import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = path.resolve('bin/paxi.mjs');

test('build history --failed includes timeout/cancelled outcomes and shows structural artifact checksums', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-build-history-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const configHome = path.join(temp, 'config');
  const paxiDir = path.join(configHome, 'paxi');
  await fs.mkdir(paxiDir, { recursive: true });
  await fs.writeFile(path.join(paxiDir, 'build-history.json'), JSON.stringify([
    { id: 'timeout-1', status: 'failed', outcome: 'timed_out', projectName: 'timeout-project', platform: 'android', framework: 'flutter', format: 'apk', variant: 'debug', startedAt: '2026-11-09T10:00:00.000Z' },
    { id: 'cancel-1', status: 'failed', outcome: 'cancelled', projectName: 'cancel-project', platform: 'android', framework: 'gradle', format: 'apk', variant: 'debug', startedAt: '2026-11-09T10:01:00.000Z' },
    { id: 'partial-1', status: 'failed', outcome: 'failed', projectName: 'partial-project', platform: 'windows', framework: 'flutter', format: 'zip', variant: 'release', startedAt: '2026-11-09T10:02:00.000Z', artifact: '/tmp/app.zip', artifactSizeBytes: 1024, artifactSha256: 'abc123', artifactVerified: false, artifactVerificationState: 'structurally_valid_only' },
    { id: 'success-1', status: 'succeeded', outcome: 'succeeded', projectName: 'success-project', platform: 'android', framework: 'flutter', format: 'apk', variant: 'debug', startedAt: '2026-11-09T10:03:00.000Z' }
  ], null, 2));

  const result = spawnSync(process.execPath, [cli, 'builds', '--failed'], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: configHome }
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /timeout-project.*timed_out/);
  assert.match(result.stdout, /cancel-project.*cancelled/);
  assert.match(result.stdout, /partial-project.*failed/);
  assert.match(result.stdout, /structure checked only.*SHA-256 abc123/);
  assert.doesNotMatch(result.stdout, /success-project/);
});
