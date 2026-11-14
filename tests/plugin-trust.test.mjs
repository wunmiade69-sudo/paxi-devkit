import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('plugin execution requires explicit trust', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-plugin-'));
  process.env.XDG_CONFIG_HOME = home;
  const { pluginCommand } = await import('../src/commands/plugins.mjs');
  const pluginDir = path.join(home, 'paxi', 'plugins');
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(path.join(pluginDir, 'hello-world.mjs'), 'export function run(){ return "ok"; }');
  await assert.rejects(() => pluginCommand(['trust', 'hello-world']), /requires interactive confirmation/);
  await pluginCommand(['trust', 'hello-world', '--yes']);
  const output = await pluginCommand(['run', 'hello-world']);
  assert.equal(output, 'ok');
  delete process.env.XDG_CONFIG_HOME;
});
