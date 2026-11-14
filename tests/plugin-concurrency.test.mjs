import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('concurrent plugin trust updates preserve both hash approvals', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-plugin-concurrent-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  try {
    const { pluginCommand } = await import('../src/commands/plugins.mjs');
    const pluginDir = path.join(home, 'paxi', 'plugins');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, 'plugin-one.mjs'), 'export function run(){ return 1; }');
    await fs.writeFile(path.join(pluginDir, 'plugin-two.mjs'), 'export function run(){ return 2; }');
    await Promise.all([
      pluginCommand(['trust', 'plugin-one', '--yes']),
      pluginCommand(['trust', 'plugin-two', '--yes'])
    ]);
    const config = JSON.parse(await fs.readFile(path.join(home, 'paxi', 'config.json'), 'utf8'));
    assert.match(config.trustedPluginHashes['plugin-one'], /^[a-f0-9]{64}$/);
    assert.match(config.trustedPluginHashes['plugin-two'], /^[a-f0-9]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await fs.rm(home, { recursive: true, force: true });
  }
});
