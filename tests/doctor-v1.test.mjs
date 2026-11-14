import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-doctor-v1-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config-home');
process.env.XDG_DATA_HOME = path.join(temp, 'data-home');

async function makeProject(files) {
  const root = await fs.mkdtemp(path.join(temp, 'project-'));
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }
  return root;
}

function initGit(root) {
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git(['init']);
  git(['config', 'user.email', 'paxi-test@example.invalid']);
  git(['config', 'user.name', 'PAXI test']);
  git(['add', '.']);
  git(['commit', '-m', 'baseline']);
}

test('task router selects coding, vision and journey roles from intent', async () => {
  const { inferTaskRole } = await import('../src/ai/task-router.mjs');
  assert.equal(inferTaskRole('Debug this TypeScript compiler error').role, 'coding');
  assert.equal(inferTaskRole('Review screenshot clipping and visual spacing').role, 'vision');
  assert.equal(inferTaskRole('Prepare a safe user journey for navigation').role, 'journey');
  assert.equal(inferTaskRole('Explain what PAXI Doctor represents').role, 'general');
  assert.equal(inferTaskRole('Anything', 'coding').role, 'coding');
  assert.throws(() => inferTaskRole('anything', 'unknown'), /AI role must be/);
});

test('task route reports exact or general fallback without changing saved routes', async () => {
  const { setConfigValues, getConfig } = await import('../src/lib/config.mjs');
  const { resolveTaskRoute } = await import('../src/ai/task-router.mjs');
  await setConfigValues({ aiMode: 'local', aiRoutes: {
    general: { provider: 'llamacpp', model: 'general-local' },
    coding: { provider: 'ollama', model: 'code-local' }
  }});
  const coding = await resolveTaskRoute('debug a C++ compile error');
  assert.equal(coding.taskRole, 'coding');
  assert.equal(coding.providerId, 'ollama');
  assert.equal(coding.routeSource, 'coding-route');
  const general = await resolveTaskRoute('Explain a concept');
  assert.equal(general.taskRole, 'general');
  assert.equal(general.routeSource, 'general-route');
  const config = await getConfig();
  assert.equal(config.aiRoutes.coding.model, 'code-local');
});

test('failure diagnosis recognizes common errors and redacts credentials in log evidence', async () => {
  const { classifyFailureLog, diagnoseProject } = await import('../src/doctor/diagnosis.mjs');
  const log = 'Error [ERR_MODULE_NOT_FOUND]: Cannot find package "tiny-lib"\nOPENAI_API_KEY=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  const classification = classifyFailureLog(log);
  assert.ok(classification.findings.some((item) => item.code === 'missing-dependency'));
  assert.equal(classification.redacted, true);
  assert.doesNotMatch(JSON.stringify(classification), /sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345/);
  const root = await makeProject({ 'package.json': JSON.stringify({ name: 'diagnosis-fixture', scripts: { test: 'node -e "process.exit(0)"' } }), 'index.js': 'export {};' });
  const logPath = path.join(temp, 'build.log');
  await fs.writeFile(logPath, log);
  const report = await diagnoseProject({ projectPath: root, logPath });
  assert.equal(report.project.name, 'diagnosis-fixture');
  assert.equal(report.evidence.secretsRedacted, true);
  assert.ok(report.testPlan.preview.includes('npm test'));
  assert.equal(report.limitations.some((item) => item.includes('No project scripts')), true);
});

test('diagnosis refuses symlinked logs and oversized log evidence', async () => {
  const { diagnoseProject } = await import('../src/doctor/diagnosis.mjs');
  const root = await makeProject({ 'README.md': 'project' });
  const target = path.join(temp, 'real.log');
  await fs.writeFile(target, 'test');
  const link = path.join(temp, 'linked.log');
  await fs.symlink(target, link);
  await assert.rejects(() => diagnoseProject({ projectPath: root, logPath: link }), /regular non-symlink/);
  const large = path.join(temp, 'large.log');
  await fs.writeFile(large, 'x'.repeat(256 * 1024 + 1));
  await assert.rejects(() => diagnoseProject({ projectPath: root, logPath: large }), /exceeds/);
});

test('test runner previews only and requires explicit confirmation before executing npm scripts', async () => {
  const { detectProjectTestCommand, runProjectTests } = await import('../src/doctor/project-test-executor.mjs');
  const root = await makeProject({
    'package.json': JSON.stringify({ name: 'test-runner-fixture', scripts: { test: 'node -e "process.exit(0)"' } }),
    'package-lock.json': JSON.stringify({ name: 'test-runner-fixture', lockfileVersion: 3 })
  });
  const plan = await detectProjectTestCommand(root);
  assert.equal(plan.id, 'node-package-test');
  assert.equal(plan.command, 'npm');
  await assert.rejects(() => runProjectTests({ projectPath: root, confirm: false }), /explicit --confirm/);
});

test('test runner executes a detected test command after confirmation and reports its exit status', async () => {
  const { runProjectTests } = await import('../src/doctor/project-test-executor.mjs');
  const root = await makeProject({ 'package.json': JSON.stringify({ name: 'test-runner-fixture', scripts: { test: 'node -e "process.exit(0)"' } }) });
  const result = await runProjectTests({ projectPath: root, confirm: true, timeoutMs: 30000 });
  assert.equal(result.executed, true);
  assert.equal(result.passed, true);
  assert.equal(result.status, 'passed');
  assert.ok(result.durationMs >= 0);
});

test('AI patch drafting sends only selected redacted files and does not apply the patch', async () => {
  const { setConfigValues } = await import('../src/lib/config.mjs');
  const { generateFixDraft } = await import('../src/doctor/fix-draft.mjs');
  const project = await makeProject({
    'src/app.js': 'export const value = null;\n',
    'README.md': 'fixture\n'
  });
  initGit(project);
  await setConfigValues({ aiMode: 'local', aiLocalUrl: 'http://127.0.0.1:8080/v1', aiRoutes: { coding: { provider: 'llamacpp', model: 'mock-code' } } });
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    const diff = 'diff --git a/src/app.js b/src/app.js\n--- a/src/app.js\n+++ b/src/app.js\n@@ -1 +1 @@\n-export const value = null;\n+export const value = 1;\n';
    return new Response(JSON.stringify({ choices: [{ message: { content: diff } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const report = await generateFixDraft({ projectPath: project, description: 'Fix the app value initialization bug', files: ['src/app.js'], includeProfile: false });
    assert.equal(report.generated, true);
    assert.equal(report.reviewPassed, true);
    assert.equal(report.applied, false);
    assert.equal(report.routeSelection.role, 'coding');
    assert.deepEqual(report.selectedFiles.map((item) => item.path), ['src/app.js']);
    assert.match(requestBody.messages[1].content, /src\/app\.js/);
    assert.doesNotMatch(requestBody.messages[1].content, /README\.md/);
    assert.equal(await fs.readFile(path.join(project, 'src/app.js'), 'utf8'), 'export const value = null;\n');
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8' });
    assert.equal(status.trim(), '');
    assert.ok((await fs.stat(report.patchFile)).mode & 0o600);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI patch drafting refuses traversal, credentials and unselected file changes', async () => {
  const { setConfigValues } = await import('../src/lib/config.mjs');
  const { generateFixDraft } = await import('../src/doctor/fix-draft.mjs');
  const project = await makeProject({ 'src/app.js': 'export const value = null;\n', '.env': 'API_KEY=do-not-read\n' });
  initGit(project);
  await setConfigValues({ aiMode: 'local', aiLocalUrl: 'http://127.0.0.1:8080/v1', aiRoutes: { coding: { provider: 'llamacpp', model: 'mock-code' } } });
  await assert.rejects(() => generateFixDraft({ projectPath: project, description: 'Fix a bug in this module', files: ['../outside.js'] }), /unsafe or sensitive/);
  await assert.rejects(() => generateFixDraft({ projectPath: project, description: 'Fix a bug in this module', files: ['.env'] }), /unsafe or sensitive/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-a\n+b\n' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => generateFixDraft({ projectPath: project, description: 'Fix a bug in this module', files: ['src/app.js'], includeProfile: false }), /unselected path/);
  } finally { globalThis.fetch = originalFetch; }
});

test.after(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});
