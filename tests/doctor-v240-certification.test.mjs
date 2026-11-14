import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProjectTests } from '../src/doctor/project-test-executor.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function makeProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v240-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'paxi-certification-fixture',
    private: true,
    scripts: { test: "node -e \"require('node:fs').writeFileSync('test-ran.txt','yes'); console.log('fixture tests passed')\"" }
  }));
  return root;
}

test('test executor uses one injected tool-availability contract for plan and execution', async () => {
  const root = await makeProject();
  try {
    const result = await runProjectTests({
      projectPath: root,
      confirm: true,
      exists: async () => false,
      runner: async () => { throw new Error('runner must not be called when tool is missing'); }
    });
    assert.equal(result.executed, false);
    assert.equal(result.status, 'tool-missing');
    assert.equal(result.passed, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('certify stays non-executing without --run-tests and --confirm', async () => {
  const root = await makeProject();
  try {
    const noConsent = spawnSync(process.execPath, [path.join(packageRoot, 'bin/paxi.mjs'), 'doctor', 'certify', '--project', root, '--run-tests', '--json'], { encoding: 'utf8' });
    assert.notEqual(noConsent.status, 0);
    assert.match(noConsent.stderr, /both --run-tests and explicit --confirm/);
    await assert.rejects(() => fs.access(path.join(root, 'test-ran.txt')));

    const readOnly = spawnSync(process.execPath, [path.join(packageRoot, 'bin/paxi.mjs'), 'doctor', 'certify', '--project', root, '--json'], { encoding: 'utf8' });
    assert.equal(readOnly.status, 0, readOnly.stderr);
    const report = JSON.parse(readOnly.stdout);
    assert.equal(report.executionKind, 'read-only-local-capability-inventory');
    assert.equal(report.summary.testCommand, 'detected-not-run');
    await assert.rejects(() => fs.access(path.join(root, 'test-ran.txt')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('certify runs the detected project test only after explicit confirmation and reports actual evidence', async () => {
  const root = await makeProject();
  try {
    const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/paxi.mjs'), 'doctor', 'certify', '--project', root, '--run-tests', '--confirm', '--timeout', '30', '--json'], { encoding: 'utf8', timeout: 45000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.executionKind, 'local-capability-inventory-plus-user-approved-test-execution');
    assert.equal(report.testExecution.executed, true);
    assert.equal(report.testExecution.status, 'passed');
    assert.equal(report.testExecution.passed, true);
    assert.equal(report.testExecution.evidenceComplete, true);
    assert.match(report.testExecution.output.stdout, /fixture tests passed/);
    assert.equal(await fs.readFile(path.join(root, 'test-ran.txt'), 'utf8'), 'yes');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('certify rejects invalid timeout and --confirm without --run-tests', async () => {
  const root = await makeProject();
  try {
    const badTimeout = spawnSync(process.execPath, [path.join(packageRoot, 'bin/paxi.mjs'), 'doctor', 'certify', '--project', root, '--run-tests', '--confirm', '--timeout', '99999'], { encoding: 'utf8' });
    assert.notEqual(badTimeout.status, 0);
    assert.match(badTimeout.stderr, /between 1 and 3600 seconds/);
    const orphanConfirm = spawnSync(process.execPath, [path.join(packageRoot, 'bin/paxi.mjs'), 'doctor', 'certify', '--project', root, '--confirm'], { encoding: 'utf8' });
    assert.notEqual(orphanConfirm.status, 0);
    assert.match(orphanConfirm.stderr, /only valid with --run-tests/);
    await assert.rejects(() => fs.access(path.join(root, 'test-ran.txt')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('certify preserves a failed test result and redacts credentials from captured output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v240-failed-'));
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'paxi-certification-failed-fixture',
      private: true,
      scripts: { test: "node -e \"console.log('api_key=secret-value'); process.exit(2)\"" }
    }));
    const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/paxi.mjs'), 'doctor', 'certify', '--project', root, '--run-tests', '--confirm', '--json'], { encoding: 'utf8', timeout: 45000 });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.testExecution.status, 'failed');
    assert.equal(report.testExecution.passed, false);
    assert.equal(report.testExecution.evidenceComplete, true);
    assert.match(report.testExecution.output.stdout, /api_key=\[REDACTED\]/);
    assert.ok(!result.stdout.includes('secret-value'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
