import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureTermuxAndroid, isTermuxEnvironment } from '../src/lib/termux.mjs';

test('Termux detection uses the Termux userland prefix rather than Android platform alone', () => {
  assert.equal(isTermuxEnvironment({ PREFIX: '/data/data/com.termux/files/usr', HOME: '/data/data/com.termux/files/home' }), true);
  assert.equal(isTermuxEnvironment({ PREFIX: '/usr', HOME: '/home/user' }), false);
  assert.equal(isTermuxEnvironment({ HOME: '/data/user/0/example/files/home' }), false);
  assert.equal(isTermuxEnvironment({ PREFIX: '/data/data/com.termux/files/usr' }), false);
  // A plain Android Node runtime without Termux's PREFIX is not a Termux host.
  assert.equal(isTermuxEnvironment({}), false);
});

test('Flutter Termux configuration calls the installed project helper from the project root', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-flutter-'));
  const prefix = path.join(temp, 'data', 'data', 'com.termux', 'files', 'usr');
  const project = path.join(temp, 'flutter-app');
  const bin = path.join(prefix, 'bin');
  const helper = path.join(prefix, 'share', 'flutter', 'flutter_project_config.sh');
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.mkdir(path.dirname(helper), { recursive: true });
  await fs.writeFile(path.join(project, 'pubspec.yaml'), 'name: sample\n');
  await fs.writeFile(path.join(bin, 'aapt2'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(path.join(bin, 'flutter'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(helper, '#!/bin/bash\nprintf configured > .paxi-termux-configured\n', { mode: 0o700 });
  const oldPrefix = process.env.PREFIX;
  const oldPath = process.env.PATH;
  process.env.PREFIX = prefix;
  process.env.PATH = `${bin}${path.delimiter}${oldPath || ''}`;
  try {
    const result = await configureTermuxAndroid({ projectPath: project });
    assert.equal(result.project.framework, 'flutter');
    assert.equal(await fs.readFile(path.join(project, '.paxi-termux-configured'), 'utf8'), 'configured');
  } finally {
    if (oldPrefix === undefined) delete process.env.PREFIX; else process.env.PREFIX = oldPrefix;
    process.env.PATH = oldPath;
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('Gradle Termux configuration writes ARM64 AAPT2 override and limits workers idempotently', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-gradle-'));
  const prefix = path.join(temp, 'data', 'data', 'com.termux', 'files', 'usr');
  const project = path.join(temp, 'android-app');
  const bin = path.join(prefix, 'bin');
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(project, 'settings.gradle'), 'rootProject.name = "sample"\n');
  await fs.writeFile(path.join(project, 'app', 'build.gradle'), '');
  await fs.mkdir(path.join(project, 'gradle', 'wrapper'), { recursive: true });
  await fs.writeFile(path.join(project, 'gradlew'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(path.join(project, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip\n');
  await fs.writeFile(path.join(bin, 'aapt2'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const oldPrefix = process.env.PREFIX;
  const oldPath = process.env.PATH;
  process.env.PREFIX = prefix;
  process.env.PATH = `${bin}${path.delimiter}${oldPath || ''}`;
  try {
    await configureTermuxAndroid({ projectPath: project });
    await configureTermuxAndroid({ projectPath: project });
    const contents = await fs.readFile(path.join(project, 'gradle.properties'), 'utf8');
    assert.equal(contents.match(/android\.aapt2FromMavenOverride=/g)?.length, 1);
    assert.equal(contents.match(/org\.gradle\.workers\.max=2/g)?.length, 1);
    assert.match(contents, new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/bin/aapt2'));
    const wrapperProperties = await fs.readFile(path.join(project, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8');
    assert.match(wrapperProperties, /^networkTimeout=180000$/m);
  } finally {
    if (oldPrefix === undefined) delete process.env.PREFIX; else process.env.PREFIX = oldPrefix;
    process.env.PATH = oldPath;
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('Flutter Termux configuration applies documented project edits when vendor helper is absent', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-flutter-native-config-'));
  const prefix = path.join(temp, 'data', 'data', 'com.termux', 'files', 'usr');
  const project = path.join(temp, 'flutter-app');
  const bin = path.join(prefix, 'bin');
  const android = path.join(project, 'android');
  await fs.mkdir(path.join(android, 'app'), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(project, 'pubspec.yaml'), 'name: sample\n');
  await fs.writeFile(path.join(bin, 'aapt2'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(path.join(bin, 'flutter'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(path.join(android, 'app', 'build.gradle.kts'), `plugins {\n    id("com.android.application")\n}\nandroid {\n    namespace = "com.example.sample"\n    compileSdk = flutter.compileSdkVersion\n    defaultConfig {\n        applicationId = "com.example.sample"\n        targetSdk = flutter.targetSdkVersion\n    }\n}\n`);
  await fs.writeFile(path.join(android, 'gradlew'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o600 });
  await fs.mkdir(path.join(android, 'gradle', 'wrapper'), { recursive: true });
  await fs.writeFile(path.join(android, 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip\n');
  const oldPrefix = process.env.PREFIX;
  const oldPath = process.env.PATH;
  process.env.PREFIX = prefix;
  process.env.PATH = `${bin}${path.delimiter}${oldPath || ''}`;
  try {
    const result = await configureTermuxAndroid({ projectPath: project });
    const gradle = await fs.readFile(path.join(android, 'app', 'build.gradle.kts'), 'utf8');
    const props = await fs.readFile(path.join(android, 'gradle.properties'), 'utf8');
    const wrapper = await fs.readFile(path.join(android, 'gradlew'), 'utf8');
    assert.equal(result.project.framework, 'flutter');
    assert.match(gradle, /compileSdk = 36/);
    assert.match(gradle, /targetSdk = 36/);
    assert.match(gradle, /abiFilters \+= listOf\("arm64-v8a"\)/);
    assert.match(props, /android\.aapt2FromMavenOverride=/);
    assert.match(props, /org\.gradle\.workers\.max=2/);
    assert.match(wrapper, new RegExp(`^#!${prefix.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}/bin/bash`, 'm'));
    const wrapperInfo = await fs.stat(path.join(android, 'gradlew'));
    assert.ok(wrapperInfo.mode & 0o100);
    // Idempotent: a second configuration must not duplicate the ABI block or properties.
    await configureTermuxAndroid({ projectPath: project });
    const secondGradle = await fs.readFile(path.join(android, 'app', 'build.gradle.kts'), 'utf8');
    assert.equal(secondGradle.match(/abiFilters/g)?.length, 1);
  } finally {
    if (oldPrefix === undefined) delete process.env.PREFIX; else process.env.PREFIX = oldPrefix;
    process.env.PATH = oldPath;
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('Flutter Termux configuration supports Groovy Android app Gradle files', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-flutter-groovy-'));
  const prefix = path.join(temp, 'data', 'data', 'com.termux', 'files', 'usr');
  const project = path.join(temp, 'flutter-app');
  const bin = path.join(prefix, 'bin');
  const android = path.join(project, 'android');
  await fs.mkdir(path.join(android, 'app'), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(project, 'pubspec.yaml'), 'name: sample\n');
  await fs.writeFile(path.join(bin, 'aapt2'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(path.join(bin, 'flutter'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(path.join(android, 'app', 'build.gradle'), `android {\n    compileSdkVersion flutter.compileSdkVersion\n    defaultConfig {\n        targetSdkVersion flutter.targetSdkVersion\n    }\n}\n`);
  const oldPrefix = process.env.PREFIX;
  const oldPath = process.env.PATH;
  process.env.PREFIX = prefix;
  process.env.PATH = `${bin}${path.delimiter}${oldPath || ''}`;
  try {
    await configureTermuxAndroid({ projectPath: project });
    const gradle = await fs.readFile(path.join(android, 'app', 'build.gradle'), 'utf8');
    assert.match(gradle, /compileSdkVersion 36/);
    assert.match(gradle, /targetSdkVersion 36/);
    assert.match(gradle, /abiFilters 'arm64-v8a'/);
  } finally {
    if (oldPrefix === undefined) delete process.env.PREFIX; else process.env.PREFIX = oldPrefix;
    process.env.PATH = oldPath;
    await fs.rm(temp, { recursive: true, force: true });
  }
});
