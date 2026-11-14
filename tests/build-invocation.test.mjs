import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeZipFixture } from './helpers/zip-fixture.mjs';
import { nonTermuxTestEnv } from './helpers/host-env.mjs';

 test('build command invokes the project-local Gradle wrapper and keeps artifacts local', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-build-test-'));
  const project = path.join(temp, 'sample-android');
  const configHome = path.join(temp, 'config');
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.writeFile(path.join(project, 'settings.gradle'), 'rootProject.name = "sample"\n');
  await fs.writeFile(path.join(project, 'app', 'build.gradle'), '');
  const fixture = path.join(temp, 'fixture.apk');
  await writeZipFixture(fixture, { name: 'AndroidManifest.xml', content: 'manifest-binary-placeholder' });
  const wrapper = `#!/data/data/com.termux/files/usr/bin/bash\nset -eu\nmkdir -p app/build/outputs/apk/debug\ncp '${fixture}' app/build/outputs/apk/debug/app-debug.apk\necho "fake Gradle completed: $*"\n`;
  await fs.writeFile(path.join(project, 'gradlew'), wrapper, { mode: 0o700 });

  const result = spawnSync(process.execPath, [path.resolve('bin/paxi.mjs'), 'build', '--project', project, '--debug'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: nonTermuxTestEnv({ XDG_CONFIG_HOME: configHome })
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const artifact = path.join(project, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  assert.equal((await fs.stat(artifact)).size > 0, true);
  const history = JSON.parse(await fs.readFile(path.join(configHome, 'paxi', 'build-history.json'), 'utf8'));
  assert.equal(history[0].status, 'succeeded');
  assert.equal(history[0].format, 'apk');
  assert.equal(history[0].outcome, 'succeeded');
  assert.deepEqual(history[0].lifecycle.history.map((entry) => entry.state), ['created', 'preflight', 'building', 'verifying', 'succeeded']);
});

test('finds flavored Gradle APK output and records its actual artifact path', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-build-flavor-'));
  const project = path.join(temp, 'sample-flavor');
  const configHome = path.join(temp, 'config');
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.writeFile(path.join(project, 'settings.gradle'), 'rootProject.name = "sample"\n');
  await fs.writeFile(path.join(project, 'app', 'build.gradle'), '');
  const fixture = path.join(temp, 'fixture.apk');
  await writeZipFixture(fixture, { name: 'AndroidManifest.xml', content: 'flavored-app' });
  const wrapper = `#!/bin/sh\nmkdir -p app/build/outputs/apk/free/debug\ncp '${fixture}' app/build/outputs/apk/free/debug/app-free-debug.apk\n`;
  await fs.writeFile(path.join(project, 'gradlew'), wrapper, { mode: 0o700 });
  const result = spawnSync(process.execPath, [path.resolve('bin/paxi.mjs'), 'build', '--project', project, '--debug'], {
    cwd: process.cwd(), encoding: 'utf8', env: nonTermuxTestEnv({ XDG_CONFIG_HOME: configHome })
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const history = JSON.parse(await fs.readFile(path.join(configHome, 'paxi', 'build-history.json'), 'utf8'));
  assert.match(history[0].artifact, /app-free-debug\.apk$/);
});

test('does not report a build as successful when the artifact is missing', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-build-missing-'));
  const project = path.join(temp, 'sample-no-artifact');
  const configHome = path.join(temp, 'config');
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.writeFile(path.join(project, 'settings.gradle'), 'rootProject.name = "sample"\n');
  await fs.writeFile(path.join(project, 'app', 'build.gradle'), '');
  await fs.writeFile(path.join(project, 'gradlew'), '#!/bin/sh\necho fake-success\n', { mode: 0o700 });
  const result = spawnSync(process.execPath, [path.resolve('bin/paxi.mjs'), 'build', '--project', project, '--debug'], {
    cwd: process.cwd(), encoding: 'utf8', env: nonTermuxTestEnv({ XDG_CONFIG_HOME: configHome })
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not locate a non-empty APK artifact/i);
  const history = JSON.parse(await fs.readFile(path.join(configHome, 'paxi', 'build-history.json'), 'utf8'));
  assert.equal(history[0].status, 'failed');
  assert.equal(history[0].outcome, 'failed');
  assert.equal(history[0].lifecycle.state, 'failed');
});

test('build --install installs the verified APK to the selected local adb device', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-build-install-'));
  const project = path.join(temp, 'sample-android');
  const configHome = path.join(temp, 'config');
  const bin = path.join(temp, 'bin');
  const fixture = path.join(temp, 'fixture.apk');
  const adbMarker = path.join(temp, 'adb-args.txt');
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(project, 'settings.gradle'), 'rootProject.name = "sample"\n');
  await fs.writeFile(path.join(project, 'app', 'build.gradle'), '');
  await writeZipFixture(fixture, { name: 'AndroidManifest.xml', content: 'build-install-app' });
  await fs.writeFile(path.join(project, 'gradlew'), `#!/bin/sh\nmkdir -p app/build/outputs/apk/debug\ncp '${fixture}' app/build/outputs/apk/debug/app-debug.apk\n`, { mode: 0o700 });
  await fs.writeFile(path.join(bin, 'adb'), `#!/bin/sh\nif [ "$1" = "devices" ]; then printf "List of devices attached\\nphone-123 device product:redmi\\n"; else printf "%s\\n" "$*" > '${adbMarker}'; fi\n`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [path.resolve('bin/paxi.mjs'), 'build', '--project', project, '--format', 'apk', '--debug', '--install'], {
    cwd: process.cwd(), encoding: 'utf8', env: nonTermuxTestEnv({ PATH: `${bin}${path.delimiter}${process.env.PATH}`, XDG_CONFIG_HOME: configHome })
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(await fs.readFile(adbMarker, 'utf8'), /^-s phone-123 install -r /);
});

test('does not accept a stale APK when a successful build creates no fresh artifact', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-build-stale-'));
  const project = path.join(temp, 'sample-android');
  const configHome = path.join(temp, 'config');
  const artifact = path.join(project, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  await fs.mkdir(path.dirname(artifact), { recursive: true });
  await fs.writeFile(path.join(project, 'settings.gradle'), 'rootProject.name = "sample"\n');
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.writeFile(path.join(project, 'app', 'build.gradle'), '');
  await writeZipFixture(artifact, { name: 'AndroidManifest.xml', content: 'old-build' });
  await fs.writeFile(path.join(project, 'gradlew'), '#!/bin/sh\necho "Gradle exits successfully but produces no output"\n', { mode: 0o700 });
  const result = spawnSync(process.execPath, [path.resolve('bin/paxi.mjs'), 'build', '--project', project, '--debug'], {
    cwd: process.cwd(), encoding: 'utf8', env: nonTermuxTestEnv({ XDG_CONFIG_HOME: configHome })
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no fresh APK artifact|Existing outputs were ignored/i);
  const history = JSON.parse(await fs.readFile(path.join(configHome, 'paxi', 'build-history.json'), 'utf8'));
  assert.equal(history[0].status, 'failed');
});
