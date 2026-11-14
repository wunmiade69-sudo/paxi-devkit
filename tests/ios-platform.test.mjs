import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from '../src/commands/build.mjs';
import { preflight } from '../src/commands/diagnostics.mjs';

test('iOS IPA builds fail clearly on non-macOS and do not invoke a remote builder', async () => {
  if (process.platform === 'darwin') return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-ios-host-'));
  await assert.rejects(
    () => build({ projectPath: root, platform: 'ios', format: 'ipa', variant: 'release' }),
    /requires macOS with Xcode|cannot be built locally/i
  );
});

test('iOS rejects Android package formats', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-ios-format-'));
  await assert.rejects(
    () => build({ projectPath: root, platform: 'ios', format: 'apk', variant: 'release' }),
    /iOS format must be ipa/i
  );
});


test('iOS preflight explains the macOS and Xcode requirement without a remote fallback', async (t) => {
  if (process.platform === 'darwin') return t.skip('Non-macOS host-gating assertion runs on Linux/Windows CI.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-ios-preflight-'));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-ios-preflight-home-'));
  const originalConfig = process.env.XDG_CONFIG_HOME;
  try {
    await fs.writeFile(path.join(root, 'pubspec.yaml'), 'name: paxi_ios_sample\n');
    process.env.XDG_CONFIG_HOME = home;
    const originalLog = console.log;
    let report;
    console.log = () => {};
    try {
      report = await preflight({ projectPath: root, platform: 'ios', format: 'ipa', variant: 'release', json: true });
    } finally {
      console.log = originalLog;
    }
    assert.equal(report.ready, false);
    assert.equal(report.exitCode, 10);
    assert.ok(report.checks.some((check) => check.id === 'platform-host' && !check.ok));
    assert.equal(report.expectedCommand, 'flutter build ipa --release');
  } finally {
    if (originalConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfig;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  }
});
