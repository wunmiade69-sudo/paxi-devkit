import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-ai-studio-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
process.env.XDG_DATA_HOME = path.join(temp, 'data');
const { AI_VAULT_FILE, AI_MODELS_DIR } = await import('../src/lib/paths.mjs');
const vault = await import('../src/ai/vault.mjs');
const providers = await import('../src/ai/providers.mjs');
const studio = await import('../src/ai/studio.mjs');
const models = await import('../src/ai/models.mjs');
const transport = await import('../src/ai/transport.mjs');
const config = await import('../src/lib/config.mjs');

test('AI provider catalogue identifies US, China and local providers without implying guaranteed data residency', () => {
  assert.equal(providers.PROVIDERS.openai.region, 'US');
  assert.match(providers.PROVIDERS.deepseek.region, /China/);
  assert.equal(providers.PROVIDERS.ollama.category, 'local');
  assert.deepEqual(providers.AI_ROLES, ['general', 'coding', 'vision', 'journey']);
});

test('AI catalogue starter model examples include current provider model IDs', () => {
  assert.ok(providers.PROVIDERS.openai.suggestedModels.includes('gpt-6-astra'));
  assert.ok(providers.PROVIDERS.anthropic.suggestedModels.includes('claude-opus-5-5'));
  assert.ok(providers.PROVIDERS.google.suggestedModels.includes('gemini-3.8-flash'));
  assert.ok(providers.PROVIDERS.deepseek.suggestedModels.includes('deepseek-flash'));
  assert.ok(providers.PROVIDERS.qwen.suggestedModels.includes('qwen3.8-max'));
  assert.ok(providers.PROVIDERS.kimi.suggestedModels.includes('kimi-k3'));
});

test('AI vault encrypts API keys at rest, authenticates passphrase and never exposes key in status', async () => {
  const secret = 'test-provider-key-value-123456';
  await vault.saveProviderKey('deepseek', secret, 'a-strong-passphrase-123');
  const raw = await fs.readFile(AI_VAULT_FILE, 'utf8');
  assert.doesNotMatch(raw, /test-provider-key-value-123456/);
  assert.match(raw, /aes-256-gcm/);
  assert.deepEqual(await vault.listVaultProviders(), ['deepseek']);
  assert.equal(await vault.getProviderKey('deepseek', { passphrase: 'a-strong-passphrase-123' }), secret);
  await assert.rejects(() => vault.getProviderKey('deepseek', { passphrase: 'wrong-passphrase-000' }), /Could not unlock/);
  const stat = await fs.stat(AI_VAULT_FILE);
  if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600);
});

test('provider environment credentials override the vault without changing encrypted values', async () => {
  process.env.DEEPSEEK_API_KEY = 'environment-key-012345';
  assert.equal(await vault.getProviderKey('deepseek', { passphrase: 'a-strong-passphrase-123' }), 'environment-key-012345');
  delete process.env.DEEPSEEK_API_KEY;
});

test('legacy shared key can unlock requests for an existing provider route', async () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.PAXI_AI_API_KEY = 'legacy-shared-key-123';
  const value = await studio.unlockProviderKeyForRequest('openai');
  assert.equal(value, 'legacy-shared-key-123');
  delete process.env.PAXI_AI_API_KEY;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

test('legacy shared PAXI_AI_API_KEY remains a fallback while provider-specific keys take precedence', async () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.PAXI_AI_API_KEY = 'legacy-shared-key-123';
  assert.equal(await vault.getProviderKey('openai'), 'legacy-shared-key-123');
  process.env.OPENAI_API_KEY = 'provider-specific-key-123';
  assert.equal(await vault.getProviderKey('openai'), 'provider-specific-key-123');
  delete process.env.OPENAI_API_KEY;
  delete process.env.PAXI_AI_API_KEY;
  if (originalOpenAiKey !== undefined) process.env.OPENAI_API_KEY = originalOpenAiKey;
});

test('Qwen accepts current BAILIAN_API_KEY and legacy DASHSCOPE_API_KEY environment names', async () => {
  process.env.DASHSCOPE_API_KEY = 'legacy-dashscope-key-123';
  assert.equal(await vault.getProviderKey('qwen'), 'legacy-dashscope-key-123');
  process.env.BAILIAN_API_KEY = 'current-bailian-key-123';
  assert.equal(await vault.getProviderKey('qwen'), 'current-bailian-key-123');
  delete process.env.BAILIAN_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
});

test('removing the final AI key removes vault and backup files', async () => {
  await vault.removeProviderKey('deepseek', 'a-strong-passphrase-123');
  assert.equal(await vault.vaultExists(), false);
  assert.equal(await fs.access(`${AI_VAULT_FILE}.bak`).then(() => true).catch(() => false), false);
});

test('provider endpoint validation requires HTTPS for cloud and loopback HTTP for local', () => {
  assert.equal(studio.validateProviderEndpoint('openai', 'https://api.openai.com/v1').hostname, 'api.openai.com');
  assert.throws(() => studio.validateProviderEndpoint('deepseek', 'http://api.deepseek.com'), /HTTPS/);
  assert.throws(() => studio.validateProviderEndpoint('ollama', 'http://192.168.1.4:11434/v1'), /localhost/);
  assert.equal(studio.validateProviderEndpoint('ollama', 'http://127.0.0.1:11434/v1').port, '11434');
});

test('AI routes can assign different providers to coding and vision, and AI off disables all routes', async () => {
  await studio.saveProviderEndpoint('google', 'https://generativelanguage.googleapis.com/v1beta');
  await studio.saveAiRoute('coding', 'deepseek', 'deepseek-flash');
  await studio.saveAiRoute('vision', 'google', 'gemini-3.8-flash');
  const routes = await studio.aiRouteCommand(['show']).then(() => config.getConfig());
  assert.deepEqual(routes.aiRoutes.coding, { provider: 'deepseek', model: 'deepseek-flash' });
  assert.deepEqual(routes.aiRoutes.vision, { provider: 'google', model: 'gemini-3.8-flash' });
  const vision = await studio.resolveConfiguredRoute('vision');
  assert.equal(vision.providerId, 'google');
  assert.equal(vision.model, 'gemini-3.8-flash');
  await config.setConfigValues({ aiMode: 'off' });
  await assert.rejects(() => studio.resolveConfiguredRoute('coding'), /AI is disabled/);
});

test('OpenAI-compatible, Anthropic and Gemini adapters send provider-specific request shapes', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), headers: options.headers, body });
    if (String(url).includes('generativelanguage')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini response' }] } }] }), { status: 200 });
    if (String(url).includes('/v1/messages')) return new Response(JSON.stringify({ content: [{ type: 'text', text: 'claude response' }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'openai response' } }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const messages = [{ role: 'system', content: 'Be safe.' }, { role: 'user', content: 'Hello.' }];
  const openai = await transport.requestModel({ providerId: 'openai', apiKey: 'openai-key-123456', model: 'gpt-6-luna', messages });
  const claude = await transport.requestModel({ providerId: 'anthropic', apiKey: 'claude-key-123456', model: 'claude-opus-4-7', messages });
  const gemini = await transport.requestModel({ providerId: 'google', apiKey: 'google-key-123456', model: 'gemini-3.8-flash', messages });
  assert.equal(openai.answer, 'openai response');
  assert.equal(claude.answer, 'claude response');
  assert.equal(gemini.answer, 'gemini response');
  assert.equal(calls[0].body.max_completion_tokens, 1800);
  assert.equal('max_tokens' in calls[0].body, false);
  assert.equal('temperature' in calls[0].body, false);
  assert.equal(calls[0].body.messages[0].role, 'developer');
  assert.equal('temperature' in calls[2].body.generationConfig, false);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[1].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[1].headers['x-api-key'], 'claude-key-123456');
  assert.equal(calls[1].body.system, 'Be safe.');
  assert.match(calls[2].url, /models\/gemini-3.8-flash:generateContent$/);
  assert.equal(calls[2].headers['x-goog-api-key'], 'google-key-123456');
  assert.doesNotMatch(calls[2].url, /google-key/);
});

test('model catalogue includes compact local models and download requires explicit confirmation', async () => {
  const catalog = models.getModelCatalog();
  assert.ok(catalog.gguf.some((item) => item.id === 'qwen35-08b-q4km'));
  await assert.rejects(() => models.downloadCatalogModel('qwen35-08b-q4km'), /--confirm/);
  await assert.rejects(() => models.downloadCatalogModel('../../outside', { confirm: true }), /Unknown local model/);
});

test('GGUF download verifies Hugging Face metadata, file signature, exact size and SHA-256 before install', async (t) => {
  const originalFetch = globalThis.fetch;
  const file = Buffer.from('GGUF' + 'paxi-test-model-binary-data');
  const sha = crypto.createHash('sha256').update(file).digest('hex');
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/models/')) return new Response(JSON.stringify([{ path: 'Qwen3.5-0.8B-Q4_K_M.gguf', type: 'file', size: file.length, lfs: { oid: sha, size: file.length } }]), { status: 200 });
    return new Response(file, { status: 200, headers: { 'content-length': String(file.length) } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await models.downloadCatalogModel('qwen35-08b-q4km', { confirm: true });
  assert.equal(result.verified, true);
  assert.equal(result.sha256, sha);
  assert.equal((await fs.readFile(result.path)).subarray(0, 4).toString('ascii'), 'GGUF');
  assert.equal((await fs.stat(result.path)).mode & 0o777, process.platform === 'win32' ? (await fs.stat(result.path)).mode & 0o777 : 0o600);
});

test('Ollama model discovery follows a configured loopback endpoint', async (t) => {
  await studio.saveProviderEndpoint('ollama', 'http://localhost:11435/v1');
  const originalFetch = globalThis.fetch;
  let calledUrl;
  globalThis.fetch = async (url) => { calledUrl = String(url); return new Response(JSON.stringify({ models: [{ name: 'qwen3.5:0.8b' }] }), { status: 200 }); };
  t.after(() => { globalThis.fetch = originalFetch; });
  assert.deepEqual(await studio.discoverModels('ollama'), ['qwen3.5:0.8b']);
  assert.equal(calledUrl, 'http://localhost:11435/api/tags');
});

test('provider model discovery uses the correct native endpoint and API key header', async (t) => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url: String(url), headers: options.headers };
    return new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.8-flash' }, { name: 'models/gemini-3.1-pro-preview' }] }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  process.env.GEMINI_API_KEY = 'gemini-key-123456';
  const found = await studio.discoverModels('google');
  delete process.env.GEMINI_API_KEY;
  assert.deepEqual(found, ['gemini-3.1-pro-preview', 'gemini-3.8-flash']);
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models');
  assert.equal(call.headers['x-goog-api-key'], 'gemini-key-123456');
});


test('general and journey prompts use their independently selected local model routes', async (t) => {
  await studio.saveProviderEndpoint('ollama', 'http://127.0.0.1:11434/v1');
  await config.setConfigValues({
    aiMode: 'local',
    aiRoutes: {
      general: { provider: 'llamacpp', model: 'local-general' },
      journey: { provider: 'ollama', model: 'qwen3.5:0.8b' }
    }
  });
  const originalFetch = globalThis.fetch;
  let called;
  globalThis.fetch = async (url, options) => {
    called = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Draft journey: Settings > About. Review selectors before execution.' } }] }), { status: 200 });
  };
  const originalLog = console.log;
  console.log = () => {};
  t.after(() => { globalThis.fetch = originalFetch; console.log = originalLog; });
  const { aiAsk } = await import('../src/commands/ai.mjs');
  const result = await aiAsk('Prepare a safe Settings/About test journey', { role: 'journey', includeProfile: false });
  assert.equal(result.provider, 'ollama');
  assert.equal(result.model, 'qwen3.5:0.8b');
  assert.equal(called.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.match(called.body.messages[0].content, /Never execute actions/);
});

test('encrypted key values are excluded from child process environments', async () => {
  const { sanitizedEnvironment } = await import('../src/lib/process.mjs');
  process.env.PAXI_AI_VAULT_PASSPHRASE = 'not-for-child-process';
  process.env.OPENAI_API_KEY = 'private-child-secret';
  process.env.BAILIAN_API_KEY = 'private-qwen-secret';
  const clean = sanitizedEnvironment();
  assert.equal(clean.PAXI_AI_VAULT_PASSPHRASE, undefined);
  assert.equal(clean.OPENAI_API_KEY, undefined);
  assert.equal(clean.BAILIAN_API_KEY, undefined);
  delete process.env.PAXI_AI_VAULT_PASSPHRASE;
  delete process.env.OPENAI_API_KEY;
  delete process.env.BAILIAN_API_KEY;
});

test.after(async () => { await fs.rm(temp, { recursive: true, force: true }); });
