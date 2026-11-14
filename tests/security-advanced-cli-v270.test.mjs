import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'paxi.mjs');

test('V2.7 CLI exposes advanced security scanners through security tools inventory', () => {
  const result = spawnSync(process.execPath, [cli, 'doctor', 'security', 'advanced-tools', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.scanners.some((item) => item.id === 'gitleaks'));
  assert.ok(parsed.scanners.some((item) => item.id === 'trivy'));
  assert.ok(parsed.scanners.some((item) => item.id === 'slither'));
});

test('V2.7 secret scanning is confirmation-gated at the CLI', () => {
  const result = spawnSync(process.execPath, [cli, 'doctor', 'security', 'secrets', '--project', root], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--confirm/);
});

test('V2.7 API authorization command is reachable and rejects missing plan/confirmation', () => {
  const result = spawnSync(process.execPath, [cli, 'doctor', 'security', 'api-authz'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--confirm/);
});
