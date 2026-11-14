import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandExists } from '../src/lib/process.mjs';
import { detectProjectTestCommand, runProjectTests } from '../src/doctor/project-test-executor.mjs';
import { runDiagnosisBenchmark } from '../src/doctor/diagnosis-benchmark.mjs';

async function tempProject(prefix) { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

test('React Native with local Jest config is planned without npx or network installation', async () => {
  const root = await tempProject('paxi-rn-jest-');
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'rn-jest-fixture', private: true, dependencies: { 'react-native': '0.80.0' }, jest: { preset: 'react-native' }
    }));
    await fs.mkdir(path.join(root, 'node_modules/jest/bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules/jest/package.json'), JSON.stringify({ name: 'jest', version: '30.0.0' }));
    await fs.writeFile(path.join(root, 'node_modules/jest/bin/jest.js'), 'process.exit(0);\n');
    const plan = await detectProjectTestCommand(root, { exists: async () => true });
    assert.equal(plan.id, 'react-native-jest-test');
    assert.equal(plan.command, process.execPath);
    assert.equal(plan.args.at(-1), '--runInBand');
    assert.ok(path.isAbsolute(plan.args[0]));
    assert.ok(!plan.command.includes('npx'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('React Native package test scripts retain the correct framework identity', async () => {
  const root = await tempProject('paxi-rn-script-');
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'rn-script-fixture', private: true, dependencies: { 'react-native': '0.80.0' }, scripts: { test: 'jest --runInBand' }
    }));
    const plan = await detectProjectTestCommand(root, { exists: async () => true });
    assert.equal(plan.id, 'react-native-package-test');
    assert.equal(plan.framework, 'React Native/Node.js');
    assert.deepEqual(plan.args, ['test']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Expo without local Jest returns tool-missing rather than attempting a download', async () => {
  const root = await tempProject('paxi-expo-no-jest-');
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'expo-fixture', dependencies: { expo: '53.0.0' }, jest: { preset: 'jest-expo' } }));
    const plan = await detectProjectTestCommand(root, { exists: async () => true });
    assert.equal(plan.id, 'expo-jest-test');
    assert.equal(plan.available, false);
    assert.match(plan.reason, /local Jest package/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

const cmakeAvailable = await commandExists('cmake');
const ctestAvailable = await commandExists('ctest');
test('React Native local Jest execution is routed through Node without a shell or npx', async () => {
  const root = await tempProject('paxi-rn-run-');
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'rn-run-fixture', dependencies: { 'react-native': '0.80.0' }, jest: { preset: 'react-native' } }));
    await fs.mkdir(path.join(root, 'node_modules/jest/bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules/jest/package.json'), JSON.stringify({ name: 'jest', version: '30.0.0' }));
    await fs.writeFile(path.join(root, 'node_modules/jest/bin/jest.js'), 'process.exit(0);\n');
    const result = await runProjectTests({
      projectPath: root, confirm: true, exists: async () => true,
      runner: async (command, args, options) => {
        assert.equal(command, process.execPath);
        assert.ok(args[0].endsWith(path.join('jest', 'bin', 'jest.js')));
        assert.ok(args.includes('--runInBand'));
        assert.equal(options.cwd, root);
        return { code: 0, stdout: 'RN tests passed', stderr: '', outputBytes: 15, outputTruncated: false };
      }
    });
    assert.equal(result.status, 'passed');
    assert.equal(result.plan.framework, 'React Native/Jest');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('CMake project with CTest is configured, built and tested in a temporary directory', { skip: !cmakeAvailable || !ctestAvailable }, async () => {
  const root = await tempProject('paxi-cmake-e2e-');
  try {
    await fs.writeFile(path.join(root, 'CMakeLists.txt'), [
      'cmake_minimum_required(VERSION 3.16)',
      'project(PaxiDoctorFixture LANGUAGES CXX)',
      'include(CTest)',
      'add_executable(paxi_fixture main.cpp)',
      'add_test(NAME paxi_fixture_test COMMAND paxi_fixture)'
    ].join('\n') + '\n');
    await fs.writeFile(path.join(root, 'main.cpp'), '#include <iostream>\nint main() { std::cout << "paxi fixture ok\\n"; return 0; }\n');
    const plan = await detectProjectTestCommand(root);
    assert.equal(plan.strategy, 'cmake-configure-build-ctest');
    const result = await runProjectTests({ projectPath: root, confirm: true, timeoutMs: 120000 });
    assert.equal(result.status, 'passed', JSON.stringify({ steps: result.steps, output: result.output }));
    assert.equal(result.passed, true);
    assert.equal(result.evidenceComplete, true);
    assert.deepEqual(result.steps.map((step) => step.id), ['configure', 'discover-tests', 'build', 'ctest']);
    assert.ok(result.steps.every((step) => step.status === 'passed'));
    assert.equal(result.cleanupComplete, true);
    assert.equal(result.buildArtifactsRetained, false);
    assert.equal((await fs.readdir(root)).sort().join(','), 'CMakeLists.txt,main.cpp');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('CMake adapter does not call a successful run when CTest reports zero tests', async () => {
  const root = await tempProject('paxi-cmake-empty-');
  const calls = [];
  try {
    await fs.writeFile(path.join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(Empty)\nenable_testing()\n');
    const result = await runProjectTests({
      projectPath: root, confirm: true, timeoutMs: 10000,
      exists: async () => true,
      runner: async (command, args) => {
        calls.push([command, args]);
        if (args.includes('--show-only')) return { code: 0, stdout: 'Test project\nNo tests were found!!!\nTotal Tests: 0\n', stderr: '', outputBytes: 45 };
        return { code: 0, stdout: 'ok', stderr: '', outputBytes: 2 };
      }
    });
    assert.equal(result.status, 'no-tests');
    assert.equal(result.passed, false);
    assert.equal(calls.length, 2, 'build and ctest must not run after an empty test inventory');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('CMake adapter refuses to continue when CTest discovery output is truncated', async () => {
  const root = await tempProject('paxi-cmake-truncated-');
  const calls = [];
  try {
    await fs.writeFile(path.join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(Truncated)\nenable_testing()\n');
    const result = await runProjectTests({
      projectPath: root, confirm: true, timeoutMs: 10000,
      exists: async () => true,
      runner: async (command, args) => {
        calls.push([command, args]);
        if (args.includes('--show-only')) return { code: 0, stdout: 'Test #1: incomplete', stderr: '', outputBytes: 900000, outputTruncated: true };
        return { code: 0, stdout: 'ok', stderr: '', outputBytes: 2 };
      }
    });
    assert.equal(result.status, 'passed-output-truncated');
    assert.equal(result.passed, false);
    assert.equal(result.evidenceComplete, false);
    assert.equal(calls.length, 2, 'build and ctest must not run after incomplete test discovery');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('CMake adapter stops after configure failure and preserves the failed stage', async () => {
  const root = await tempProject('paxi-cmake-fail-');
  const calls = [];
  try {
    await fs.writeFile(path.join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\nproject(Broken)\nenable_testing()\n');
    const result = await runProjectTests({
      projectPath: root, confirm: true, timeoutMs: 10000,
      exists: async () => true,
      runner: async (command, args) => { calls.push([command, args]); return { code: 1, stdout: '', stderr: 'compiler missing', outputBytes: 16 }; }
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.passed, false);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].id, 'configure');
    assert.equal(calls.length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('database CI report assertion accepts only a successful migration with complete cleanup', async () => {
  const root = await tempProject('paxi-db-report-');
  try {
    const file = path.join(root, 'report.json');
    const valid = {
      reportType: 'paxi-disposable-service-database-lab', engine: 'postgres', status: 'passed', passed: true,
      cleanupComplete: true, migrationReplayPassed: true, schemaComparison: { status: 'changed' }
    };
    await fs.writeFile(file, JSON.stringify(valid));
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/assert-database-lab-report.mjs');
    const good = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    valid.cleanupComplete = false;
    await fs.writeFile(file, JSON.stringify(valid));
    const bad = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /cleanupComplete/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('diagnosis benchmark dataset v1.1 contains hard negatives and matches all 24 synthetic fixtures', () => {
  const report = runDiagnosisBenchmark();
  assert.equal(report.datasetVersion, '1.1.0');
  assert.equal(report.executionKind, 'offline-synthetic-fixtures');
  assert.equal(report.summary.cases, 24);
  assert.equal(report.summary.exactCases, 24);
  assert.equal(report.summary.falsePositive, 0);
  assert.equal(report.summary.falseNegative, 0);
  assert.equal(report.status, 'passed');
  assert.ok(report.cases.some((item) => item.id === 'benign-network-test-name'));
  assert.ok(report.limitations.some((item) => item.includes('not an independently sourced')));
});
