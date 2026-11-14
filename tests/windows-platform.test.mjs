import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from '../src/commands/build.mjs';
import { createGradleInvocation } from '../src/lib/gradle-invocation.mjs';
import { createZipFromDirectory } from '../src/lib/zip.mjs';
import { inspectArtifact } from '../src/lib/artifacts.mjs';
import { inspectWindowsToolchain } from '../src/lib/windows.mjs';

async function tempDir(prefix = 'paxi-windows-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('Windows ZIP packager streams a Flutter desktop bundle and verifier checks its layout', async () => {
  const root = await tempDir();
  try {
    const bundle = path.join(root, 'Release');
    await fs.mkdir(path.join(bundle, 'data'), { recursive: true });
    await fs.writeFile(path.join(bundle, 'sample_app.exe'), 'exe-payload');
    await fs.writeFile(path.join(bundle, 'flutter_windows.dll'), 'flutter-runtime');
    await fs.writeFile(path.join(bundle, 'data', 'icudtl.dat'), 'flutter-assets');
    const archive = path.join(root, 'sample-windows.zip');
    const created = await createZipFromDirectory(bundle, archive);
    assert.equal(created.entries, 3);
    const report = await inspectArtifact(archive, { quiet: true });
    assert.equal(report.type, 'WINDOWS ZIP');
    assert.equal(report.packageName, 'sample_app');
    assert.equal(report.zipEntries, 3);
    assert.match(report.verificationLevel, /Windows app bundle structure valid/);
    assert.match(report.warnings.join(' '), /code-signature status was not checked/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Windows ZIP packager refuses symlinked bundle entries', async (t) => {
  const root = await tempDir();
  try {
    const bundle = path.join(root, 'Release');
    await fs.mkdir(bundle);
    const external = path.join(root, 'external.txt');
    await fs.writeFile(external, 'outside bundle');
    try { await fs.symlink(external, path.join(bundle, 'linked.txt')); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('This host does not permit creating symlinks in the test environment.');
      throw error;
    }
    await assert.rejects(() => createZipFromDirectory(bundle, path.join(root, 'unsafe.zip')), /symbolic link/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Windows Gradle Wrapper plan uses java directly instead of executing gradlew.bat through a shell', async () => {
  const root = await tempDir();
  try {
    await fs.mkdir(path.join(root, 'gradle', 'wrapper'), { recursive: true });
    await fs.writeFile(path.join(root, 'gradlew.bat'), '@echo off\r\n');
    await fs.writeFile(path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar'), 'jar');
    await fs.writeFile(path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.12-bin.zip\n');
    const invocation = await createGradleInvocation({
      projectRoot: root, task: 'assembleDebug', hostPlatform: 'win32',
      commandExistsImpl: async (command) => command === 'java'
    });
    assert.equal(invocation.command, 'java');
    assert.deepEqual(invocation.args.slice(0, 3), ['-classpath', path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain']);
    assert.equal(invocation.args[3], 'assembleDebug');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Windows desktop format is restricted to a ZIP bundle', async () => {
  await assert.rejects(
    () => build({ platform: 'windows', format: 'apk', variant: 'debug' }),
    /Windows desktop format must be zip/i
  );
});

test('Windows desktop builds fail clearly on non-Windows hosts and never use a remote builder', async () => {
  if (process.platform === 'win32') return;
  const root = await tempDir();
  try {
    await fs.writeFile(path.join(root, 'pubspec.yaml'), 'name: paxi_windows_sample\n');
    await assert.rejects(
      () => build({ projectPath: root, platform: 'windows', format: 'zip', variant: 'release' }),
      /requires a Windows host|cannot be built locally on this host/i
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Windows Flutter build integration uses local toolchain and emits a runnable app bundle', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows host integration test runs on Windows CI only.');
  const windowsTools = await inspectWindowsToolchain();
  if (!windowsTools.ready) return t.skip(`Windows C++/SDK toolchain not present on this runner: ${windowsTools.detail}`);

  const root = await tempDir();
  const bin = path.join(root, 'fake-bin');
  const project = path.join(root, 'flutter-sample');
  const config = path.join(root, 'config');
  try {
    await fs.mkdir(bin, { recursive: true });
    await fs.mkdir(path.join(project, 'windows'), { recursive: true });
    await fs.writeFile(path.join(project, 'pubspec.yaml'), 'name: paxi_windows_sample\n');
    await fs.writeFile(path.join(project, 'windows', 'CMakeLists.txt'), '# fake runner marker\n');
    const fakeFlutter = [
      '@echo off',
      'if not "%1"=="build" exit /b 31',
      'if not "%2"=="windows" exit /b 32',
      'mkdir "build\\windows\\x64\\runner\\Release\\data" 2>nul',
      'echo executable>"build\\windows\\x64\\runner\\Release\\paxi_sample.exe"',
      'echo runtime>"build\\windows\\x64\\runner\\Release\\flutter_windows.dll"',
      'echo assets>"build\\windows\\x64\\runner\\Release\\data\\icudtl.dat"',
      'exit /b 0',
      ''
    ].join('\r\n');
    await fs.writeFile(path.join(bin, 'flutter.bat'), fakeFlutter, 'utf8');
    const oldPath = process.env.PATH;
    const oldConfig = process.env.XDG_CONFIG_HOME;
    process.env.PATH = `${bin}${path.delimiter}${oldPath || ''}`;
    process.env.XDG_CONFIG_HOME = config;
    try {
      const result = await build({ projectPath: project, platform: 'windows', format: 'zip', variant: 'release' });
      assert.match(result.artifact, /paxi_windows_sample-windows-release-/i);
      const report = await inspectArtifact(result.artifact, { quiet: true });
      assert.equal(report.type, 'WINDOWS ZIP');
      const history = JSON.parse(await fs.readFile(path.join(config, 'paxi', 'build-history.json'), 'utf8'));
      assert.deepEqual(history[0].lifecycle.history.map((entry) => entry.state), ['created', 'preflight', 'building', 'verifying', 'succeeded']);
    } finally {
      if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
      if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Windows desktop preflight exposes a Windows-host requirement without remote fallback', async () => {
  if (process.platform === 'win32') return;
  const root = await tempDir();
  const home = await tempDir('paxi-windows-preflight-home-');
  try {
    await fs.writeFile(path.join(root, 'pubspec.yaml'), 'name: paxi_windows_preflight\n');
    await fs.mkdir(path.join(root, 'windows'), { recursive: true });
    await fs.writeFile(path.join(root, 'windows', 'CMakeLists.txt'), '# runner marker\n');
    const { preflight } = await import('../src/commands/diagnostics.mjs');
    const originalConfig = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = home;
    try {
      const originalLog = console.log;
      let report;
      console.log = () => {};
      try {
        report = await preflight({ projectPath: root, platform: 'windows', format: 'zip', variant: 'release', json: true });
      } finally {
        console.log = originalLog;
      }
      assert.equal(report.ready, false);
      assert.equal(report.exitCode, 10);
      assert.ok(report.checks.some((item) => item.id === 'platform-host' && item.ok === false));
      assert.equal(report.expectedCommand, 'flutter build windows --release');
    } finally {
      if (originalConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalConfig;
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('Windows ZIP strict verification refuses to imply Authenticode validation', async () => {
  const root = await tempDir();
  try {
    const bundle = path.join(root, 'Release');
    await fs.mkdir(path.join(bundle, 'data'), { recursive: true });
    await fs.writeFile(path.join(bundle, 'sample.exe'), 'binary');
    await fs.writeFile(path.join(bundle, 'flutter_windows.dll'), 'runtime');
    await fs.writeFile(path.join(bundle, 'data', 'icudtl.dat'), 'assets');
    const archive = path.join(root, 'sample.zip');
    await createZipFromDirectory(bundle, archive);
    await assert.rejects(() => inspectArtifact(archive, { quiet: true, strict: true }), /Authenticode|Strict Windows ZIP verification/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Windows offline preflight checks both Gradle and Flutter caches', async () => {
  const root = await tempDir('paxi-windows-offline-');
  const home = await tempDir('paxi-windows-offline-home-');
  const flutterRoot = path.join(home, 'flutter');
  const pubCache = path.join(home, 'pub-cache');
  const gradleHome = path.join(home, 'gradle-home');
  const fakeBin = path.join(home, 'bin');
  const previous = Object.fromEntries(['XDG_CONFIG_HOME', 'FLUTTER_ROOT', 'PUB_CACHE', 'GRADLE_USER_HOME', 'PATH'].map((key) => [key, process.env[key]]));
  try {
    await fs.mkdir(path.join(root, 'android', 'gradle', 'wrapper'), { recursive: true });
    await fs.mkdir(path.join(gradleHome, 'wrapper', 'dists', 'gradle-8.12-bin', 'hash', 'gradle-8.12', 'bin'), { recursive: true });
    await fs.mkdir(path.join(gradleHome, 'caches', 'modules-2'), { recursive: true });
    await fs.mkdir(path.join(pubCache), { recursive: true });
    await fs.mkdir(path.join(flutterRoot, 'bin', 'cache', 'artifacts', 'engine', 'windows-x64'), { recursive: true });
    await fs.mkdir(fakeBin, { recursive: true });
    await fs.writeFile(path.join(root, 'pubspec.yaml'), 'name: windows_offline_sample\n');
    await fs.writeFile(path.join(root, 'windows', 'CMakeLists.txt'), '# runner\n').catch(async () => {
      await fs.mkdir(path.join(root, 'windows'), { recursive: true });
      await fs.writeFile(path.join(root, 'windows', 'CMakeLists.txt'), '# runner\n');
    });
    await fs.writeFile(path.join(root, 'android', 'gradlew'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    await fs.writeFile(path.join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.12-bin.zip\n');
    await fs.writeFile(path.join(gradleHome, 'wrapper', 'dists', 'gradle-8.12-bin', 'hash', 'gradle-8.12', 'bin', 'gradle'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    await fs.writeFile(path.join(fakeBin, 'flutter'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    process.env.XDG_CONFIG_HOME = path.join(home, 'config');
    process.env.FLUTTER_ROOT = flutterRoot;
    process.env.PUB_CACHE = pubCache;
    process.env.GRADLE_USER_HOME = gradleHome;
    process.env.PATH = `${fakeBin}${path.delimiter}${previous.PATH || ''}`;

    const { preflight } = await import('../src/commands/diagnostics.mjs');
    const originalLog = console.log;
    let report;
    console.log = () => {};
    try { report = await preflight({ projectPath: root, platform: 'windows', format: 'zip', variant: 'release', offline: true, json: true }); }
    finally { console.log = originalLog; }

    assert.ok(report.checks.some((check) => check.id === 'gradle-wrapper-cache' && check.ok));
    assert.ok(report.checks.some((check) => check.id === 'gradle-dependency-cache' && check.ok));
    assert.ok(report.checks.some((check) => check.id === 'windows-flutter-artifacts' && check.ok));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  }
});
