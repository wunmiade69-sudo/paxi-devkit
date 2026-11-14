import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DOCTOR_AGENT_FEEDBACK_FILE } from '../lib/paths.mjs';
import { readJson, updateJsonSecure } from '../lib/safe-store.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';

const AREAS = new Set(['plan', 'diagnosis', 'model', 'patch', 'visual', 'testing', 'general']);
const DECISIONS = new Set(['accepted', 'rejected', 'modified']);
const MAX_EVENTS = 80;

function identity(projectPath) {
  const root = path.resolve(projectPath);
  return createHash('sha256').update(root).digest('hex').slice(0, 24);
}
function normalize(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && /^[a-f0-9]{24}$/.test(item.projectId) && Array.isArray(item.events)).slice(0, 16).map((item) => ({
    projectId: item.projectId,
    projectName: typeof item.projectName === 'string' ? item.projectName.slice(0, 80) : 'project',
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
    events: item.events.filter((event) => event && typeof event.id === 'string' && DECISIONS.has(event.decision) && AREAS.has(event.area)).slice(-MAX_EVENTS).map((event) => ({
      id: event.id.slice(0, 36), decision: event.decision, area: event.area,
      note: typeof event.note === 'string' ? event.note.slice(0, 400) : '',
      createdAt: typeof event.createdAt === 'string' ? event.createdAt : null
    }))
  }));
}

async function assertProject(projectPath) {
  const root = path.resolve(projectPath);
  const stat = await fs.lstat(root).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('Feedback requires a real, non-symlink project directory.');
  return { root, projectId: identity(root), projectName: path.basename(root).slice(0, 80) || 'project' };
}

export async function recordAgentFeedback(projectPath, { decision, area = 'general', note = '' } = {}) {
  const project = await assertProject(projectPath);
  if (!DECISIONS.has(decision)) throw new Error(`Decision must be one of: ${[...DECISIONS].join(', ')}.`);
  if (!AREAS.has(area)) throw new Error(`Area must be one of: ${[...AREAS].join(', ')}.`);
  if (typeof note !== 'string' || note.length > 400 || /[\0]/.test(note)) throw new Error('Feedback note must be 1–400 characters when supplied.');
  const redaction = redactSensitiveText(note.trim());
  const now = new Date().toISOString();
  const event = { id: randomUUID(), decision, area, note: redaction.text.slice(0, 400), createdAt: now };
  await updateJsonSecure(DOCTOR_AGENT_FEEDBACK_FILE, { schemaVersion: 1, projects: [] }, (current) => {
    const projects = normalize(current?.projects);
    const previous = projects.find((item) => item.projectId === project.projectId);
    const next = projects.filter((item) => item.projectId !== project.projectId);
    next.unshift({ projectId: project.projectId, projectName: project.projectName, updatedAt: now, events: [...(previous?.events || []), event].slice(-MAX_EVENTS) });
    return { schemaVersion: 1, updatedAt: now, projects: next.slice(0, 16) };
  });
  return { projectId: project.projectId, event, redacted: redaction.redacted, redactionCategories: redaction.categories, storage: 'local-only' };
}

export async function listAgentFeedback(projectPath) {
  const project = await assertProject(projectPath);
  const store = normalize((await readJson(DOCTOR_AGENT_FEEDBACK_FILE, { schemaVersion: 1, projects: [] })).projects);
  const match = store.find((item) => item.projectId === project.projectId);
  return { ...project, events: match?.events || [], storage: 'local-only' };
}

export async function summarizeAgentFeedback(projectPath) {
  const { events } = await listAgentFeedback(projectPath);
  const areas = {};
  for (const area of AREAS) {
    const matching = events.filter((event) => event.area === area);
    const accepted = matching.filter((event) => event.decision === 'accepted').length;
    const rejected = matching.filter((event) => event.decision === 'rejected').length;
    const modified = matching.filter((event) => event.decision === 'modified').length;
    const total = matching.length;
    areas[area] = {
      total, accepted, rejected, modified,
      reviewBias: total >= 3 && (rejected + modified) / total >= 0.5 ? 'extra-human-review' : total >= 3 && accepted / total >= 0.8 ? 'confidence-building' : 'neutral',
      autoApplyAllowed: false
    };
  }
  return {
    total: events.length,
    areas,
    learning: 'Only explicit accept/reject/modify feedback is counted. This changes recommendations and review emphasis, never patch approval or safety gates.',
    storage: 'local-only'
  };
}

export async function clearAgentFeedback(projectPath) {
  const project = await assertProject(projectPath);
  let removed = 0;
  await updateJsonSecure(DOCTOR_AGENT_FEEDBACK_FILE, { schemaVersion: 1, projects: [] }, (current) => {
    const projects = normalize(current?.projects).filter((item) => {
      if (item.projectId === project.projectId) { removed = item.events.length; return false; }
      return true;
    });
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), projects };
  });
  return { removed, projectId: project.projectId };
}
