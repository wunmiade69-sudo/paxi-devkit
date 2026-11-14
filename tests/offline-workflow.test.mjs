import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gradleDistributionName, inspectGradleWrapperCache, createOfflineGradleEnvironment } from '../src/lib/offline.mjs';
import { classifyFailure } from '../src/lib/failure.mjs';
import { exitCodeForError } from '../src/lib/exit-codes.mjs';
import { taskCommand } from '../src/commands/tasks.mjs';
import { cacheClean } from '../src/commands/cache.mjs';
import { writeZipFixture } from './helpers/zip-fixture.mjs';
import { nonTermuxTestEnv } from './helpers/host-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Gradle wrapper parser handles escaped URL separators and distributions', () => {
  assert.deepEqual(gradleDistributionName('distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip'), {
    version: '8.14.3', flavor: 'all', directory: 'gradle-8.14.3-all'
  });
  assert.equal(gradleDistributionName('distributionUrl=not-a-gradle-zip'), null);
});

test('offline Gradle cache inspection detects the exact wrapper version', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-offline-cache-'));
  const project = path.join(home, 'project');
  const gradleHome = path.join(home, 'gradle-home');
  const wrapper = path.join(project, 'android', 'gradle', 'wrapper');
  const dists = path.join(gradleHome, 'wrapper', 'dists', 'gradle-8.14.3-all', 'hash', 'gradle-8.14.3', 'bin');
  await fs.mkdir(wrapper, { recursive: true });
  await fs.mkdir(dists, { recursive: true });
  await fs.writeFile(path.join(project, 'android', 'gradlew'), '#!/bin/sh\n', { mode: 0o700 });
  await fs.writeFile(path.join(wrapper, 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip\n');
  await fs.writeFile(path.join(dists, 'gradle'), '#!/bin/sh\n', { mode: 0o700 });
  const result = await inspectGradleWrapperCache(path.join(project, 'android'), { gradleUserHome: gradleHome });
  assert.equal(result.wrapperPresent, true);
  assert.equal(result.cached, true);
  assert.equal(result.version, '8.14.3');
});

test('temporary offline Gradle home shares only cache directories and enables StartParameter offline', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-gradle-home-'));
  await fs.mkdir(path.join(base, 'wrapper'), { recursive: true });
  await fs.mkdir(path.join(base, 'caches'), { recursive: true });
  const created = await createOfflineGradleEnvironment({ baseHome: base });
  const script = await fs.readFile(created.initScript, 'utf8');
  assert.match(script, /startParameter\.offline\s*=\s*true/);
  assert.equal((await fs.lstat(path.join(created.env.GRADLE_USER_HOME, 'wrapper'))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(created.env.GRADLE_USER_HOME, 'caches'))).isSymbolicLink(), true);
  await created.cleanup();
  await assert.rejects(() => fs.stat(created.env.GRADLE_USER_HOME));
});

test('test timeout validation rejects zero, decimals, negatives, empty and values over 24 hours', async () => {
  for (const value of ['0', '1.5', '-1', '', '86401', '999999999']) {
    await assert.rejects(() => taskCommand('test', ['--timeout', value]), /integer from 1 to 86400 seconds/);
  }
});

test('offline dependency classifier explains missing Gradle wrapper distributions', () => {
  const failure = classifyFailure('Exception in thread main org.gradle.wrapper.Download.downloadInternal java.net.SocketException: Software caused connection abort');
  assert.equal(failure.id, 'gradle-distribution');
  assert.match(failure.title, /Gradle Wrapper distribution/);
});

test('exit codes distinguish offline caches, timeout, cancellation and invalid arguments', () => {
  assert.equal(exitCodeForError(new Error('Offline cache missing: Gradle distribution')), 12);
  assert.equal(exitCodeForError(new Error('Build timed out after 60 seconds')), 16);
  assert.equal(exitCodeForError(new Error('was cancelled by Ctrl+C')), 17);
  assert.equal(exitCodeForError(new Error('Usage: paxi test --timeout')), 2);
});

test('cache cleanup requires an explicit confirmation flag', async () => {
  await assert.rejects(() => cacheClean(['--gradle']), /re-run with --confirm/);
});

test('offline native Gradle build adds --offline and records offline mode', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-build-offline-'));
  const project = path.join(temp, 'project');
  const home = path.join(temp, 'home');
  const configHome = path.join(temp, 'config');
  const gradleHome = path.join(home, '.gradle');
  const wrapper = path.join(project, 'gradle', 'wrapper');
  const cachedDist = path.join(gradleHome, 'wrapper', 'dists', 'gradle-8.12-bin', 'hash', 'gradle-8.12', 'bin');
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.mkdir(wrapper, { recursive: true });
  await fs.mkdir(cachedDist, { recursive: true });
  await fs.writeFile(path.join(project, 'settings.gradle'), 'rootProject.name="sample"\n');
  await fs.writeFile(path.join(project, 'app', 'build.gradle'), '');
  await fs.writeFile(path.join(wrapper, 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.12-bin.zip\n');
  await fs.writeFile(path.join(cachedDist, 'gradle'), '#!/bin/sh\n', { mode: 0o700 });
  const artifact = path.join(temp, 'fixture.apk');
  await writeZipFixture(artifact, { name: 'AndroidManifest.xml', content: 'offline fixture' });
  const argsFile = path.join(temp, 'gradle-args.txt');
  const wrapperScript = `#!/bin/sh\nprintf '%s\\n' "$*" > '${argsFile}'\nmkdir -p app/build/outputs/apk/debug\ncp '${artifact}' app/build/outputs/apk/debug/app-debug.apk\n`;
  await fs.writeFile(path.join(project, 'gradlew'), wrapperScript, { mode: 0o700 });
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'paxi.mjs'), 'build', '--project', project, '--format', 'apk', '--debug', '--offline'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: nonTermuxTestEnv({ HOME: home, GRADLE_USER_HOME: gradleHome, XDG_CONFIG_HOME: configHome })
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(await fs.readFile(argsFile, 'utf8'), /--offline/);
  const history = JSON.parse(await fs.readFile(path.join(configHome, 'paxi', 'build-history.json'), 'utf8'));
  assert.equal(history[0].offline, true);
  assert.match(history[0].id, /^\d+-[a-f0-9]{8}$/);
  assert.equal(history[0].toolchain.node, process.version);
  const diagnosed = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'paxi.mjs'), 'builds', '--diagnose', history[0].id, '--json'], {
    cwd: repoRoot, encoding: 'utf8', env: nonTermuxTestEnv({ HOME: home, GRADLE_USER_HOME: gradleHome, XDG_CONFIG_HOME: configHome })
  });
  assert.equal(diagnosed.status, 0, `${diagnosed.stdout}\n${diagnosed.stderr}`);
  assert.equal(JSON.parse(diagnosed.stdout).id, history[0].id);
});

test('support bundle ZIP contains sanitized diagnostics but no project source files', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-support-bundle-'));
  const project = path.join(temp, 'project');
  const config = path.join(temp, 'config');
  await fs.mkdir(path.join(project, '.paxi', 'logs'), { recursive: true });
  await fs.mkdir(path.join(project, 'lib'), { recursive: true });
  await fs.writeFile(path.join(project, 'package.json'), '{"name":"support-test"}');
  await fs.writeFile(path.join(project, 'lib', 'secret-source.js'), 'const apiKey = "not-for-support";');
  await fs.writeFile(path.join(project, '.paxi', 'logs', 'failed.log'), 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789\nAPI_KEY=sk-123456789012345678901234567890');
  process.env.XDG_CONFIG_HOME = config;
  const { createSupportBundle } = await import('../src/commands/diagnostics.mjs');
  const target = path.join(temp, 'support.zip');
  await createSupportBundle({ projectPath: project, outputPath: target });
  const bytes = await fs.readFile(target);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  const list = spawnSync('unzip', ['-l', target], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /environment\.json/);
  assert.doesNotMatch(list.stdout, /secret-source\.js/);
  const log = spawnSync('unzip', ['-p', target, 'logs/failed.log'], { encoding: 'utf8' });
  assert.equal(log.status, 0, log.stderr);
  assert.match(log.stdout, /REDACTED/);
  assert.doesNotMatch(log.stdout, /abcdefghijklmnopqrstuvwxyz0123456789/);
  delete process.env.XDG_CONFIG_HOME;
});

test('offline Flutter build resolves Pub offline and sets Gradle StartParameter offline for Flutter wrapper', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-flutter-offline-'));
  const project = path.join(temp, 'project');
  const home = path.join(temp, 'home');
  const gradleHome = path.join(home, '.gradle');
  const configHome = path.join(home, '.config');
  const fakeBin = path.join(temp, 'bin');
  const android = path.join(project, 'android');
  const wrapper = path.join(android, 'gradle', 'wrapper');
  const cachedDist = path.join(gradleHome, 'wrapper', 'dists', 'gradle-8.12-bin', 'hash', 'gradle-8.12', 'bin');
  await fs.mkdir(wrapper, { recursive: true });
  await fs.mkdir(cachedDist, { recursive: true });
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(project, 'pubspec.yaml'), 'name: offline_flutter_sample\n');
  await fs.writeFile(path.join(android, 'gradlew'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(path.join(wrapper, 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.12-bin.zip\n');
  await fs.writeFile(path.join(cachedDist, 'gradle'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const fixture = path.join(temp, 'fixture.apk');
  await writeZipFixture(fixture, { name: 'AndroidManifest.xml', content: 'offline flutter fixture' });
  const argsFile = path.join(temp, 'flutter-args.txt');
  const flutter = path.join(fakeBin, 'flutter');
  await fs.writeFile(flutter, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${argsFile}'\nif [ "$1" = "build" ]; then\n  test -f "$GRADLE_USER_HOME/init.d/paxi-offline.init.gradle" || exit 31\n  grep -q 'startParameter.offline = true' "$GRADLE_USER_HOME/init.d/paxi-offline.init.gradle" || exit 32\n  mkdir -p build/app/outputs/flutter-apk\n  cp '${fixture}' build/app/outputs/flutter-apk/app-debug.apk\nfi\nexit 0\n`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'paxi.mjs'), 'build', '--project', project, '--format', 'apk', '--debug', '--offline'], {
    cwd: repoRoot, encoding: 'utf8', env: nonTermuxTestEnv({ HOME: home, GRADLE_USER_HOME: gradleHome, XDG_CONFIG_HOME: configHome, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` })
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const invocations = (await fs.readFile(argsFile, 'utf8')).trim().split(/\r?\n/);
  assert.match(invocations[0], /pub get --offline --no-precompile/);
  assert.match(invocations[1], /build apk --debug .*--no-pub/);
  assert.match(result.stdout, /Local Android build completed/);
});
