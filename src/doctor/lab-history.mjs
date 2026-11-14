import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_DIR, DOCTOR_LAB_RUNS_FILE } from '../lib/paths.mjs';
import { readJson, updateJsonSecure } from '../lib/safe-store.mjs';
import { comparePngFiles } from './visual-regression.mjs';

const HISTORY_DIR = path.join(CONFIG_DIR, 'doctor-reports', 'history');
const MAX_REPORT_BYTES = 4 * 1024 * 1024;

function issueCodes(items = []) {
  return [...new Set((Array.isArray(items) ? items : []).map((item) => item?.code).filter((value) => typeof value === 'string'))].sort();
}

async function readArchivedReport(entry) {
  if (typeof entry?.archivePath !== 'string') throw new Error(`Run ${entry?.runId || '(unknown)'} has no archived report. Only runs recorded by this release can be compared.`);
  const file = path.resolve(entry.archivePath);
  const expectedRoot = path.resolve(HISTORY_DIR) + path.sep;
  if (!file.startsWith(expectedRoot)) throw new Error('Run history contains a report path outside the protected PAXI history directory.');
  const historyInfo = await fs.lstat(HISTORY_DIR).catch(() => null);
  if (!historyInfo?.isDirectory() || historyInfo.isSymbolicLink()) throw new Error('PAXI Device Lab history directory is not safe to read.');
  const info = await fs.lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_REPORT_BYTES) throw new Error('Archived report is missing, not a regular file, or exceeds the 4 MiB safety limit.');
  const text = await fs.readFile(file, 'utf8');
  let report;
  try { report = JSON.parse(text); } catch { throw new Error('Archived Device Lab report is not valid JSON.'); }
  if (report?.runId !== entry.runId || typeof report?.runner !== 'string') throw new Error('Archived report identity does not match run history.');
  return report;
}

export async function recordLabRun(report, extra = {}) {
  if (!report || typeof report.runId !== 'string' || typeof report.runner !== 'string') throw new Error('Cannot archive a Device Lab report without a run ID and runner.');
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const configInfo = await fs.lstat(CONFIG_DIR);
  if (!configInfo.isDirectory() || configInfo.isSymbolicLink()) throw new Error('PAXI config directory must be a regular directory, not a symbolic link.');
  await fs.mkdir(HISTORY_DIR, { recursive: true, mode: 0o700 });
  const historyInfo = await fs.lstat(HISTORY_DIR);
  if (!historyInfo.isDirectory() || historyInfo.isSymbolicLink()) throw new Error('PAXI Device Lab history directory must be a regular directory, not a symbolic link.');
  const archivePath = path.join(HISTORY_DIR, `${report.runId}.json`);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_REPORT_BYTES) throw new Error('Device Lab report exceeds the 4 MiB local history archive limit.');
  const handle = await fs.open(archivePath, 'wx', 0o600).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(`A Device Lab archive already exists for run ${report.runId}.`);
  });
  try { await handle.writeFile(serialized); } finally { await handle.close(); }
  let retainedIds = [];
  await updateJsonSecure(DOCTOR_LAB_RUNS_FILE, { schemaVersion: 1, runs: [] }, (current) => {
    const runs = Array.isArray(current?.runs) ? current.runs.filter((item) => item && typeof item.runId === 'string') : [];
    const nextRuns = [{
        runId: report.runId,
        completedAt: report.completedAt || new Date().toISOString(),
        runner: report.runner,
        executionKind: report.executionKind || null,
        summary: report.summary || null,
        targetUrl: report.targetUrl || null,
        device: report.device ? { model: report.device.model, type: report.device.type, androidRelease: report.device.androidRelease, detectedProfile: report.device.detectedProfile } : null,
        reportPath: report.reportPath || null,
        evidenceDirectory: report.reportDirectory || null,
        archivePath,
        ...extra
      }, ...runs.filter((item) => item.runId !== report.runId)].slice(0, 30);
    retainedIds = nextRuns.map((item) => item.runId);
    return { schemaVersion: 1, runs: nextRuns };
  });
  const keep = new Set(retainedIds);
  const files = await fs.readdir(HISTORY_DIR).catch(() => []);
  for (const name of files) {
    if (!name.endsWith('.json') || keep.has(name.slice(0, -5))) continue;
    await fs.unlink(path.join(HISTORY_DIR, name)).catch(() => {});
  }
  return archivePath;
}

export async function listLabRuns() {
  const history = await readJson(DOCTOR_LAB_RUNS_FILE, { schemaVersion: 1, runs: [] });
  return Array.isArray(history?.runs) ? history.runs.slice(0, 30) : [];
}

export async function compareLabRuns(beforeRunId, afterRunId) {
  if (!beforeRunId || !afterRunId || beforeRunId === afterRunId) throw new Error('Choose two different Device Lab run IDs to compare.');
  const history = await listLabRuns();
  const beforeEntry = history.find((item) => item.runId === beforeRunId);
  const afterEntry = history.find((item) => item.runId === afterRunId);
  if (!beforeEntry || !afterEntry) throw new Error('One or both run IDs were not found in the local Device Lab history.');
  const [before, after] = await Promise.all([readArchivedReport(beforeEntry), readArchivedReport(afterEntry)]);
  if (before.runner !== after.runner || before.executionKind !== after.executionKind) {
    return { comparable: false, beforeRunId, afterRunId, reason: 'Runs use different Device Lab runners or execution environments. Compare matching browser, emulator or physical-device run types.' };
  }
  if (Array.isArray(before.results) && Array.isArray(after.results)) {
    const left = new Map(before.results.map((item) => [item.id, item]));
    const right = new Map(after.results.map((item) => [item.id, item]));
    const cases = [];
    const visualComparisons = [];
    const safeScreenshot = (report, screenshotPath) => {
      if (typeof screenshotPath !== 'string' || typeof report.reportDirectory !== 'string') return null;
      const root = path.resolve(report.reportDirectory);
      const candidate = path.resolve(screenshotPath);
      const relative = path.relative(root, candidate);
      return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? candidate : null;
    };
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id);
      const b = right.get(id);
      if (!a || !b) {
        cases.push({ id, change: a ? 'removed-from-after-run' : 'added-in-after-run', beforeStatus: a?.status || null, afterStatus: b?.status || null });
        continue;
      }
      const oldCodes = issueCodes(a.issues);
      const newCodes = issueCodes(b.issues);
      const introducedIssues = newCodes.filter((code) => !oldCodes.includes(code));
      const resolvedIssues = oldCodes.filter((code) => !newCodes.includes(code));
      const caseChanges = { id, beforeStatus: a.status, afterStatus: b.status, introducedIssues, resolvedIssues };
      const beforeScreenshot = safeScreenshot(before, a.evidence?.screenshot);
      const afterScreenshot = safeScreenshot(after, b.evidence?.screenshot);
      if (beforeScreenshot && afterScreenshot) {
        try {
          caseChanges.visualComparison = await comparePngFiles(beforeScreenshot, afterScreenshot);
          visualComparisons.push({ id, ...caseChanges.visualComparison });
        } catch (error) {
          caseChanges.visualComparison = { comparable: false, reason: String(error.message || error).slice(0, 300) };
        }
      }
      if (a.status !== b.status || introducedIssues.length || resolvedIssues.length || (caseChanges.visualComparison?.comparable && !caseChanges.visualComparison.passed)) cases.push(caseChanges);
    }
    return {
      comparable: true,
      comparisonKind: before.executionKind === 'simulated-browser-semantic-journey' ? 'browser-semantic-journey-results' : 'browser-viewport-results',
      beforeRunId,
      afterRunId,
      summary: {
        before: before.summary || null,
        after: after.summary || null,
        improvedCases: cases.filter((item) => ['failed', 'review'].includes(item.beforeStatus) && item.afterStatus === 'passed').length,
        regressedCases: cases.filter((item) => item.beforeStatus === 'passed' && ['failed', 'review'].includes(item.afterStatus)).length,
        changedCases: cases.length,
        visualComparisons: visualComparisons.length,
        visualRegressions: visualComparisons.filter((item) => item.comparable && !item.passed).length
      },
      cases,
      visualComparisons,
      limitation: before.executionKind === 'simulated-browser-semantic-journey' ? 'Compares semantic journey step statuses and issue codes. A matching journey name and step IDs do not prove identical backend state; review the full reports and environment metadata.' : 'Browser runs now compare compatible PNG screenshots pixel by pixel when evidence paths are present; font rasterization and dynamic content can still cause noise. Physical-device screenshots from different hardware are not assumed to be directly comparable.'
    };
  }
  const compareFields = (left, right, prefix = '') => {
    const changes = [];
    const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
    for (const key of keys) {
      const a = left?.[key]; const b = right?.[key];
      const label = prefix ? `${prefix}.${key}` : key;
      if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) changes.push(...compareFields(a, b, label));
      else if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ field: label, before: a ?? null, after: b ?? null });
    }
    return changes;
  };
  return {
    comparable: true,
    comparisonKind: 'device-snapshot',
    beforeRunId,
    afterRunId,
    changes: [
      ...compareFields(before.device, after.device, 'device'),
      ...compareFields(before.conditionsObserved, after.conditionsObserved, 'conditionsObserved')
    ],
    limitation: 'Compares device metadata and observed condition values. Screenshots are saved separately and are not pixel-diffed.'
  };
}
