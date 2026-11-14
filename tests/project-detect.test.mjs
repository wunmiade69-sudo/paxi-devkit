import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectProject } from '../src/lib/project-detect.mjs';

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-devkit-'));
  for (const file of files) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '');
  }
  return root;
}

test('detects Flutter projects from pubspec.yaml', async () => {
  const root = await fixture(['pubspec.yaml', 'lib/main.dart']);
  const project = detectProject(root);
  assert.equal(project.framework, 'flutter');
  assert.equal(project.platforms.windows, true);
  assert.equal(project.platforms.ios, true);
});

test('detects Android Gradle projects', async () => {
  const root = await fixture(['settings.gradle', 'app/build.gradle']);
  assert.equal(detectProject(root).framework, 'gradle');
});

test('does not mistake a generic Node project for an Android project', async () => {
  const root = await fixture(['package.json']);
  assert.equal(detectProject(root).framework, 'javascript');
});

test('detects a native Xcode project nested under ios/', async () => {
  const root = await fixture(['ios/Runner.xcodeproj/project.pbxproj']);
  const project = detectProject(root);
  assert.equal(project.framework, 'xcode');
  assert.equal(project.platforms.ios, true);
});
