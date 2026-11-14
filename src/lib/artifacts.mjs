import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { commandExists, runProcess, sanitizedEnvironment } from './process.mjs';

const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;

export async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function validateZipContainer(file, size) {
  if (size < 22) throw new Error('Artifact is too small to be a valid ZIP-based Android/iOS package.');
  const handle = await fs.open(file, 'r');
  try {
    const first = Buffer.alloc(4);
    await handle.read(first, 0, 4, 0);
    if (first.readUInt32LE(0) !== LOCAL) throw new Error('Artifact does not begin with a ZIP local-file header. It may be truncated or not a valid APK/AAB/IPA.');

    const tailLength = Math.min(size, 22 + 65535);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    const eocdIndex = tail.lastIndexOf(EOCD);
    if (eocdIndex < 0 || eocdIndex + 22 > tail.length) throw new Error('ZIP end-of-central-directory record is missing; artifact may be truncated.');

    const diskNumber = tail.readUInt16LE(eocdIndex + 4);
    const centralDisk = tail.readUInt16LE(eocdIndex + 6);
    const entriesOnDisk = tail.readUInt16LE(eocdIndex + 8);
    const entryCount = tail.readUInt16LE(eocdIndex + 10);
    const centralSize = tail.readUInt32LE(eocdIndex + 12);
    const centralOffset = tail.readUInt32LE(eocdIndex + 16);
    const commentLength = tail.readUInt16LE(eocdIndex + 20);
    const eocdAbsolute = size - tailLength + eocdIndex;

    if (eocdIndex + 22 + commentLength > tail.length) throw new Error('ZIP comment length exceeds the artifact boundary.');
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error('Multi-disk ZIP artifacts are not supported.');
    if (entryCount === ZIP64_SENTINEL_16 || centralSize === ZIP64_SENTINEL_32 || centralOffset === ZIP64_SENTINEL_32) {
      throw new Error('ZIP64 artifact layout is not supported by this verifier yet.');
    }
    if (entryCount === 0) throw new Error('ZIP artifact contains no files.');
    if (centralOffset + centralSize > eocdAbsolute || centralOffset < 0 || centralSize < 0) throw new Error('ZIP central-directory offsets are outside the artifact bounds.');

    const central = Buffer.alloc(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    let offset = 0;
    let counted = 0;
    const entryNames = [];
    while (offset < central.length && counted < entryCount) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== CENTRAL) {
        throw new Error('ZIP central directory contains an invalid or truncated entry.');
      }
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const entryCommentLength = central.readUInt16LE(offset + 32);
      const localOffset = central.readUInt32LE(offset + 42);
      const nameBytes = central.subarray(offset + 46, offset + 46 + nameLength);
      const entryName = nameBytes.toString((central.readUInt16LE(offset + 8) & 0x0800) ? 'utf8' : 'latin1');
      if (entryName.startsWith('/') || entryName.includes('\\') || entryName.split('/').includes('..') || /^[A-Za-z]:/.test(entryName)) {
        throw new Error(`ZIP entry contains an unsafe path: ${entryName.slice(0, 120)}`);
      }
      entryNames.push(entryName);
      const next = offset + 46 + nameLength + extraLength + entryCommentLength;
      if (next > central.length || localOffset + 30 > size) throw new Error('ZIP entry metadata exceeds the artifact bounds.');
      const localHeader = Buffer.alloc(4);
      await handle.read(localHeader, 0, 4, localOffset);
      if (localHeader.readUInt32LE(0) !== LOCAL) throw new Error('ZIP entry points to an invalid local-file header.');
      offset = next;
      counted += 1;
    }
    if (counted !== entryCount || offset > central.length) throw new Error('ZIP central-directory entry count does not match its metadata.');
    return { entries: entryCount, centralDirectoryBytes: centralSize, entryNames };
  } finally {
    await handle.close();
  }
}

export async function inspectArtifact(inputPath, { quiet = false, strict = false } = {}) {
  const file = path.resolve(inputPath);
  const info = await fs.lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0) {
    throw new Error(`Artifact must be a non-empty regular file (symbolic links are not accepted): ${file}`);
  }
  const extension = path.extname(file).toLowerCase();
  if (!['.apk', '.aab', '.ipa', '.zip'].includes(extension)) throw new Error('Supported artifact types are APK, AAB, IPA and Windows app ZIP bundles.');

  const zip = await validateZipContainer(file, info.size);
  let contentIntegrity = 'structure only';
  const warnings = [];
  if (await commandExists('unzip')) {
    const archiveTest = await runProcess('unzip', ['-tqq', file], { capture: true, env: sanitizedEnvironment(), maxOutputBytes: 32768 });
    if (archiveTest.code !== 0) throw new Error(`ZIP entry/CRC validation failed: ${(archiveTest.stderr || archiveTest.stdout || 'unzip rejected the archive').slice(0, 500)}`);
    contentIntegrity = 'ZIP entries and CRC verified';
  } else {
    warnings.push('unzip is not installed; compressed-entry CRC checks were skipped.');
  }
  const digest = await sha256File(file);
  const report = {
    file,
    type: extension.slice(1).toUpperCase(),
    sizeBytes: info.size,
    sha256: digest,
    zipEntries: zip.entries,
    contentIntegrity,
    signature: 'not checked',
    packageName: null,
    bundleIdentifier: null,
    minimumOsVersion: null,
    provisioningProfilePresent: false,
    warnings,
    verificationLevel: 'structurally valid',
    installable: false,
    signed: false,
    fullyPlatformVerified: false
  };

  if (extension === '.apk') {
    const hasApkSigner = await commandExists('apksigner');
    const hasAapt2 = await commandExists('aapt2');
    if (hasApkSigner) {
      const signed = await runProcess('apksigner', ['verify', '--verbose', file], { capture: true, env: sanitizedEnvironment(), maxOutputBytes: 32768, timeoutMs: 30000 });
      if (signed.code === 0) {
        report.signature = 'verified';
        report.signed = true;
      } else {
        report.signature = 'verification failed';
        report.warnings.push('apksigner could not verify the APK signature. Check release/debug signing configuration.');
      }
    } else {
      report.warnings.push('apksigner is not installed; APK signature status was not checked.');
    }
    if (hasAapt2) {
      const badging = await runProcess('aapt2', ['dump', 'badging', file], { capture: true, env: sanitizedEnvironment(), maxOutputBytes: 65536, timeoutMs: 30000 });
      const match = `${badging.stdout}\n${badging.stderr}`.match(/^package:\s+name='([^']+)'/m);
      if (badging.code === 0 && match) report.packageName = match[1];
      else report.warnings.push('AAPT2 could not read the APK package metadata; archive structure was still checked.');
    } else {
      report.warnings.push('aapt2 is not installed; Android package metadata was not checked.');
    }
    report.installable = report.signed && Boolean(report.packageName);
    report.verificationLevel = report.installable ? 'installable and signed' : 'structurally valid; installability not confirmed';
    report.fullyPlatformVerified = report.installable;
    if (strict && (!hasApkSigner || !hasAapt2 || !report.installable)) {
      throw new Error(`Strict APK verification failed. Required: apksigner and aapt2; current status: signature=${report.signature}, package=${report.packageName || 'unknown'}.`);
    }
  } else if (extension === '.aab') {
    const hasBundletool = await commandExists('bundletool');
    if (hasBundletool) {
      const validation = await runProcess('bundletool', ['validate', `--bundle=${file}`], { capture: true, env: sanitizedEnvironment(), maxOutputBytes: 32768, timeoutMs: 120000 });
      if (validation.code !== 0) throw new Error(`bundletool rejected this AAB: ${(validation.stderr || validation.stdout).slice(0, 600)}`);
      report.fullyPlatformVerified = false;
      report.verificationLevel = 'bundletool validation passed (signature not confirmed)';
    } else {
      report.warnings.push('bundletool is not installed; AAB module validation was not performed.');
    }
    if (strict && !hasBundletool) throw new Error('Strict AAB verification requires bundletool. Install bundletool and retry.');
  } else if (extension === '.ipa') {
    const hasPayloadApp = zip.entryNames.some((name) => /^Payload\/[^/]+\.app\/$/.test(name) || /^Payload\/[^/]+\.app\/Info\.plist$/.test(name));
    const hasInfoPlist = zip.entryNames.some((name) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(name));
    const hasProvisioning = zip.entryNames.some((name) => /^Payload\/[^/]+\.app\/embedded\.mobileprovision$/.test(name));
    if (!hasPayloadApp || !hasInfoPlist) throw new Error('IPA layout is invalid: expected Payload/<AppName>.app/Info.plist.');
    report.packageName = null;
    report.provisioningProfilePresent = hasProvisioning;
    report.signed = false;
    if (!hasProvisioning) report.warnings.push('IPA has no embedded.mobileprovision profile; device installation/distribution signing is not confirmed.');
    if (process.platform !== 'darwin') {
      report.warnings.push('IPA bundle layout was checked; Apple code-signature validation requires macOS with codesign.');
    } else if (await commandExists('codesign') && await commandExists('unzip')) {
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-ipa-verify-'));
      try {
        const extraction = await runProcess('unzip', ['-q', file, '-d', temporaryRoot], { capture: true, env: sanitizedEnvironment(), timeoutMs: 120000, maxOutputBytes: 32768 });
        if (extraction.code !== 0) throw new Error('Could not extract IPA to a temporary directory for signature verification.');
        const payloadPath = path.join(temporaryRoot, 'Payload');
        const appName = (await fs.readdir(payloadPath)).find((name) => name.endsWith('.app'));
        if (!appName) throw new Error('IPA Payload directory does not contain an .app bundle.');
        const appPath = path.join(payloadPath, appName);
        const infoPlist = path.join(appPath, 'Info.plist');
        if (!(await fs.stat(infoPlist).then(() => true, () => false))) throw new Error('IPA app bundle is missing Info.plist.');
        if (await commandExists('plutil')) {
          const bundle = await runProcess('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlist], { capture: true, env: sanitizedEnvironment(), timeoutMs: 15000, maxOutputBytes: 8192 });
          const minimum = await runProcess('plutil', ['-extract', 'MinimumOSVersion', 'raw', '-o', '-', infoPlist], { capture: true, env: sanitizedEnvironment(), timeoutMs: 15000, maxOutputBytes: 8192 });
          if (bundle.code === 0) report.bundleIdentifier = bundle.stdout.trim() || null;
          if (minimum.code === 0) report.minimumOsVersion = minimum.stdout.trim() || null;
        } else {
          report.warnings.push('plutil is unavailable; IPA bundle identifier and minimum iOS version were not extracted.');
        }
        const codesign = await runProcess('codesign', ['--verify', '--deep', '--strict', appPath], { capture: true, env: sanitizedEnvironment(), timeoutMs: 60000, maxOutputBytes: 32768 });
        if (codesign.code !== 0) throw new Error(`codesign rejected the IPA app bundle: ${(codesign.stderr || codesign.stdout).slice(0, 500)}`);
        if (hasProvisioning && await commandExists('security')) {
          const profilePath = path.join(appPath, 'embedded.mobileprovision');
          const profile = await runProcess('security', ['cms', '-D', '-i', profilePath], { capture: true, env: sanitizedEnvironment(), timeoutMs: 30000, maxOutputBytes: 65536 });
          if (profile.code !== 0) throw new Error('The IPA embedded provisioning profile could not be decoded by the macOS security tool.');
        }
        report.signed = true;
        report.fullyPlatformVerified = Boolean(report.bundleIdentifier && report.minimumOsVersion && hasProvisioning);
        report.verificationLevel = report.fullyPlatformVerified ? 'Apple app signature and bundle metadata verified' : 'Apple app signature verified; bundle metadata incomplete';
      } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
      }
    } else {
      report.warnings.push('codesign and unzip are required for strict IPA signature verification on macOS.');
    }
    if (strict && (!report.fullyPlatformVerified || !hasProvisioning || !report.signed || !report.bundleIdentifier || !report.minimumOsVersion)) {
      throw new Error('Strict IPA verification requires macOS, codesign, a valid Payload app bundle and an embedded provisioning profile.');
    }
  } else {
    const executables = zip.entryNames.filter((name) => /(^|\/)[^/]+\.exe$/i.test(name));
    const hasFlutterRuntime = zip.entryNames.some((name) => /(^|\/)flutter_windows\.dll$/i.test(name));
    const hasDataAssets = zip.entryNames.some((name) => /(^|\/)data\//i.test(name));
    if (!executables.length || !hasFlutterRuntime || !hasDataAssets) {
      throw new Error('Windows ZIP layout is invalid: expected a Flutter Windows bundle containing an .exe, flutter_windows.dll and data/ assets.');
    }
    report.type = 'WINDOWS ZIP';
    report.packageName = path.basename(executables[0]).replace(/\.exe$/i, '');
    report.installable = false;
    report.fullyPlatformVerified = false;
    report.verificationLevel = 'Windows app bundle structure valid';
    report.warnings.push('Windows executable code-signature status was not checked. Sign and verify the executable with Windows SignTool before public distribution.');
    if (strict) throw new Error('Strict Windows ZIP verification is not available yet. The archive structure and CRCs were checked, but Windows Authenticode signing must be verified separately with SignTool.');
  }

  if (!quiet) {
    console.log(`\nPAXI artifact verification: ${report.type}`);
    console.log(`File:       ${report.file}`);
    console.log(`Size:       ${(report.sizeBytes / 1024 / 1024).toFixed(2)} MiB`);
    console.log(`ZIP files:  ${report.zipEntries}`);
    console.log(`Contents:   ${report.contentIntegrity}`);
    console.log(`SHA-256:    ${report.sha256}`);
    console.log(`Signature:  ${report.signature}`);
    console.log(`Status:     ${report.verificationLevel}`);
    if (report.packageName) console.log(`Package:    ${report.packageName}`);
    if (report.bundleIdentifier) console.log(`Bundle ID:  ${report.bundleIdentifier}`);
    if (report.minimumOsVersion) console.log(`Minimum iOS: ${report.minimumOsVersion}`);
    if (report.provisioningProfilePresent) console.log('Provisioning: profile present');
    for (const warning of report.warnings) console.log(`Warning:    ${warning}`);
    console.log('✓ Archive structure and checksum verified.');
  }
  return report;
}

export async function verifyCommand(args = []) {
  const strict = args.includes('--strict');
  const paths = args.filter((arg) => arg !== '--strict');
  if (paths.length !== 1 || paths[0].startsWith('--')) throw new Error('Usage: paxi verify <path/to/app.apk|app.aab|app.ipa|windows-app.zip> [--strict]');
  return inspectArtifact(paths[0], { strict });
}
