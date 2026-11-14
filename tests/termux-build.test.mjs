import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from '../src/commands/build.mjs';
import { writeZipFixture } from './helpers/zip-fixture.mjs';

async function withTermuxEnvironment(prefix, bin, callback) {
  const oldPrefix = process.env.PREFIX;
  const oldPath = process.env.PATH;
  const oldConfig = process.env.XDG_CONFIG_HOME;
  process.env.PREFIX = prefix;
  process.env.PATH = `${bin}${path.delimiter}${oldPath || ''}`;
  process.env.XDG_CONFIG_HOME = path.join(path.dirname(prefix), 'config');
  try { await callback(); }
  finally {
    if (oldPrefix === undefined) delete process.env.PREFIX; else process.env.PREFIX = oldPrefix;
    process.env.PATH = oldPath;
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
  }
}

test('Termux Flutter builds receive ARM64 and no-tree-shake flags and verify the APK', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-flutter-build-'));
  const prefix = path.join(temp, 'data', 'data', 'com.termux', 'files', 'usr');
  const bin = path.join(temp, 'bin');
  const project = path.join(temp, 'flutter-project');
  const capture = path.join(temp, 'args.txt');
  const fixture = path.join(temp, 'fixture.apk');
  await writeZipFixture(fixture, { name: 'AndroidManifest.xml', content: 'flutter-app' });
  await fs.mkdir(bin, { recursive: true });
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'pubspec.yaml'), 'name: paxi_test\n');
  await fs.mkdir(path.join(project, 'android'), { recursive: true });
  await fs.writeFile(path.join(project, 'android', 'gradle.properties'), `android.aapt2FromMavenOverride=${path.join(prefix, 'bin', 'aapt2')}\n`);
  const fakeFlutter = `#!/bin/bash\nprintf '%s\\n' "$*" > '${capture}'\nmkdir -p build/app/outputs/flutter-apk\ncp '${fixture}' build/app/outputs/flutter-apk/app-debug.apk\n`;
  await fs.writeFile(path.join(bin, 'flutter'), fakeFlutter, { mode: 0o700 });
  try {
    await withTermuxEnvironment(prefix, bin, async () => {
      const result = await build({ projectPath: project, variant: 'debug', format: 'apk' });
      const args = await fs.readFile(capture, 'utf8');
      assert.match(args, /--target-platform android-arm64/);
      assert.match(args, /--no-tree-shake-icons/);
      assert.equal((await fs.stat(result.artifact)).size > 0, true);
    });
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('Termux Gradle builds require AAPT2 configuration and limit workers', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-gradle-build-'));
  const prefix = path.join(temp, 'data', 'data', 'com.termux', 'files', 'usr');
  const project = path.join(temp, 'android-project');
  const capture = path.join(temp, 'gradle-args.txt');
  const fixture = path.join(temp, 'fixture.apk');
  await writeZipFixture(fixture, { name: 'AndroidManifest.xml', content: 'gradle-app' });
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.writeFile(path.join(project, 'settings.gradle'), 'rootProject.name = "sample"\n');
  await fs.writeFile(path.join(project, 'app', 'build.gradle'), '');
  await fs.writeFile(path.join(project, 'gradle.properties'), `android.aapt2FromMavenOverride=${path.join(prefix, 'bin', 'aapt2')}\n`);
  await fs.writeFile(path.join(project, 'gradlew'), `#!/bin/bash\nprintf '%s\\n' "$*" > '${capture}'\nmkdir -p app/build/outputs/apk/debug\ncp '${fixture}' app/build/outputs/apk/debug/app-debug.apk\n`, { mode: 0o700 });
  try {
    await withTermuxEnvironment(prefix, path.join(temp, 'bin'), async () => {
      const result = await build({ projectPath: project, variant: 'debug', format: 'apk' });
      const args = await fs.readFile(capture, 'utf8');
      assert.match(args, /--no-daemon/);
      assert.match(args, /--max-workers=2/);
      assert.equal((await fs.stat(result.artifact)).size > 0, true);
    });
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test('Termux Gradle build explains when AAPT2 override is missing', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-termux-gradle-guard-'));
  const prefix = path.join(temp, 'data', 'data', 'com.termux', 'files', 'usr');
  const project = path.join(temp, 'android-project');
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.writeFile(path.join(project, 'settings.gradle'), 'rootProject.name = "sample"\n');
  await fs.writeFile(path.join(project, 'app', 'build.gradle'), '');
  await fs.writeFile(path.join(project, 'gradlew'), '#!/bin/bash\nexit 0\n', { mode: 0o700 });
  try {
    await withTermuxEnvironment(prefix, path.join(temp, 'bin'), async () => {
      await assert.rejects(build({ projectPath: project }), /paxi configure android/);
    });
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
