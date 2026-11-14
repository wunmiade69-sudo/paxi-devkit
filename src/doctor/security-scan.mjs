import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { commandExists } from '../lib/process.mjs';

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'target', '.dart_tool', '.gradle', 'Pods', '.venv', 'venv', '__pycache__', 'coverage', '.next', '.turbo']);
const SOURCE_EXTENSIONS = new Set(['.js','.jsx','.mjs','.cjs','.ts','.tsx','.vue','.svelte','.py','.php','.java','.kt','.kts','.go','.rs','.c','.h','.cc','.cpp','.cxx','.hpp','.hh','.cs','.swift','.sol','.sql','.sh','.ps1','.yml','.yaml','.xml','.json','.toml','.properties']);
const SENSITIVE_FILE = /(?:^|\/)(?:\.env(?:\..*)?|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|[^/]+\.(?:pem|p12|pfx|jks|keystore))$/i;
const PLACEHOLDER = /^(?:change[-_ ]?me|example|sample|dummy|placeholder|your[-_ ].*|xxx+|redacted|none|null)$/i;
const MAX_FILES = 2500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const RULES = [
  { code: 'hardcoded-credential', severity: 'critical', confidence: 'medium', pattern: /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password|private[_-]?token)\s*[:=]\s*(["'`])([^\r\n]{12,}?)\1/i, message: 'Possible hardcoded credential in source. The matched value was not retained.' },
  { code: 'provider-token-literal', severity: 'critical', confidence: 'high', pattern: /\b(?:sk-[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/, message: 'A token-shaped credential literal was detected. The value was not retained.' },
  { code: 'private-key-literal', severity: 'critical', confidence: 'high', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, message: 'A private-key block appears in a project text file.' },
  { code: 'tls-verification-disabled', severity: 'high', confidence: 'high', pattern: /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|verify\s*=\s*False|ssl_verify\s*=\s*false|CURLOPT_SSL_VERIFYPEER\s*,\s*false|curl\s+[^\n]*\s-k(?:\s|$))/, message: 'TLS certificate verification appears to be disabled.' },
  { code: 'shell-true-subprocess', severity: 'high', confidence: 'high', pattern: /\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\([\s\S]{0,240}?\bshell\s*=\s*True/, message: 'A Python subprocess call enables shell parsing. Prefer argument arrays with shell disabled.' },
  { code: 'dynamic-shell-execution', severity: 'high', confidence: 'medium', pattern: /\b(?:child_process\.)?(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|[^,\n]*\+\s*[A-Za-z_$])/, message: 'A shell command may be constructed from dynamic input. Validate arguments and prefer spawn with an argument array.' },
  { code: 'dynamic-eval', severity: 'high', confidence: 'medium', pattern: /\beval\s*\(/, message: 'Dynamic eval usage was detected. Confirm that untrusted input cannot reach this call.' },
  { code: 'unsafe-html-injection', severity: 'high', confidence: 'medium', pattern: /(?:\.innerHTML\s*=|dangerouslySetInnerHTML\s*=|v-html\s*=)/, message: 'A dynamic HTML injection sink was detected. Ensure content is trusted or sanitized.' },
  { code: 'unsafe-deserialization', severity: 'high', confidence: 'medium', pattern: /\b(?:pickle\.loads|yaml\.load\s*\(|unserialize\s*\()/, message: 'Potentially unsafe deserialization was detected. Use safe formats/loaders or strict object allowlists.' },
  { code: 'permissive-cors', severity: 'medium', confidence: 'medium', pattern: /(?:origin\s*:\s*['"]\*['"][^\n]{0,120}credentials\s*:\s*true|credentials\s*:\s*true[^\n]{0,120}origin\s*:\s*['"]\*['"])/i, message: 'Wildcard CORS origin appears combined with credentialed requests.' },
  { code: 'sql-string-concatenation', severity: 'medium', confidence: 'low', pattern: /(?:query|execute|raw)\s*\([^\n]{0,160}(?:\+\s*[A-Za-z_$]|\$\{)/i, message: 'A SQL/query call may interpolate dynamic text. Prefer parameterized queries and verify the query context.' },
  { code: 'solidity-tx-origin', severity: 'high', confidence: 'medium', pattern: /\btx\.origin\b/, message: 'Solidity uses tx.origin. Check for phishing-sensitive authorization; prefer msg.sender with explicit role checks.' },
  { code: 'solidity-delegatecall', severity: 'high', confidence: 'medium', pattern: /\.delegatecall\s*\(/, message: 'Solidity delegatecall was detected. Review target control, storage layout and authorization.' },
  { code: 'solidity-selfdestruct', severity: 'high', confidence: 'medium', pattern: /\bselfdestruct\s*\(/, message: 'Solidity selfdestruct usage was detected. Review compiler/EVM semantics and whether this behavior is intended.' },
  { code: 'unsafe-c-string', severity: 'high', confidence: 'medium', pattern: /\b(?:gets|strcpy|strcat|sprintf)\s*\(/, message: 'A C/C++ memory-unsafe string function was detected. Prefer bounded alternatives and validate buffer sizes.' },
  { code: 'webview-javascript-bridge', severity: 'medium', confidence: 'medium', pattern: /\baddJavascriptInterface\s*\(/, message: 'Android WebView JavaScript bridge usage was detected. Restrict trusted origins and exposed methods.' },
  { code: 'android-cleartext-traffic', severity: 'medium', confidence: 'high', pattern: /usesCleartextTraffic\s*=\s*["']true["']/i, message: 'Android manifest permits cleartext network traffic. Confirm this is limited to development if required.' }
];

function safeRelative(root, file) { return path.relative(root, file).split(path.sep).join('/').slice(0, 240); }
async function collect(root) {
  const files = []; const sensitive = []; let totalBytes = 0; let truncated = false;
  async function walk(directory, depth = 0) {
    if (depth > 18 || files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) { truncated = true; return; }
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) { truncated = true; break; }
      const full = path.join(directory, entry.name); const relative = safeRelative(root, full);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!IGNORE_DIRS.has(entry.name)) await walk(full, depth + 1); continue; }
      if (!entry.isFile()) continue;
      if (SENSITIVE_FILE.test(relative)) { sensitive.push(relative); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      const manifest = /^(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|composer\.json|composer\.lock|pyproject\.toml|requirements[^/]*\.txt|requirements|Pipfile(?:\.lock)?|pom\.xml|build\.gradle(?:\.kts)?|gradle\.lockfile|libs\.versions\.toml|Gemfile(?:\.lock)?|Package\.swift|Package\.resolved|pubspec\.ya?ml|pubspec\.lock|poetry\.lock|uv\.lock|foundry\.toml|packages\.lock\.json|Directory\.Packages\.props|packages\.config|[^/]+\.csproj)$/i.test(entry.name);
      if (!manifest && !SOURCE_EXTENSIONS.has(ext)) continue;
      const info = await fs.lstat(full).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink()) continue;
      if (info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_TOTAL_BYTES) { truncated = true; continue; }
      files.push({ full, relative, size: info.size, manifest }); totalBytes += info.size;
    }
  }
  await walk(root);
  return { files, sensitive, totalBytes, truncated };
}

async function dependencyInventory(files) {
  const manifests = files.filter((item) => item.manifest).map((item) => item.relative).slice(0, 100);
  const packageFile = files.find((item) => item.relative === 'package.json');
  let packageSummary = null;
  if (packageFile) {
    try {
      const parsed = JSON.parse(await fs.readFile(packageFile.full, 'utf8'));
      const dependencies = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}), ...(parsed.optionalDependencies || {}) };
      const lifecycleScripts = Object.keys(parsed.scripts || {}).filter((name) => ['preinstall','install','postinstall','prepare'].includes(name));
      const floating = Object.entries(dependencies).filter(([, version]) => typeof version === 'string' && /^(?:\*|latest|x|git\+|https?:)/i.test(version)).map(([name]) => name).slice(0, 60);
      packageSummary = { name: typeof parsed.name === 'string' ? parsed.name.slice(0, 80) : null, directDependencyCount: Object.keys(dependencies).length, lifecycleScripts, floatingOrNonRegistrySpecs: floating };
    } catch { packageSummary = { parseError: true }; }
  }

  const ecosystemSpecs = [
    { id: 'npm', manifests: ['package.json'], locks: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'] },
    { id: 'cargo', manifests: ['Cargo.toml'], locks: ['Cargo.lock'] },
    { id: 'go', manifests: ['go.mod'], locks: ['go.sum'] },
    { id: 'python', manifests: ['pyproject.toml', 'requirements.txt', 'requirements', 'Pipfile'], locks: ['Pipfile.lock', 'poetry.lock', 'uv.lock'] },
    { id: 'composer', manifests: ['composer.json'], locks: ['composer.lock'] },
    { id: 'maven', manifests: ['pom.xml'], locks: [] },
    { id: 'gradle', manifests: ['build.gradle', 'build.gradle.kts', 'libs.versions.toml'], locks: ['gradle.lockfile'] },
    { id: 'ruby', manifests: ['Gemfile'], locks: ['Gemfile.lock'] },
    { id: 'swift', manifests: ['Package.swift'], locks: ['Package.resolved'] },
    { id: 'dart-flutter', manifests: ['pubspec.yaml'], locks: ['pubspec.lock'] },
    { id: 'dotnet', manifests: ['.csproj', 'Directory.Packages.props', 'packages.config'], locks: ['packages.lock.json'] }
  ];
  const ecosystems = [];
  for (const spec of ecosystemSpecs) {
    const related = files.filter((item) => {
      const base = path.basename(item.relative);
      return item.manifest && (spec.manifests.includes(base) || spec.manifests.includes(base.toLowerCase()) || (spec.id === 'python' && /^requirements(?:[^/]*\.txt)?$/i.test(base)) || spec.manifests.some((value) => value.startsWith('.') && base.toLowerCase().endsWith(value.toLowerCase())) || spec.locks.includes(base));
    });
    if (!related.length) continue;
    let declared = 0; let lockEntries = 0; const notes = [];
    for (const file of related) {
      const base = path.basename(file.relative);
      const text = await fs.readFile(file.full, 'utf8').catch(() => '');
      if (!text || text.includes('\0')) continue;
      try {
        if (base === 'package.json') {
          const value = JSON.parse(text);
          declared += Object.keys({ ...(value.dependencies || {}), ...(value.devDependencies || {}), ...(value.optionalDependencies || {}) }).length;
        } else if (base === 'Cargo.toml') {
          let inDeps = false;
          for (const line of text.split(/\r?\n/)) {
            const section = line.match(/^\s*\[([^\]]+)\]/)?.[1] || '';
            if (section) inDeps = /(?:^|\.)(?:dev-|build-)?dependencies$/.test(section);
            else if (inDeps && /^\s*[A-Za-z0-9_-]+\s*=/.test(line) && !/^\s*(?:#|\[)/.test(line)) declared += 1;
          }
        } else if (base === 'Cargo.lock') lockEntries += (text.match(/^\[\[package\]\]/gm) || []).length;
        else if (base === 'go.mod') {
          let inRequire = false;
          for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (/^require\s*\($/.test(trimmed)) { inRequire = true; continue; }
            if (inRequire && trimmed === ')') { inRequire = false; continue; }
            if ((inRequire && /^[^/\s][^\s]+\s+v\S+/.test(trimmed)) || /^require\s+\S+\s+v\S+/.test(trimmed)) declared += 1;
          }
        } else if (base === 'go.sum') lockEntries += new Set(text.split(/\r?\n/).map((line) => line.trim().split(/\s+/).slice(0, 2).join(' ')).filter(Boolean)).size;
        else if (/^requirements[^/]*\.txt$/i.test(base) || base === 'requirements') declared += text.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#') && !/^(?:-r\s|-e\s|--)/.test(line.trim())).length;
        else if (base === 'pyproject.toml') {
          const projectDeps = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1] || '';
          const optionalDeps = text.match(/optional-dependencies\s*=\s*\{([\s\S]*?)\}/m)?.[1] || '';
          const poetryDeps = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?=\n\[|$)/)?.[1] || '';
          declared += (projectDeps.match(/['"][^'"]+['"]/g) || []).length + (optionalDeps.match(/['"][^'"]+['"]/g) || []).length + poetryDeps.split(/\r?\n/).filter((line) => /^\s*[A-Za-z0-9_.-]+\s*=/.test(line)).length;
        } else if (base === 'Pipfile') {
          let inDeps = false;
          for (const line of text.split(/\r?\n/)) { if (/^\s*\[(packages|dev-packages)\]/.test(line)) { inDeps = true; continue; } if (/^\s*\[/.test(line)) { inDeps = false; continue; } if (inDeps && /^\s*[A-Za-z0-9_.-]+\s*=/.test(line)) declared += 1; }
        } else if (base === 'composer.json') { const value = JSON.parse(text); declared += Object.keys({ ...(value.require || {}), ...(value['require-dev'] || {}) }).length; }
        else if (base === 'composer.lock') { const value = JSON.parse(text); lockEntries += (value.packages || []).length + (value['packages-dev'] || []).length; }
        else if (base === 'pom.xml') declared += (text.match(/<dependency\s*>/g) || []).length;
        else if (base.startsWith('build.gradle')) declared += (text.match(/\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|classpath)\s*(?:\(|\s)/g) || []).length;
        else if (base === 'libs.versions.toml') declared += (text.match(/^\s*[A-Za-z0-9_.-]+\s*=/gm) || []).length;
        else if (base === 'Gemfile') declared += (text.match(/^\s*gem\s+['"]/gm) || []).length;
        else if (base === 'Gemfile.lock') lockEntries += (text.match(/^    [A-Za-z0-9_.-]+ \(/gm) || []).length;
        else if (base === 'Package.swift') declared += (text.match(/\.package\s*\(/g) || []).length;
        else if (base === 'pubspec.yaml') {
          let inDeps = false;
          for (const line of text.split(/\r?\n/)) { if (/^(dependencies|dev_dependencies):\s*$/.test(line)) { inDeps = true; continue; } if (/^\S/.test(line) && !/^(dependencies|dev_dependencies):/.test(line)) inDeps = false; if (inDeps && /^\s{2}[A-Za-z0-9_-]+:/.test(line) && !/sdk:\s/.test(line)) declared += 1; }
        } else if (base.endsWith('.csproj') || base === 'Directory.Packages.props') declared += (text.match(/<PackageReference\b/g) || []).length;
        else if (base === 'packages.config') declared += (text.match(/<package\s+/g) || []).length;
        else if (spec.locks.includes(base)) lockEntries += (text.match(/(?:^|\n)\s*[^\s#][^\n]*/g) || []).length;
      } catch { notes.push(`${file.relative}: parse was partial or unsupported`); }
    }
    const manifestPaths = related.filter((item) => spec.manifests.includes(path.basename(item.relative)) || (spec.id === 'python' && /^requirements(?:[^/]*\.txt)?$/i.test(path.basename(item.relative))) || spec.manifests.some((value) => value.startsWith('.') && path.basename(item.relative).toLowerCase().endsWith(value.toLowerCase()))).map((item) => item.relative);
    const lockPaths = related.filter((item) => spec.locks.includes(path.basename(item.relative))).map((item) => item.relative);
    ecosystems.push({ ecosystem: spec.id, manifests: manifestPaths.slice(0, 20), lockfiles: lockPaths.slice(0, 20), estimatedDirectDependencies: declared, estimatedLockedEntries: lockEntries, lockfilePresent: lockPaths.length > 0, confidence: 'manifest heuristic; verify with the native package manager', notes: notes.slice(0, 10) });
  }
  const lockfiles = manifests.filter((name) => /(?:lock|\.lock|\.sum$|Package\.resolved$|gradle\.lockfile$)/i.test(name));
  const tools = await Promise.all(['npm','pnpm','yarn','cargo-audit','govulncheck','pip-audit','composer','osv-scanner','bundle-audit'].map(async (name) => ({ name, available: await commandExists(name) })));
  return { manifests, lockfiles, package: packageSummary, ecosystems, auditTools: tools, vulnerabilityDatabaseQueried: false, note: 'Dependency counts are static manifest heuristics, not resolved dependency graphs. This offline inventory does not claim that any dependency is vulnerable or clean. Use the ecosystem package manager or a trusted scanner with explicit online consent to query current advisories.' };
}

export async function scanProjectSecurity(projectPath = process.cwd()) {
  const root = path.resolve(projectPath); const rootInfo = await fs.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Security scan requires a real, non-symlink project directory.');
  const inventory = await collect(root); const findings = []; const seen = new Set();
  const add = (rule, relative, line) => {
    const key = `${rule.code}:${relative}:${line}`; if (seen.has(key)) return; seen.add(key);
    findings.push({ code: rule.code, severity: rule.severity, confidence: rule.confidence, file: relative, line, message: rule.message, evidence: 'Matched a static source pattern; the original source line and secret values are not included.' });
  };
  for (const relative of inventory.sensitive) {
    findings.push({ code: 'sensitive-file-present', severity: 'warning', confidence: 'high', file: relative, line: null, message: 'A credential/key-like file exists in the project tree and was deliberately not opened.', evidence: 'Filename only; file contents were not read.' });
  }
  for (const file of inventory.files) {
    if (file.manifest && /(?:lock|\.lock|\.sum$)/i.test(file.relative)) continue;
    const text = await fs.readFile(file.full, 'utf8').catch(() => null); if (text === null || text.includes('\0')) continue;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0; const match = rule.pattern.exec(line); if (!match) continue;
        if (rule.code === 'hardcoded-credential' && PLACEHOLDER.test(String(match[2] || '').replace(/["'`]/g, '').trim())) continue;
        add(rule, file.relative, index + 1);
      }
    }
  }
  const deps = await dependencyInventory(inventory.files);
  const counts = findings.reduce((result, item) => { result[item.severity] = (result[item.severity] || 0) + 1; return result; }, {});
  const fingerprint = createHash('sha256').update(inventory.files.map((item) => `${item.relative}:${item.size}`).join('\n')).digest('hex').slice(0, 20);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: { name: path.basename(root), fingerprint },
    executionKind: 'read-only-static-security-review',
    inventory: { filesScanned: inventory.files.length, bytesScanned: inventory.totalBytes, truncated: inventory.truncated, sensitiveFilesNotOpened: inventory.sensitive.length },
    summary: { findings: findings.length, critical: counts.critical || 0, high: counts.high || 0, medium: counts.medium || 0, warning: counts.warning || 0 },
    findings,
    dependencies: deps,
    limitations: [
      'Static pattern matching can produce false positives and false negatives; it is not a penetration test or formal security audit.',
      'No dependency advisory database was queried and no network request was made.',
      'Credential-like files were not opened. Secret detection covers eligible source files only and cannot guarantee detection of every secret.',
      'No project scripts, compilers, tests, dependency installers or remote services were executed.'
    ]
  };
}

export async function runNpmDependencyAudit({ projectPath = process.cwd(), online = false, confirm = false, runner = null } = {}) {
  const root = path.resolve(projectPath); const rootInfo = await fs.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Dependency audit requires a real, non-symlink project directory.');
  if (!online || !confirm) throw new Error('Online dependency auditing contacts the npm registry. Review the project and pass --online --confirm explicitly.');
  const packageLock = await fs.lstat(path.join(root, 'package-lock.json')).catch(() => null);
  const packageJson = await fs.lstat(path.join(root, 'package.json')).catch(() => null);
  if (!packageLock?.isFile() || packageLock.isSymbolicLink() || !packageJson?.isFile() || packageJson.isSymbolicLink()) throw new Error('The confirmed npm audit currently requires regular package.json and package-lock.json files.');
  const execute = runner || (await import('../lib/process.mjs')).runProcess;
  const result = await execute('npm', ['audit', '--json', '--no-fund'], { cwd: root, capture: true, tee: false, timeoutMs: 120000, maxOutputBytes: 2 * 1024 * 1024 });
  let payload;
  try { payload = JSON.parse(result.stdout || '{}'); } catch { throw new Error(`npm audit did not return valid JSON. Exit code: ${result.code}. ${String(result.stderr || '').slice(0, 500)}`); }
  const vulnerabilities = payload.metadata?.vulnerabilities || {};
  return {
    schemaVersion: 1,
    executionKind: 'confirmed-online-npm-audit',
    registryContacted: true,
    exitCode: result.code,
    summary: { total: Number(vulnerabilities.total || 0), info: Number(vulnerabilities.info || 0), low: Number(vulnerabilities.low || 0), moderate: Number(vulnerabilities.moderate || 0), high: Number(vulnerabilities.high || 0), critical: Number(vulnerabilities.critical || 0) },
    advisories: Object.entries(payload.vulnerabilities || {}).slice(0, 300).map(([name, item]) => ({ name, severity: item.severity, direct: item.isDirect, range: item.range, fixAvailable: Boolean(item.fixAvailable), via: (item.via || []).slice(0, 8).map((entry) => typeof entry === 'string' ? entry : { title: entry.title, url: entry.url, range: entry.range }) })),
    note: 'npm audit results reflect the registry advisory data at the time of this confirmed run. Review proposed fixes before changing lockfiles.'
  };
}
