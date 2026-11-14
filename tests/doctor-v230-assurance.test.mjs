import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runDiagnosisBenchmark } from '../src/doctor/diagnosis-benchmark.mjs';
import { buildCertificationReport } from '../src/doctor/certification.mjs';
import { runProjectTests } from '../src/doctor/project-test-executor.mjs';
import { runNativeVulnerabilityScan } from '../src/doctor/security-adapters.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v230-'));
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function makeProject(name, packageJson = { name, scripts: { test: 'node test.js' } }) {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(packageJson));
  return directory;
}

test('diagnosis benchmark reports deterministic precision, recall and exact-case metrics without fixture text', () => {
  const report = runDiagnosisBenchmark();
  assert.equal(report.status, 'passed');
  assert.equal(report.executionKind, 'offline-synthetic-fixtures');
  assert.equal(report.summary.cases, 24);
  assert.equal(report.datasetVersion, '1.1.0');
  assert.equal(report.summary.accuracy, 1);
  assert.equal(report.summary.precision, 1);
  assert.equal(report.summary.recall, 1);
  assert.equal(report.summary.f1, 1);
  assert.ok(report.cases.every((item) => item.exactMatch));
  assert.ok(!JSON.stringify(report).includes('Cannot find module'));
});

test('environment certification is read-only and distinguishes available tools from executed tests', async () => {
  const project = await makeProject('certify-ready');
  let testRunnerCalls = 0;
  const report = await buildCertificationReport({
    projectPath: project,
    exists: async (name) => ['node', 'npm', 'git'].includes(name)
  });
  assert.equal(report.status, 'ready-for-test');
  assert.equal(report.executionKind, 'read-only-local-capability-inventory');
  assert.equal(report.project.testPlan.command, 'npm');
  assert.equal(report.project.testPlan.available, true);
  assert.equal(report.summary.testCommand, 'detected-not-run');
  assert.ok(report.safeguards.some((item) => item.toLowerCase().includes('no project test')));
  assert.equal(testRunnerCalls, 0);
  assert.ok(!JSON.stringify(report).includes(project));
});

test('environment certification blocks a detected test plan when its package manager is missing', async () => {
  const project = await makeProject('certify-blocked');
  const report = await buildCertificationReport({ projectPath: project, exists: async (name) => name === 'node' });
  assert.equal(report.status, 'blocked');
  assert.equal(report.project.testPlan.available, false);
  assert.equal(report.summary.testCommand, 'tool-missing');
});

test('environment certification reports partial when no conventional test plan exists', async () => {
  const project = await makeProject('certify-no-plan', { name: 'empty-project' });
  const report = await buildCertificationReport({ projectPath: project, exists: async () => false });
  assert.equal(report.status, 'partial');
  assert.equal(report.project.testPlan, null);
  assert.equal(report.summary.testCommand, 'not-detected');
});

test('environment certification refuses a symlink project root', async (t) => {
  if (process.platform === 'win32') return t.skip('Symlink creation may require elevated Windows permissions.');
  const project = await makeProject('certify-symlink-target');
  const link = path.join(root, 'certify-symlink');
  await fs.symlink(project, link);
  await assert.rejects(() => buildCertificationReport({ projectPath: link }), /non-symlink/);
});

test('project test runner marks successful exit with truncated output as passed but evidence incomplete', async () => {
  const project = await makeProject('test-output-truncated');
  const result = await runProjectTests({
    projectPath: project,
    confirm: true,
    exists: async () => true,
    runner: async () => ({ code: 0, stdout: 'tests passed', stderr: '', outputBytes: 900000, outputTruncated: true, timedOut: false, cancelled: false })
  });
  assert.equal(result.passed, true);
  assert.equal(result.status, 'passed-output-truncated');
  assert.equal(result.evidenceComplete, false);
  assert.equal(result.outputTruncated, true);
  assert.equal(result.outputBytes, 900000);
});

test('native scanner never reports clean or complete when its captured JSON output was truncated', async () => {
  const project = path.join(root, 'scanner-truncated');
  await fs.mkdir(project, { recursive: true });
  const result = await runNativeVulnerabilityScan({
    scanner: 'osv-scanner', projectPath: project, online: true, confirm: true,
    exists: async () => true,
    runner: async (_command, args) => args.includes(project)
      ? { code: 0, stdout: JSON.stringify({ results: [{ packages: [{ package: { name: 'pkg-a', version: '1.2.3' }, vulnerabilities: [] }] }] }), stderr: '', outputBytes: 1000000, outputTruncated: true }
      : { code: 0, stdout: 'osv-scanner 2.8.0', stderr: '', outputTruncated: false }
  });
  assert.equal(result.status, 'incomplete-output');
  assert.equal(result.clean, false);
  assert.equal(result.complete, false);
  assert.equal(result.outputTruncated, true);
  assert.equal(result.summary.coverageComplete, false);
});

test('CLI exposes the certification and diagnosis benchmark commands', async () => {
  const version = spawnSync(process.execPath, [path.join(packageRoot, 'bin', 'paxi.mjs'), 'version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), '2.7.0');
  const benchmark = spawnSync(process.execPath, [path.join(packageRoot, 'bin', 'paxi.mjs'), 'doctor', 'benchmark', 'diagnosis', '--json'], { encoding: 'utf8' });
  assert.equal(benchmark.status, 0, benchmark.stderr);
  assert.equal(JSON.parse(benchmark.stdout).status, 'passed');
  const help = spawnSync(process.execPath, [path.join(packageRoot, 'bin', 'paxi.mjs'), 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /doctor certify/);
  assert.match(help.stdout, /doctor benchmark diagnosis/);
});

test.after(async () => fs.rm(root, { recursive: true, force: true }));
