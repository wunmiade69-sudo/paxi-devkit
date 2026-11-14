import fs, { readFile } from 'node:fs/promises';
import path from 'node:path';
import { detectProject } from '../lib/project-detect.mjs';
import { runProcess, commandExists, sanitizedEnvironment } from '../lib/process.mjs';
import { getBuildHistory } from './build.mjs';
import { inspectArtifact } from '../lib/artifacts.mjs';
import { isTermuxEnvironment, getTermuxBuildEnvironment } from '../lib/termux.mjs';
import { inspectGradleWrapperCache } from '../lib/offline.mjs';
import { createGradleInvocation } from '../lib/gradle-invocation.mjs';
import { renderFailureAdvice } from '../lib/failure.mjs';

async function fsAccess(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function projectTest({ projectPath = process.cwd(), timeoutMs = 15 * 60 * 1000, offline = false } = {}) {
  const project = detectProject(projectPath);
  let command;
  let args;
  if (project.framework === 'flutter') {
    if (!(await commandExists('flutter'))) throw new Error('Flutter was not found on PATH.');
    command = 'flutter';
    if (offline) {
      const pub = await runProcess('flutter', ['pub', 'get', '--offline', '--no-precompile'], { cwd: project.root, env: sanitizedEnvironment(), capture: true, tee: true, timeoutMs: Math.min(timeoutMs, 5 * 60 * 1000), maxOutputBytes: 512 * 1024 });
      if (pub.code !== 0) throw new Error(`Offline cache missing or Flutter package resolution failed. flutter pub get --offline exited ${pub.code}.\n${renderFailureAdvice(`${pub.stderr}\n${pub.stdout}`)}`);
      args = ['test', '--no-pub'];
    } else args = ['test'];
  } else if (project.framework === 'gradle') {
    const androidApp = await Promise.all(['app/build.gradle', 'app/build.gradle.kts'].map((file) => fsAccess(path.join(project.root, file)))).then((values) => values.some(Boolean));
    const task = androidApp ? 'testDebugUnitTest' : 'test';
    if (offline) {
      const cache = await inspectGradleWrapperCache(project.root);
      if (cache.wrapperPresent && !cache.cached) throw new Error(`Offline cache missing: Gradle distribution ${cache.version || ''} is not cached. Run the project's Gradle Wrapper --version command while online, then retry --offline.`);
    }
    const invocation = await createGradleInvocation({ projectRoot: project.root, task, termux: isTermuxEnvironment(), offline });
    command = invocation.command;
    args = invocation.args;
  } else if (project.framework === 'javascript') {
    const npm = await commandExists('npm');
    if (!npm) throw new Error('npm was not found on PATH.');
    const packageFile = JSON.parse(await readFile(path.join(project.root, 'package.json'), 'utf8'));
    if (!packageFile?.scripts?.test) throw new Error('package.json does not define a test script.');
    command = 'npm';
    args = ['test'];
  } else if (['react-native', 'expo'].includes(project.framework)) {
    throw new Error(`${project.framework} was detected, but is detection-only in this release. Run its native npm/Expo workflow; PAXI does not claim to run these test workflows yet.`);
  } else {
    throw new Error(`Automated test command is not configured for '${project.framework}'. Supported projects: Flutter, Gradle Java/Kotlin, and Node.js.`);
  }
  console.log(`\nPAXI test: ${project.name} (${project.framework})\n`);
  const logFile = path.join(project.root, '.paxi', 'logs', `${Date.now()}-test.log`);
  const env = isTermuxEnvironment() ? await getTermuxBuildEnvironment() : sanitizedEnvironment();
  const result = await runProcess(command, args, { cwd: project.root, env, capture: true, tee: true, logFile, timeoutMs, maxOutputBytes: 1024 * 1024 });
  if (result.code !== 0) {
    const tail = `${result.stderr}\n${result.stdout}`.trim().split(/\r?\n/).slice(-30).join('\n');
    const reason = result.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} seconds` : result.cancelled ? 'was cancelled' : `failed (exit code ${result.code})`;
    throw new Error(`Project tests ${reason}. Full log: ${logFile}\n${tail}\n\n${renderFailureAdvice(tail)}`);
  }
  console.log('\n✓ Test command completed successfully.');
}

async function latestApk() {
  const history = await getBuildHistory();
  const entry = history.find((item) => item.status === 'succeeded' && item.platform === 'android' && item.format === 'apk' && item.artifact);
  if (!entry?.artifact) throw new Error('No successful APK build is recorded. Run paxi build --platform android --format apk first.');
  return entry;
}

export async function installApk(inputPath = null, { device = null, strict = false } = {}) {
  if (!(await commandExists('adb'))) throw new Error('Android Debug Bridge (adb) is not installed or not on PATH. Run paxi doctor.');
  const latest = inputPath ? null : await latestApk();
  const artifact = path.resolve(inputPath || latest.artifact);
  const info = await fs.lstat(artifact).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size === 0) throw new Error(`APK must be an existing, non-empty regular file: ${artifact}`);
  if (path.extname(artifact).toLowerCase() !== '.apk') throw new Error('Only APK files can be installed directly. AAB files must be distributed through a compatible app-store workflow.');
  const artifactReport = await inspectArtifact(artifact, { quiet: true, strict });
  if (strict && (!artifactReport.signed || !artifactReport.packageName || !artifactReport.installable)) throw new Error('Strict installation requires a verified APK signature and readable Android package metadata. Install apksigner and aapt2, then retry.');
  if (latest?.artifactSha256 && artifactReport.sha256 !== latest.artifactSha256) {
    throw new Error('The latest recorded APK has changed since its build. Its SHA-256 no longer matches build history; rebuild or pass a separately reviewed APK path.');
  }
  if (artifactReport.signature === 'verification failed') throw new Error('APK signature verification failed. Refusing to install this APK.');

  const devices = await runProcess('adb', ['devices'], { capture: true, env: sanitizedEnvironment(), timeoutMs: 15000 });
  if (devices.code !== 0) throw new Error('Could not query adb devices. Check USB debugging or wireless debugging and the adb server.');
  const available = devices.stdout.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state] = line.split(/\s+/, 3);
    return { serial, state };
  });
  const authorized = available.filter((item) => item.state === 'device');
  if (device && !authorized.some((item) => item.serial === device)) {
    const states = available.map((item) => `${item.serial} (${item.state})`).join(', ') || 'none';
    throw new Error(`Requested adb device '${device}' is not authorized/online. Available devices: ${states}`);
  }
  if (!device && authorized.length === 0) throw new Error('No authorized Android device is connected to adb. Enable USB debugging or pair wireless debugging, then run adb devices.');
  if (!device && authorized.length > 1) throw new Error(`Multiple Android devices are connected (${authorized.map((item) => item.serial).join(', ')}). Re-run with --device <serial>.`);
  const serial = device || authorized[0].serial;

  console.log(`Installing locally: ${artifact}`);
  const result = await runProcess('adb', ['-s', serial, 'install', '-r', artifact], { env: sanitizedEnvironment(), timeoutMs: 180000 });
  if (result.code !== 0) throw new Error(`adb install failed (exit code ${result.code}). Review the device output; PAXI did not upload the APK anywhere.`);
  console.log(`✓ APK installed on Android device ${serial}.`);
}

export async function listAndroidDevices() {
  if (!(await commandExists('adb'))) throw new Error('Android Debug Bridge (adb) is not installed or not on PATH.');
  const result = await runProcess('adb', ['devices', '-l'], { capture: true, env: sanitizedEnvironment(), timeoutMs: 15000 });
  if (result.code !== 0) throw new Error('Could not query adb devices.');
  const devices = result.stdout.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state, ...details] = line.split(/\s+/);
    return { serial, state, details: details.join(' ') };
  });
  console.log('\nAndroid devices\n');
  if (!devices.length) console.log('No devices found. Enable USB debugging or pair Android Wireless debugging.');
  for (const item of devices) console.log(`${item.state === 'device' ? '✓' : '·'} ${item.serial} — ${item.state}${item.details ? ` (${item.details})` : ''}`);
  return devices;
}

function parseTimeout(value, commandName) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`--timeout for ${commandName} must be an integer from 1 to 86400 seconds.`);
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error(`--timeout for ${commandName} must be an integer from 1 to 86400 seconds.`);
  return seconds * 1000;
}

export async function taskCommand(action, args = []) {
  if (action === 'test') {
    let projectPath = process.cwd();
    let timeoutMs = 15 * 60 * 1000;
    let offline = false;
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '--project' && args[index + 1] && !args[index + 1].startsWith('--')) projectPath = args[++index];
      else if (args[index] === '--timeout') timeoutMs = parseTimeout(args[++index], 'paxi test');
      else if (args[index] === '--offline') offline = true;
      else throw new Error('Usage: paxi test [--project <directory>] [--timeout <1..86400>] [--offline]');
    }
    return projectTest({ projectPath, timeoutMs, offline });
  }
  if (action === 'install') {
    let artifact = null;
    let device = null;
    let strict = false;
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '--device' && args[index + 1] && !args[index + 1].startsWith('--')) device = args[++index];
      else if (args[index] === '--strict') strict = true;
      else if (!args[index].startsWith('--') && !artifact) artifact = args[index];
      else throw new Error('Usage: paxi install [path/to/app.apk] [--device <serial>] [--strict]');
    }
    return installApk(artifact, { device, strict });
  }
  if (action === 'devices') return listAndroidDevices();
  throw new Error(`Unknown task command: ${action}`);
}
