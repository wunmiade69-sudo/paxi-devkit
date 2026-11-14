import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { taskCommand, installApk, listAndroidDevices } from '../src/commands/tasks.mjs';
import { writeZipFixture } from './helpers/zip-fixture.mjs';

test('Gradle Android test command runs the debug unit-test task through the local wrapper', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-tests-gradle-'));
  const marker = path.join(root, 'task.txt');
  await fs.mkdir(path.join(root, 'app'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), 'rootProject.name = "sample"');
  await fs.writeFile(path.join(root, 'app', 'build.gradle'), '');
  await fs.writeFile(path.join(root, 'gradlew'), '#!/bin/sh\nprintf "%s" "$*" > "$PAXI_TEST_TASK_MARKER"\n', { mode: 0o700 });
  const previousPrefix = process.env.PREFIX;
  const previousMarker = process.env.PAXI_TEST_TASK_MARKER;
  // This case verifies the generic Gradle invocation. A separate test below
  // explicitly sets a Termux PREFIX and verifies memory-safe worker flags.
  process.env.PREFIX = '';
  process.env.PAXI_TEST_TASK_MARKER = marker;
  try {
    await taskCommand('test', ['--project', root]);
    assert.equal(await fs.readFile(marker, 'utf8'), 'testDebugUnitTest');
  } finally {
    if (previousPrefix === undefined) delete process.env.PREFIX;
    else process.env.PREFIX = previousPrefix;
    if (previousMarker === undefined) delete process.env.PAXI_TEST_TASK_MARKER;
    else process.env.PAXI_TEST_TASK_MARKER = previousMarker;
  }
});

test('APK installation requires an authorized adb device and installs a local APK', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-adb-test-'));
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  const apk = path.join(root, 'local build.apk');
  const marker = path.join(root, 'adb-args.txt');
  await writeZipFixture(apk, { name: 'AndroidManifest.xml', content: 'test-app' });
  const adb = path.join(bin, 'adb');
  await fs.writeFile(adb, '#!/bin/sh\nif [ "$1" = "devices" ]; then printf "List of devices attached\\nemulator-5554 device product:test\\n"; else printf "%s\\n" "$*" > "$PAXI_ADB_MARKER"; fi\n', { mode: 0o700 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  process.env.PAXI_ADB_MARKER = marker;
  try {
    await installApk(apk);
    assert.equal(await fs.readFile(marker, 'utf8'), `-s emulator-5554 install -r ${apk}\n`);
  } finally {
    process.env.PATH = previousPath;
    delete process.env.PAXI_ADB_MARKER;
  }
});

test('device listing parses authorized and unauthorized adb states', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-adb-devices-'));
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  const adb = path.join(bin, 'adb');
  await fs.writeFile(adb, '#!/bin/sh\nprintf "List of devices attached\\nemulator-5554 device product:test\\n192.168.1.5:5555 unauthorized transport_id:3\\n"\n', { mode: 0o700 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const devices = await listAndroidDevices();
    assert.deepEqual(devices.map((item) => [item.serial, item.state]), [
      ['emulator-5554', 'device'],
      ['192.168.1.5:5555', 'unauthorized']
    ]);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('install refuses a latest-build APK whose SHA-256 changed after the build', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-adb-tamper-'));
  const bin = path.join(root, 'bin');
  const config = path.join(root, 'config');
  const apk = path.join(root, 'sample.apk');
  await fs.mkdir(bin);
  await fs.mkdir(path.join(config, 'paxi'), { recursive: true });
  await writeZipFixture(apk, { name: 'AndroidManifest.xml', content: 'tamper-check' });
  await fs.writeFile(path.join(config, 'paxi', 'build-history.json'), JSON.stringify([{
    status: 'succeeded', platform: 'android', format: 'apk', artifact: apk, artifactSha256: '0'.repeat(64)
  }]));
  await fs.writeFile(path.join(bin, 'adb'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const result = spawnSync(process.execPath, [path.resolve('bin/paxi.mjs'), 'install'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, XDG_CONFIG_HOME: config }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256 no longer matches build history/i);
});

test('Gradle tests use Termux memory limits and the local Gradle wrapper', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-tests-termux-gradle-'));
  const marker = path.join(root, 'task.txt');
  const fakePrefix = path.join(root, 'data', 'data', 'com.termux', 'files', 'usr');
  await fs.mkdir(path.join(root, 'app'), { recursive: true });
  await fs.mkdir(path.join(fakePrefix, 'lib', 'jvm'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.gradle'), 'rootProject.name = "sample"');
  await fs.writeFile(path.join(root, 'app', 'build.gradle'), '');
  await fs.writeFile(path.join(root, 'gradlew'), '#!/bin/sh\nprintf "%s" "$*" > "$PAXI_TEST_TASK_MARKER"\n', { mode: 0o700 });
  const previous = { PREFIX: process.env.PREFIX, HOME: process.env.HOME, marker: process.env.PAXI_TEST_TASK_MARKER };
  process.env.PREFIX = fakePrefix;
  process.env.HOME = root;
  process.env.PAXI_TEST_TASK_MARKER = marker;
  try {
    await taskCommand('test', ['--project', root]);
    assert.equal(await fs.readFile(marker, 'utf8'), 'testDebugUnitTest --no-daemon --max-workers=2');
  } finally {
    for (const [key, value] of Object.entries({ PREFIX: previous.PREFIX, HOME: previous.HOME, PAXI_TEST_TASK_MARKER: previous.marker })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
