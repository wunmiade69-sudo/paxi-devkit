import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-agent-v120-'));
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

test('architecture analysis maps internal JS imports, entrypoints, API/state signals and cycles without source contents', async () => {
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'architecture-fixture', dependencies: { react: '^19.0.0' }, scripts: { test: 'node --test' } }),
    'package-lock.json': JSON.stringify({ name: 'architecture-fixture', lockfileVersion: 3 }),
    'src/main.jsx': "import App from './App.jsx';\nexport default App;",
    'src/App.jsx': "import { load } from './api.js';\nimport { useStore } from './store.js';\nexport default function App(){ return fetch('/api'); }",
    'src/api.js': "import { state } from './store.js';\nexport const load = () => axios.get('/items');",
    'src/store.js': "import { load } from './api.js';\nexport const useStore = () => useState(load);"
  });
  const { analyzeProjectArchitecture } = await import('../src/doctor/project-architecture.mjs');
  const result = await analyzeProjectArchitecture(root);
  assert.ok(result.entrypoints.includes('src/main.jsx'));
  assert.ok(result.graph.edgeCount >= 4);
  assert.ok(result.graph.cycles.length >= 1);
  assert.ok(result.architectureSignals.apiMarkers.some((item) => item.name === 'fetch'));
  assert.ok(result.architectureSignals.stateMarkers.some((item) => item.name === 'react-state'));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(JSON.stringify(result), /export default function App/);
  assert.ok(result.dependencyInventory.direct.includes('react'));
  assert.ok(result.inventory.manifests.includes('package.json'));
  assert.ok(result.inventory.manifests.includes('package-lock.json'));
});

test('architecture analyzer refuses a symlink root', async () => {
  const root = await fixture({ 'src/index.js': 'export {};' });
  const link = path.join(temp, 'architecture-link');
  await fs.symlink(root, link);
  const { analyzeProjectArchitecture } = await import('../src/doctor/project-architecture.mjs');
  await assert.rejects(() => analyzeProjectArchitecture(link), /non-symlink/);
});

test('feedback is local, project-scoped, redacted and influences review bias only after repeated signals', async () => {
  const { recordAgentFeedback, summarizeAgentFeedback, listAgentFeedback } = await import('../src/doctor/agent-feedback.mjs');
  const one = await fixture({ 'README.md': 'one' });
  const two = await fixture({ 'README.md': 'two' });
  await recordAgentFeedback(one, { decision: 'rejected', area: 'testing', note: 'Do not accept incomplete tests. API_KEY=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' });
  await recordAgentFeedback(one, { decision: 'modified', area: 'testing', note: 'Require a physical-device run before claiming Android passed.' });
  await recordAgentFeedback(one, { decision: 'accepted', area: 'testing' });
  await recordAgentFeedback(one, { decision: 'rejected', area: 'testing' });
  const summary = await summarizeAgentFeedback(one);
  assert.equal(summary.total, 4);
  assert.equal(summary.areas.testing.reviewBias, 'extra-human-review');
  assert.equal(summary.areas.testing.autoApplyAllowed, false);
  assert.equal((await listAgentFeedback(two)).events.length, 0);
  const events = await listAgentFeedback(one);
  assert.doesNotMatch(JSON.stringify(events), /sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345/);
  assert.match(events.events[0].note, /Do not accept incomplete tests/);
});

test('feedback clear is scoped to the current project', async () => {
  const { recordAgentFeedback, clearAgentFeedback, listAgentFeedback } = await import('../src/doctor/agent-feedback.mjs');
  const one = await fixture(); const two = await fixture();
  await recordAgentFeedback(one, { decision: 'accepted', area: 'plan' });
  await recordAgentFeedback(two, { decision: 'rejected', area: 'patch' });
  assert.equal((await clearAgentFeedback(one)).removed, 1);
  assert.equal((await listAgentFeedback(one)).events.length, 0);
  assert.equal((await listAgentFeedback(two)).events.length, 1);
});

test('AI budget preflight enforces token, per-request and monthly limits using only user-entered rates', async () => {
  const { setAiBudgetLimit, setAiModelPricing, previewAiBudget, getAiBudget } = await import('../src/ai/budget.mjs');
  await setAiBudgetLimit('maxInputTokens', 100);
  await setAiBudgetLimit('maxOutputTokens', 50);
  await setAiBudgetLimit('maxRequestUsd', 0.01);
  await setAiBudgetLimit('maxMonthlyUsd', 0.02);
  const missingPrice = await previewAiBudget({ provider: 'openai', model: 'test-model', messages: [{ role: 'user', content: 'hello' }], maxTokens: 20, local: false });
  assert.equal(missingPrice.allowed, false);
  assert.ok(missingPrice.errors.some((item) => /No user-configured price/.test(item)));
  await setAiModelPricing('openai', 'test-model', 100, 200);
  const tooLarge = await previewAiBudget({ provider: 'openai', model: 'test-model', messages: [{ role: 'user', content: 'x'.repeat(1000) }], maxTokens: 20, local: false });
  assert.equal(tooLarge.allowed, false);
  assert.ok(tooLarge.errors.some((item) => /input/.test(item)));
  await setAiBudgetLimit('maxInputTokens', 10000);
  await setAiBudgetLimit('maxOutputTokens', 4096);
  const expensive = await previewAiBudget({ provider: 'openai', model: 'test-model', messages: [{ role: 'user', content: 'please help' }], maxTokens: 2200, local: false });
  assert.equal(expensive.allowed, false);
  assert.ok(expensive.estimatedCostUsd > 0.01);
  assert.ok((await getAiBudget()).pricing['openai/test-model']);
});

test('AI budget records provider usage with user-configured rates and monthly ledger', async () => {
  const { setAiBudgetLimit, setAiModelPricing, previewAiBudget, recordAiBudgetUsage, getAiBudget } = await import('../src/ai/budget.mjs');
  await setAiModelPricing('deepseek', 'budget-test', 1, 2);
  const preview = await previewAiBudget({ provider: 'deepseek', model: 'budget-test', messages: [{ role: 'user', content: 'hello' }], maxTokens: 20, local: false });
  const recorded = await recordAiBudgetUsage({ provider: 'deepseek', model: 'budget-test', usage: { prompt_tokens: 1000, completion_tokens: 500 }, budgetPreview: preview, local: false });
  assert.equal(recorded.inputTokens, 1000);
  assert.equal(recorded.outputTokens, 500);
  assert.equal(recorded.costUsd, 0.002);
  assert.ok((await getAiBudget()).ledger.some((item) => item.provider === 'deepseek' && item.model === 'budget-test'));
  await setAiBudgetLimit('maxMonthlyUsd', 0.0025);
  const monthlyBlocked = await previewAiBudget({ provider: 'deepseek', model: 'budget-test', messages: [{ role: 'user', content: 'hello' }], maxTokens: 2200, local: false });
  assert.equal(monthlyBlocked.allowed, false);
  assert.ok(monthlyBlocked.errors.some((item) => /monthly cap/.test(item)));
});

test('AI budget rejects malformed provider token counts instead of recording negative spend', async () => {
  const { setAiModelPricing, previewAiBudget, recordAiBudgetUsage } = await import('../src/ai/budget.mjs');
  await setAiModelPricing('deepseek', 'malformed-usage-test', 1, 2);
  const preview = await previewAiBudget({ provider: 'deepseek', model: 'malformed-usage-test', messages: [{ role: 'user', content: 'hello' }], maxTokens: 20, local: false });
  const recorded = await recordAiBudgetUsage({ provider: 'deepseek', model: 'malformed-usage-test', usage: { prompt_tokens: -100, completion_tokens: '12.5' }, budgetPreview: preview, local: false });
  assert.equal(recorded.inputTokens, preview.inputTokensEstimated);
  assert.equal(recorded.outputTokens, preview.outputTokensRequested);
  assert.equal(recorded.source, 'estimated');
  assert.ok(recorded.costUsd >= 0);
  const nonFinite = await recordAiBudgetUsage({ provider: 'deepseek', model: 'malformed-usage-test', usage: { prompt_tokens: Number.NaN, completion_tokens: Number.POSITIVE_INFINITY }, budgetPreview: preview, local: false });
  assert.equal(nonFinite.source, 'estimated');
  assert.ok(Number.isFinite(nonFinite.costUsd));
});

test('cloud model transport blocks a call before fetch when configured spend limits cannot be evaluated', async () => {
  const { setAiBudgetLimit } = await import('../src/ai/budget.mjs');
  const { requestModel } = await import('../src/ai/transport.mjs');
  await setAiBudgetLimit('maxRequestUsd', 0.5);
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
  try {
    await assert.rejects(() => requestModel({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'test', model: 'no-price-configured', messages: [{ role: 'user', content: 'hello' }] }), /budget guard blocked/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('successful cloud transport passes the budget guard and records returned token usage', async () => {
  const { setAiBudgetLimit, setAiModelPricing, getAiBudget } = await import('../src/ai/budget.mjs');
  const { requestModel } = await import('../src/ai/transport.mjs');
  await setAiBudgetLimit('maxRequestUsd', 0.5);
  await setAiBudgetLimit('maxMonthlyUsd', 1);
  await setAiBudgetLimit('maxInputTokens', 32000);
  await setAiBudgetLimit('maxOutputTokens', 4096);
  await setAiModelPricing('deepseek', 'transport-budget-test', 0.1, 0.2);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const sent = JSON.parse(options.body);
    assert.equal(sent.model, 'transport-budget-test');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'budget ok' } }], usage: { prompt_tokens: 100, completion_tokens: 40 } }), { status: 200 });
  };
  try {
    const result = await requestModel({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-key', model: 'transport-budget-test', messages: [{ role: 'user', content: 'hello' }], maxTokens: 50 });
    assert.equal(result.answer, 'budget ok');
    assert.equal(result.budget.recorded, true);
    assert.equal(result.budget.usageSource, 'provider-usage');
    assert.equal(result.budget.recordedCostUsd, 0.000018);
    assert.ok((await getAiBudget()).ledger.some((item) => item.model === 'transport-budget-test'));
  } finally { globalThis.fetch = originalFetch; }
});

test('Agent plan includes architecture and explicit feedback adaptation without executing work', async () => {
  const { setConfigValues } = await import('../src/lib/config.mjs');
  const { buildAgentPlan } = await import('../src/doctor/agent-engine.mjs');
  const { recordAgentFeedback } = await import('../src/doctor/agent-feedback.mjs');
  await setConfigValues({ aiMode: 'off', aiRoutes: {} });
  const root = await fixture({
    'package.json': JSON.stringify({ name: 'agent-v12-fixture', scripts: { test: 'node --test' }, dependencies: { react: '^19.0.0' } }),
    'index.html': '<button>Continue</button>',
    'src/main.jsx': "import App from './App.jsx'; export default App;",
    'src/App.jsx': "export default function App(){ return fetch('/api'); }"
  });
  await recordAgentFeedback(root, { decision: 'rejected', area: 'testing' });
  await recordAgentFeedback(root, { decision: 'modified', area: 'testing' });
  await recordAgentFeedback(root, { decision: 'rejected', area: 'testing' });
  const plan = await buildAgentPlan({ projectPath: root });
  assert.ok(plan.architecture.graph.edgeCount >= 1);
  assert.ok(plan.architecture.architectureSignals.apiMarkers.some((item) => item.name === 'fetch'));
  assert.equal(plan.feedbackAdaptation.areas.testing.reviewBias, 'extra-human-review');
  assert.ok(plan.steps.some((step) => step.id === 'api-contract-check'));
  assert.ok(plan.steps.some((step) => step.id === 'state-transition-check') === false);
  assert.equal(plan.execution.status, 'plan-only');
  assert.equal(plan.execution.testsRun, false);
  assert.equal(plan.execution.filesChanged, false);
});

test('Agent feedback and architecture commands expose project-scoped reports', async () => {
  const { doctorAgentCommand } = await import('../src/commands/doctor-agent.mjs');
  const root = await fixture({ 'package.json': JSON.stringify({ name: 'cli-v12', scripts: { test: 'node --test' } }), 'src/main.js': "import { run } from './service.js'; run();", 'src/service.js': "export const run = () => fetch('/health');" });
  const originalLog = console.log;
  console.log = () => {};
  try {
    const architecture = await doctorAgentCommand(['architecture', '--project', root, '--json']);
    assert.ok(architecture.graph.edgeCount >= 1);
    const saved = await doctorAgentCommand(['feedback', 'record', '--decision', 'modified', '--area', 'plan', '--note', 'Please include an API test.', '--project', root]);
    assert.equal(saved.event.decision, 'modified');
    const shown = await doctorAgentCommand(['feedback', 'show', '--project', root]);
    assert.equal(shown.summary.total, 1);
    assert.equal(shown.summary.areas.plan.modified, 1);
  } finally { console.log = originalLog; }
});

test.after(async () => { await fs.rm(temp, { recursive: true, force: true }); });
