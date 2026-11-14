import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { commandExists, runProcess, sanitizedEnvironment } from '../lib/process.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';

const SCANNERS = Object.freeze({
  'osv-scanner': { command: 'osv-scanner', versionArgs: ['--version'], args: (root) => ['scan', 'source', '-r', '--format', 'json', '--all-packages', root], ecosystems: ['all-lockfiles'], description: 'OSV Scanner recursive source/lockfile scan.' },
  'cargo-audit': { command: 'cargo-audit', executable: 'cargo', versionArgs: ['audit', '--version'], args: () => ['audit', '--json'], requires: ['Cargo.lock'], ecosystems: ['rust'], description: 'RustSec audit of Cargo.lock.' },
  govulncheck: { command: 'govulncheck', versionArgs: ['-version'], args: () => ['-json', './...'], requires: ['go.mod'], ecosystems: ['go'], description: 'Go vulnerability analysis using the Go vulnerability database.' },
  'pip-audit': { command: 'pip-audit', versionArgs: ['--version'], args: () => ['--requirement', 'requirements.txt', '--format', 'json'], requires: ['requirements.txt'], ecosystems: ['python-requirements'], description: 'Python requirements vulnerability audit.' },
  'composer-audit': { command: 'composer', versionArgs: ['--version'], args: () => ['audit', '--format=json'], requires: ['composer.lock'], ecosystems: ['php'], description: 'Composer dependency advisory audit.' },
  'dotnet-audit': { command: 'dotnet', versionArgs: ['--version'], args: () => ['list', 'package', '--vulnerable', '--include-transitive', '--format', 'json'], requiresAny: ['*.sln', '*.csproj'], ecosystems: ['dotnet'], description: '.NET vulnerable-package report.' }
});

async function regular(root, relative) {
  const file = path.join(root, relative);
  const info = await fs.lstat(file).catch(() => null);
  return info?.isFile() && !info.isSymbolicLink() ? file : null;
}

async function projectRoot(projectPath) {
  const root = path.resolve(projectPath);
  const info = await fs.lstat(root).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('Security scan target must be a real, non-symlink directory.');
  return root;
}

function countDetectedPackages(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) { for (const child of value) countDetectedPackages(child, seen); return seen.size; }
  const packageName = value.package?.name || value.name || value.module;
  const version = value.package?.version || value.version || value.installedVersion;
  if (typeof packageName === 'string' && packageName.length && typeof version === 'string' && version.length) {
    seen.add(`${packageName}@${version}`);
  }
  for (const child of Object.values(value)) countDetectedPackages(child, seen);
  return seen.size;
}

function findAdvisories(value, output = [], seen = new Set(), context = {}) {
  if (!value || typeof value !== 'object' || output.length >= 5000) return output;
  if (Array.isArray(value)) { for (const child of value) findAdvisories(child, output, seen, context); return output; }
  const packageName = value.package?.name || value.package?.Name || (typeof value.name === 'string' ? value.name : null) || context.packageName;
  const packageVersion = value.package?.version || value.version || value.installedVersion || context.packageVersion;
  const severity = (typeof value.severity === 'string' ? value.severity : null)
    || (typeof value.database_specific?.severity === 'string' ? value.database_specific.severity : null)
    || (typeof value.max_severity === 'string' ? value.max_severity : null)
    || context.severity;
  const childContext = { packageName, packageVersion, severity };
  const id = value.id || value.alias || value.advisory_id || value.vulnerability_id;
  if (typeof id === 'string' && /^(?:CVE-|GHSA-|OSV-|RUSTSEC-|GO-\d{4}-)/i.test(id)) {
    const key = `${id}:${packageName || ''}:${value.affected?.ranges?.[0]?.events?.[0]?.introduced || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push({
        id: id.slice(0, 100),
        package: String(packageName || value.module || '').slice(0, 180) || null,
        version: String(packageVersion || '').slice(0, 80) || null,
        severity: String(severity || value.ratings?.[0]?.severity || 'unknown').slice(0, 40),
        summary: redactSensitiveText(String(value.summary || value.title || value.details || '').slice(0, 400)).text || null
      });
    }
  }
  for (const child of Object.values(value)) findAdvisories(child, output, seen, childContext);
  return output;
}

export async function listNativeSecurityScanners({ exists = commandExists, runner = runProcess } = {}) {
  const results = [];
  for (const [id, item] of Object.entries(SCANNERS)) {
    const executable = item.executable || item.command;
    const hostAvailable = await exists(executable);
    let available = hostAvailable;
    let availabilityNote = hostAvailable ? 'command found' : `missing ${executable}`;
    // cargo-audit is a Cargo subcommand, not a standalone executable. Verify the subcommand itself.
    if (id === 'cargo-audit' && hostAvailable) {
      const check = await runner('cargo', ['audit', '--version'], { capture: true, tee: false, timeoutMs: 5000, maxOutputBytes: 12000, env: sanitizedEnvironment() });
      available = check.code === 0;
      availabilityNote = available ? 'cargo audit subcommand available' : 'cargo exists but cargo-audit subcommand was not found';
    }
    results.push({ id, command: executable, hostAvailable, available, availabilityNote, ecosystems: item.ecosystems, description: item.description, requires: item.requires || item.requiresAny || [] });
  }
  return results;
}

export async function runNativeVulnerabilityScan({ scanner, projectPath = process.cwd(), online = false, confirm = false, runner = runProcess, exists = commandExists, timeoutMs = 180000 } = {}) {
  const adapter = SCANNERS[scanner];
  if (!adapter) throw new Error(`Unknown native scanner '${scanner}'. Available: ${Object.keys(SCANNERS).join(', ')}.`);
  if (!online || !confirm) throw new Error('Native vulnerability scans may contact advisory services. Pass --online --confirm after reviewing the project and scanner.');
  const root = await projectRoot(projectPath);
  for (const relative of adapter.requires || []) if (!(await regular(root, relative))) throw new Error(`${scanner} requires ${relative} in the selected project.`);
  if (adapter.requiresAny) {
    const entries = await fs.readdir(root);
    const matches = adapter.requiresAny.some((pattern) => pattern === '*.sln' ? entries.some((name) => name.endsWith('.sln')) : pattern === '*.csproj' ? entries.some((name) => name.endsWith('.csproj')) : false);
    if (!matches) throw new Error(`${scanner} requires a solution or project file (${adapter.requiresAny.join(', ')}).`);
  }
  const executable = adapter.executable || adapter.command;
  if (!(await exists(executable))) return { schemaVersion: 1, reportType: 'paxi-native-vulnerability-scan', scanner, status: 'tool-missing', complete: false, clean: false, note: `Install ${executable} deliberately and rerun. No scan was executed.` };
  const versionResult = await runner(executable, adapter.versionArgs || ['--version'], { capture: true, tee: false, timeoutMs: 10000, maxOutputBytes: 4096, env: { ...sanitizedEnvironment(), CI: '1', NO_COLOR: '1' } });
  const scannerVersion = versionResult.code === 0 && !versionResult.outputTruncated ? redactSensitiveText(String(versionResult.stdout || versionResult.stderr || '').trim().split(/\r?\n/)[0]).text.slice(0, 200) || 'unknown' : 'unknown';
  const args = adapter.args(root);
  const startedAt = Date.now();
  const result = await runner(executable, args, { cwd: root, capture: true, tee: false, timeoutMs, maxOutputBytes: 4 * 1024 * 1024, env: { ...sanitizedEnvironment(), CI: '1', NO_COLOR: '1' } });
  const stdout = redactSensitiveText(result.stdout || '').text;
  const stderr = redactSensitiveText(result.stderr || '').text;
  let parsed = null;
  try { parsed = JSON.parse(stdout); } catch {}
  // govulncheck emits a JSON stream; retain records as JSON lines when possible.
  if (!parsed && scanner === 'govulncheck') {
    const records = [];
    for (const line of stdout.split(/\r?\n/).slice(0, 20000)) { try { records.push(JSON.parse(line)); } catch {} }
    if (records.length) parsed = records;
  }
  const advisories = parsed ? findAdvisories(parsed) : [];
  const packagesScanned = parsed ? countDetectedPackages(parsed) : 0;
  const timedOut = Boolean(result.timedOut);
  const outputTruncated = Boolean(result.outputTruncated);
  const status = timedOut ? 'timed-out' : outputTruncated ? 'incomplete-output' : result.code === 0 ? parsed ? (advisories.length ? 'completed-with-findings' : packagesScanned ? 'completed-no-findings-reported' : 'completed-coverage-unknown') : 'completed-unparsed' : parsed ? 'completed-with-findings-or-errors' : 'failed';
  return {
    schemaVersion: 1, reportType: 'paxi-native-vulnerability-scan', executionKind: 'confirmed-online-native-advisory-scan',
    scanner, command: executable, scannerVersion, status, complete: Boolean(parsed) && packagesScanned > 0 && !timedOut && !outputTruncated, clean: Boolean(parsed) && packagesScanned > 0 && advisories.length === 0 && result.code === 0 && !timedOut && !outputTruncated,
    exitCode: result.code, timedOut, outputTruncated, outputBytes: Number.isFinite(result.outputBytes) ? result.outputBytes : null, durationMs: Date.now() - startedAt,
    advisories, summary: { advisoryRecords: advisories.length, packagesScanned, outputParsed: Boolean(parsed), coverageKnown: packagesScanned > 0 && !outputTruncated, coverageComplete: !outputTruncated },
    outputExcerpt: stdout.slice(0, 12000), errorExcerpt: stderr.slice(0, 3000),
    limitations: ['This scan contacts external advisory data sources; the exact database freshness depends on the selected scanner.', 'A zero-exit scan is not labeled clean when output cannot be parsed or the tool reports no package/version inventory to establish coverage.', 'Scanner coverage depends on lockfiles, supported ecosystems and tool version. Review direct/transitive reachability and fix suggestions before changing dependencies.']
  };
}

async function ensureOutputPath(outputPath, overwrite) {
  const target = path.resolve(outputPath);
  const parent = path.dirname(target);
  const parts = path.parse(parent);
  let current = parts.root;
  for (const segment of parent.slice(parts.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await fs.lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error('SBOM output path cannot traverse symbolic links.');
  }
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const existing = await fs.lstat(target).catch(() => null);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error('SBOM output must be a regular file path.');
  if (existing && !overwrite) throw new Error('SBOM output already exists. Choose another path or pass --overwrite.');
  return target;
}

export async function generateProjectSbom({ projectPath = process.cwd(), outputPath = 'paxi-sbom.cdx.json', format = 'cyclonedx-json', confirm = false, overwrite = false, runner = runProcess, exists = commandExists } = {}) {
  if (!confirm) throw new Error('SBOM generation reads the project filesystem and writes a component inventory. Pass --confirm after reviewing the target.');
  if (!['cyclonedx-json', 'spdx-json'].includes(format)) throw new Error('SBOM format must be cyclonedx-json or spdx-json.');
  const root = await projectRoot(projectPath);
  if (!(await exists('syft'))) return { schemaVersion: 1, reportType: 'paxi-sbom-generation', status: 'tool-missing', complete: false, note: 'Syft is not installed. Install it deliberately; PAXI does not download security tools.' };
  const target = await ensureOutputPath(outputPath, overwrite);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-sbom-'));
  const tempFile = path.join(tempRoot, 'sbom.json');
  try {
    const result = await runner('syft', ['scan', `dir:${root}`, '-o', `${format}=${tempFile}`, '--base-path', root, '-q'], {
      cwd: root, capture: true, tee: false, timeoutMs: 180000, maxOutputBytes: 256 * 1024, env: { ...sanitizedEnvironment(), NO_COLOR: '1' }
    });
    if (result.code !== 0) throw new Error(`Syft failed with exit code ${result.code}: ${String(result.stderr || result.error || '').slice(0, 800)}`);
    const raw = await fs.readFile(tempFile, 'utf8');
    if (Buffer.byteLength(raw) > 50 * 1024 * 1024) throw new Error('Generated SBOM exceeds 50 MiB.');
    const document = JSON.parse(raw);
    const components = Array.isArray(document.components) ? document.components : Array.isArray(document.packages) ? document.packages : [];
    const valid = format === 'cyclonedx-json' ? document.bomFormat === 'CycloneDX' && Array.isArray(document.components) : typeof document.spdxVersion === 'string' && Array.isArray(document.packages);
    if (!valid) throw new Error(`Syft output did not match the requested ${format} structure.`);
    if (overwrite) await fs.copyFile(tempFile, target);
    else await fs.copyFile(tempFile, target, fs.constants.COPYFILE_EXCL);
    return {
      schemaVersion: 1, reportType: 'paxi-sbom-generation', executionKind: 'local-syft-filesystem-inventory',
      status: 'generated', complete: true, format, outputPath: target,
      summary: { components: components.length, licensesPresent: components.filter((item) => item.licenses?.length || item.licenseConcluded).length },
      artifact: { bytes: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex') },
      limitations: ['This is a local component inventory. It is not a vulnerability scan or proof that listed components are safe.', 'Syft cataloging depends on files and package metadata available in the project tree. Enrichment and registry access were not enabled by PAXI.']
    };
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
}
