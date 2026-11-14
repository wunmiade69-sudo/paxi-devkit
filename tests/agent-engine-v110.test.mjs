import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-agent-v110-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
process.env.XDG_DATA_HOME = path.join(temp, 'data');

async function fixture(files = {}) {
  const root = await fs.mkdtemp(path.join(temp, 'project-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

test('project memory is opt-in, scoped per project, bounded and sensitive-value redacted', async () => {
  const memory = await import('../src/doctor/agent-memory.mjs');
  const first = await fixture({ 'package.json': JSON.stringify({ name: 'memory-one' }) });
  const second = await fixture({ 'package.json': JSON.stringify({ name: 'memory-two' }) });
  assert.equal((await memory.listProjectMemory(first)).notes.length, 0);
  const saved = await memory.rememberProjectNote(first, 'Prefer existing React components. API_KEY=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
  assert.equal(saved.redacted, true);
  assert.match(saved.note.text, /Prefer existing React components/);
  assert.doesNotMatch(saved.note.text, /sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345/);
  assert.equal((await memory.listProjectMemory(first)).notes.length, 1);
  assert.equal((await memory.listProjectMemory(second)).notes.length, 0);
  assert.equal((await memory.forgetProjectNote(first, saved.note.id)).removed, true);
  assert.equal((await memory.listProjectMemory(first)).notes.length, 0);
});

test('project memory refuses oversized notes and symlinked project roots', async () => {
  const memory = await import('../src/doctor/agent-memory.mjs');
  const root = await fixture({ 'README.md': 'safe' });
  await assert.rejects(() => memory.rememberProjectNote(root, 'x'.repeat(801)), /1–800 characters/);
  const link = path.join(temp, 'project-link');
  await fs.symlink(root, link);
  await assert.rejects(() => memory.listProjectMemory(link), /non-symlink/);
});

test('agent route recommendation classifies complexity and reports local resource caution without changing routes', async () => {
  const { setConfigValues, getConfig } = await import('../src/lib/config.mjs');
  const { recommendAgentRoute } = await import('../src/ai/agent-selector.mjs');
  await setConfigValues({ aiMode: 'local', aiRoutes: { coding: { provider: 'llamacpp', model: 'tiny-local-code' } } });
  const resources = { platform: 'android', architecture: 'arm64', cpuCores: 8, totalMemoryGB: 4, currentlyFreeMemoryGB: 1.1, freeMemoryRatio: 0.27, note: 'test fixture' };
  const result = await recommendAgentRoute('Debug this security audit and investigate a cross-platform race condition', 'auto', { resources });
  assert.equal(result.taskRole, 'coding');
  assert.equal(result.complexity.level, 'high');
  assert.equal(result.route.provider, 'llamacpp');
  assert.equal(result.resourceFit, 'low-headroom');
  assert.equal(result.cost.status, 'not-estimated');
  assert.equal((await getConfig()).aiRoutes.coding.model, 'tiny-local-code');
});

test('agent plan combines project diagnosis, QA steps and only explicitly saved memory', async () => {
  const { setConfigValues } = await import('../src/lib/config.mjs');
  const { rememberProjectNote } = await import('../src/doctor/agent-memory.mjs');
  const { buildAgentPlan } = await import('../src/doctor/agent-engine.mjs');
  await setConfigValues({ aiMode: 'off', aiRoutes: {} });
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'agent-plan-fixture', scripts: { test: 'node test.js' }, dependencies: { react: '^19.0.0' } }),
    'index.html': '<button></button><img src="a.png">',
    'src/main.jsx': 'export default function App(){ return <div/> }'
  });
  await rememberProjectNote(root, 'Use current React structure and avoid adding dependencies.');
  const plan = await buildAgentPlan({ projectPath: root });
  assert.equal(plan.execution.status, 'plan-only');
  assert.equal(plan.execution.testsRun, false);
  assert.equal(plan.execution.filesChanged, false);
  assert.equal(plan.projectMemory.count, 1);
  assert.ok(plan.steps.some((step) => step.id === 'browser-device-lab'));
  assert.ok(plan.steps.some((step) => step.id === 'run-detected-tests'));
  assert.ok(plan.diagnosis.findings.some((item) => item.code === 'html-button-name'));
});

test('AI auto route includes provider base URL and resource-aware metadata in returned selection', async () => {
  const { setConfigValues } = await import('../src/lib/config.mjs');
  const { aiAsk } = await import('../src/commands/ai.mjs');
  await setConfigValues({ aiMode: 'local', aiRoutes: { coding: { provider: 'llamacpp', model: 'mock-agent-code' } }, aiLocalUrl: 'http://127.0.0.1:8080/v1' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://127.0.0.1:8080/v1/chat/completions');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'diagnosis response' } }] }), { status: 200 });
  };
  try {
    const result = await aiAsk('Please debug this TypeScript build error', { role: 'auto', includeProfile: false, print: false });
    assert.equal(result.answer, 'diagnosis response');
    assert.equal(result.routeSelection.role, 'coding');
    assert.equal(result.routeSelection.provider, 'llamacpp');
    assert.ok(result.routeSelection.complexity);
    assert.ok(result.routeSelection.resourceFit);
  } finally { globalThis.fetch = originalFetch; }
});

test('combined visual review includes only supplied bounded diagnosis context', async () => {
  const { setConfigValues } = await import('../src/lib/config.mjs');
  const { analyzeScreenshot } = await import('../src/doctor/vision.mjs');
  await setConfigValues({ aiMode: 'local', aiRoutes: { vision: { provider: 'llamacpp', model: 'mock-vision' } }, aiLocalUrl: 'http://127.0.0.1:8080/v1' });
  const image = path.join(temp, 'screen.png');
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(640, 16); bytes.writeUInt32BE(480, 20);
  await fs.writeFile(image, bytes);
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Visual and project evidence reviewed.' } }] }), { status: 200 });
  };
  try {
    const result = await analyzeScreenshot(image, { contextSummary: JSON.stringify({ finding: 'html-button-name', sourceFiles: 'not supplied' }) });
    assert.equal(result.projectContextIncluded, true);
    assert.match(request.messages[1].content[0].text, /html-button-name/);
    assert.doesNotMatch(request.messages[1].content[0].text, /sourceFiles.*actual source code/i);
  } finally { globalThis.fetch = originalFetch; }
});


test('Agent AI review sends project metadata and saved notes but never sends the absolute project path', async () => {
  const { setConfigValues } = await import('../src/lib/config.mjs');
  const { rememberProjectNote } = await import('../src/doctor/agent-memory.mjs');
  const { doctorAgentCommand } = await import('../src/commands/doctor-agent.mjs');
  const root = await fixture({ 'package.json': JSON.stringify({ name: 'private-path-fixture', scripts: { test: 'node test.js' } }), 'src/index.js': 'export {};' });
  await rememberProjectNote(root, 'Prefer existing utilities and do not add dependencies.');
  await setConfigValues({ aiMode: 'local', aiLocalUrl: 'http://127.0.0.1:8080/v1', aiRoutes: { general: { provider: 'llamacpp', model: 'agent-review-local' } } });
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Reviewed plan.' } }] }), { status: 200 });
  };
  console.log = () => {};
  try {
    const plan = await doctorAgentCommand(['plan', '--project', root, '--ai', '--no-profile', '--json']);
    assert.equal(plan.aiReview.answer, 'Reviewed plan.');
    const userContent = requestBody.messages.find((item) => item.role === 'user').content;
    assert.match(userContent, /Prefer existing utilities/);
    assert.doesNotMatch(userContent, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(userContent, /"root"\s*:/);
  } finally { globalThis.fetch = originalFetch; console.log = originalLog; }
});

test.after(async () => { await fs.rm(temp, { recursive: true, force: true }); });
