import test from 'node:test';
import assert from 'node:assert/strict';
import { setConfigValue } from '../src/lib/config.mjs';

test('AI API keys cannot be persisted in the PAXI config store', async () => {
  await assert.rejects(() => setConfigValue('apiKey', 'secret-value'), /Unsupported config key/);
});

test('child-process environment helper removes API key secrets', async () => {
  const { sanitizedEnvironment } = await import('../src/lib/process.mjs');
  process.env.PAXI_AI_API_KEY = 'do-not-leak';
  assert.equal(sanitizedEnvironment().PAXI_AI_API_KEY, undefined);
  delete process.env.PAXI_AI_API_KEY;
});

test('related AI configuration values are persisted in one atomic update', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-ai-config-'));
  try {
    const script = `import { setConfigValues } from './src/lib/config.mjs'; await setConfigValues({ aiApiUrl: 'https://api.example.test/v1', aiModel: 'model-a', aiProvider: 'openai-compatible', aiMode: 'api' });`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: home }
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const stored = JSON.parse(await fs.readFile(path.join(home, 'paxi', 'config.json'), 'utf8'));
    assert.deepEqual(
      { aiApiUrl: stored.aiApiUrl, aiModel: stored.aiModel, aiProvider: stored.aiProvider, aiMode: stored.aiMode },
      { aiApiUrl: 'https://api.example.test/v1', aiModel: 'model-a', aiProvider: 'openai-compatible', aiMode: 'api' }
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
