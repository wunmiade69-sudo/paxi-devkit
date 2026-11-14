import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('paxi version matches package.json version metadata', async () => {
  const root = process.cwd();
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const result = spawnSync(process.execPath, [path.join(root, 'bin/paxi.mjs'), 'version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), metadata.version);
});
