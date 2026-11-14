import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DOCTOR_AGENT_MEMORY_FILE } from '../lib/paths.mjs';
import { readJson, updateJsonSecure } from '../lib/safe-store.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';

const MAX_PROJECTS = 12;
const MAX_NOTES_PER_PROJECT = 20;
const MAX_NOTE_CHARS = 800;

async function projectIdentity(projectPath) {
  const root = path.resolve(projectPath);
  const info = await fs.lstat(root).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('Project memory requires a real, non-symlink project directory.');
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 24);
  return { root, projectId: digest, projectName: path.basename(root).slice(0, 80) || 'project' };
}

function normalizeStore(value) {
  const projects = Array.isArray(value?.projects) ? value.projects : [];
  return projects.filter((item) => item && /^[a-f0-9]{24}$/.test(item.projectId) && typeof item.projectName === 'string' && Array.isArray(item.notes))
    .slice(0, MAX_PROJECTS).map((item) => ({
      projectId: item.projectId,
      projectName: item.projectName.slice(0, 80),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
      notes: item.notes.filter((note) => note && typeof note.id === 'string' && typeof note.text === 'string')
        .slice(0, MAX_NOTES_PER_PROJECT).map((note) => ({ id: note.id.slice(0, 36), text: note.text.slice(0, MAX_NOTE_CHARS), createdAt: typeof note.createdAt === 'string' ? note.createdAt : null }))
    }));
}

export async function listProjectMemory(projectPath = process.cwd()) {
  const identity = await projectIdentity(projectPath);
  const store = normalizeStore(await readJson(DOCTOR_AGENT_MEMORY_FILE, { schemaVersion: 1, projects: [] }));
  const match = store.find((item) => item.projectId === identity.projectId);
  return { ...identity, notes: match?.notes || [], updatedAt: match?.updatedAt || null, storage: 'local-only' };
}

export async function rememberProjectNote(projectPath = process.cwd(), noteText) {
  const identity = await projectIdentity(projectPath);
  if (typeof noteText !== 'string' || !noteText.trim() || noteText.length > MAX_NOTE_CHARS || /[\0]/.test(noteText)) {
    throw new Error(`Project memory note must contain 1–${MAX_NOTE_CHARS} characters.`);
  }
  const redacted = redactSensitiveText(noteText.trim());
  if (!redacted.text.trim()) throw new Error('The note is empty after sensitive-value redaction.');
  const now = new Date().toISOString();
  const entry = { id: randomUUID(), text: redacted.text.slice(0, MAX_NOTE_CHARS), createdAt: now };
  await updateJsonSecure(DOCTOR_AGENT_MEMORY_FILE, { schemaVersion: 1, projects: [] }, (current) => {
    const projects = normalizeStore(current).filter((item) => item.projectId !== identity.projectId);
    const prior = normalizeStore(current).find((item) => item.projectId === identity.projectId);
    const notes = [...(prior?.notes || []), entry].slice(-MAX_NOTES_PER_PROJECT);
    projects.unshift({ projectId: identity.projectId, projectName: identity.projectName, updatedAt: now, notes });
    return { schemaVersion: 1, updatedAt: now, projects: projects.slice(0, MAX_PROJECTS) };
  });
  return { ...identity, note: entry, redacted: redacted.redacted, redactionCategories: redacted.categories, storage: 'local-only' };
}

export async function forgetProjectNote(projectPath = process.cwd(), noteId) {
  const identity = await projectIdentity(projectPath);
  if (typeof noteId !== 'string' || !/^[0-9a-f-]{36}$/i.test(noteId)) throw new Error('A valid note ID is required.');
  let removed = false;
  await updateJsonSecure(DOCTOR_AGENT_MEMORY_FILE, { schemaVersion: 1, projects: [] }, (current) => {
    const projects = normalizeStore(current).map((item) => {
      if (item.projectId !== identity.projectId) return item;
      const notes = item.notes.filter((note) => { if (note.id === noteId) removed = true; return note.id !== noteId; });
      return { ...item, notes, updatedAt: new Date().toISOString() };
    }).filter((item) => item.notes.length > 0);
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), projects };
  });
  return { removed, projectId: identity.projectId };
}

export async function clearProjectMemory(projectPath = process.cwd()) {
  const identity = await projectIdentity(projectPath);
  let removed = 0;
  await updateJsonSecure(DOCTOR_AGENT_MEMORY_FILE, { schemaVersion: 1, projects: [] }, (current) => {
    const projects = normalizeStore(current).filter((item) => {
      if (item.projectId === identity.projectId) { removed = item.notes.length; return false; }
      return true;
    });
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), projects };
  });
  return { removed, projectId: identity.projectId };
}
