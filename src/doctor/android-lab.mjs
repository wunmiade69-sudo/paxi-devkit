import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR } from '../lib/paths.mjs';
import { recordLabRun } from './lab-history.mjs';
import { commandExists, runProcess } from '../lib/process.mjs';
import { DEVICE_CONDITIONS } from './device-lab.mjs';

const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const clip = (value, max = 8000) => String(value || '').slice(0, max);

async function adb(args, { timeoutMs = 12000, maxOutputBytes = 256 * 1024 } = {}) {
  return runProcess('adb', args, { capture: true, tee: false, timeoutMs, maxOutputBytes });
}

function parseDeviceList(output) {
  return String(output).split(/\r?\n/).slice(1).map((line) => {
    const match = line.trim().match(/^(\S+)\s+(device|unauthorized|offline)(?:\s+(.*))?$/);
    if (!match) return null;
    return { serial: match[1], state: match[2], details: match[3] || '' };
  }).filter(Boolean);
}

function parseResolution(value) {
  const matches = [...String(value).matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
  const match = matches.at(-1) || String(value).match(/(\d+)x(\d+)/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}
function parseDensity(value) {
  const matches = [...String(value).matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
  const match = matches.at(-1) || String(value).match(/density[^\d]*(\d+)/i);
  return match ? Number(match[1]) : null;
}
function parseOrientation(value) {
  const text = String(value || '');
  const named = text.match(/ROTATION_(0|90|180|270)/i);
  const numeric = text.match(/(?:mRotation|rotation)\s*[=:]\s*([0-3])(?:\D|$)/i);
  const degrees = named ? Number(named[1]) : numeric ? Number(numeric[1]) * 90 : null;
  if (degrees === null) return 'unknown';
  return degrees === 90 || degrees === 270 ? 'landscape-current' : 'portrait-current';
}
function displaySerial(serial, isEmulator) {
  if (isEmulator) return serial;
  const value = String(serial || '');
  return value.length > 4 ? `…${value.slice(-4)}` : 'redacted';
}

function classifyProfile(resolution, density) {
  if (!resolution || !density) return { id: 'unknown', confidence: 'not-determined' };
  const dpWidth = Math.round(Math.min(resolution.width, resolution.height) * 160 / density);
  if (dpWidth < 360) return { id: 'compact', confidence: 'viewport-heuristic', dpWidth };
  if (dpWidth >= 600) return { id: 'tablet', confidence: 'viewport-heuristic', dpWidth };
  if (dpWidth >= 412) return { id: 'large', confidence: 'viewport-heuristic', dpWidth };
  return { id: 'standard', confidence: 'viewport-heuristic', dpWidth };
}

async function captureScreenshot(serial, destination, timeoutMs = 20000) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  return new Promise((resolve, reject) => {
    const child = spawn('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    const chunks = [];
    let total = 0;
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('ADB screenshot capture timed out.'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      total += chunk.length;
      if (total > 40 * 1024 * 1024) {
        child.kill('SIGKILL');
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Screenshot exceeded the 40 MiB safety limit.')); }
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); reject(new Error(`Could not start adb screenshot: ${error.message}`));
    });
    child.once('close', async (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const bytes = Buffer.concat(chunks);
      if (code !== 0 || bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
        reject(new Error(stderr || 'ADB did not return a valid PNG screenshot.'));
        return;
      }
      try {
        await fs.writeFile(destination, bytes, { mode: 0o600 });
        resolve({ path: destination, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
      } catch (error) { reject(error); }
    });
  });
}

async function getProp(serial, key) {
  const result = await adb(['-s', serial, 'shell', 'getprop', key], { timeoutMs: 5000, maxOutputBytes: 4096 });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function captureHierarchy(serial, outputDir) {
  const remote = `/sdcard/paxi-doctor-${randomUUID()}.xml`;
  try {
    const dump = await adb(['-s', serial, 'shell', 'uiautomator', 'dump', remote], { timeoutMs: 25000, maxOutputBytes: 16 * 1024 });
    if (dump.code !== 0) return { captured: false, reason: dump.stderr || dump.stdout || 'uiautomator dump failed.' };
    const read = await adb(['-s', serial, 'shell', 'cat', remote], { timeoutMs: 10000, maxOutputBytes: 2 * 1024 * 1024 });
    if (read.code !== 0 || !read.stdout.includes('<hierarchy')) return { captured: false, reason: 'UI hierarchy output was unavailable.' };
    // Retain layout structure and bounds, but strip on-screen text and descriptions that may contain personal data.
    const sanitized = read.stdout.replace(/\s(?:text|content-desc)="[^"]*"/g, '');
    const destination = path.join(outputDir, 'ui-hierarchy-sanitized.xml');
    await fs.writeFile(destination, sanitized, { mode: 0o600 });
    return { captured: true, path: destination, bytes: Buffer.byteLength(sanitized), textAttributesRemoved: true };
  } finally {
    await adb(['-s', serial, 'shell', 'rm', '-f', remote], { timeoutMs: 5000, maxOutputBytes: 1024 }).catch(() => {});
  }
}

export async function runAndroidDeviceLab({ packageId = null, deviceId = null, launch = false, conditions = [], outputDir = null } = {}) {
  if (!(await commandExists('adb'))) throw new Error('ADB was not found on PATH. Install Android platform-tools and enable USB debugging or start an emulator.');
  if (packageId && !PACKAGE_ID.test(packageId)) throw new Error('Package ID must look like a valid Android application ID (for example com.example.app).');
  const selectedConditions = [...new Set(conditions)];
  const unknown = selectedConditions.filter((id) => !Object.hasOwn(DEVICE_CONDITIONS, id));
  if (unknown.length) throw new Error(`Unknown Device Lab condition(s): ${unknown.join(', ')}.`);
  if (launch && !packageId) throw new Error('--launch requires --package <application.id>.');
  const listing = await adb(['devices', '-l'], { timeoutMs: 10000, maxOutputBytes: 64 * 1024 });
  if (listing.code !== 0) throw new Error(listing.stderr || 'Could not list ADB devices.');
  const devices = parseDeviceList(listing.stdout);
  const ready = devices.filter((item) => item.state === 'device');
  if (!ready.length) throw new Error(`No authorized ADB device is connected. Detected: ${devices.map((item) => `${item.serial} (${item.state})`).join(', ') || 'none'}.`);
  let selected;
  if (deviceId) selected = ready.find((item) => item.serial === deviceId);
  else if (ready.length === 1) selected = ready[0];
  else throw new Error(`Multiple ADB devices are connected. Choose one with --device: ${ready.map((item) => item.serial).join(', ')}.`);
  if (!selected) throw new Error(`ADB device '${deviceId}' is not in an authorized state.`);

  const runId = randomUUID();
  const reportDir = outputDir ? path.resolve(outputDir) : path.join(CONFIG_DIR, 'doctor-reports', 'android-device-lab', runId);
  await fs.mkdir(reportDir, { recursive: true, mode: 0o700 });
  if (packageId) {
    const installed = await adb(['-s', selected.serial, 'shell', 'pm', 'path', packageId], { timeoutMs: 8000, maxOutputBytes: 8192 });
    if (installed.code !== 0 || !installed.stdout.includes('package:')) throw new Error(`Package '${packageId}' does not appear to be installed on ${selected.serial}.`);
  }
  let launchResult = null;
  if (launch) {
    let resolved = await adb(['-s', selected.serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', packageId], { timeoutMs: 10000, maxOutputBytes: 16 * 1024 });
    if (resolved.code !== 0 || !resolved.stdout.trim()) resolved = await adb(['-s', selected.serial, 'shell', 'pm', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', packageId], { timeoutMs: 10000, maxOutputBytes: 16 * 1024 });
    const component = resolved.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes('/')).at(-1) || '';
    if (resolved.code !== 0 || !component || !component.startsWith(`${packageId}/`) || !/^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(component)) {
      throw new Error(`Could not safely resolve a launcher activity for ${packageId}. Start the app manually, then rerun without --launch.`);
    }
    launchResult = await adb(['-s', selected.serial, 'shell', 'am', 'start', '-W', '-n', component], { timeoutMs: 20000, maxOutputBytes: 16 * 1024 });
    if (launchResult.code !== 0 || /Error:|Exception|unable to resolve/i.test(`${launchResult.stdout}\n${launchResult.stderr}`)) throw new Error(`Could not launch ${packageId}: ${launchResult.stderr || launchResult.stdout}`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  // Keep ADB requests sequential so many concurrent child-process listeners are not added on Android/Termux.
  const model = await getProp(selected.serial, 'ro.product.model');
  const release = await getProp(selected.serial, 'ro.build.version.release');
  const sdk = await getProp(selected.serial, 'ro.build.version.sdk');
  const qemu = await getProp(selected.serial, 'ro.kernel.qemu');
  const sizeRaw = await adb(['-s', selected.serial, 'shell', 'wm', 'size']);
  const densityRaw = await adb(['-s', selected.serial, 'shell', 'wm', 'density']);
  const fontScale = await adb(['-s', selected.serial, 'shell', 'settings', 'get', 'system', 'font_scale']);
  const nightMode = await adb(['-s', selected.serial, 'shell', 'dumpsys', 'uimode'], { timeoutMs: 8000 });
  const inputMethod = await adb(['-s', selected.serial, 'shell', 'dumpsys', 'input_method'], { timeoutMs: 8000 });
  const connectivity = await adb(['-s', selected.serial, 'shell', 'dumpsys', 'connectivity'], { timeoutMs: 8000, maxOutputBytes: 128 * 1024 });
  const display = await adb(['-s', selected.serial, 'shell', 'dumpsys', 'display'], { timeoutMs: 8000, maxOutputBytes: 64 * 1024 });
  const resolution = parseResolution(sizeRaw.stdout);
  const density = parseDensity(densityRaw.stdout);
  const profile = classifyProfile(resolution, density);
  const fontScaleText = fontScale.stdout.trim();
  const fontScaleValue = fontScaleText ? Number(fontScaleText) : Number.NaN;
  const darkMatch = `${nightMode.stdout}\n${nightMode.stderr}`.match(/Night mode:\s*(yes|no)|mNightMode\s*[=:]\s*(\w+)/i);
  const keyboardMatch = `${inputMethod.stdout}\n${inputMethod.stderr}`.match(/mInputShown\s*[=:]\s*(true|false)|mShowRequested\s*[=:]\s*(true|false)/i);
  const orientation = parseOrientation(display.stdout);
  const conditionsObserved = {};
  for (const condition of selectedConditions) {
    if (condition === 'font') conditionsObserved.font = { value: Number.isFinite(fontScaleValue) ? fontScaleValue : null, verified: Number.isFinite(fontScaleValue) };
    else if (condition === 'landscape') conditionsObserved.landscape = { currentDisplayOrientation: orientation, verified: orientation !== 'unknown', note: 'PAXI observes the current orientation; it does not rotate the device.' };
    else if (condition === 'dark') conditionsObserved.dark = { mode: darkMatch?.[1] || darkMatch?.[2] || 'unknown', verified: Boolean(darkMatch), note: 'PAXI observes the current system UI mode; it does not change the theme.' };
    else if (condition === 'keyboard') conditionsObserved.keyboard = { visible: keyboardMatch ? keyboardMatch[1] || keyboardMatch[2] : 'unknown', verified: Boolean(keyboardMatch), note: 'PAXI observes input-method state; it does not open or dismiss the keyboard.' };
    else if (condition === 'zoom') conditionsObserved.zoom = { displayDensity: density, verified: Number.isFinite(density), note: 'Display density is reported; PAXI does not change system display scaling.' };
    else if (condition === 'offline') {
      const connectionText = `${connectivity.stdout}\n${connectivity.stderr}`;
      const networkState = /(?:CONNECTED|VALIDATED)/i.test(connectionText) ? 'connected-indicator-found' : /(?:DISCONNECTED|NO NETWORK|NOT CONNECTED)/i.test(connectionText) ? 'disconnected-indicator-found' : 'unknown';
      conditionsObserved.offline = { networkState, verified: false, note: 'PAXI records a coarse connectivity indicator only; it does not change Wi-Fi/mobile radio state.' };
    }
  }
  const screenshot = await captureScreenshot(selected.serial, path.join(reportDir, 'device-screenshot.png'));
  const hierarchy = await captureHierarchy(selected.serial, reportDir);
  const isEmulator = qemu === '1' || /emulator|sdk_gphone|generic/i.test(`${selected.serial} ${selected.details} ${model || ''}`);
  const report = {
    schemaVersion: 1,
    runId,
    completedAt: new Date().toISOString(),
    runner: 'adb-device-lab',
    executionKind: isEmulator ? 'android-emulator' : 'physical-android-device',
    devicePassClaim: false,
    device: {
      serial: displaySerial(selected.serial, isEmulator),
      model: model || 'unknown',
      androidRelease: release || 'unknown',
      sdk: sdk || 'unknown',
      type: isEmulator ? 'emulator' : 'physical-device',
      adbDetails: selected.details,
      resolution,
      density,
      detectedProfile: profile,
      orientation,
      packageId,
      launchRequested: launch,
      launchExitCode: launchResult?.code ?? null
    },
    selectedConditions,
    conditionsObserved,
    evidence: { screenshot, hierarchy },
    reportDirectory: reportDir,
    limitations: [
      'This run captures the real connected Android device or emulator; it does not automatically alter system settings for selected conditions.',
      'Selected conditions are observational. Change font scale, orientation, theme, keyboard, display size or network state manually, then rerun to capture that state.',
      'The detected compact/standard/large/tablet class is a viewport heuristic, not a hardware model classification. Foldable hinge posture is not inferred.',
      'Screenshot evidence may contain private screen content. The UI hierarchy has text/content-description attributes stripped, but screenshots should still be reviewed before sharing.'
    ]
  };
  const reportPath = path.join(reportDir, 'report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  report.reportPath = reportPath;
  report.archivePath = await recordLabRun(report);
  return report;
}

export async function listAndroidDevices() {
  if (!(await commandExists('adb'))) return { available: false, devices: [], message: 'ADB not found on PATH.' };
  const result = await adb(['devices', '-l']);
  return { available: result.code === 0, devices: parseDeviceList(result.stdout), raw: clip(result.stdout, 12000), error: result.error || result.stderr || null };
}
