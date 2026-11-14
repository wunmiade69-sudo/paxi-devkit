import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectProject } from './project-inspect.mjs';
import { detectProjectTestCommand } from './project-test-executor.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';

const MAX_LOG_BYTES = 256 * 1024;

const FAILURE_RULES = [
  {
    code: 'missing-dependency', severity: 'error', confidence: 'high',
    pattern: /(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module|ModuleNotFoundError|No module named )/i,
    title: 'A required module or package could not be resolved.',
    recommendation: 'Check the missing package name, the selected package manager and the project lockfile. Install dependencies using the project’s existing package manager; do not delete the lockfile as a first step.'
  },
  {
    code: 'dependency-conflict', severity: 'error', confidence: 'high',
    pattern: /(?:ERESOLVE|unable to resolve dependency tree|peer dep(?:endency)? conflict)/i,
    title: 'The dependency solver reported an incompatible package tree.',
    recommendation: 'Inspect the conflicting package versions and peer requirements. Prefer a compatible version combination over bypassing peer checks.'
  },
  {
    code: 'typescript-diagnostic', severity: 'error', confidence: 'high',
    pattern: /\berror TS\d{3,5}\s*:/i,
    title: 'The TypeScript compiler reported a type or compile error.',
    recommendation: 'Use the first TypeScript diagnostic as the starting point. Check the referenced file and line, then rerun the project type-check/build command.'
  },
  {
    code: 'android-sdk-missing', severity: 'error', confidence: 'high',
    pattern: /(?:SDK location not found|ANDROID_HOME.*not set|Android SDK.*not found|Failed to find target with hash string)/i,
    title: 'The Android build cannot locate a required SDK component.',
    recommendation: 'Check ANDROID_HOME/ANDROID_SDK_ROOT, installed platform and build-tools versions, and local SDK permissions. Do not copy SDK credentials or signing files into the project.'
  },
  {
    code: 'gradle-build-failure', severity: 'error', confidence: 'medium',
    pattern: /(?:BUILD FAILED|Execution failed for task|Could not determine the dependencies of task)/i,
    title: 'Gradle reports a build or task failure.',
    recommendation: 'Find the earliest specific cause above the final BUILD FAILED summary. Check the failing task, Gradle/JDK compatibility and dependency resolution before changing Gradle versions.'
  },
  {
    code: 'flutter-dependency-failure', severity: 'error', confidence: 'medium',
    pattern: /(?:pub get failed|Because .* depends on .* version solving failed|Target of URI doesn't exist)/i,
    title: 'Flutter/Dart dependency resolution or import analysis failed.',
    recommendation: 'Check pubspec constraints and the first missing import/package. Run flutter pub get using the project’s configured Flutter SDK, then repeat flutter analyze/test.'
  },
  {
    code: 'cmake-toolchain-failure', severity: 'error', confidence: 'high',
    pattern: /(?:CMAKE_CXX_COMPILER|CMAKE_C_COMPILER|No CMAKE_MAKE_PROGRAM|Could NOT find .*\b(?:compiler|CXX|make)\b)/i,
    title: 'CMake could not locate or configure a required compiler/build tool.',
    recommendation: 'Check the C/C++ compiler, CMake generator and build tools for the current host architecture. Keep generated build files outside source directories where possible.'
  },
  {
    code: 'network-or-registry-failure', severity: 'warning', confidence: 'medium',
    pattern: /(?:ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network timeout|Could not resolve host)/i,
    title: 'A dependency or service request failed at the network layer.',
    recommendation: 'Check DNS, connectivity, proxy and registry endpoint. Retry only after confirming the configured source; do not disable TLS verification as a workaround.'
  },
  {
    code: 'service-connection-failure', severity: 'error', confidence: 'medium',
    pattern: /(?:\bECONNREFUSED\b|could not connect to server|Failed to connect to .*? port \d+)/i,
    title: 'The application could not establish a connection to a configured service.',
    recommendation: 'Verify the service is running, the configured host/port is correct, and the service is reachable from this execution environment. Check container/network boundaries before changing application retry logic.'
  },
  {
    code: 'disk-space-exhaustion', severity: 'error', confidence: 'high',
    pattern: /(?:\bENOSPC\b|No space left on device|not enough space on the disk)/i,
    title: 'The host ran out of available disk space while writing a build, dependency or test artifact.',
    recommendation: 'Inspect free space and the specific cache/output directory. Remove only reviewed disposable build/cache artifacts; do not delete source files, signing material or user data.'
  },
  {
    code: 'port-in-use', severity: 'error', confidence: 'high',
    pattern: /(?:\bEADDRINUSE\b|Address already in use|Only one usage of each socket address)/i,
    title: 'A requested local network port is already in use.',
    recommendation: 'Identify the process listening on the exact port and determine whether it is an expected development server. Prefer configuring a separate test port rather than terminating an unknown process.'
  },
  {
    code: 'syntax-or-parse-failure', severity: 'error', confidence: 'medium',
    pattern: /(?:\bSyntaxError:\s|\bIndentationError:\s|\bParseError:\s)/i,
    title: 'A source or configuration parser reported a syntax error.',
    recommendation: 'Use the first parser location and file/line hint to inspect the affected source. Avoid broad formatting or automated rewrites until the minimal syntax defect is understood.'
  },
  {
    code: 'jvm-bytecode-version-mismatch', severity: 'error', confidence: 'high',
    pattern: /(?:Unsupported class file major version|Unsupported major\.minor version|class file has wrong version)/i,
    title: 'A JVM tool encountered bytecode compiled for an unsupported Java class-file version.',
    recommendation: 'Compare the JDK used by the build, Gradle/Maven runtime and configured source/target toolchain. Align supported versions rather than changing compiler targets without checking dependencies.'
  },
  {
    code: 'tls-certificate-verification', severity: 'error', confidence: 'high',
    pattern: /(?:certificate verify failed|SSL certificate problem:|unable to get local issuer certificate|self[- ]signed certificate in certificate chain)/i,
    title: 'TLS certificate verification failed while connecting to a remote service.',
    recommendation: 'Check the certificate chain, trust store, system clock and configured proxy. Do not disable TLS verification or use insecure transport as a workaround.'
  },
  {
    code: 'permission-failure', severity: 'error', confidence: 'high',
    pattern: /(?:EACCES|EPERM|Permission denied|Access is denied)/i,
    title: 'The process could not access a file, directory or executable.',
    recommendation: 'Inspect the exact path and ownership/permissions. Prefer correcting access on the specific project or SDK directory rather than running the entire tool as root.'
  },
  {
    code: 'memory-exhaustion', severity: 'error', confidence: 'high',
    pattern: /(?:JavaScript heap out of memory|OutOfMemoryError|Killed process .* out of memory|ENOMEM)/i,
    title: 'The build or test process appears to have exhausted available memory.',
    recommendation: 'Reduce parallel workers, close memory-heavy applications, inspect large assets and use toolchain-supported heap limits. Avoid blindly increasing memory on a constrained phone.'
  },
  {
    code: 'test-assertion-failure', severity: 'warning', confidence: 'medium',
    pattern: /(?:AssertionError|Assertion failed|\b\d+\s+tests?\s+failed\b|\btests?(?:\s+suite)?\s+failed\b|\bFAIL(?:ED)?\s+(?:test|spec)\b)/i,
    title: 'A test or assertion reported a failure.',
    recommendation: 'Identify the first failing test and compare expected versus actual behavior. Do not weaken or delete the assertion just to obtain a green test run.'
  },
  {
    code: 'solidity-test-or-compile-failure', severity: 'error', confidence: 'medium',
    pattern: /(?:CompilerError:|TypeError:.*solidity|DeclarationError:|forge test.*failed|HardhatError)/i,
    title: 'A Solidity compiler or smart-contract test error was reported.',
    recommendation: 'Inspect the exact compiler diagnostic and the affected contract/test. Treat a passing unit test as insufficient security evidence; use independent review and adversarial tests before deployment.'
  }
];

function safeExcerpt(text, match) {
  const index = match.index ?? 0;
  const start = Math.max(0, index - 100);
  return text.slice(start, Math.min(text.length, index + 240)).replace(/\s+/g, ' ').trim().slice(0, 320);
}

export function classifyFailureLog(input) {
  const redacted = redactSensitiveText(String(input || '').slice(0, MAX_LOG_BYTES));
  const text = redacted.text;
  const findings = [];
  for (const rule of FAILURE_RULES) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(text);
    if (!match) continue;
    findings.push({
      code: rule.code,
      severity: rule.severity,
      confidence: rule.confidence,
      title: rule.title,
      recommendation: rule.recommendation,
      evidence: safeExcerpt(text, match)
    });
  }
  return { findings, redacted: redacted.redacted, redactionCategories: redacted.categories, bytesAnalyzed: Buffer.byteLength(text, 'utf8') };
}

async function readLogFile(filePath) {
  if (!filePath) return null;
  const absolute = path.resolve(filePath);
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Evidence log must be a regular non-symlink file.');
  if (info.size > MAX_LOG_BYTES) throw new Error(`Evidence log exceeds the ${MAX_LOG_BYTES}-byte limit. Supply a relevant excerpt.`);
  const raw = await fs.readFile(absolute, 'utf8');
  if (raw.includes('\0')) throw new Error('Evidence log appears to be binary; supply a text log.');
  const sanitized = redactSensitiveText(raw);
  return { fileName: path.basename(absolute), bytes: info.size, text: sanitized.text, redacted: sanitized.redacted, redactionCategories: sanitized.categories };
}

function testPlanReason(plan) {
  if (!plan) return 'No supported conventional test command was detected. Add or document the project’s test runner.';
  if (plan.available === false) return `The detected test tool (${plan.command}) is not installed on PATH.`;
  return `${plan.command} ${plan.args.join(' ')} — ${plan.reason}`;
}

export async function diagnoseProject({ projectPath = process.cwd(), logPath = null } = {}) {
  const root = path.resolve(projectPath);
  const rootInfo = await fs.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Diagnosis requires a real, non-symlink project directory.');
  const [inspection, log, testPlan] = await Promise.all([
    inspectProject(root), readLogFile(logPath), detectProjectTestCommand(root)
  ]);
  let manifestName = null;
  const manifestPath = path.join(root, 'package.json');
  const manifestInfo = await fs.lstat(manifestPath).catch(() => null);
  if (manifestInfo?.isFile() && !manifestInfo.isSymbolicLink() && manifestInfo.size <= 256 * 1024) {
    try { const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); if (typeof manifest.name === 'string' && /^[a-zA-Z0-9@._/-]{1,100}$/.test(manifest.name)) manifestName = manifest.name; } catch {}
  }
  const logAnalysis = log ? classifyFailureLog(log.text) : { findings: [], redacted: false, redactionCategories: [], bytesAnalyzed: 0 };
  const staticFindings = inspection.findings.map((item) => ({
    code: item.code, severity: item.severity, confidence: 'medium', title: item.message, recommendation: item.recommendation,
    evidence: 'Static project inspection; heuristic finding.'
  }));
  const findings = [...logAnalysis.findings, ...staticFindings];
  const errors = findings.filter((item) => item.severity === 'error').length;
  const warnings = findings.length - errors;
  return {
    schemaVersion: 1,
    diagnosisId: `diag-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    project: {
      name: manifestName || inspection.project.name,
      primaryFramework: inspection.project.primaryFramework,
      detectionConfidence: inspection.project.detectionConfidence,
      languages: inspection.technologies.languages,
      frameworks: inspection.technologies.frameworks,
      categories: inspection.technologies.categories,
      filesInspected: inspection.inventory.filesInspected,
      inventoryTruncated: inspection.inventory.truncated,
      packageManagerLockfiles: inspection.inventory.packageManagerLockfiles,
      scripts: inspection.inventory.scripts
    },
    evidence: {
      logProvided: Boolean(log),
      logFileName: log?.fileName || null,
      logBytes: log?.bytes || 0,
      secretsRedacted: Boolean(log?.redacted || logAnalysis.redacted),
      redactionCategories: [...new Set([...(log?.redactionCategories || []), ...logAnalysis.redactionCategories])]
    },
    testPlan: testPlan ? { ...testPlan, preview: testPlanReason(testPlan) } : null,
    summary: { findings: findings.length, errors, warnings, confidence: logAnalysis.findings.some((item) => item.confidence === 'high') ? 'evidence-backed' : findings.length ? 'heuristic' : 'insufficient-evidence' },
    findings,
    limitations: [
      'Diagnosis is based on static project markers, optional sanitized log excerpts and known failure signatures. It is not proof of root cause.',
      'No project scripts, builds, tests, network requests or source modifications were executed.',
      'A suggested test command is a preview only. Running it requires a separate explicit confirmation.'
    ]
  };
}
