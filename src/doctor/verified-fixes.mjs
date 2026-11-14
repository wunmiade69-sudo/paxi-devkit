import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DOCTOR_VERIFIED_FIXES_FILE } from '../lib/paths.mjs';
import { readJson, updateJsonSecure } from '../lib/safe-store.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';

const MAX_PROJECTS = 12;
const MAX_RECORDS = 30;
const MAX_FILES = 12;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;

function projectId(root) { return createHash('sha256').update(root).digest('hex').slice(0, 24); }

async function identity(projectPath) {
  const root = path.resolve(projectPath);
  const info = await fs.lstat(root).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('Verified-fix learning requires a real, non-symlink project directory.');
  return { root, projectId: projectId(root), projectName: path.basename(root).slice(0, 80) || 'project' };
}

function normalizeStore(value) {
  return (Array.isArray(value?.projects) ? value.projects : []).filter((p) => p && /^[a-f0-9]{24}$/.test(p.projectId) && Array.isArray(p.records)).slice(0, MAX_PROJECTS).map((p) => ({
    projectId: p.projectId,
    projectName: String(p.projectName || 'project').slice(0, 80),
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : null,
    records: p.records.filter((r) => r && typeof r.id === 'string' && typeof r.summary === 'string' && Array.isArray(r.files)).slice(-MAX_RECORDS).map((r) => ({
      id: r.id.slice(0, 36), summary: r.summary.slice(0, 240), createdAt: typeof r.createdAt === 'string' ? r.createdAt : null,
      evidence: r.evidence && typeof r.evidence === 'object' ? { runId: String(r.evidence.runId || '').slice(0, 80), reportSha256: String(r.evidence.reportSha256 || '').slice(0, 64), total: Number(r.evidence.total) || 0, passed: Number(r.evidence.passed) || 0, reports: Array.isArray(r.evidence.reports) ? r.evidence.reports.slice(0, 8).map((item) => ({ type: String(item.type || 'unknown').slice(0, 40), executionKind: String(item.executionKind || '').slice(0, 80), runId: String(item.runId || '').slice(0, 80), reportSha256: String(item.reportSha256 || '').slice(0, 64), passed: Number(item.passed) || 0, total: Number(item.total) || 0, assurance: String(item.assurance || '').slice(0, 80) })) : [] } : null,
      files: r.files.filter((f) => f && typeof f.path === 'string' && /^[a-f0-9]{64}$/.test(f.sha256)).slice(0, MAX_FILES).map((f) => ({ path: f.path.slice(0, 300), sha256: f.sha256 }))
    }))
  }));
}

async function hashProjectFile(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath) || relativePath.length > 300) throw new Error('Each --file must be a project-relative path.');
  const normalized = path.normalize(relativePath);
  if (normalized === '.' || normalized.startsWith(`..${path.sep}`) || normalized === '..') throw new Error('Verified-fix file paths must remain inside the project.');
  const full = path.resolve(root, normalized);
  if (!full.startsWith(`${root}${path.sep}`)) throw new Error('Verified-fix file paths must remain inside the project.');
  let current = root;
  for (const part of normalized.split(path.sep)) {
    current = path.join(current, part);
    const info = await fs.lstat(current).catch(() => null);
    if (!info) throw new Error(`Verified-fix source file does not exist: ${normalized}`);
    if (info.isSymbolicLink()) throw new Error(`Verified-fix source file cannot traverse a symlink: ${normalized}`);
  }
  const info = await fs.lstat(full);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error(`Verified-fix source must be a regular file no larger than 2 MiB: ${normalized}`);
  const hash = createHash('sha256').update(await fs.readFile(full)).digest('hex');
  return { path: normalized.split(path.sep).join('/'), sha256: hash };
}

function validatePassingEvidence(report, fileName) {
  if (!report || typeof report !== 'object' || !report.completedAt || Number.isNaN(Date.parse(report.completedAt))) throw new Error(`Evidence ${fileName} is missing a valid completion timestamp.`);
  if (report.executionKind === 'confirmed-read-only-api-smoke-tests') {
    const summary = report.summary;
    if (!summary || !Number.isInteger(summary.total) || summary.total < 1 || summary.failed !== 0 || summary.passed !== summary.total || !Array.isArray(report.results) || report.results.length !== summary.total || report.results.some((item) => item.status !== 'passed')) throw new Error(`API evidence ${fileName} did not pass every case.`);
    return { type: 'api', executionKind: report.executionKind, runId: String(report.runId || '').slice(0, 80), passed: summary.passed, total: summary.total, assurance: 'confirmed-read-only-api-smoke' };
  }
  if (report.runner === 'playwright-chromium' && report.executionKind === 'simulated-browser-viewport') {
    const summary = report.summary;
    if (!summary || !Number.isInteger(summary.total) || summary.total < 1 || summary.failed !== 0 || summary.review !== 0 || summary.passed !== summary.total || !Array.isArray(report.results) || report.results.length !== summary.total || report.results.some((item) => item.status !== 'passed')) throw new Error(`Website evidence ${fileName} did not pass every viewport case without review findings.`);
    return { type: 'website', executionKind: report.executionKind, runId: String(report.runId || '').slice(0, 80), passed: summary.passed, total: summary.total, assurance: 'simulated-browser-viewport-only' };
  }
  if (report.reportType === 'paxi-semantic-website-journey' && typeof report.runner === 'string' && report.runner.startsWith('playwright-') && report.executionKind === 'simulated-browser-semantic-journey') {
    const summary = report.summary;
    if (report.status !== 'completed' || report.journeyPassClaim !== true || !summary || !Number.isInteger(summary.total) || summary.total < 1 || summary.failed !== 0 || !Number.isInteger(summary.expectedAssertions) || summary.expectedAssertions < 1 || summary.assertions < summary.expectedAssertions || !Array.isArray(report.results) || report.results.length !== summary.total || report.results.some((item) => item.status !== 'passed')) throw new Error(`Semantic website evidence ${fileName} must complete every step and pass at least one explicit assertion.`);
    if ((report.issues || []).some((item) => item.severity === 'error')) throw new Error(`Semantic website evidence ${fileName} contains an error-level runtime issue.`);
    return { type: 'website-semantic', executionKind: report.executionKind, runId: String(report.runId || '').slice(0, 80), passed: summary.passed, total: summary.total, assurance: 'simulated-semantic-browser-journey-only' };
  }
  if (report.runner === 'adb-android-user-journey' && report.executionKind === 'physical-android-device') {
    const summary = report.summary;
    if (report.device?.type !== 'physical-device' || report.journeyPassClaim !== true || report.status !== 'completed' || !summary || summary.failed !== 0 || summary.assertions < 1 || !report.crashScan?.available || (report.crashScan.signals || []).length || (report.issues || []).length) throw new Error(`Android evidence ${fileName} is not a fully passing scripted journey on a physical Android device.`);
    return { type: 'android-physical', executionKind: report.executionKind, runId: String(report.runId || '').slice(0, 80), passed: Number(summary.passed) || 0, total: Number(summary.steps) || 0, assurance: 'scripted-journey-on-physical-android; not full-device-certification' };
  }
  if (report.runner === 'adb-android-user-journey' && report.executionKind === 'android-emulator') throw new Error(`Android evidence ${fileName} came from an emulator. Emulator results can be correlated, but verified-fix memory requires a physical-device run for this evidence type.`);
  throw new Error(`Unsupported verified-fix evidence ${fileName}. Supply passing PAXI API, website viewport or physical Android journey reports.`);
}

export async function recordVerifiedFix({ projectPath = process.cwd(), evidencePath = null, evidencePaths = [], summary, files = [], confirm = false } = {}) {
  if (!confirm) throw new Error('Verified-fix learning stores a project memory record. Review the passing reports and pass --confirm.');
  const paths = [...new Set([...(Array.isArray(evidencePaths) ? evidencePaths : []), ...(evidencePath ? [evidencePath] : [])])];
  if (!paths.length || paths.length > 8) throw new Error('Verified-fix learning requires 1–8 --evidence <saved-PAXI-test-report.json> files.');
  if (typeof summary !== 'string' || !summary.trim() || summary.length > 240) throw new Error('Supply a concise --summary between 1 and 240 characters.');
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw new Error(`Supply 1–${MAX_FILES} project-relative --file paths identifying the corrected code.`);
  const project = await identity(projectPath);
  const evidenceReports = [];
  for (const item of paths) {
    const reportPath = path.resolve(item);
    const reportInfo = await fs.lstat(reportPath).catch(() => null);
    if (!reportInfo?.isFile() || reportInfo.isSymbolicLink() || reportInfo.size > MAX_REPORT_BYTES) throw new Error('Each evidence input must be a regular, non-symlink report within the 2 MiB limit.');
    const raw = await fs.readFile(reportPath);
    if (raw.includes(0)) throw new Error(`Evidence ${path.basename(reportPath)} must be UTF-8 JSON.`);
    let report;
    try { report = JSON.parse(raw.toString('utf8')); } catch { throw new Error(`Evidence ${path.basename(reportPath)} is not valid JSON.`); }
    const verified = validatePassingEvidence(report, path.basename(reportPath));
    evidenceReports.push({ ...verified, reportSha256: createHash('sha256').update(raw).digest('hex') });
  }
  const redacted = redactSensitiveText(summary.trim());
  const fileSnapshots = [];
  for (const file of [...new Set(files)]) fileSnapshots.push(await hashProjectFile(project.root, file));
  const now = new Date().toISOString();
  const total = evidenceReports.reduce((sum, item) => sum + item.total, 0);
  const passed = evidenceReports.reduce((sum, item) => sum + item.passed, 0);
  const record = {
    id: randomUUID(),
    summary: redacted.text.slice(0, 240),
    createdAt: now,
    evidence: {
      runId: evidenceReports[0].runId,
      reportSha256: evidenceReports[0].reportSha256,
      total, passed,
      reports: evidenceReports
    },
    files: fileSnapshots
  };
  await updateJsonSecure(DOCTOR_VERIFIED_FIXES_FILE, { schemaVersion: 2, projects: [] }, (current) => {
    const projects = normalizeStore(current);
    const previous = projects.find((item) => item.projectId === project.projectId);
    const next = projects.filter((item) => item.projectId !== project.projectId);
    next.unshift({ projectId: project.projectId, projectName: project.projectName, updatedAt: now, records: [...(previous?.records || []), record].slice(-MAX_RECORDS) });
    return { schemaVersion: 2, updatedAt: now, projects: next.slice(0, MAX_PROJECTS) };
  });
  const types = [...new Set(evidenceReports.map((item) => item.type))];
  return { projectName: project.projectName, record, redacted: redacted.redacted, storage: 'local-only', verification: evidenceReports.length === 1 && types[0] === 'api' ? 'all API regression cases passed' : `all submitted ${types.join(', ')} evidence passed`, assurance: evidenceReports.map((item) => item.assurance) };
}

export async function listVerifiedFixes(projectPath = process.cwd()) {
  const project = await identity(projectPath);
  const store = normalizeStore(await readJson(DOCTOR_VERIFIED_FIXES_FILE, { schemaVersion: 1, projects: [] }));
  const match = store.find((item) => item.projectId === project.projectId);
  const records = [];
  for (const record of match?.records || []) {
    let changed = false;
    for (const file of record.files) {
      try { const current = await hashProjectFile(project.root, file.path); if (current.sha256 !== file.sha256) changed = true; }
      catch { changed = true; }
    }
    records.push({ ...record, freshness: changed ? 'stale-source-changed' : 'source-snapshot-unchanged' });
  }
  return { ...project, records, count: records.length, storage: 'local-only', note: 'A saved record links to passing API, browser-viewport or physical Android journey reports at the recorded time. Browser results are simulations (viewport and semantic journeys); Android proof covers only the scripted assertions, not full device certification. Source fingerprints indicate whether selected files changed since that snapshot.' };
}

export async function clearVerifiedFixes(projectPath = process.cwd()) {
  const project = await identity(projectPath);
  let removed = 0;
  await updateJsonSecure(DOCTOR_VERIFIED_FIXES_FILE, { schemaVersion: 1, projects: [] }, (current) => {
    const projects = normalizeStore(current).filter((item) => { if (item.projectId === project.projectId) { removed = item.records.length; return false; } return true; });
    return { schemaVersion: 1, updatedAt: new Date().toISOString(), projects };
  });
  return { removed, projectId: project.projectId };
}
