import { classifyFailureLog } from './diagnosis.mjs';

// Curated synthetic messages only. No customer logs, API keys or model outputs are stored.
const CASES = Object.freeze([
  { id: 'node-missing-module', text: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'vite'", expected: ['missing-dependency'] },
  { id: 'npm-peer-conflict', text: 'npm ERR! ERESOLVE unable to resolve dependency tree', expected: ['dependency-conflict'] },
  { id: 'typescript-type-error', text: "src/app.ts(8,4): error TS2322: Type 'string' is not assignable to type 'number'.", expected: ['typescript-diagnostic'] },
  { id: 'android-sdk-absent', text: 'Android SDK location not found. Define a valid SDK location with ANDROID_HOME.', expected: ['android-sdk-missing'] },
  { id: 'gradle-failed-task', text: "Execution failed for task ':app:compileDebugKotlin'. BUILD FAILED", expected: ['gradle-build-failure'] },
  { id: 'flutter-pub-resolution', text: 'Because sample_app depends on package_x, version solving failed. pub get failed.', expected: ['flutter-dependency-failure'] },
  { id: 'cmake-no-compiler', text: 'CMAKE_CXX_COMPILER could not be found on this host.', expected: ['cmake-toolchain-failure'] },
  { id: 'network-timeout', text: 'npm request failed: ECONNRESET while contacting the configured registry.', expected: ['network-or-registry-failure'] },
  { id: 'permission-denied', text: 'EACCES: permission denied, open /tmp/example/output.bin', expected: ['permission-failure'] },
  { id: 'memory-exhaustion', text: 'FATAL ERROR: JavaScript heap out of memory', expected: ['memory-exhaustion'] },
  { id: 'test-assertion', text: 'AssertionError: expected 4 to equal 5. 1 test failed.', expected: ['test-assertion-failure'] },
  { id: 'solidity-compiler', text: 'TypeError: solidity: Type uint256 is not implicitly convertible to address', expected: ['solidity-test-or-compile-failure'] },
  { id: 'combined-permission-and-module', text: "Error: Cannot find module 'dotenv'\nEACCES: Permission denied", expected: ['missing-dependency', 'permission-failure'] },
  { id: 'successful-build', text: 'BUILD SUCCESSFUL in 14s\nAll tests passed.', expected: [] },
  { id: 'clean-install', text: 'added 124 packages, audited 125 packages, found 0 vulnerabilities.', expected: [] },
  { id: 'ordinary-progress', text: 'Compiling source files...\nGenerating documentation...\nDone.', expected: [] },
  { id: 'service-connection-refused', text: 'Error: connect ECONNREFUSED 127.0.0.1:5432', expected: ['service-connection-failure'] },
  { id: 'disk-space-full', text: 'Error: ENOSPC: no space left on device, write', expected: ['disk-space-exhaustion'] },
  { id: 'development-port-conflict', text: 'Error: listen EADDRINUSE: address already in use :::4173', expected: ['port-in-use'] },
  { id: 'python-parser-error', text: 'File "main.py", line 9: SyntaxError: invalid syntax', expected: ['syntax-or-parse-failure'] },
  { id: 'jvm-class-version', text: 'Unsupported class file major version 65', expected: ['jvm-bytecode-version-mismatch'] },
  { id: 'tls-chain-error', text: 'request failed: SSL certificate problem: unable to get local issuer certificate', expected: ['tls-certificate-verification'] },
  { id: 'benign-local-server-message', text: 'The app server started on port 4173. Address was configured by the test fixture.', expected: [] },
  { id: 'benign-network-test-name', text: 'Test named "connection refused is shown" passed with expected UI text.', expected: [] }
]);

function ratio(numerator, denominator) { return denominator ? numerator / denominator : numerator === 0 ? 1 : 0; }
function round(value) { return Number(value.toFixed(4)); }

/** Evaluate deterministic diagnosis signatures against a versioned synthetic corpus. */
export function runDiagnosisBenchmark() {
  const perCode = new Map();
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let exactCases = 0;
  const caseResults = [];

  for (const sample of CASES) {
    const actual = [...new Set(classifyFailureLog(sample.text).findings.map((item) => item.code))].sort();
    const expected = [...sample.expected].sort();
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const matched = expected.filter((code) => actualSet.has(code));
    const extra = actual.filter((code) => !expectedSet.has(code));
    const missed = expected.filter((code) => !actualSet.has(code));
    truePositive += matched.length;
    falsePositive += extra.length;
    falseNegative += missed.length;
    if (extra.length === 0 && missed.length === 0) exactCases += 1;
    for (const code of new Set([...expected, ...actual])) {
      const metric = perCode.get(code) || { truePositive: 0, falsePositive: 0, falseNegative: 0 };
      if (matched.includes(code)) metric.truePositive += 1;
      if (extra.includes(code)) metric.falsePositive += 1;
      if (missed.includes(code)) metric.falseNegative += 1;
      perCode.set(code, metric);
    }
    caseResults.push({ id: sample.id, matched, falsePositives: extra, falseNegatives: missed, exactMatch: extra.length === 0 && missed.length === 0 });
  }

  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = exactCases / CASES.length;
  return {
    schemaVersion: 1,
    reportType: 'paxi-diagnosis-benchmark',
    benchmark: 'deterministic-failure-signatures',
    datasetVersion: '1.1.0',
    executionKind: 'offline-synthetic-fixtures',
    status: precision >= 0.95 && recall >= 0.95 && accuracy >= 0.95 ? 'passed' : 'needs-attention',
    limitations: [
      'This benchmark measures deterministic log-signature classification only; it does not measure LLM reasoning, root-cause correctness, patch quality or real-project diagnosis.',
      'The corpus is synthetic and is not an independently sourced real-incident dataset. Add reviewed, sanitized real-world fixtures with provenance before treating these scores as release-quality evidence.',
      'A passing benchmark is not proof that all diagnoses are correct or that a project is secure.'
    ],
    summary: {
      cases: CASES.length,
      exactCases,
      accuracy: round(accuracy),
      truePositive,
      falsePositive,
      falseNegative,
      precision: round(precision),
      recall: round(recall),
      f1: round(f1)
    },
    perCode: Object.fromEntries([...perCode.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, counts]) => {
      const p = ratio(counts.truePositive, counts.truePositive + counts.falsePositive);
      const r = ratio(counts.truePositive, counts.truePositive + counts.falseNegative);
      return [code, { ...counts, precision: round(p), recall: round(r), f1: round(p + r ? (2 * p * r) / (p + r) : 0) }];
    })),
    cases: caseResults
  };
}
