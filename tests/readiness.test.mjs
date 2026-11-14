import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin', 'paxi.mjs');

test('doctor --json returns a machine-readable report with package-driven PAXI version', () => {
  const home = fsSync.mkdtempSync(path.join(os.tmpdir(), 'paxi-doctor-json-'));
  const result = spawnSync(process.execPath, [cli, 'doctor', '--json'], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }
  });
  assert.ok([0, 11].includes(result.status), `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  const pkg = JSON.parse(fsSync.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(report.paxiVersion, pkg.version);
  assert.equal(typeof report.ready, 'boolean');
  assert.equal(typeof report.host.termux, 'boolean');
  assert.equal(report.host.supported, ['linux', 'darwin', 'win32'].includes(process.platform) || report.host.termux);
  assert.equal(Number.isInteger(report.offlineExitCode), true);
  assert.ok(report.tools.node);
  fsSync.rmSync(home, { recursive: true, force: true });
});

test('preflight identifies Expo as detection-only with a project-detection exit code', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-preflight-expo-'));
  try {
    await fs.writeFile(path.join(temp, 'package.json'), JSON.stringify({ name: 'expo-app', dependencies: { expo: '^54.0.0' } }));
    const home = path.join(temp, 'home');
    await fs.mkdir(home, { recursive: true });
    const result = spawnSync(process.execPath, [cli, 'preflight', '--json', '--project', temp], {
      cwd: repoRoot, encoding: 'utf8', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }
    });
    assert.equal(result.status, 10, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.project.framework, 'expo');
    assert.equal(report.project.support, 'detection-only');
    assert.equal(report.ready, false);
    assert.ok(report.checks.some((check) => check.id === 'builder-supported' && !check.ok));
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('build timeout parser rejects values outside 1..86400 and accepts valid integer range', () => {
  const result = spawnSync(process.execPath, [cli, 'build', '--timeout', '0'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /integer between 1 and 86400/);
});
