import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectArtifact, verifyCommand } from '../src/lib/artifacts.mjs';
import { writeZipFixture } from './helpers/zip-fixture.mjs';

test('artifact inspection validates ZIP layout and returns a SHA-256 checksum', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-artifact-valid-'));
  const apk = path.join(root, 'sample.apk');
  await writeZipFixture(apk, { name: 'AndroidManifest.xml', content: 'binary-manifest' });
  const report = await inspectArtifact(apk, { quiet: true });
  assert.equal(report.type, 'APK');
  assert.equal(report.zipEntries, 1);
  assert.match(report.sha256, /^[a-f0-9]{64}$/);
  assert.ok(report.sizeBytes > 0);
});

test('artifact inspection rejects truncated, non-ZIP files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-artifact-invalid-'));
  const apk = path.join(root, 'broken.apk');
  await fs.writeFile(apk, 'this is not an apk');
  await assert.rejects(inspectArtifact(apk, { quiet: true }), /ZIP local-file header|too small/i);
});

test('artifact inspection rejects symbolic links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-artifact-symlink-'));
  const real = path.join(root, 'real.apk');
  const link = path.join(root, 'linked.apk');
  await writeZipFixture(real);
  await fs.symlink(real, link);
  await assert.rejects(inspectArtifact(link, { quiet: true }), /symbolic links are not accepted/i);
});

test('verify command requires exactly one artifact path', async () => {
  await assert.rejects(verifyCommand([]), /Usage: paxi verify/);
});

test('artifact inspection supports Android App Bundles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-artifact-aab-'));
  const aab = path.join(root, 'sample.aab');
  await writeZipFixture(aab, { name: 'BundleConfig.pb', content: 'bundle-config' });
  const report = await inspectArtifact(aab, { quiet: true });
  assert.equal(report.type, 'AAB');
  assert.equal(report.zipEntries, 1);
});

test('artifact inspection rejects corrupted ZIP entry contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-artifact-crc-'));
  const apk = path.join(root, 'corrupt.apk');
  await writeZipFixture(apk, { name: 'AndroidManifest.xml', content: 'original-content' });
  const bytes = await fs.readFile(apk);
  const marker = bytes.indexOf(Buffer.from('original-content'));
  assert.notEqual(marker, -1);
  bytes[marker] ^= 0x01;
  await fs.writeFile(apk, bytes);
  await assert.rejects(inspectArtifact(apk, { quiet: true }), /CRC validation failed/i);
});

test('strict APK verification refuses to claim full verification without platform tools', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-artifact-strict-'));
  const apk = path.join(root, 'sample.apk');
  await writeZipFixture(apk, { name: 'AndroidManifest.xml', content: 'manifest' });
  await assert.rejects(inspectArtifact(apk, { quiet: true, strict: true }), /Strict APK verification failed/i);
});

test('IPA verification requires a Payload app bundle and Info.plist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-artifact-ipa-layout-'));
  const ipa = path.join(root, 'sample.ipa');
  await writeZipFixture(ipa, { name: 'random/file.txt', content: 'not an app' });
  await assert.rejects(inspectArtifact(ipa, { quiet: true }), /IPA layout is invalid/i);
});
