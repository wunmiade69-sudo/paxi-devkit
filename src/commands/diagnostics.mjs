import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectProject } from '../lib/project-detect.mjs';
import { commandExists, runProcess, sanitizedEnvironment } from '../lib/process.mjs';
import { getTermuxPaths, isTermuxEnvironment } from '../lib/termux.mjs';
import { offlineToolchainSnapshot, inspectGradleWrapperCache } from '../lib/offline.mjs';
import { getConfig, getStoredConfig } from '../lib/config.mjs';
import { getBuildHistory } from './build.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';
import { VERSION } from '../lib/version.mjs';
import { deflateRawSync } from 'node:zlib';
import { inspectWindowsToolchain } from '../lib/windows.mjs';

const existsDir = async (p) => Boolean(p) && fs.stat(p).then((s) => s.isDirectory(), () => false);
const existsFile = async (p) => Boolean(p) && fs.stat(p).then((s) => s.isFile(), () => false);

async function containsSigningFile(root) {
  const ignored = new Set(['.git', 'node_modules', 'build', '.gradle', '.dart_tool', 'Pods']);
  const queue = [{ directory: root, depth: 0 }];
  while (queue.length) {
    const { directory, depth } = queue.shift();
    if (depth > 6) continue;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !ignored.has(entry.name)) queue.push({ directory: target, depth: depth + 1 });
      else if (entry.isFile() && /\.(?:jks|keystore|p12|pfx)$/i.test(entry.name)) return true;
    }
  }
  return false;
}

async function versionOf(command, args = ['--version']) {
  if (!(await commandExists(command))) return null;
  const result = await runProcess(command, args, { capture: true, tee: false, timeoutMs: 8000, maxOutputBytes: 4096, env: sanitizedEnvironment() });
  return result.code === 0 ? `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).find(Boolean)?.trim() || null : null;
}

async function collectHost({ offline = false } = {}) {
  const termux = isTermuxEnvironment();
  const termuxPaths = termux ? getTermuxPaths() : null;
  const sdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || termuxPaths?.androidSdk || null;
  const flutter = await commandExists('flutter');
  const dart = await commandExists('dart') || await commandExists('dartvm');
  const tools = {};
  for (const [name, label] of [
    ['node', 'Node.js'], ['java', 'Java'], ['gradle', 'Gradle'], ['flutter', 'Flutter'],
    ['dart', 'Dart'], ['adb', 'ADB'], ['aapt2', 'AAPT2'], ['apksigner', 'apksigner'],
    ['bundletool', 'bundletool'], ['xcodebuild', 'Xcode'], ['npm', 'npm'], ['git', 'Git']
  ]) {
    const available = name === 'node' ? true : name === 'dart' ? dart : await commandExists(name);
    tools[name] = { label, available };
  }
  if (tools.node.available) tools.node.version = process.version;
  if (tools.java.available) tools.java.version = await versionOf('java', ['-version']);
  if (tools.flutter.available && !offline) tools.flutter.version = await versionOf('flutter');
  if (tools.dart.available) tools.dart.version = await versionOf(tools.dart.available && await commandExists('dart') ? 'dart' : 'dartvm');
  if (tools.gradle.available) tools.gradle.version = await versionOf('gradle');
  const windows = await inspectWindowsToolchain();
  const sdk = {
    path: sdkPath,
    available: await existsDir(sdkPath),
    platforms: await existsDir(sdkPath ? path.join(sdkPath, 'platforms') : null),
    buildTools: await existsDir(sdkPath ? path.join(sdkPath, 'build-tools') : null),
    platformTools: await existsDir(sdkPath ? path.join(sdkPath, 'platform-tools') : null)
  };
  const aapt2Path = termuxPaths?.aapt2 || null;
  const stat = await fs.statfs(process.env.HOME || os.homedir()).catch(() => null);
  const disk = stat ? { freeBytes: Number(stat.bavail) * Number(stat.bsize), totalBytes: Number(stat.blocks) * Number(stat.bsize) } : null;
  return {
    paxiVersion: VERSION,
    host: { platform: os.platform(), release: os.release(), architecture: os.arch(), termux, cpuCores: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), disk },
    tools,
    android: { sdk, aapt2: { available: await commandExists('aapt2'), path: aapt2Path }, adb: tools.adb },
    ios: { hostSupported: os.platform() === 'darwin', xcodeAvailable: tools.xcodebuild.available },
    windows,
    paths: { gradleUserHome: process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle'), pubCache: process.env.PUB_CACHE || path.join(os.homedir(), '.pub-cache'), androidSdk: sdkPath }
  };
}

export async function doctorReport({ offline = false, projectPath = null } = {}) {
  const report = await collectHost({ offline });
  // Set host support before calculating machine-readable readiness/exit codes.
  report.host.supported = ['linux', 'darwin', 'win32'].includes(os.platform()) || report.host.termux;
  const problems = [];
  const macIosReady = report.ios.hostSupported && report.ios.xcodeAvailable;
  const windowsReady = report.windows.hostSupported && report.windows.ready && report.tools.flutter.available;
  if (!report.tools.node.available) problems.push('Missing required tool: Node.js');
  if (!report.tools.java.available && !macIosReady && !windowsReady) problems.push('Missing required tool: Java');
  if (!report.android.sdk.available && !macIosReady && !windowsReady) problems.push('Android SDK directory is missing or not configured. Configure ANDROID_HOME/ANDROID_SDK_ROOT or install the host-specific SDK.');
  if (!projectPath && !report.tools.flutter.available && !report.tools.gradle.available && !macIosReady && !windowsReady) problems.push('No global Flutter SDK or system Gradle was found. A project-local Gradle wrapper may still be available for an individual project.');
  if (report.host.termux && !report.android.aapt2.available) problems.push(`Termux AAPT2 is missing. Expected ${getTermuxPaths().aapt2}; install it with pkg install aapt2.`);
  if (projectPath) {
    const project = detectProject(projectPath);
    report.project = project;
    if (!['flutter', 'gradle', 'xcode', 'javascript', 'react-native', 'expo'].includes(project.framework)) problems.push(`Unrecognised project framework: ${project.framework}`);
    const cache = await offlineToolchainSnapshot(project.root);
    report.cache = cache;
    if (offline && ['flutter', 'gradle'].includes(project.framework)) {
      if (!report.android.sdk.available) problems.push('Android SDK directory is missing or not configured. Run the host-specific Android SDK setup before offline builds.');
      if (cache.gradleWrapper.wrapperPresent && !cache.gradleWrapper.cached) problems.push(`Missing Gradle distribution: ${cache.gradleWrapper.version || 'unknown version'} (${cache.gradleWrapper.path || 'wrapper cache'}).`);
      if (project.framework === 'flutter' && !report.tools.flutter.available) problems.push('Flutter SDK is not on PATH. Install/configure Flutter before attempting offline builds.');
      if (project.framework === 'flutter' && !report.tools.dart.available) problems.push('Dart SDK/runtime is not on PATH. Install/configure Dart with Flutter before attempting offline builds.');
      if (project.framework === 'flutter' && !cache.gradleWrapper.wrapperPresent) problems.push('Flutter Android project Gradle Wrapper is missing. Generate/repair the Android folder while online.');
      if (project.framework === 'gradle' && !cache.gradleWrapper.wrapperPresent && !report.tools.gradle.available) problems.push('Neither a project Gradle Wrapper nor system Gradle is available.');
      if (project.framework === 'flutter' && !cache.pub.available) problems.push('Flutter Pub cache directory is missing; run flutter pub get while online before offline builds.');
      if (project.framework === 'flutter' && !cache.flutter.artifactsCached) problems.push('Flutter SDK artifacts cache is missing; run flutter precache --android while online.');
      if (!cache.gradleDependencies.available) problems.push('Gradle dependency cache is missing; complete one successful online build first.');
    }
  } else if (offline) {
    const cache = await offlineToolchainSnapshot(process.cwd());
    report.cache = cache;
    if (!cache.gradleDependencies.available) problems.push('Gradle dependency cache is not present. Project-specific dependencies cannot be confirmed without a project preflight.');
  }
  report.offlineReady = Boolean(report.tools.java.available && (!report.host.termux || report.android.aapt2.available) && projectPath && problems.length === 0);
  const hasMissingOfflineCache = problems.some((item) => /Missing Gradle distribution|Pub cache directory is missing|Flutter SDK artifacts cache is missing|Gradle dependency cache is missing|Gradle dependency cache is not present|Gradle Wrapper is missing/i.test(item));
  const missingOfflineToolchain = !report.host.supported || !report.tools.node.available || !report.tools.java.available || !report.android.sdk.available || (report.host.termux && !report.android.aapt2.available) || Boolean(projectPath && report.project?.framework === 'flutter' && (!report.tools.flutter.available || !report.tools.dart.available));
  report.offlineExitCode = report.offlineReady ? 0 : !report.host.supported ? 10 : missingOfflineToolchain ? 11 : hasMissingOfflineCache ? 12 : 11;
  const projectWrapperAvailable = Boolean(report.cache?.gradleWrapper?.wrapperPresent);
  const androidReady = report.android.sdk.available && (report.host.termux ? report.android.aapt2.available : true) && (report.tools.flutter.available || report.tools.gradle.available || projectWrapperAvailable);
  const iosReady = report.ios.hostSupported && report.ios.xcodeAvailable;
  report.ready = Boolean(report.host.supported && report.tools.node.available && ((report.tools.java.available && androidReady) || iosReady || windowsReady));
  if (!report.host.supported) problems.push(`This host platform (${os.platform()}) is not supported. Use Windows, macOS, Linux or Termux/Android.`);
  if (report.windows.hostSupported && !windowsReady) problems.push(`Windows desktop build prerequisites: ${report.windows.detail} Flutter must also be installed.`);
  report.problems = problems;
  const config = await getConfig();
  report.ai = { mode: config.aiMode, requestsDisabled: config.aiMode === 'off' };
  return report;
}

export async function doctor({ json = false, offline = false, projectPath = null } = {}) {
  const report = await doctorReport({ offline, projectPath });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  console.log('\nPAXI DevKit environment check\n');
  console.log(`PAXI: ${report.paxiVersion}`);
  console.log(`OS: ${report.host.platform} ${report.host.release}`);
  console.log(`Architecture: ${report.host.architecture}`);
  console.log(`Node: ${process.version}`);
  console.log(`CPU cores: ${report.host.cpuCores}`);
  console.log(`Free system memory: ${(report.host.freeMemoryBytes / 1024 ** 3).toFixed(2)} GiB`);
  console.log(`Free disk: ${report.host.disk ? (report.host.disk.freeBytes / 1024 ** 3).toFixed(2) + ' GiB' : 'unknown'}`);
  for (const [name, tool] of Object.entries(report.tools)) console.log(`${tool.available ? '✓' : '·'} ${tool.label}: ${tool.available ? 'available' : 'not found'}${tool.version ? ` (${tool.version})` : ''}`);
  console.log(`${report.android.sdk.available ? '✓' : '·'} Android SDK: ${report.android.sdk.available ? report.android.sdk.path : 'not configured/found'}`);
  console.log(`${report.android.aapt2.available ? '✓' : '·'} Android AAPT2: ${report.android.aapt2.available ? 'available' : 'not found'}`);
  console.log(`${report.ios.hostSupported && report.ios.xcodeAvailable ? '✓' : '·'} iOS build host: ${report.ios.hostSupported && report.ios.xcodeAvailable ? 'macOS + Xcode available' : 'requires macOS + Xcode'}`);
  if (report.windows.hostSupported) console.log(`${report.windows.ready && report.tools.flutter.available ? '✓' : '·'} Windows desktop build: ${report.windows.ready ? report.windows.detail : report.windows.detail}; Flutter ${report.tools.flutter.available ? 'available' : 'not found'}`);
  console.log(`AI mode: ${report.ai.mode}`);
  console.log(`Environment status: ${report.ready ? 'READY' : 'PARTIAL'}`);
  if (!report.host.supported) console.log(`This host platform (${os.platform()}) is not supported. Supported hosts: Windows, macOS, Linux and Termux/Android.`);
  if (offline) console.log(`Offline readiness: ${report.offlineReady ? 'READY' : 'NOT READY'}`);
  for (const problem of report.problems) console.log(`! ${problem}`);
  if (report.host.termux) console.log('\nTermux note: PAXI builds run locally. No source code is uploaded to a PAXI build server.');
  return report;
}

export async function preflight({ projectPath = process.cwd(), offline = false, json = false, variant = 'debug', format = 'apk', platform = 'android' } = {}) {
  if (!['android', 'ios', 'windows'].includes(platform)) throw new Error('Preflight platform must be android, ios or windows.');
  const expectedFormat = { android: ['apk', 'aab'], ios: ['ipa'], windows: ['zip'] };
  if (!expectedFormat[platform].includes(format)) throw new Error(`Preflight format '${format}' is invalid for ${platform}.`);
  if (platform === 'ios' && variant !== 'release') throw new Error('iOS preflight requires --release because IPA is a release package.');

  const project = detectProject(projectPath);
  const report = await doctorReport({ offline, projectPath: project.root });
  const checks = [];
  const add = (id, ok, detail, required = true) => checks.push({ id, ok: Boolean(ok), detail, required });

  const finish = (expectedCommand, modeLabel) => {
    const requiredFailures = checks.filter((item) => item.required && !item.ok);
    const codeFor = (id) => requiredFailures.some((item) => item.id === id);
    const cacheMissing = offline && requiredFailures.some((item) => ['pub-cache', 'flutter-sdk-artifacts', 'windows-flutter-artifacts', 'gradle-distribution-cache', 'system-gradle-offline', 'gradle-dependency-cache'].includes(item.id));
    const hostOrBuilderMissing = codeFor('project-detected') || codeFor('builder-supported') || codeFor('platform-host');
    const toolchainMissing = codeFor('flutter') || codeFor('java') || codeFor('android-sdk') || codeFor('android-sdk-platform') || codeFor('android-build-tools') || codeFor('visual-studio') || codeFor('windows-sdk') || codeFor('xcode');
    const result = {
      ready: requiredFailures.length === 0,
      project,
      platform,
      format,
      variant,
      mode: modeLabel,
      expectedCommand,
      host: report.host,
      checks,
      problems: requiredFailures.map((item) => `${item.id}: ${item.detail}`),
      exitCode: requiredFailures.length === 0 ? 0 : hostOrBuilderMissing ? 10 : cacheMissing ? 12 : toolchainMissing ? 11 : 11
    };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`\nPAXI preflight: ${project.name}\nFramework: ${project.framework}\nPlatform: ${platform} · ${format.toUpperCase()} · ${variant}\nBuild mode: ${result.mode}\n`);
      for (const item of checks) console.log(`${item.ok ? '✓' : item.required ? '✗' : '·'} ${item.id}: ${item.detail}`);
      console.log(`\nEnvironment status: ${result.ready ? 'READY' : 'NOT READY'}`);
      if (expectedCommand) console.log(`Expected command: ${expectedCommand}`);
    }
    return result;
  };

  add('project-detected', project.framework !== 'unknown', `${project.framework} · ${project.confidence} confidence · ${project.detectedBy}`);

  if (platform === 'windows') {
    const supported = project.framework === 'flutter';
    add('builder-supported', supported, supported ? 'PAXI Windows desktop builder: Flutter' : `Windows desktop builds currently require a Flutter project; detected ${project.framework}.`);
    add('platform-host', report.windows.hostSupported, report.windows.hostSupported ? 'Running on Windows' : 'Windows Flutter desktop builds must run on a Windows PC.');
    add('flutter', report.tools.flutter.available, report.tools.flutter.version || 'Flutter SDK not found');
    const runner = await existsFile(path.join(project.root, 'windows', 'CMakeLists.txt'));
    add('windows-runner', runner, runner ? 'Flutter windows/ runner CMake project found' : 'Flutter Windows runner missing. Run flutter create --platforms=windows . and review the generated files.');
    add('visual-studio', report.windows.visualStudioAvailable, report.windows.visualStudioAvailable ? `Visual Studio C++ Build Tools: ${report.windows.installationPath}` : report.windows.detail);
    add('windows-sdk', report.windows.windowsSdkAvailable, report.windows.windowsSdkAvailable ? 'Windows 10/11 SDK detected' : 'Install a Windows 10/11 SDK component through Visual Studio Installer.');
    if (offline && project.framework === 'flutter') {
      add('pub-cache', report.cache?.pub?.available, report.cache?.pub?.available ? `Pub cache: ${report.cache.pub.path}` : 'Pub cache is missing; run flutter pub get while online.', true);
      add('windows-flutter-artifacts', report.cache?.flutter?.windowsArtifactsCached, report.cache?.flutter?.windowsArtifactsCached ? 'Flutter Windows x64 engine artifacts are cached.' : 'Flutter Windows engine artifacts are missing; run flutter precache --windows while online.');
      const wrapper = report.cache?.gradleWrapper;
      add('gradle-wrapper-cache', Boolean(wrapper?.wrapperPresent && wrapper?.cached), wrapper?.wrapperPresent ? (wrapper.cached ? `Gradle ${wrapper.version} distribution is cached.` : wrapper.reason) : 'Flutter Android Gradle Wrapper is missing; warm the Windows Flutter project online first.');
      add('gradle-dependency-cache', report.cache?.gradleDependencies?.available, report.cache?.gradleDependencies?.available ? 'Gradle dependency cache directory is present; exact artifacts are validated by Gradle offline mode.' : 'Gradle dependency cache is missing; complete one successful online build first.');
    }
    if (report.host.disk) add('disk-space', report.host.disk.freeBytes > 1024 ** 3, `${(report.host.disk.freeBytes / 1024 ** 3).toFixed(2)} GiB available`);
    add('memory', report.host.freeMemoryBytes > 1024 ** 3, `${(report.host.freeMemoryBytes / 1024 ** 3).toFixed(2)} GiB free RAM`, false);
    const command = offline
      ? `flutter pub get --offline && (PAXI creates an offline GRADLE_USER_HOME/init script) flutter build windows ${variant === 'release' ? '--release' : '--debug'} --no-pub`
      : `flutter build windows ${variant === 'release' ? '--release' : '--debug'}`;
    return finish(command, offline ? 'offline Flutter Windows build' : 'local Flutter Windows build');
  }

  if (platform === 'ios') {
    const supported = ['flutter', 'xcode'].includes(project.framework);
    add('builder-supported', supported, supported ? `PAXI iOS builder: ${project.framework}` : `iOS packaging requires a Flutter or native Xcode project; detected ${project.framework}.`);
    add('platform-host', report.ios.hostSupported, report.ios.hostSupported ? 'Running on macOS' : 'iOS IPA builds require macOS with Xcode.');
    add('xcode', report.tools.xcodebuild.available, report.tools.xcodebuild.available ? 'xcodebuild is available' : 'Install Xcode and its command-line tools.');
    if (offline) add('ios-offline', false, 'Offline iOS builds are not enabled in this release; Xcode/Swift package resolution must be prepared on macOS.');
    if (report.host.disk) add('disk-space', report.host.disk.freeBytes > 1024 ** 3, `${(report.host.disk.freeBytes / 1024 ** 3).toFixed(2)} GiB available`);
    return finish(project.framework === 'flutter' ? 'flutter build ipa --release' : 'xcodebuild archive && xcodebuild -exportArchive', 'local macOS/Xcode IPA build');
  }

  const supported = project.framework === 'flutter' || project.framework === 'gradle';
  add('builder-supported', supported, supported ? `PAXI Android builder: ${project.framework}` : project.framework === 'expo' || project.framework === 'react-native' ? `${project.framework} is detection-only in this release. Use its native npm/Expo/Gradle workflow; PAXI does not claim to build it yet.` : `No supported Android builder for ${project.framework}.`);
  add('java', report.tools.java.available, report.tools.java.version || 'Java/JDK not found');
  if (project.framework === 'flutter') add('flutter', report.tools.flutter.available, report.tools.flutter.version || 'Flutter SDK not found');
  if (report.host.termux && ['flutter', 'gradle'].includes(project.framework)) add('termux-aapt2', report.android.aapt2.available, report.android.aapt2.path || 'Termux AAPT2 not found');
  let wrapperCache = null;
  if (['flutter', 'gradle'].includes(project.framework)) {
    const gradleRoot = project.framework === 'flutter' ? path.join(project.root, 'android') : project.root;
    wrapperCache = await inspectGradleWrapperCache(gradleRoot);
    const wrapperOrSystem = wrapperCache.wrapperPresent || report.tools.gradle.available;
    add('gradle-wrapper-or-system', wrapperOrSystem, wrapperCache.wrapperPresent ? `Project wrapper distribution ${wrapperCache.version || 'present'}` : report.tools.gradle.available ? 'No project wrapper; system Gradle is available' : 'No project wrapper or system Gradle found');
    if (offline && wrapperCache.wrapperPresent) add('gradle-distribution-cache', wrapperCache.cached, wrapperCache.cached ? `Gradle ${wrapperCache.version} cached` : wrapperCache.reason);
    else if (offline && !wrapperCache.wrapperPresent) add('system-gradle-offline', report.tools.gradle.available, report.tools.gradle.available ? 'System Gradle will be used in offline mode' : 'System Gradle is unavailable');
  }
  const cache = report.cache;
  if (project.framework === 'flutter') {
    add('pub-cache', cache.pub.available, cache.pub.available ? `Pub cache: ${cache.pub.path}` : 'Pub cache directory missing', offline);
    add('flutter-sdk-artifacts', cache.flutter.artifactsCached, cache.flutter.artifactsCached ? 'Flutter SDK cache directory present' : 'Flutter SDK artifact cache missing', offline);
  }
  if (offline && ['flutter', 'gradle'].includes(project.framework)) add('gradle-dependency-cache', cache.gradleDependencies.available, cache.gradleDependencies.available ? 'Gradle dependency cache directory present; exact modules are checked by the offline build' : 'Gradle dependency cache missing; warm dependencies with one successful online build.');
  if (report.host.disk) add('disk-space', report.host.disk.freeBytes > 1024 ** 3, `${(report.host.disk.freeBytes / 1024 ** 3).toFixed(2)} GiB available`);
  add('memory', report.host.freeMemoryBytes > 768 * 1024 ** 2, `${(report.host.freeMemoryBytes / 1024 ** 3).toFixed(2)} GiB free RAM`, false);
  if (project.framework === 'flutter' || project.framework === 'gradle') {
    const sdkRoot = report.android.sdk.path;
    add('android-sdk', report.android.sdk.available, report.android.sdk.available ? `Android SDK: ${sdkRoot}` : 'Android SDK directory is not configured or could not be found.');
    if (sdkRoot) {
      const appGradle = project.framework === 'flutter' ? path.join(project.root, 'android', 'app', 'build.gradle.kts') : path.join(project.root, 'app', 'build.gradle.kts');
      const groovyGradle = project.framework === 'flutter' ? path.join(project.root, 'android', 'app', 'build.gradle') : path.join(project.root, 'app', 'build.gradle');
      const source = await fs.readFile(appGradle, 'utf8').catch(() => fs.readFile(groovyGradle, 'utf8').catch(() => ''));
      const sdkMatch = source.match(/compileSdk(?:Version)?\s*(?:=\s*)?(\d{2,3})/);
      if (sdkMatch) {
        const platformPath = path.join(sdkRoot, 'platforms', `android-${sdkMatch[1]}`);
        add('android-sdk-platform', await existsDir(platformPath), `Android platform ${sdkMatch[1]} ${await existsDir(platformPath) ? 'installed' : `missing at ${platformPath}`}`);
      }
      add('android-build-tools', report.android.sdk.buildTools, report.android.sdk.buildTools ? 'Android build-tools directory present' : 'Android SDK build-tools directory missing', !report.host.termux);
    }
  }
  if (variant === 'release') {
    if (format === 'apk') {
      add('apk-signature-verifier', report.tools.apksigner.available, report.tools.apksigner.available ? 'apksigner is available' : 'apksigner is required for a verified APK release.');
      add('apk-package-verifier', report.android.aapt2.available, report.android.aapt2.available ? 'AAPT2 is available for package metadata checks' : 'AAPT2 is required for Android package metadata checks.');
    } else {
      add('aab-validator', report.tools.bundletool.available, report.tools.bundletool.available ? 'bundletool is available' : 'bundletool is required for a verified Android App Bundle.');
    }
    const hasSigningText = await fs.readFile(path.join(project.root, 'android', 'app', 'build.gradle'), 'utf8').catch(() => '') + await fs.readFile(path.join(project.root, 'android', 'app', 'build.gradle.kts'), 'utf8').catch(() => '');
    const hasSigning = /signingConfig|storeFile|keyAlias/.test(hasSigningText);
    add('release-signing', hasSigning, hasSigning ? 'Signing configuration markers found; PAXI does not inspect or validate key material.' : 'No signing configuration markers detected. Configure signing privately before distribution.');
    const hasKeystoreInProject = await containsSigningFile(project.root);
    add('keystore-location', !hasKeystoreInProject, hasKeystoreInProject ? 'Potential signing key file is inside the project tree. Move it outside the repository and use a private properties file/environment variable.' : 'No common keystore/certificate file found inside the project tree.', false);
  }
  const command = project.framework === 'flutter'
    ? offline
      ? `flutter pub get --offline && flutter build ${format === 'aab' ? 'appbundle' : 'apk'} ${variant === 'release' ? '--release' : '--debug'} --no-pub`
      : `flutter build ${format === 'aab' ? 'appbundle' : 'apk'} ${variant === 'release' ? '--release' : '--debug'}`
    : project.framework === 'gradle'
      ? `${wrapperCache?.wrapperScript ? (os.platform() === 'win32' ? 'gradlew.bat' : './gradlew') : 'gradle'} ${(format === 'aab' ? 'bundle' : 'assemble')}${variant === 'release' ? 'Release' : 'Debug'}${offline ? ' --offline' : ''}`
      : null;
  return finish(command, offline ? 'offline dependency resolution' : 'online-capable local build');
}

export async function setupGuide() {
  const report = await doctorReport();
  console.log('\nPAXI first-run setup\n');
  console.log(`Environment status: ${report.ready ? 'READY' : 'PARTIAL'}`);
  if (!report.host.supported) console.log(`This host platform (${os.platform()}) is not supported. Supported hosts: Windows, macOS, Linux and Termux/Android.`);
  console.log('PAXI does not silently install large SDKs or modify project files during setup.');
  if (!report.tools.java.available && os.platform() !== 'win32' && !report.ios.hostSupported) console.log('Java missing: Termux: pkg install openjdk-21  | Debian/Ubuntu: install a supported JDK 17 or 21.');
  if (os.platform() === 'win32') {
    console.log('Windows host: install Node.js 20+, Git for Windows, and a Windows-compatible Flutter SDK.');
    console.log('For Android builds, install a JDK and Android SDK. For Windows desktop builds, install Visual Studio with the Desktop development with C++ workload and a Windows SDK.');
    console.log('Run flutter doctor -v, then paxi doctor --json. PAXI does not download or install SDKs automatically.');
  }
  if (os.platform() === 'darwin') console.log('macOS host: install Xcode and accept its licence for iOS IPA builds; install JDK/Android SDK separately for Android builds.');
  if (!report.tools.flutter.available) console.log('Flutter missing: install a host-compatible Flutter SDK and confirm flutter is on PATH.');
  if (report.host.termux && !report.android.aapt2.available) console.log('Termux AAPT2 missing: pkg install aapt2');
  if (!report.tools.gradle.available) console.log(os.platform() === 'win32' ? 'System Gradle is optional when a complete project Gradle Wrapper is present.' : 'System Gradle fallback missing: Termux: pkg install gradle');
  if (report.windows.hostSupported && !report.windows.ready) console.log(`Windows desktop prerequisites: ${report.windows.detail}`);
  if (!report.android.sdk.available && !report.ios.hostSupported) console.log('Android SDK directory missing: configure ANDROID_HOME/ANDROID_SDK_ROOT or complete your host-specific Android SDK setup.');
  console.log('Next recommended command: paxi doctor --json');
  return report;
}

export async function environmentJson() {
  const report = await doctorReport();
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (date.getDate()) | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9);
  return { time, day };
}

function createZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.from(entry.data);
    const compressed = deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    const { time, day } = dosDateTime();
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); localHeader.writeUInt16LE(20, 4); localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8); localHeader.writeUInt16LE(time, 10); localHeader.writeUInt16LE(day, 12);
    localHeader.writeUInt32LE(crc, 14); localHeader.writeUInt32LE(compressed.length, 18); localHeader.writeUInt32LE(raw.length, 22); localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    local.push(localHeader, name, compressed);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); centralHeader.writeUInt16LE(20, 4); centralHeader.writeUInt16LE(20, 6); centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10); centralHeader.writeUInt16LE(time, 12); centralHeader.writeUInt16LE(day, 14);
    centralHeader.writeUInt32LE(crc, 16); centralHeader.writeUInt32LE(compressed.length, 20); centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(name.length, 28); centralHeader.writeUInt16LE(0, 30); centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34); centralHeader.writeUInt16LE(0, 36); centralHeader.writeUInt32LE(0, 38); centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralBuffer, end]);
}

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(api.?key|secret|password|token|private.?key|credential|keystore)/i.test(key)) output[key] = '[REDACTED]';
    else output[key] = stripSecrets(item);
  }
  return output;
}

export async function createSupportBundle({ projectPath = process.cwd(), outputPath = null } = {}) {
  const project = detectProject(projectPath);
  const dir = path.join(project.root, '.paxi', 'logs');
  const logs = await fs.readdir(dir).catch(() => []);
  const selected = [];
  for (const name of logs.filter((item) => item.endsWith('.log')).sort().slice(-5)) {
    const full = path.join(dir, name);
    const info = await fs.lstat(full).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) continue;
    const content = await fs.readFile(full).catch(() => Buffer.alloc(0));
    const excerpt = content.subarray(Math.max(0, content.length - 512 * 1024)).toString('utf8');
    selected.push({ name: `logs/${name}`, data: redactSensitiveText(excerpt).text });
  }
  const config = stripSecrets(await getStoredConfig());
  const report = await doctorReport({ projectPath: project.root });
  const history = stripSecrets((await getBuildHistory()).filter((entry) => entry.projectPath === project.root).slice(0, 10));
  const entries = [
    { name: 'support/environment.json', data: JSON.stringify(report, null, 2) },
    { name: 'support/project-detection.json', data: JSON.stringify(project, null, 2) },
    { name: 'support/paxi-config-sanitized.json', data: JSON.stringify(config, null, 2) },
    { name: 'support/build-history-sanitized.json', data: JSON.stringify(history, null, 2) },
    ...selected
  ];
  const target = path.resolve(outputPath || path.join(os.homedir(), `paxi-support-${Date.now()}.zip`));
  const archive = createZip(entries.map((entry) => ({ ...entry, data: Buffer.from(entry.data) })));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await fs.lstat(target).catch(() => null);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error(`Refusing to overwrite a non-regular support-bundle destination: ${target}`);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, archive, { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, target);
  console.log(`✓ Sanitized support bundle created: ${target}`);
  console.log('Included: environment, project markers, sanitized PAXI config/build history, and up to five recent logs.');
  console.log('Excluded: project source, signing keys, API keys, and credential files. Review the bundle before sharing; secret redaction is best-effort.');
  return target;
}
