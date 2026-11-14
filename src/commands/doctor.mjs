import fs from 'node:fs/promises';
import os from 'node:os';
import { commandExists, runProcess, sanitizedEnvironment } from '../lib/process.mjs';
import { getConfig } from '../lib/config.mjs';
import { isTermuxEnvironment, getTermuxPaths } from '../lib/termux.mjs';

const checks = [
  ['node', 'Node.js runtime'], ['git', 'Git'], ['java', 'Java runtime (Gradle/JDK)'],
  ['gradle', 'System Gradle fallback'], ['flutter', 'Flutter SDK'],
  ['adb', 'Android Debug Bridge'], ['aapt2', 'Android AAPT2 resource compiler'], ['sdkmanager', 'Android SDK manager (optional on Termux)'],
  ['apksigner', 'APK signature verifier (optional)'], ['bundletool', 'Android App Bundle validator (optional)'],
  ['llama-server', 'llama.cpp local model server'], ['gh', 'GitHub CLI (optional)']
];

async function directoryExists(value) {
  if (!value) return false;
  try { return (await fs.stat(value)).isDirectory(); } catch { return false; }
}

async function inspectJava() {
  if (!(await commandExists('java'))) return;
  const result = await runProcess('java', ['-version'], { capture: true, env: sanitizedEnvironment() });
  const firstLine = `${result.stderr || result.stdout}`.split(/\r?\n/).find(Boolean)?.trim();
  if (firstLine) console.log(`Java version: ${firstLine}`);
}

export async function doctor() {
  console.log('\nPAXI DevKit environment check\n');
  console.log(`OS: ${os.platform()} ${os.release()}`);
  console.log(`Architecture: ${os.arch()}`);
  console.log(`Node: ${process.version}`);
  console.log(`CPU cores: ${os.cpus().length || os.availableParallelism?.() || 'unknown'}`);
  console.log(`Free system memory: ${(os.freemem() / 1024 ** 3).toFixed(2)} GiB`);
  console.log(`JAVA_HOME: ${process.env.JAVA_HOME || '(not set)'}`);
  console.log(`ANDROID_HOME: ${process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '(not set)'}`);
  await inspectJava();
  console.log('');
  for (const [command, label] of checks) {
    const found = await commandExists(command);
    console.log(`${found ? '✓' : '·'} ${label}: ${found ? 'available' : 'not found'}`);
  }
  const dartFound = await commandExists('dart');
  const dartVmFound = !dartFound && await commandExists('dartvm');
  console.log(`${dartFound || dartVmFound ? '✓' : '·'} Dart SDK/runtime: ${dartFound ? 'dart available' : dartVmFound ? 'dartvm available (Termux Flutter runtime)' : 'not found'}`);

  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const sdkPresent = await directoryExists(sdkRoot);
  console.log(`${sdkPresent ? '✓' : '·'} Android SDK directory: ${sdkPresent ? sdkRoot : 'not configured or not found'}`);
  if (sdkPresent) {
    const platformTools = await directoryExists(`${sdkRoot}/platform-tools`);
    const buildTools = await directoryExists(`${sdkRoot}/build-tools`);
    const platforms = await directoryExists(`${sdkRoot}/platforms`);
    console.log(`${platformTools ? '✓' : '·'} SDK platform-tools directory: ${platformTools ? 'available' : 'missing'}`);
    console.log(`${buildTools ? '✓' : '·'} SDK build-tools directory: ${buildTools ? 'available' : 'missing'}`);
    console.log(`${platforms ? '✓' : '·'} Android platforms directory: ${platforms ? 'available' : 'missing'}`);
  }

  const isMac = process.platform === 'darwin';
  const xcodebuild = isMac && await commandExists('xcodebuild');
  console.log(`${xcodebuild ? '✓' : '·'} iOS build host: ${xcodebuild ? 'macOS + xcodebuild available; verify signing and SDKs' : 'requires macOS + Xcode; unavailable on this host'}`);
  const config = await getConfig();
  console.log(`AI mode: ${config.aiMode}`);
  if (config.aiMode === 'api') console.log(`Remote API key: ${process.env.PAXI_AI_API_KEY ? 'available via environment' : 'not set (PAXI_AI_API_KEY)'}`);
  else if (config.aiMode === 'local') console.log(`Local AI endpoint: ${config.aiLocalUrl}`);
  else console.log('AI requests: disabled');

  const termux = isTermuxEnvironment();
  if (termux) {
    const { flutterProjectConfig, flutterPostInstall, aapt2 } = getTermuxPaths();
    const projectConfigAvailable = await fs.access(flutterProjectConfig).then(() => true, () => false);
    const flutterAvailable = await commandExists('flutter');
    const aapt2Available = await fs.access(aapt2).then(() => true, () => false);
    const postInstallAvailable = await fs.access(flutterPostInstall).then(() => true, () => false);
    console.log('\nTermux ARM64 toolchain');
    console.log(`Termux prefix: ${process.env.PREFIX || '(not set)'}`);
    console.log(`Termux AAPT2: ${await fs.access(aapt2).then(() => aapt2, () => 'not found')}`);
    console.log(`Flutter project configuration: ${projectConfigAvailable ? 'vendor helper available' : flutterAvailable && aapt2Available ? 'PAXI built-in Termux configurator available (vendor helper not shipped)' : 'needs Flutter + Termux AAPT2'}`);
    console.log(`Flutter post-install helper: ${postInstallAvailable ? 'available' : 'not found'}`);
    if (await commandExists('dartvm')) {
      const dartVersion = await runProcess('dartvm', ['--version'], { capture: true, maxOutputBytes: 4096, env: sanitizedEnvironment() });
      const dartLine = `${dartVersion.stdout || dartVersion.stderr}`.split(/\r?\n/).find(Boolean);
      if (dartLine) console.log(`Dart VM: ${dartLine.trim()}`);
    }
    if (await commandExists('flutter')) {
      const version = await runProcess('flutter', ['--version'], { capture: true, maxOutputBytes: 16 * 1024, env: sanitizedEnvironment() });
      const firstLine = `${version.stdout || version.stderr}`.split(/\r?\n/).find((line) => /Flutter \d/.test(line));
      if (firstLine) console.log(`Flutter toolchain: ${firstLine.trim()}`);
    }
    if (!sdkPresent && !process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
      console.log('Android SDK: Flutter/Termux may resolve its SDK internally; run flutter doctor -v if Android tooling is still reported missing.');
    }
    console.log('Build tuning: PAXI targets arm64-v8a for Termux Flutter builds and limits Gradle workers to 2.');
  } else if (['arm64', 'aarch64'].includes(os.arch()) && os.platform() !== 'darwin') {
    console.log('\nARM64 note: Android host tools depend on the Linux distribution and installed SDK. Verify with a real local project build.');
  }
  if (os.totalmem() < 6 * 1024 ** 3) console.log('\nMemory note: this device has under 6 GiB RAM. Large Flutter/Gradle builds and local AI inference may compete for memory.');
  if (termux) console.log('\nTermux note: builds run locally. PAXI does not upload source code or fall back to a cloud builder.');
}
