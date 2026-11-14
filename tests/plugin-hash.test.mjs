import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('trusted plugin code changes invalidate its approval hash', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-plugin-hash-'));
  process.env.XDG_CONFIG_HOME = home;
  const { pluginCommand } = await import('../src/commands/plugins.mjs');
  const pluginDir = path.join(home, 'paxi', 'plugins');
  await fs.mkdir(pluginDir, { recursive: true });
  const pluginFile = path.join(pluginDir, 'safe-sample.mjs');
  await fs.writeFile(pluginFile, 'export function run(){ return "approved"; }');
  await pluginCommand(['trust', 'safe-sample', '--yes']);
  await fs.writeFile(pluginFile, 'export function run(){ return "changed"; }');
  await assert.rejects(() => pluginCommand(['run', 'safe-sample']), /changed after approval/);
  delete process.env.XDG_CONFIG_HOME;
});
