import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJsonSecure } from '../src/lib/safe-store.mjs';

test('secure JSON writes use owner-only permissions and can be read back', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-safe-store-'));
  const file = path.join(root, 'private', 'config.json');
  await writeJsonSecure(file, { setting: 'safe' });
  assert.deepEqual(await readJson(file, {}), { setting: 'safe' });
  const info = await fs.stat(file);
  assert.equal(info.mode & 0o777, 0o600);
});

test('secure JSON reads reject symbolic links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-safe-link-'));
  const target = path.join(root, 'target.json');
  const link = path.join(root, 'config.json');
  await fs.writeFile(target, '{"unsafe":true}');
  await fs.symlink(target, link);
  await assert.rejects(() => readJson(link, {}), /symbolic-link/);
});

test('secure JSON store refuses a symlinked configuration directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-safe-dir-link-'));
  const target = path.join(root, 'real');
  const link = path.join(root, 'linked');
  await fs.mkdir(target);
  await fs.symlink(target, link);
  await assert.rejects(() => writeJsonSecure(path.join(link, 'config.json'), { unsafe: true }), /symbolic-link config directory/i);
});

test('concurrent secure updates preserve every increment', async () => {
  const { updateJsonSecure } = await import('../src/lib/safe-store.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-safe-concurrent-'));
  const file = path.join(root, 'private', 'counter.json');
  await writeJsonSecure(file, { count: 0 });
  await Promise.all(Array.from({ length: 12 }, () => updateJsonSecure(file, { count: 0 }, (current) => ({ count: current.count + 1 }))));
  assert.deepEqual(await readJson(file, {}), { count: 12 });
});

test('malformed JSON recovers from the last valid backup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-safe-backup-'));
  const file = path.join(root, 'private', 'config.json');
  await writeJsonSecure(file, { aiMode: 'off' });
  await writeJsonSecure(file, { aiMode: 'local' });
  await fs.writeFile(file, '{malformed');
  assert.deepEqual(await readJson(file, {}), { aiMode: 'off' });
});
