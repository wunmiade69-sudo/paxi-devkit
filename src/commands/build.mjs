import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { detectProject } from '../lib/project-detect.mjs';
import { runProcess, commandExists, sanitizedEnvironment } from '../lib/process.mjs';
import { HISTORY_FILE } from '../lib/paths.mjs';
import { readJson, writeJsonSecure, updateJsonSecure } from '../lib/safe-store.mjs';
import { isTermuxEnvironment, hasAapt2Override, getTermuxPaths, getTermuxBuildEnvironment } from '../lib/termux.mjs';
import { inspectArtifact, sha256File } from '../lib/artifacts.mjs';
import { VERSION } from '../lib/version.mjs';
import { inspectGradleWrapperCache, createOfflineGradleEnvironment } from '../lib/offline.mjs';
import { renderFailureAdvice } from '../lib/failure.mjs';
import { createGradleInvocation } from '../lib/gradle-invocation.mjs';
import { createZipFromDirectory } from '../lib/zip.mjs';
import { inspectWindowsToolchain } from '../lib/windows.mjs';
import { createStateMachine, BUILD_STATE_TRANSITIONS, buildFailureState } from '../lib/state-machine.mjs';

async function saveHistory(entry) {
  await updateJsonSecure(HISTORY_FILE, [], (current) => {
    const history = Array.isArray(current) ? current : [];
    return [entry, ...history].slice(0, 50);
  });
}

async function isUsableArtifact(file) {
  try {
    const info = await fs.lstat(file);
    return info.isFile() && !info.isSymbolicLink() && info.size > 0;
  } catch {
    return false;
  }
}

async function walkArtifacts(directory, extension, output, depth = 0) {
  if (depth > 9) return;
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', '.gradle'].includes(entry.name)) {
        await walkArtifacts(candidate, extension, output, depth + 1);
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(`.${extension}`)) {
      if (await isUsableArtifact(candidate)) {
        const stat = await fs.stat(candidate);
        output.push({ file: candidate, modifiedAt: stat.mtimeMs });
      }
    }
  }
}

async function discoverBuildOutputRoots(root) {
  const outputRoots = new Set([
    path.join(root, 'app', 'build', 'outputs'),
    path.join(root, 'build', 'app', 'outputs'),
    path.join(root, 'build', 'outputs')
  ]);
  const ignored = new Set(['.git', '.gradle', 'node_modules', '.dart_tool', '.idea', '.expo', 'Pods']);
  const queue = [{ directory: root, depth: 0 }];
  while (queue.length) {
    const { directory, depth } = queue.shift();
    if (depth > 7) continue;
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      const child = path.join(directory, entry.name);
      if (entry.name === 'build') {
        outputRoots.add(path.join(child, 'outputs'));
        outputRoots.add(path.join(child, 'app', 'outputs'));
        continue;
      }
      queue.push({ directory: child, depth: depth + 1 });
    }
  }
  return [...outputRoots];
}

async function collectAndroidArtifacts(root, format) {
  const extension = format === 'aab' ? 'aab' : 'apk';
  const found = new Map();
  const outputRoots = await discoverBuildOutputRoots(root);
  for (const outputRoot of outputRoots) {
    const items = [];
    await walkArtifacts(outputRoot, extension, items);
    for (const item of items) found.set(item.file, item);
  }
  return [...found.values()];
}

function expectedAndroidPaths(root, framework, variant, format) {
  const extension = format === 'aab' ? 'aab' : 'apk';
  if (framework === 'flutter') {
    return format === 'aab'
      ? [path.join(root, 'build', 'app', 'outputs', 'bundle', variant, `app-${variant}.aab`)]
      : [path.join(root, 'build', 'app', 'outputs', 'flutter-apk', `app-${variant}.apk`), path.join(root, 'build', 'app', 'outputs', 'apk', variant, `app-${variant}.apk`)];
  }
  return [
    path.join(root, 'app', 'build', 'outputs', format === 'aab' ? 'bundle' : 'apk', variant, `app-${variant}.${extension}`),
    path.join(root, 'build', 'outputs', format === 'aab' ? 'bundle' : 'apk', variant, `app-${variant}.${extension}`)
  ];
}

async function snapshotAndroidArtifacts(root, format) {
  const snapshot = new Map();
  const candidates = await collectAndroidArtifacts(root, format);
  for (const item of candidates) {
    const stat = await fs.stat(item.file);
    snapshot.set(item.file, { size: stat.size, mtimeMs: stat.mtimeMs, sha256: await sha256File(item.file) });
  }
  return snapshot;
}

async function findAndroidArtifact(root, framework, variant, format, baseline = new Map(), buildStartedMs = Date.now()) {
  const extension = format === 'aab' ? 'aab' : 'apk';
  const candidates = await collectAndroidArtifacts(root, format);
  const fresh = [];
  for (const item of candidates) {
    const stat = await fs.stat(item.file);
    const old = baseline.get(item.file);
    const hash = old ? await sha256File(item.file) : null;
    const changed = !old || stat.size !== old.size || stat.mtimeMs > old.mtimeMs || hash !== old.sha256;
    const recent = stat.mtimeMs >= buildStartedMs - 2000;
    if (changed && recent) fresh.push({ ...item, size: stat.size });
  }

  const exact = expectedAndroidPaths(root, framework, variant, format).filter((candidate) => fresh.some((item) => item.file === candidate));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`Build produced multiple exact ${extension.toUpperCase()} outputs for ${variant}: ${exact.join(', ')}. Select or remove the unintended output and retry.`);

  const variantMatches = fresh.filter((item) => item.file.toLowerCase().includes(variant.toLowerCase()));
  const candidatesToUse = variantMatches.length ? variantMatches : fresh;
  if (candidatesToUse.length === 1) return candidatesToUse[0].file;
  if (candidatesToUse.length > 1) {
    throw new Error(`Build produced multiple fresh ${extension.toUpperCase()} artifacts; PAXI will not guess which one to record: ${candidatesToUse.map((item) => item.file).join(', ')}. Supply a project flavor/task that produces one unambiguous output.`);
  }
  const existing = candidates.length > 0;
  if (existing) throw new Error(`Build completed but produced no fresh ${extension.toUpperCase()} artifact. Existing outputs were ignored to prevent a stale artifact from being reported as this build.`);
  return null;
}

function iosHostError() {
  return new Error([
    'An iOS IPA cannot be built locally on this host.',
    `Detected host: ${os.platform()} (${os.arch()}).`,
    'A standard iOS build requires macOS with Xcode, iOS platform SDKs, and valid Apple signing/provisioning configuration.',
    'No remote builder was contacted and no project files were uploaded.',
    'Run this command on a configured Mac. PAXI does not silently switch to a cloud builder.'
  ].join('\n'));
}

async function resolveExportOptions(projectRoot, exportOptions) {
  if (!exportOptions) return null;
  const resolved = path.resolve(projectRoot, exportOptions);
  const info = await fs.lstat(resolved).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Export options must point to a regular plist file: ${resolved}`);
  return resolved;
}

function validateScheme(scheme) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/.test(scheme || '')) {
    throw new Error('Xcode scheme must be 1–100 characters and contain only letters, numbers, spaces, dots, underscores or hyphens.');
  }
}

async function locateXcodeContainer(projectRoot) {
  for (const root of [projectRoot, path.join(projectRoot, 'ios')]) {
    let entries = [];
    try { entries = await fs.readdir(root); } catch {}
    const workspace = entries.filter((name) => name.endsWith('.xcworkspace')).sort()[0];
    const project = entries.filter((name) => name.endsWith('.xcodeproj')).sort()[0];
    const name = workspace || project;
    if (name) return { path: path.join(root, name), type: workspace ? '-workspace' : '-project' };
  }
  return null;
}

async function snapshotFiles(directory, extension) {
  const baseline = new Map();
  const names = await fs.readdir(directory).catch(() => []);
  for (const name of names.filter((item) => item.toLowerCase().endsWith(extension))) {
    const file = path.join(directory, name);
    if (!(await isUsableArtifact(file))) continue;
    const stat = await fs.stat(file);
    baseline.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, sha256: await sha256File(file) });
  }
  return baseline;
}

async function freshFiles(directory, extension, baseline) {
  const names = await fs.readdir(directory).catch(() => []);
  const fresh = [];
  for (const name of names.filter((item) => item.toLowerCase().endsWith(extension))) {
    const file = path.join(directory, name);
    if (!(await isUsableArtifact(file))) continue;
    const stat = await fs.stat(file);
    const old = baseline.get(file);
    const hash = old ? await sha256File(file) : null;
    if (!old || stat.size !== old.size || stat.mtimeMs > old.mtimeMs || hash !== old.sha256) fresh.push(file);
  }
  if (fresh.length > 1) throw new Error(`Build produced multiple fresh ${extension} artifacts; refusing to guess: ${fresh.join(', ')}`);
  return fresh;
}

async function buildIos({ project, format, exportOptions, scheme, timeoutMs, onReady = () => {} }) {
  if (format !== 'ipa') throw new Error('iOS builds use --format ipa. APK and AAB are Android formats.');
  if (process.platform !== 'darwin') throw iosHostError();
  if (!(await commandExists('xcodebuild'))) throw new Error('Xcode command-line tools were not found. Install Xcode, select it with xcode-select, and accept the licence.');
  const plistPath = await resolveExportOptions(project.root, exportOptions);

  if (project.framework === 'flutter') {
    if (!(await commandExists('flutter'))) throw new Error('Flutter was not found on PATH.');
    const args = ['build', 'ipa', '--release'];
    if (plistPath) args.push('--export-options-plist', plistPath);
    const ipa = path.join(project.root, 'build', 'ios', 'ipa');
    const before = await snapshotFiles(ipa, '.ipa');
    onReady({ command: 'flutter', args });
    const result = await runProcess('flutter', args, { cwd: project.root, env: sanitizedEnvironment(), timeoutMs, capture: true, tee: true, logFile: path.join(project.root, '.paxi', 'logs', `${Date.now()}-ios-build.log`) });
    if (result.code !== 0) {
      const reason = result.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} seconds` : result.cancelled ? 'was cancelled by Ctrl+C' : `failed (exit code ${result.code})`;
      throw new Error(`Flutter iOS build ${reason}. Review Xcode output and signing configuration.`);
    }
    const candidate = await freshFiles(ipa, '.ipa', before);
    if (candidate.length === 1) return { artifact: candidate[0] };
    throw new Error('Flutter exited successfully but did not create a fresh IPA in build/ios/ipa. Existing IPA files are not accepted as this build result.');
  }

  if (project.framework !== 'xcode') {
    throw new Error(`Project type '${project.framework}' is not supported for iOS packaging. Flutter and native Xcode projects are supported.`);
  }
  validateScheme(scheme);
  if (!plistPath) throw new Error('For native Xcode IPA export, supply --export-options <ExportOptions.plist> with your signing/distribution settings.');
  const container = await locateXcodeContainer(project.root);
  if (!container) throw new Error('Could not locate an .xcworkspace or .xcodeproj in the project root or ios/ directory.');
  const archivePath = path.join(project.root, 'build', 'paxi-ios', `${scheme}.xcarchive`);
  const exportPath = path.join(project.root, 'build', 'paxi-ios', 'export');
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  const archiveArgs = [container.type, container.path, '-scheme', scheme, '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', archivePath, 'archive'];
  onReady({ command: 'xcodebuild', args: archiveArgs });
  const archive = await runProcess('xcodebuild', archiveArgs, { cwd: project.root, env: sanitizedEnvironment(), timeoutMs, capture: true, tee: true, logFile: path.join(project.root, '.paxi', 'logs', `${Date.now()}-xcode-archive.log`) });
  if (archive.code !== 0) {
    const reason = archive.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} seconds` : archive.cancelled ? 'was cancelled by Ctrl+C' : `failed (exit code ${archive.code})`;
    throw new Error(`Xcode archive ${reason}.`);
  }
  await fs.mkdir(exportPath, { recursive: true });
  const beforeExport = await snapshotFiles(exportPath, '.ipa');
  const exported = await runProcess('xcodebuild', ['-exportArchive', '-archivePath', archivePath, '-exportPath', exportPath, '-exportOptionsPlist', plistPath], { cwd: project.root, env: sanitizedEnvironment(), timeoutMs, capture: true, tee: true, logFile: path.join(project.root, '.paxi', 'logs', `${Date.now()}-xcode-export.log`) });
  if (exported.code !== 0) {
    const reason = exported.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} seconds` : exported.cancelled ? 'was cancelled by Ctrl+C' : `failed (exit code ${exported.code})`;
    throw new Error(`Xcode IPA export ${reason}.`);
  }
  const fresh = await freshFiles(exportPath, '.ipa', beforeExport);
  if (fresh.length === 1) return { artifact: fresh[0] };
  throw new Error('Xcode completed but did not create a fresh IPA in the export directory. Existing IPA files are not accepted as this build result.');
}

function windowsHostError() {
  return new Error([
    'A Windows desktop bundle cannot be built locally on this host.',
    `Detected host: ${os.platform()} (${os.arch()}).`,
    'Flutter Windows desktop compilation requires a Windows host with Visual Studio C++ Build Tools and a Windows SDK.',
    'No remote builder was contacted and no project files were uploaded.'
  ].join('\n'));
}

function safeWindowsFilePart(value) {
  const result = String(value || 'paxi-app').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  return result && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(result) ? result.slice(0, 80) : 'paxi-app';
}

async function collectDirectoryFiles(directory, depth = 0, output = []) {
  if (depth > 12) throw new Error(`Windows build output is nested too deeply: ${directory}`);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Windows build output contains a symbolic link; refusing to package it: ${file}`);
    if (entry.isDirectory()) await collectDirectoryFiles(file, depth + 1, output);
    else if (entry.isFile()) output.push(file);
  }
  return output;
}

async function snapshotDirectory(directory) {
  const files = await collectDirectoryFiles(directory).catch(() => []);
  const snapshot = new Map();
  for (const file of files) {
    const info = await fs.stat(file);
    snapshot.set(path.relative(directory, file), { size: info.size, mtimeMs: info.mtimeMs, sha256: await sha256File(file) });
  }
  return snapshot;
}

async function findWindowsOutputDirectory(projectRoot, variant) {
  const config = variant === 'release' ? 'Release' : 'Debug';
  const candidates = [
    path.join(projectRoot, 'build', 'windows', 'x64', 'runner', config),
    path.join(projectRoot, 'build', 'windows', 'runner', config)
  ];
  const matches = [];
  for (const directory of candidates) {
    const info = await fs.lstat(directory).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) continue;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const executables = entries.filter((item) => item.isFile() && !item.isSymbolicLink() && item.name.toLowerCase().endsWith('.exe'));
    const runtime = entries.some((item) => item.isFile() && !item.isSymbolicLink() && item.name.toLowerCase() === 'flutter_windows.dll');
    const data = entries.some((item) => item.isDirectory() && !item.isSymbolicLink() && item.name.toLowerCase() === 'data');
    if (executables.length === 1 && runtime && data) matches.push({ directory, executable: path.join(directory, executables[0].name) });
  }
  if (matches.length > 1) throw new Error(`Multiple Windows Flutter output directories were found. PAXI will not choose between them: ${matches.map((item) => item.directory).join(', ')}`);
  if (!matches.length) throw new Error(`Flutter exited without producing a complete Windows ${config} bundle. Expected one .exe, flutter_windows.dll and data/ directory under build/windows/x64/runner/${config}.`);
  return matches[0];
}

async function buildWindows({ project, format, variant, timeoutMs, offline, buildId, buildStartedMs, onInvocation = () => {}, onReady = () => {} }) {
  if (format !== 'zip') throw new Error('Windows desktop builds use --format zip to package the complete runnable app bundle.');
  if (process.platform !== 'win32') throw windowsHostError();
  if (project.framework !== 'flutter') throw new Error(`Windows desktop packaging currently supports Flutter projects only; '${project.framework}' has no PAXI Windows bundle adapter yet.`);
  if (!(await commandExists('flutter'))) throw new Error('Flutter was not found on PATH. Install a Windows Flutter SDK and run paxi doctor.');
  const windowsRunner = path.join(project.root, 'windows');
  const cmake = path.join(windowsRunner, 'CMakeLists.txt');
  const cmakeInfo = await fs.lstat(cmake).catch(() => null);
  if (!cmakeInfo?.isFile() || cmakeInfo.isSymbolicLink()) {
    throw new Error(`Flutter Windows runner files are missing. From the project root run: flutter create --platforms=windows .\nReview the generated windows/ project files before rebuilding; PAXI does not modify them automatically.`);
  }
  const windowsTools = await inspectWindowsToolchain();
  if (!windowsTools.ready) throw new Error(`Windows desktop toolchain is incomplete. ${windowsTools.detail}`);

  const outputBefore = await findWindowsOutputDirectory(project.root, variant).catch(() => null);
  const baseline = outputBefore ? await snapshotDirectory(outputBefore.directory) : new Map();
  const logFile = path.join(project.root, '.paxi', 'logs', `${buildStartedMs}-windows-build.log`);
  let args = ['build', 'windows', variant === 'release' ? '--release' : '--debug'];
  let buildEnv = sanitizedEnvironment();
  let offlineCleanup = null;
  onInvocation({ command: 'flutter', args, logFile });
  try {
    if (offline) {
      const cache = await inspectGradleWrapperCache(path.join(project.root, 'android'));
      if (!cache.wrapperPresent) throw new Error('Offline cache missing: Flutter Windows project has no Android Gradle Wrapper. Run one online Flutter build or repair the Android project before using --offline.');
      if (!cache.cached) throw new Error(`Offline cache missing: Gradle distribution ${cache.version || ''} is not cached. Run the Windows project Gradle Wrapper once while online, then retry --offline.`);
      const snapshot = await offlineToolchainSnapshot(project.root);
      if (!snapshot.gradleDependencies.available) throw new Error('Offline cache missing: Gradle dependency cache is not present. Complete one successful online build first.');
      if (!snapshot.flutter.windowsArtifactsCached) throw new Error('Offline cache missing: Flutter Windows engine artifacts are not cached. Run flutter precache --windows while online.');
      const pub = await runProcess('flutter', ['pub', 'get', '--offline', '--no-precompile'], {
        cwd: project.root, env: buildEnv, capture: true, tee: true,
        timeoutMs: Math.min(timeoutMs, 5 * 60 * 1000), maxOutputBytes: 512 * 1024
      });
      if (pub.code !== 0) {
        const reason = pub.timedOut ? `timed out after ${Math.round(Math.min(timeoutMs, 5 * 60 * 1000) / 1000)} seconds` : pub.cancelled ? 'was cancelled by Ctrl+C' : `exited ${pub.code}`;
        throw new Error(`Offline cache missing or Flutter package resolution ${reason}. flutter pub get --offline failed.\n${renderFailureAdvice(`${pub.stderr}\n${pub.stdout}`)}`);
      }
      args.push('--no-pub');
      // Flutter invokes gradlew.bat internally. Setting --offline on the Flutter
      // command alone does not make Gradle dependency resolution offline.
      offlineCleanup = await createOfflineGradleEnvironment();
      buildEnv = { ...buildEnv, ...offlineCleanup.env };
      onInvocation({ command: 'flutter', args, logFile });
    }
    onReady({ command: 'flutter', args });
    console.log(`\nPAXI local Windows build: ${project.name}`);
    console.log(`Framework: Flutter | Platform: Windows | Format: ZIP app bundle | Variant: ${variant}${offline ? ' | Offline' : ''}`);
    console.log(`Working directory: ${project.root}\n`);
    const result = await runProcess('flutter', args, {
      cwd: project.root, env: buildEnv, capture: true, tee: true,
      logFile, timeoutMs, maxOutputBytes: 2 * 1024 * 1024
    });
    if (result.code !== 0) {
      const tail = `${result.stderr}\n${result.stdout}`.trim().split(/\r?\n/).slice(-35).join('\n');
      const reason = result.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} seconds` : result.cancelled ? 'was cancelled by Ctrl+C' : `failed (exit code ${result.code})`;
      throw new Error(`Local Windows build ${reason}. Full log: ${logFile}\n${tail || 'No captured error output.'}\n\n${renderFailureAdvice(tail)}`);
    }

    const output = await findWindowsOutputDirectory(project.root, variant);
    const current = await snapshotDirectory(output.directory);
    const freshFiles = [];
    for (const [relative, value] of current) {
      const old = baseline.get(relative);
      const recent = value.mtimeMs >= buildStartedMs - 2000;
      const changed = !old || value.size !== old.size || value.mtimeMs > old.mtimeMs || value.sha256 !== old.sha256;
      if (changed && recent) freshFiles.push(relative);
    }
    if (!freshFiles.length) throw new Error('Flutter completed but PAXI found no fresh Windows app bundle files. Existing outputs were ignored to avoid recording a stale build.');

    const destinationDirectory = path.join(project.root, 'build', 'paxi-distribution');
    const archiveName = `${safeWindowsFilePart(project.name)}-windows-${variant}-${buildId}.zip`;
    const archivePath = path.join(destinationDirectory, archiveName);
    await createZipFromDirectory(output.directory, archivePath);
    const artifactDetails = await inspectArtifact(archivePath, { quiet: true, strict: false });
    console.log(`\n✓ Local Windows build completed: ${archivePath}`);
    console.log(`Artifact: ${(artifactDetails.sizeBytes / 1024 / 1024).toFixed(2)} MiB · SHA-256 ${artifactDetails.sha256}`);
    for (const warning of artifactDetails.warnings) console.warn(`Warning: ${warning}`);
    console.log('Extract the ZIP and run the application executable. Windows code signing must be completed separately before public distribution.');
    console.log('Build ran on this PC; no source or artifact was sent to a PAXI build server.');
    return { artifact: archivePath, artifactDetails, command: 'flutter', args, logFile };
  } finally {
    if (offlineCleanup) await offlineCleanup.cleanup().catch(() => {});
  }
}

async function locateExecutable(name) {
  const suffixes = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(directory, `${name}${suffix}`);
      const info = await fs.stat(candidate).catch(() => null);
      if (info?.isFile()) return candidate;
    }
  }
  return null;
}

async function buildToolchainSnapshot(project, framework, { offline = false } = {}) {
  const versionFromFile = async (file) => (await fs.readFile(file, 'utf8').catch(() => '')).trim() || null;
  const flutterExecutable = await locateExecutable('flutter');
  let flutterRoot = process.env.FLUTTER_ROOT || (flutterExecutable ? path.dirname(path.dirname(flutterExecutable)) : null);
  if (!flutterRoot && isTermuxEnvironment()) flutterRoot = path.join(getTermuxPaths().prefix, 'opt', 'flutter');
  const wrapperRoot = framework === 'flutter' ? path.join(project.root, 'android') : project.root;
  const wrapper = await inspectGradleWrapperCache(wrapperRoot);
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (isTermuxEnvironment() ? getTermuxPaths().androidSdk : null);
  let sdkPlatforms = [];
  let sdkBuildTools = [];
  let ndkVersions = [];
  if (sdkRoot) {
    sdkPlatforms = (await fs.readdir(path.join(sdkRoot, 'platforms')).catch(() => [])).filter((name) => /^android-\d+$/.test(name)).sort();
    sdkBuildTools = (await fs.readdir(path.join(sdkRoot, 'build-tools')).catch(() => [])).sort();
    ndkVersions = (await fs.readdir(path.join(sdkRoot, 'ndk')).catch(() => [])).sort();
  }
  const javaResult = await commandExists('java') ? await runProcess('java', ['-version'], { capture: true, tee: false, timeoutMs: 8000, maxOutputBytes: 4096, env: sanitizedEnvironment() }) : null;
  const javaText = javaResult ? `${javaResult.stderr}\n${javaResult.stdout}` : '';
  const javaVersion = javaText.match(/(?:openjdk|java) version ["']?([^"'\s]+)/i)?.[1] || javaText.match(/version "([^"]+)"/i)?.[1] || null;
  const gradleResult = !offline && await commandExists('gradle') ? await runProcess('gradle', ['--version'], { capture: true, tee: false, timeoutMs: 10000, maxOutputBytes: 8192, env: sanitizedEnvironment() }) : null;
  const gradleText = gradleResult ? `${gradleResult.stdout}\n${gradleResult.stderr}` : '';
  const systemGradleVersion = gradleText.match(/^Gradle\s+([\w.+-]+)/m)?.[1] || null;
  const flutterVersionText = flutterRoot ? await versionFromFile(path.join(flutterRoot, 'bin', 'cache', 'flutter.version.json')) : null;
  let flutterVersion = null;
  try { const parsed = JSON.parse(flutterVersionText || '{}'); flutterVersion = parsed.frameworkVersion || parsed.version || null; } catch {}
  return {
    node: process.version,
    java: javaVersion,
    flutter: flutterVersion,
    dart: flutterRoot ? await versionFromFile(path.join(flutterRoot, 'bin', 'cache', 'dart-sdk', 'version')) : null,
    gradle: { system: systemGradleVersion, wrapper: wrapper.wrapperPresent ? { version: wrapper.version, distribution: wrapper.directory, cached: wrapper.cached } : null },
    androidSdk: sdkRoot ? { path: sdkRoot, platforms: sdkPlatforms, buildTools: sdkBuildTools, ndkVersions } : null,
    windows: await inspectWindowsToolchain()
  };
}

async function releaseSigningWarnings(projectRoot, framework) {
  const appRoot = framework === 'flutter' ? path.join(projectRoot, 'android', 'app') : path.join(projectRoot, 'app');
  const gradleText = (await fs.readFile(path.join(appRoot, 'build.gradle'), 'utf8').catch(() => '')) +
    (await fs.readFile(path.join(appRoot, 'build.gradle.kts'), 'utf8').catch(() => ''));
  const warnings = [];
  if (!/signingConfig|storeFile|keyAlias/.test(gradleText)) warnings.push('No Android release signing configuration markers were detected. The release may be unsigned or not distributable.');
  const keyFiles = [];
  async function scan(directory, depth = 0) {
    if (depth > 5) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory() && !['.git', 'node_modules', 'build', '.gradle', '.dart_tool', 'Pods'].includes(entry.name)) await scan(target, depth + 1);
      else if (entry.isFile() && /\.(?:jks|keystore|p12|pfx)$/i.test(entry.name)) keyFiles.push(target);
    }
  }
  await scan(projectRoot);
  if (keyFiles.length) warnings.push(`Potential signing key file(s) are inside the project tree: ${keyFiles.join(', ')}. Move them outside the repository and ignore private signing files.`);
  const properties = await fs.readFile(path.join(appRoot, 'key.properties'), 'utf8').catch(() => '');
  if (/^(?:storePassword|keyPassword)\s*=\s*[^$\s]/m.test(properties)) warnings.push('Android key.properties appears to contain literal password values. Move credentials to a protected local secret store/environment and keep the file out of Git.');
  return warnings;
}

function buildRecord({ id, toolchain = null, project, framework, platform, variant, format, startedAt, status, artifact = null, artifactDetails = null, error = null, command = null, args = [], logFile = null, offline = false, lifecycle = null }) {
  const finishedAt = new Date();
  return {
    id,
    paxiVersion: VERSION,
    toolchain,
    nodeVersion: process.version,
    hostPlatform: `${process.platform}-${process.arch}`,
    offline,
    projectName: project.name,
    projectPath: project.root,
    framework,
    platform,
    variant,
    format,
    status,
    outcome: lifecycle?.state || status,
    lifecycle: lifecycle || null,
    artifact,
    artifactSizeBytes: artifactDetails?.sizeBytes ?? null,
    artifactSha256: artifactDetails?.sha256 ?? null,
    artifactVerified: artifactDetails?.fullyPlatformVerified === true,
    artifactVerificationState: !artifactDetails ? 'not_checked' : artifactDetails.fullyPlatformVerified === true ? 'platform_verified' : 'structurally_valid_only',
    verificationLevel: artifactDetails?.verificationLevel || null,
    command: command ? [command, ...args] : null,
    logFile,
    error: error ? String(error).slice(0, 500) : null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime()
  };
}

export async function build({ projectPath = process.cwd(), variant = 'debug', format = 'apk', frameworkOverride = null, platform = 'android', exportOptions = null, scheme = null, timeoutMs = 45 * 60 * 1000, offline = false, allowUnverifiedRelease = false } = {}) {
  if (!['debug', 'release'].includes(variant)) throw new Error('Build variant must be debug or release.');
  if (!['android', 'ios', 'windows'].includes(platform)) throw new Error('Platform must be android, ios or windows.');
  if (platform === 'android' && !['apk', 'aab'].includes(format)) throw new Error('Android format must be apk or aab.');
  if (platform === 'ios' && format !== 'ipa') throw new Error('iOS format must be ipa. APK/AAB are Android formats.');
  if (platform === 'ios' && variant !== 'release') throw new Error('An installable/distributable IPA is a release artifact. Re-run with --release.');
  if (platform === 'windows' && format !== 'zip') throw new Error('Windows desktop format must be zip (a runnable app bundle).');

  const detected = detectProject(projectPath);
  const project = frameworkOverride ? { ...detected, framework: frameworkOverride } : detected;
  const framework = project.framework;
  const startedAt = new Date();
  const buildId = `${startedAt.getTime()}-${randomUUID().slice(0, 8)}`;
  if (platform === 'ios' && process.platform !== 'darwin') throw iosHostError();
  if (platform === 'ios' && offline) throw new Error('Offline iOS builds are not enabled in this release. Xcode/Swift package resolution must be prepared and verified separately on macOS.');
  if (platform === 'windows' && process.platform !== 'win32') throw windowsHostError();
  const lifecycle = createStateMachine('build', 'created', BUILD_STATE_TRANSITIONS);
  lifecycle.transition('preflight', { platform, format, variant, offline });
  let toolchain = null;

  let invocationCommand = null;
  let invocationArgs = [];
  let invocationLogFile = null;
  let offlineCleanup = null;
  try {
    toolchain = await buildToolchainSnapshot(project, framework, { offline });
    if (platform === 'windows') {
      invocationCommand = 'flutter';
      invocationArgs = ['build', 'windows', variant === 'release' ? '--release' : '--debug'];
      invocationLogFile = path.join(project.root, '.paxi', 'logs', `${startedAt.getTime()}-windows-build.log`);
      const result = await buildWindows({
        project, format, variant, timeoutMs, offline, buildId, buildStartedMs: startedAt.getTime(),
        onInvocation: ({ command, args, logFile }) => { invocationCommand = command; invocationArgs = [...args]; invocationLogFile = logFile; },
        onReady: ({ command, args }) => { lifecycle.transition('building', { platform, command, args }); }
      });
      invocationCommand = result.command; invocationArgs = [...result.args]; invocationLogFile = result.logFile;
      lifecycle.transition('verifying', { artifact: result.artifact });
      lifecycle.transition('succeeded');
      await saveHistory(buildRecord({ id: buildId, toolchain, project, framework, platform, variant, format, startedAt, status: 'succeeded', artifact: result.artifact, artifactDetails: result.artifactDetails, command: result.command, args: result.args, logFile: result.logFile, offline, lifecycle: lifecycle.snapshot() }));
      return { project, artifact: result.artifact };
    }
    if (platform === 'ios') {
      console.log(`\nPAXI local iOS build: ${project.name}`);
      console.log('Framework: Xcode/Flutter | Platform: iOS | Format: IPA | Variant: release');
      const result = await buildIos({
        project, format, exportOptions, scheme, timeoutMs,
        onReady: ({ command, args }) => { lifecycle.transition('building', { platform, command, args }); }
      });
      lifecycle.transition('verifying', { artifact: result.artifact });
      const artifactDetails = await inspectArtifact(result.artifact, { quiet: true, strict: !allowUnverifiedRelease });
      lifecycle.transition('succeeded');
      await saveHistory(buildRecord({ id: buildId, toolchain, project, framework, platform, variant, format, startedAt, status: 'succeeded', artifact: result.artifact, artifactDetails, lifecycle: lifecycle.snapshot() }));
      console.log(`✓ iOS IPA created: ${result.artifact}`);
      console.log('Build ran locally on this Mac. No source or artifact was sent to a PAXI build server.');
      return { project, ...result };
    }

    if (!['flutter', 'gradle'].includes(framework)) {
      if (['expo', 'react-native'].includes(framework)) throw new Error(`${framework} was detected, but is detection-only in PAXI ${VERSION}. Use its native npm/Expo/Gradle workflow; PAXI does not claim to build this framework yet.`);
      throw new Error(`Cannot build framework '${framework}'. Supported Android builders: Flutter and Android Gradle (Java/Kotlin).`);
    }
    if (platform === 'android' && variant === 'release') {
      console.log('Release build selected. PAXI will not create or manage signing keys. Configure signing locally and keep keystores out of Git.');
      for (const warning of await releaseSigningWarnings(project.root, framework)) console.warn(`WARNING: ${warning}`);
      const verifierReady = format === 'apk' ? await commandExists('apksigner') && await commandExists('aapt2') : await commandExists('bundletool');
      if (!verifierReady && !allowUnverifiedRelease) throw new Error(`Release build guard: ${format.toUpperCase()} verification tools are missing (${format === 'apk' ? 'apksigner and aapt2' : 'bundletool'}). Install them before making a distributable release, or explicitly acknowledge the risk with --allow-unverified-release.`);
      if (!verifierReady) console.warn('WARNING: --allow-unverified-release supplied. PAXI cannot fully verify this release artifact. Do not distribute until verified on a trusted machine.');
    }
    let command;
    let args;
    let baseline = new Map();
    const buildStartedMs = Date.now();
    const logFile = path.join(project.root, '.paxi', 'logs', `${buildStartedMs}-build.log`);
    invocationLogFile = logFile;
    if (framework === 'flutter') {
      if (!(await commandExists('flutter'))) throw new Error('Flutter was not found on PATH. Run paxi doctor and configure a local Flutter toolchain first.');
      if (isTermuxEnvironment() && !(await hasAapt2Override(project.root))) {
        const { aapt2 } = getTermuxPaths();
        throw new Error(`The Flutter project is not yet configured for Termux ARM64 AAPT2. Run: paxi configure android --project \"${project.root}\" (expected ${aapt2}).`);
      }
      command = 'flutter';
      args = ['build', format === 'aab' ? 'appbundle' : 'apk', variant === 'release' ? '--release' : '--debug'];
      if (isTermuxEnvironment()) {
        // The ARM64 Termux Flutter port uses the JIT Dart host and ships an ARM64
        // Android engine. Its documented build path targets arm64 and skips icon
        // tree-shaking, which depends on an unavailable AOT snapshot tool.
        args.push('--target-platform', 'android-arm64', '--no-tree-shake-icons');
      }
    } else {
      const termux = isTermuxEnvironment();
      if (termux && !(await hasAapt2Override(project.root))) {
        const { aapt2 } = getTermuxPaths();
        throw new Error(`Termux Android projects must be configured for the ARM64 AAPT2 binary before building. Run: paxi configure android --project "${project.root}" (expected ${aapt2}).`);
      }
      const gradleRoot = framework === 'flutter' ? path.join(project.root, 'android') : project.root;
      const gradleTask = format === 'aab'
        ? (variant === 'release' ? 'bundleRelease' : 'bundleDebug')
        : (variant === 'release' ? 'assembleRelease' : 'assembleDebug');
      const invocation = await createGradleInvocation({ projectRoot: gradleRoot, task: gradleTask, termux });
      command = invocation.command;
      args = invocation.args;
    }
    let buildEnv = isTermuxEnvironment() ? await getTermuxBuildEnvironment() : sanitizedEnvironment();
    if (offline) {
      const gradleRoot = framework === 'flutter' ? path.join(project.root, 'android') : project.root;
      const wrapperCache = await inspectGradleWrapperCache(gradleRoot);
      if (wrapperCache.wrapperPresent && !wrapperCache.cached) {
        throw new Error(`Offline cache missing: Gradle distribution ${wrapperCache.version || ''} is not cached. Run the project's Gradle wrapper once while online (for example: cd ${gradleRoot} && ./gradlew --version), then retry --offline.`);
      }
      if (framework === 'flutter' && !wrapperCache.wrapperPresent) {
        throw new Error('Offline cache missing: Flutter Android project has no Gradle Wrapper. Generate/repair the Android wrapper while online before an offline build.');
      }
      if (framework === 'flutter') {
        const pub = await runProcess('flutter', ['pub', 'get', '--offline', '--no-precompile'], { cwd: project.root, env: buildEnv, capture: true, tee: true, timeoutMs: Math.min(timeoutMs, 5 * 60 * 1000), maxOutputBytes: 512 * 1024 });
        if (pub.code !== 0) {
          const reason = pub.timedOut ? `timed out after ${Math.round(Math.min(timeoutMs, 5 * 60 * 1000) / 1000)} seconds` : pub.cancelled ? 'was cancelled by Ctrl+C' : `exited ${pub.code}`;
          throw new Error(`Offline cache missing or Flutter package resolution ${reason}. flutter pub get --offline failed.
${renderFailureAdvice(`${pub.stderr}
${pub.stdout}`)}`);
        }
        args.push('--no-pub');
        offlineCleanup = await createOfflineGradleEnvironment();
        buildEnv = { ...buildEnv, ...offlineCleanup.env };
      } else {
        args.push('--offline');
      }
    }
    invocationCommand = command;
    invocationArgs = [...args];
    baseline = await snapshotAndroidArtifacts(project.root, format);
    console.log(`\nPAXI local build: ${project.name}`);
    console.log(`Framework: ${framework} | Platform: Android | Format: ${format.toUpperCase()} | Variant: ${variant} | Device: ${process.arch}`);
    console.log(`Working directory: ${project.root}\n`);
    lifecycle.transition('building', { platform: 'android', command });
    const result = await runProcess(command, args, { cwd: project.root, env: buildEnv, capture: true, tee: true, logFile, timeoutMs, maxOutputBytes: 2 * 1024 * 1024 });
    if (result.code !== 0) {
      const tail = `${result.stderr}\n${result.stdout}`.trim().split(/\r?\n/).slice(-35).join('\n');
      const reason = result.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} seconds` : result.cancelled ? 'was cancelled by Ctrl+C' : `failed (exit code ${result.code})`;
      throw new Error(`Local Android build ${reason}. Full log: ${logFile}\n${tail || 'No captured error output.'}\n\n${renderFailureAdvice(`${tail}\n${result.error || ''}`)}`);
    }
    lifecycle.transition('verifying');
    const artifact = await findAndroidArtifact(project.root, framework, variant, format, baseline, buildStartedMs);
    if (!artifact) throw new Error(`Build tool exited successfully, but PAXI could not locate a non-empty ${format.toUpperCase()} artifact for ${variant}. Check the build output directories and your Gradle product flavor.`);
    const artifactDetails = await inspectArtifact(artifact, { quiet: true, strict: variant === 'release' && !allowUnverifiedRelease });
    lifecycle.transition('succeeded', { artifact });
    await saveHistory(buildRecord({ id: buildId, toolchain, project, framework, platform, variant, format, startedAt, status: 'succeeded', artifact, artifactDetails, command, args, logFile, offline, lifecycle: lifecycle.snapshot() }));
    console.log(`\n✓ Local Android build completed: ${artifact}`);
    console.log(`Artifact: ${(artifactDetails.sizeBytes / 1024 / 1024).toFixed(2)} MiB · SHA-256 ${artifactDetails.sha256}`);
    for (const warning of artifactDetails.warnings) console.log(`Warning: ${warning}`);
    console.log('Build ran on this device; no source or artifact was sent to a PAXI build server.');
    if (format === 'aab') console.log('AAB files are for app-store distribution and cannot be installed directly like APKs.');
    return { project, artifact };
  } catch (error) {
    if (!lifecycle.isTerminal) lifecycle.transition(buildFailureState(error), { message: String(error?.message || error).slice(0, 300) });
    if (lifecycle.state !== 'succeeded') {
      await saveHistory(buildRecord({ id: buildId, toolchain, project, framework, platform, variant, format, startedAt, status: 'failed', error: error.message, command: invocationCommand, args: invocationArgs, logFile: invocationLogFile, offline, lifecycle: lifecycle.snapshot() }));
    }
    throw error;
  } finally {
    if (offlineCleanup) await offlineCleanup.cleanup().catch(() => {});
  }
}

export async function getBuildHistory() {
  const value = await readJson(HISTORY_FILE, []);
  return Array.isArray(value) ? value : [];
}

export async function showBuildHistory(args = []) {
  let json = false;
  let failedOnly = false;
  let projectFilter = null;
  let clean = false;
  let diagnoseId = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--failed') failedOnly = true;
    else if (args[i] === '--clean') clean = true;
    else if (args[i] === '--diagnose' && args[i + 1]) diagnoseId = args[++i];
    else if (args[i] === '--project' && args[i + 1]) projectFilter = path.resolve(args[++i]);
    else throw new Error('Usage: paxi builds [--json] [--failed] [--project <path>] [--diagnose <build-id>] [--clean]');
  }
  if (clean) {
    await writeJsonSecure(HISTORY_FILE, []);
    await fs.rm(`${HISTORY_FILE}.bak`, { force: true });
    console.log('✓ Local build history cleared. Existing artifacts and logs were not deleted.');
    return;
  }
  let history = await getBuildHistory();
  if (diagnoseId) {
    const entry = history.find((item, index) => item.id === diagnoseId || item.startedAt === diagnoseId || String(index + 1) === diagnoseId);
    if (!entry) throw new Error(`Build record '${diagnoseId}' was not found. Run paxi builds --json to list build IDs.`);
    if (json) return console.log(JSON.stringify(entry, null, 2));
    console.log(`\nBuild diagnosis: ${entry.id || entry.startedAt}`);
    console.log(JSON.stringify(entry, null, 2));
    if (entry.logFile) {
      const log = await fs.readFile(entry.logFile, 'utf8').catch(() => '');
      console.log(log ? `\nRecent log output\n${log.split(/\r?\n/).slice(-50).join('\n')}` : '\nBuild log is no longer available.');
    }
    return entry;
  }
  if (failedOnly) history = history.filter((item) => item.status === 'failed' || ['failed', 'cancelled', 'timed_out'].includes(item.outcome || item.lifecycle?.state));
  if (projectFilter) history = history.filter((item) => item.projectPath === projectFilter);
  if (json) return console.log(JSON.stringify(history, null, 2));
  if (!history.length) return console.log('No matching local build history.');
  console.log('\nRecent local builds\n');
  for (const item of history.slice(0, 10)) {
    const outcome = item.outcome || item.lifecycle?.state || item.status || 'unknown';
    const status = outcome === 'succeeded' ? '✓' : outcome === 'timed_out' ? '⌛' : outcome === 'cancelled' ? '↪' : '×';
    console.log(`${status} ${item.id || item.startedAt} · ${item.projectName} · ${item.platform || 'android'} · ${item.framework} · ${item.format || 'apk'} · ${item.variant} · ${outcome} · ${new Date(item.startedAt).toLocaleString()}`);
    if (item.artifact) console.log(`  ${item.artifact}`);
    if (item.artifactSha256) {
      const verification = item.artifactVerificationState === 'platform_verified' || item.artifactVerified
        ? (item.verificationLevel || 'platform verified')
        : item.artifactVerificationState === 'structurally_valid_only' ? 'structure checked only' : 'not verified';
      console.log(`  ${verification} · ${(Number(item.artifactSizeBytes || 0) / 1024 / 1024).toFixed(2)} MiB · SHA-256 ${item.artifactSha256}`);
    }
    if (item.logFile) console.log(`  log · ${item.logFile}`);
    if (item.error) console.log(`  ${item.error}`);
  }
}
