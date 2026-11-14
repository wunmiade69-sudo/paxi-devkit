import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runProcess, commandExists, sanitizedEnvironment } from '../lib/process.mjs';

const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const MAX_FINDINGS = 5000;
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,127}$/;

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
async function hashFile(file) { const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex'); }
function safeText(value, limit = 500) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit) : ''; }
function normalizeSeverity(value) {
  const severity = String(value || '').toLowerCase();
  if (['critical', 'high', 'medium', 'moderate', 'low', 'info', 'informational', 'error', 'warning'].includes(severity)) return severity === 'moderate' || severity === 'warning' ? 'medium' : severity === 'informational' ? 'info' : severity === 'error' ? 'high' : severity;
  return 'unknown';
}
async function projectRoot(projectPath) {
  const root = path.resolve(projectPath);
  const info = await fs.lstat(root).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('Security project path must be an existing directory and must not be a symlink.');
  return root;
}
async function readBoundedJson(file, maxBytes = MAX_REPORT_BYTES) {
  const info = await fs.lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error('Scanner report is missing, not a regular file, or exceeds the report size limit.');
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}
function incompleteBase(scanner, note, extra = {}) {
  return { schemaVersion: 1, reportType: 'paxi-security-tool', scanner, status: 'not-run', complete: false, findings: [], summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 }, note, ...extra };
}
function findingSummary(findings) {
  const summary = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 };
  for (const item of findings) summary[item.severity in summary ? item.severity : 'unknown'] += 1;
  return summary;
}
function safeGitleaksFindings(records) {
  return records.slice(0, MAX_FINDINGS).map((item) => ({
    code: safeText(item.RuleID || item.ruleID || 'secret-detected', 100),
    severity: 'critical', confidence: 'scanner',
    file: safeText(item.File || item.file || '', 300),
    line: Number.isInteger(item.StartLine) ? item.StartLine : Number.isInteger(item.startLine) ? item.startLine : null,
    fingerprint: safeText(item.Fingerprint || item.fingerprint || '', 180),
    message: 'A potential secret was detected. The matched secret value and source snippet were intentionally discarded.'
  }));
}
function safeSemgrepFindings(records) {
  return records.slice(0, MAX_FINDINGS).map((item) => ({
    code: safeText(item.check_id || item.rule_id || 'semgrep-finding', 180),
    severity: normalizeSeverity(item.extra?.severity || item.severity),
    confidence: safeText(item.extra?.metadata?.confidence || 'scanner', 40),
    file: safeText(item.path || '', 300),
    line: Number.isInteger(item.start?.line) ? item.start.line : null,
    message: safeText(item.extra?.message || item.message || 'Static analysis finding.', 500)
  }));
}
function safeTrivyFindings(document) {
  const findings = [];
  for (const result of (Array.isArray(document.Results) ? document.Results : []).slice(0, 1000)) {
    for (const item of (Array.isArray(result.Vulnerabilities) ? result.Vulnerabilities : [])) {
      findings.push({ code: safeText(item.VulnerabilityID || 'vulnerability', 100), severity: normalizeSeverity(item.Severity), confidence: 'scanner', file: safeText(result.Target || '', 300), package: safeText(item.PkgName || '', 160), installedVersion: safeText(item.InstalledVersion || '', 100), fixedVersion: safeText(item.FixedVersion || '', 100), message: safeText(item.Title || item.Description || 'Dependency vulnerability reported.', 500) });
    }
    for (const item of (Array.isArray(result.Misconfigurations) ? result.Misconfigurations : [])) {
      findings.push({ code: safeText(item.ID || 'misconfiguration', 100), severity: normalizeSeverity(item.Severity), confidence: 'scanner', file: safeText(result.Target || '', 300), message: safeText(item.Title || item.Message || 'Infrastructure misconfiguration reported.', 500) });
    }
    for (const item of (Array.isArray(result.Secrets) ? result.Secrets : [])) {
      findings.push({ code: safeText(item.RuleID || 'secret-detected', 100), severity: normalizeSeverity(item.Severity || 'high'), confidence: 'scanner', file: safeText(result.Target || '', 300), line: Number.isInteger(item.StartLine) ? item.StartLine : null, message: 'A potential secret was detected. Secret values and code snippets were discarded.' });
    }
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings.slice(0, MAX_FINDINGS);
}
function safeSlitherFindings(document) {
  const detectors = Array.isArray(document?.results?.detectors) ? document.results.detectors : [];
  return detectors.slice(0, MAX_FINDINGS).map((item) => ({
    code: safeText(item.check || item.impact || 'slither-detector', 120),
    severity: normalizeSeverity(item.impact === 'High' ? 'high' : item.impact === 'Medium' ? 'medium' : item.impact === 'Low' ? 'low' : 'unknown'),
    confidence: safeText(item.confidence || 'scanner', 40),
    message: safeText(item.description || item.markdown || 'Static smart-contract analysis finding.', 700),
    elements: Array.isArray(item.elements) ? item.elements.slice(0, 20).map((element) => ({ type: safeText(element.type, 60), name: safeText(element.name, 160), source: safeText(element.source_mapping?.filename_relative || '', 240), lineStart: Number.isInteger(element.source_mapping?.lines?.[0]) ? element.source_mapping.lines[0] : null })) : []
  }));
}
function ensureConsent({ confirm, online = false }) {
  if (!confirm) throw new Error('Security scans inspect project code or artifacts and may invoke native scanners. Review the target and pass --confirm.');
  if (online) return;
}
async function invokeTool({ tool, args, cwd, timeoutMs = 180000, runner = runProcess, maxOutputBytes = 2 * 1024 * 1024 }) {
  return runner(tool, args, { cwd, capture: true, tee: false, timeoutMs, maxOutputBytes, env: { ...sanitizedEnvironment(), NO_COLOR: '1' } });
}

export async function listAdvancedSecurityTools({ exists = commandExists } = {}) {
  const tools = [
    ['gitleaks', 'Secret detection in working trees and bounded Git history'],
    ['semgrep', 'Static application security testing'],
    ['trivy', 'Filesystem vulnerability, secret and misconfiguration scanning'],
    ['slither', 'Solidity static analysis'],
    ['solc', 'Local Solidity compiler required by Slither'],
    ['apkanalyzer', 'Android APK manifest inspection'],
    ['apksigner', 'Android APK signature verification']
  ];
  return Promise.all(tools.map(async ([id, description]) => ({ id, description, available: await exists(id) })));
}

export async function scanSecrets({ projectPath = process.cwd(), confirm = false, history = false, historyLimit = 1000, runner = runProcess, exists = commandExists } = {}) {
  ensureConsent({ confirm });
  const root = await projectRoot(projectPath);
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 1000) throw new Error('Git history limit must be between 1 and 1000 commits.');
  if (!(await exists('gitleaks'))) return incompleteBase('gitleaks', 'Gitleaks is not installed. Install it separately; PAXI does not download security tools.');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-gitleaks-'));
  const reportFile = path.join(tempRoot, 'report.json');
  try {
    const args = ['detect', '--source', root, '--report-format', 'json', '--report-path', reportFile, '--redact', '--no-banner', '--exit-code', '0'];
    if (history) args.push('--log-opts', `-n ${historyLimit}`);
    const result = await invokeTool({ tool: 'gitleaks', args, cwd: root, runner, timeoutMs: 240000, maxOutputBytes: 256 * 1024 });
    if (result.timedOut || result.cancelled) return incompleteBase('gitleaks', result.timedOut ? 'Gitleaks timed out; scan is incomplete.' : 'Gitleaks was cancelled; scan is incomplete.', { executionKind: history ? 'local-git-history' : 'local-working-tree' });
    if (result.outputTruncated) return incompleteBase('gitleaks', 'Gitleaks process output was truncated; scan status is incomplete.', { executionKind: history ? 'local-git-history' : 'local-working-tree' });
    const document = await readBoundedJson(reportFile).catch((error) => { throw new Error(`Gitleaks did not produce a valid bounded JSON report: ${error.message}`); });
    if (!Array.isArray(document)) throw new Error('Gitleaks report shape was not an array.');
    const findings = safeGitleaksFindings(document);
    const complete = result.code === 0 || result.code === 1;
    return { schemaVersion: 1, reportType: 'paxi-security-tool', scanner: 'gitleaks', status: complete ? (findings.length ? 'findings' : 'clean') : 'incomplete', complete, executionKind: history ? 'local-git-history' : 'local-working-tree', historyLimit: history ? historyLimit : null, findings, summary: { ...findingSummary(findings), truncatedFindings: document.length > MAX_FINDINGS }, scannerExitCode: result.code, outputTruncated: Boolean(result.outputTruncated), note: 'Secret values, matched lines and source snippets are never retained in this report.' };
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
}

export async function runSemgrepSast({ projectPath = process.cwd(), rulesPath = null, online = false, confirm = false, runner = runProcess, exists = commandExists } = {}) {
  ensureConsent({ confirm, online });
  const root = await projectRoot(projectPath);
  if (!rulesPath && !online) throw new Error('Offline Semgrep requires a local rules file via --rules. Registry configuration requires --online --confirm.');
  if (online && !confirm) throw new Error('Online Semgrep rules may contact a registry. Pass --online --confirm after reviewing the target.');
  if (rulesPath) {
    const absolute = path.resolve(rulesPath); const info = await fs.lstat(absolute).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) throw new Error('Semgrep rules must be a local regular file no larger than 2 MiB.');
  }
  if (!(await exists('semgrep'))) return incompleteBase('semgrep', 'Semgrep is not installed. Install it separately; PAXI does not download security tools.');
  const args = ['scan', '--json', '--metrics', 'off', '--quiet', '--no-git-ignore'];
  args.push('--config', rulesPath ? path.resolve(rulesPath) : 'auto', root);
  const result = await invokeTool({ tool: 'semgrep', args, cwd: root, runner, timeoutMs: 300000, maxOutputBytes: 8 * 1024 * 1024 });
  if (result.timedOut || result.cancelled || result.outputTruncated) return incompleteBase('semgrep', result.timedOut ? 'Semgrep timed out.' : result.cancelled ? 'Semgrep was cancelled.' : 'Semgrep JSON output was truncated.', { outputTruncated: Boolean(result.outputTruncated), online });
  let document;
  try { document = JSON.parse(result.stdout || '{}'); } catch { return incompleteBase('semgrep', 'Semgrep did not return parseable JSON.'); }
  if (!Array.isArray(document.results)) return incompleteBase('semgrep', 'Semgrep JSON report did not contain a results array.');
  const findings = safeSemgrepFindings(document.results);
  const errors = Array.isArray(document.errors) ? document.errors.length : 0;
  const complete = errors === 0 && [0, 1].includes(result.code);
  return { schemaVersion: 1, reportType: 'paxi-security-tool', scanner: 'semgrep', status: !complete ? 'incomplete' : findings.length ? 'findings' : 'clean', complete, executionKind: online ? 'local-scanner-online-rules' : 'local-scanner-local-rules', findings, summary: { ...findingSummary(findings), scannerErrors: errors, truncatedFindings: document.results.length > MAX_FINDINGS }, scannerExitCode: result.code, note: errors ? 'Semgrep reported scanner errors; findings may be incomplete.' : 'Semgrep output was normalized; source snippets and metavariables were discarded.' };
}

export async function runTrivyFilesystemScan({ projectPath = process.cwd(), online = false, confirm = false, runner = runProcess, exists = commandExists } = {}) {
  ensureConsent({ confirm, online });
  const root = await projectRoot(projectPath);
  if (online && !confirm) throw new Error('Online Trivy database updates require --online --confirm.');
  if (!(await exists('trivy'))) return incompleteBase('trivy', 'Trivy is not installed. Install it separately; PAXI does not download security tools.');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-trivy-'));
  const reportFile = path.join(tempRoot, 'report.json');
  try {
    const args = ['fs', '--scanners', 'vuln,misconfig,secret', '--format', 'json', '--output', reportFile, '--exit-code', '0'];
    if (!online) args.push('--skip-db-update');
    args.push(root);
    const result = await invokeTool({ tool: 'trivy', args, cwd: root, runner, timeoutMs: 600000, maxOutputBytes: 512 * 1024 });
    if (result.timedOut || result.cancelled || result.outputTruncated) return incompleteBase('trivy', result.timedOut ? 'Trivy timed out.' : result.cancelled ? 'Trivy was cancelled.' : 'Trivy process output was truncated.', { outputTruncated: Boolean(result.outputTruncated) });
    const document = await readBoundedJson(reportFile).catch((error) => { throw new Error(`Trivy did not produce a valid bounded JSON report: ${error.message}`); });
    const findings = safeTrivyFindings(document);
    const report = document.Metadata || document.Report || {};
    const complete = [0, 1].includes(result.code) && Array.isArray(document.Results);
    return { schemaVersion: 1, reportType: 'paxi-security-tool', scanner: 'trivy', status: !complete ? 'incomplete' : findings.length ? 'findings' : 'clean', complete, executionKind: online ? 'local-trivy-online-db' : 'local-trivy-cached-db', findings, summary: { ...findingSummary(findings), results: Array.isArray(document.Results) ? document.Results.length : 0 }, scannerExitCode: result.code, database: { updatedAt: safeText(document.Metadata?.UpdatedAt || '', 80), version: safeText(document.Metadata?.Version || '', 80) }, note: 'Secret matches are reduced to rule/file/line metadata; secret values and code snippets are discarded.' };
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
}

export async function runSlitherSingleFile({ filePath, confirm = false, runner = runProcess, exists = commandExists } = {}) {
  ensureConsent({ confirm });
  if (!filePath) throw new Error('Solidity analysis requires --file <single.sol>.');
  const absolute = path.resolve(filePath); const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || path.extname(absolute).toLowerCase() !== '.sol' || info.size > 5 * 1024 * 1024) throw new Error('Slither requires one single .sol file (regular file, up to 5 MiB); directories and symlinks are refused.');
  if (!(await exists('slither'))) return incompleteBase('slither', 'Slither is not installed. Install it separately; PAXI does not download security tools.');
  if (!(await exists('solc'))) return incompleteBase('slither', 'A local solc compiler is required. Install and select it deliberately; PAXI will not fetch compilers.');
  const result = await invokeTool({ tool: 'slither', args: [absolute, '--json', '-'], cwd: path.dirname(absolute), runner, timeoutMs: 300000, maxOutputBytes: 8 * 1024 * 1024 });
  if (result.timedOut || result.cancelled || result.outputTruncated) return incompleteBase('slither', result.timedOut ? 'Slither timed out.' : result.cancelled ? 'Slither was cancelled.' : 'Slither output was truncated.', { outputTruncated: Boolean(result.outputTruncated) });
  let document;
  try { document = JSON.parse(result.stdout || '{}'); } catch { return incompleteBase('slither', 'Slither did not return parseable JSON; compiler or analysis output may have been mixed into stdout.', { scannerExitCode: result.code }); }
  const findings = safeSlitherFindings(document);
  const hasDetectors = Array.isArray(document?.results?.detectors);
  const complete = hasDetectors && !result.outputTruncated && [0, 1].includes(result.code);
  return { schemaVersion: 1, reportType: 'paxi-security-tool', scanner: 'slither', status: !complete ? 'incomplete' : findings.length ? 'findings' : 'clean', complete, executionKind: 'local-single-solidity-file', file: path.basename(absolute), findings, summary: { ...findingSummary(findings) }, scannerExitCode: result.code, note: 'Single-file static analysis only. This is not a full project build, formal verification or proof of contract security.' };
}

export async function inspectAndroidApk({ filePath, confirm = false, runner = runProcess, exists = commandExists } = {}) {
  ensureConsent({ confirm });
  if (!filePath) throw new Error('APK inspection requires --file <app.apk>.');
  const absolute = path.resolve(filePath); const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || path.extname(absolute).toLowerCase() !== '.apk' || info.size > 1024 * 1024 * 1024) throw new Error('APK inspection requires a regular .apk file up to 1 GiB; symlinks are refused.');
  if (!(await exists('apkanalyzer'))) return incompleteBase('android-apk', 'Android SDK apkanalyzer is not installed.');
  if (!(await exists('apksigner'))) return incompleteBase('android-apk', 'Android SDK apksigner is not installed.');
  const manifest = await invokeTool({ tool: 'apkanalyzer', args: ['manifest', 'print', absolute], cwd: path.dirname(absolute), runner, timeoutMs: 60000, maxOutputBytes: 2 * 1024 * 1024 });
  const signature = await invokeTool({ tool: 'apksigner', args: ['verify', '--verbose', '--print-certs', absolute], cwd: path.dirname(absolute), runner, timeoutMs: 60000, maxOutputBytes: 512 * 1024 });
  const truncated = manifest.outputTruncated || signature.outputTruncated;
  const manifestComplete = manifest.code === 0 && !manifest.timedOut && !manifest.cancelled && !manifest.outputTruncated;
  const signatureComplete = signature.code === 0 && !signature.timedOut && !signature.cancelled && !signature.outputTruncated;
  if (!manifestComplete) return incompleteBase('android-apk', 'APK manifest could not be completely decoded.', { outputTruncated: Boolean(truncated), signatureStatus: signatureComplete ? 'verified' : 'not-verified' });
  const xml = manifest.stdout;
  const findings = [];
  const add = (code, severity, message) => findings.push({ code, severity, confidence: 'static-manifest', file: path.basename(absolute), message });
  if (/\bandroid:debuggable\s*=\s*"true"/i.test(xml)) add('apk-debuggable', 'high', 'APK manifest enables debugging. Confirm this is not a production build.');
  if (/\bandroid:usesCleartextTraffic\s*=\s*"true"/i.test(xml)) add('apk-cleartext-traffic', 'high', 'APK manifest permits cleartext network traffic.');
  if (/\bandroid:allowBackup\s*=\s*"true"/i.test(xml)) add('apk-backup-enabled', 'medium', 'APK allows Android backup. Review whether sensitive application data is excluded.');
  const exported = [...xml.matchAll(/<(activity|activity-alias|service|receiver|provider)\b[^>]*\bandroid:exported\s*=\s*"true"[^>]*>/gi)];
  for (const match of exported.slice(0, 100)) {
    const tag = match[1].toLowerCase();
    const tagText = match[0];
    if (!/android:permission\s*=/.test(tagText) && !/android:exported\s*=\s*"false"/.test(tagText)) add(`apk-exported-${tag}`, 'medium', `An exported ${tag} has no component-level android:permission attribute. Review its intent filters and authorization.`);
  }
  const certMatch = signature.stdout.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9:]+)/i);
  const complete = signatureComplete;
  return { schemaVersion: 1, reportType: 'paxi-security-tool', scanner: 'android-apk', status: !complete ? 'incomplete' : findings.length ? 'findings' : 'clean', complete: manifestComplete && signatureComplete, executionKind: 'local-static-apk-analysis', artifact: { file: path.basename(absolute), bytes: info.size, sha256: await hashFile(absolute) }, signature: { verified: signatureComplete, certificateSha256: certMatch ? certMatch[1].replace(/:/g, '').toLowerCase() : null, note: signatureComplete ? 'apksigner verification succeeded; certificate trust/publisher identity is not independently established.' : safeText(signature.stderr || signature.error, 300) }, findings, summary: findingSummary(findings), outputTruncated: Boolean(truncated), note: 'APK was not installed or executed. Manifest parsing is heuristic; binary resources and runtime behavior are not covered.' };
}

function loopback(hostname) { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase()); }
export async function checkWebSecurityHeaders({ url, confirm = false, allowRemote = false, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  ensureConsent({ confirm });
  let target;
  try { target = new URL(url); } catch { throw new Error('Web security check requires a valid --url.'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('Web security URL must be HTTP(S), without credentials, query or fragment.');
  if (!loopback(target.hostname) && (!allowRemote || target.protocol !== 'https:')) throw new Error('Remote website security checks require HTTPS plus --allow-remote --confirm.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(target, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'PAXI-Doctor-Security/2.7' } });
    const headers = response.headers;
    await response.body?.cancel().catch(() => {});
    const findings = [];
    const add = (code, severity, message) => findings.push({ code, severity, confidence: 'http-response', file: target.origin, message });
    const csp = headers.get('content-security-policy');
    if (!csp) add('web-missing-csp', 'medium', 'Content-Security-Policy header is missing.');
    else if (/\bunsafe-inline\b|\bunsafe-eval\b/.test(csp)) add('web-weak-csp', 'medium', 'CSP contains unsafe-inline or unsafe-eval. Review whether nonces or hashes can replace them.');
    if (target.protocol === 'https:' && !headers.get('strict-transport-security')) add('web-missing-hsts', 'medium', 'Strict-Transport-Security header is missing on HTTPS.');
    if (!headers.get('x-content-type-options')?.toLowerCase().includes('nosniff')) add('web-missing-nosniff', 'low', 'X-Content-Type-Options: nosniff is missing.');
    if (!headers.get('referrer-policy')) add('web-missing-referrer-policy', 'low', 'Referrer-Policy is missing.');
    const frame = headers.get('x-frame-options');
    if (!frame && !(csp || '').includes('frame-ancestors')) add('web-missing-framing-protection', 'medium', 'X-Frame-Options and CSP frame-ancestors are both absent.');
    const setCookie = headers.get('set-cookie') || '';
    if (setCookie && !/;\s*secure(?:;|$)/i.test(setCookie)) add('cookie-missing-secure', 'medium', 'At least one observed Set-Cookie header may be missing Secure.');
    if (setCookie && !/;\s*httponly(?:;|$)/i.test(setCookie)) add('cookie-missing-httponly', 'medium', 'At least one observed Set-Cookie header may be missing HttpOnly.');
    if (/access-control-allow-origin\s*:\s*\*/i.test(headers.get('access-control-allow-origin') || '') && /true/i.test(headers.get('access-control-allow-credentials') || '')) add('web-cors-wildcard-credentials', 'high', 'Wildcard Access-Control-Allow-Origin appears with credentialed CORS.');
    return { schemaVersion: 1, reportType: 'paxi-security-tool', scanner: 'web-headers', status: findings.length ? 'findings' : 'clean', complete: true, executionKind: loopback(target.hostname) ? 'loopback-http-check' : 'remote-https-check', target: `${target.origin}${target.pathname}`, httpStatus: response.status, findings, summary: findingSummary(findings), note: 'Single GET response only; this is not a complete web application penetration test. Cookies are not retained.' };
  } catch (error) {
    return { ...incompleteBase('web-headers', error.name === 'AbortError' ? 'Website header check timed out.' : `Website header check failed: ${safeText(error.message, 200)}`), target: target.origin };
  } finally { clearTimeout(timer); }
}

export async function testApiObjectAuthorization({ planPath, confirm = false, allowRemote = false, ownerTokenEnv = 'PAXI_TEST_OWNER_TOKEN', otherTokenEnv = 'PAXI_TEST_OTHER_TOKEN', timeoutMs = 8000, fetchImpl = fetch } = {}) {
  ensureConsent({ confirm });
  if (!planPath) throw new Error('API authorization check requires --plan <plan.json>.');
  for (const name of [ownerTokenEnv, otherTokenEnv]) if (!ENV_NAME.test(name)) throw new Error('Token environment variable names must be simple uppercase environment identifiers.');
  if (ownerTokenEnv === otherTokenEnv) throw new Error('Owner and non-owner token variables must be different.');
  const ownerToken = process.env[ownerTokenEnv]; const otherToken = process.env[otherTokenEnv];
  if (!ownerToken || !otherToken || ownerToken === otherToken) throw new Error('Set two distinct test-user tokens in the configured owner and non-owner environment variables.');
  const info = await fs.lstat(planPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new Error('Authorization plan must be a local regular JSON file up to 64 KiB.');
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  if (!Array.isArray(plan.cases) || !plan.cases.length || plan.cases.length > 25) throw new Error('Authorization plan must contain 1–25 test cases.');
  const results = [];
  for (const item of plan.cases) {
    if (item.method !== 'GET' || typeof item.url !== 'string' || !Array.isArray(item.ownerExpected) || !Array.isArray(item.nonOwnerExpected) || item.ownerExpected.length === 0 || item.nonOwnerExpected.length === 0) throw new Error('Each authorization case must define GET url, ownerExpected statuses and nonOwnerExpected statuses.');
    if (item.ownerExpected.some((code) => !Number.isInteger(code) || code < 200 || code > 299)) throw new Error('Owner expected statuses must be 2xx codes.');
    if (item.nonOwnerExpected.some((code) => ![403, 404].includes(code))) throw new Error('Non-owner expected statuses must be 403 or 404; a 2xx response is never an acceptable non-owner result.');
    const target = new URL(item.url);
    if (target.username || target.password || target.hash || target.search || !['http:', 'https:'].includes(target.protocol)) throw new Error('Authorization test URLs must be HTTP(S), without credentials or fragments.');
    if (!loopback(target.hostname) && (!allowRemote || target.protocol !== 'https:')) throw new Error('Remote authorization tests require HTTPS plus --allow-remote --confirm.');
    const one = async (token) => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
      try { const response = await fetchImpl(target, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }); await response.body?.cancel().catch(() => {}); return { status: response.status, ok: response.ok }; }
      catch (error) { return { status: null, error: error.name === 'AbortError' ? 'timeout' : safeText(error.message, 160) }; }
      finally { clearTimeout(timer); }
    };
    const owner = await one(ownerToken); const nonOwner = await one(otherToken);
    results.push({ id: safeText(item.id || `case-${results.length + 1}`, 80), method: 'GET', target: `${target.origin}${target.pathname}`, ownerStatus: owner.status, nonOwnerStatus: nonOwner.status, ownerAllowed: item.ownerExpected.includes(owner.status), nonOwnerDenied: item.nonOwnerExpected.includes(nonOwner.status), complete: owner.status !== null && nonOwner.status !== null });
  }
  const complete = results.every((item) => item.complete);
  const passed = results.filter((item) => item.ownerAllowed && item.nonOwnerDenied && item.complete).length;
  return { schemaVersion: 1, reportType: 'paxi-security-api-authz', status: !complete ? 'incomplete' : passed === results.length ? 'passed' : 'findings', complete, executionKind: 'paired-test-account-get-only', results, summary: { total: results.length, passed, failed: results.length - passed }, note: 'Only supplied GET routes were called. Response bodies, authorization tokens and token values were not retained. Use an isolated staging environment and test accounts.' };
}

export async function doctorAdvancedSecurityCommand(args = []) {
  const [action, ...rest] = args;
  const supported = ['advanced-tools', 'secrets', 'sast', 'trivy', 'contracts', 'apk', 'web', 'api-authz'];
  if (!supported.includes(action)) throw new Error(`Advanced security command must be one of: ${supported.join(', ')}.`);
  let projectPath = process.cwd(); let filePath = null; let rulesPath = null; let planPath = null;
  let confirm = false; let online = false; let history = false; let historyLimit = 1000; let allowRemote = false; let json = false;
  let ownerTokenEnv = 'PAXI_TEST_OWNER_TOKEN'; let otherTokenEnv = 'PAXI_TEST_OTHER_TOKEN'; let timeoutMs = 8000;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--confirm') confirm = true;
    else if (arg === '--online') online = true;
    else if (arg === '--history') history = true;
    else if (arg === '--allow-remote') allowRemote = true;
    else if (arg === '--json') json = true;
    else if (arg === '--project' && rest[index + 1] && !rest[index + 1].startsWith('--')) projectPath = rest[++index];
    else if (arg === '--file' && rest[index + 1] && !rest[index + 1].startsWith('--')) filePath = rest[++index];
    else if (arg === '--rules' && rest[index + 1] && !rest[index + 1].startsWith('--')) rulesPath = rest[++index];
    else if (arg === '--plan' && rest[index + 1] && !rest[index + 1].startsWith('--')) planPath = rest[++index];
    else if (arg === '--history-limit' && /^\d+$/.test(rest[index + 1] || '')) historyLimit = Number(rest[++index]);
    else if (arg === '--owner-token-env' && rest[index + 1] && !rest[index + 1].startsWith('--')) ownerTokenEnv = rest[++index];
    else if (arg === '--other-token-env' && rest[index + 1] && !rest[index + 1].startsWith('--')) otherTokenEnv = rest[++index];
    else if (arg === '--timeout' && /^\d+$/.test(rest[index + 1] || '')) timeoutMs = Number(rest[++index]) * 1000;
    else if (arg === '--url' && rest[index + 1] && !rest[index + 1].startsWith('--')) filePath = rest[++index];
    else throw new Error(`Unrecognized advanced security option: ${arg}`);
  }
  if (timeoutMs < 1000 || timeoutMs > 30000) throw new Error('--timeout must be between 1 and 30 seconds.');
  let report;
  if (action === 'advanced-tools') {
    report = { scanners: await listAdvancedSecurityTools() };
  } else if (action === 'secrets') {
    if (filePath || rulesPath || planPath || online || allowRemote) throw new Error('secrets accepts --project, --confirm, --history, --history-limit and --json.');
    report = await scanSecrets({ projectPath, confirm, history, historyLimit });
  } else if (action === 'sast') {
    if (filePath || planPath || history || allowRemote) throw new Error('sast accepts --project, --rules, --online, --confirm and --json.');
    report = await runSemgrepSast({ projectPath, rulesPath, online, confirm });
  } else if (action === 'trivy') {
    if (filePath || rulesPath || planPath || history || allowRemote) throw new Error('trivy accepts --project, --online, --confirm and --json.');
    report = await runTrivyFilesystemScan({ projectPath, online, confirm });
  } else if (action === 'contracts') {
    if (rulesPath || planPath || history || online || allowRemote) throw new Error('contracts accepts --file, --confirm and --json.');
    report = await runSlitherSingleFile({ filePath, confirm });
  } else if (action === 'apk') {
    if (rulesPath || planPath || history || online || allowRemote) throw new Error('apk accepts --file, --confirm and --json.');
    report = await inspectAndroidApk({ filePath, confirm });
  } else if (action === 'web') {
    if (rulesPath || planPath || history || projectPath !== process.cwd()) throw new Error('web accepts --url, --allow-remote, --confirm, --timeout and --json.');
    report = await checkWebSecurityHeaders({ url: filePath, confirm, allowRemote, timeoutMs });
  } else {
    if (filePath || rulesPath || history || online || projectPath !== process.cwd() || allowRemote === false && rest.includes('--allow-remote')) throw new Error('api-authz accepts --plan, --owner-token-env, --other-token-env, --allow-remote, --confirm and --json.');
    report = await testApiObjectAuthorization({ planPath, confirm, allowRemote, ownerTokenEnv, otherTokenEnv, timeoutMs });
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else if (action === 'advanced-tools') {
    for (const tool of report.scanners) console.log(`${tool.available ? '[AVAILABLE]' : '[MISSING]'} ${tool.id} — ${tool.description}`);
  } else {
    console.log(`Security ${action}: ${String(report.status || 'unknown').toUpperCase()} · ${report.summary?.total ?? report.summary?.findings ?? 0} finding(s)`);
    if (report.note) console.log(report.note);
    for (const item of (report.findings || []).slice(0, 50)) console.log(`  [${String(item.severity || 'unknown').toUpperCase()}] ${item.code} · ${item.file || item.package || ''}${item.line ? `:${item.line}` : ''} — ${item.message}`);
    for (const item of (report.results || []).slice(0, 50)) console.log(`  [${item.ownerAllowed && item.nonOwnerDenied ? 'PASS' : 'REVIEW'}] ${item.id} · owner ${item.ownerStatus ?? 'no response'} / non-owner ${item.nonOwnerStatus ?? 'no response'}`);
    if (report.complete === false) process.exitCode = 2;
    else if (report.findings?.length || report.status === 'findings') process.exitCode = 1;
  }
  return report;
}
