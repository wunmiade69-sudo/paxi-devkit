import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { CONFIG_DIR } from '../lib/paths.mjs';
import { runProcess, commandExists } from '../lib/process.mjs';
import { redactSensitiveText } from '../lib/redact.mjs';
import { recordLabRun } from './lab-history.mjs';
import { listAndroidDevices } from './android-lab.mjs';

const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_JOURNEY_BYTES = 128 * 1024;
const MAX_STEPS = 100;
const MAX_TOTAL_WAIT_MS = 10 * 60 * 1000;
const MAX_TEXT_BYTES = 4096;
const KEY_CODES = Object.freeze({
  BACK: 4, ENTER: 66, TAB: 61, ESCAPE: 111, MENU: 82, DPAD_UP: 19,
  DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, DPAD_CENTER: 23,
  PAGE_UP: 92, PAGE_DOWN: 93, DELETE: 67
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeName = (value) => String(value || 'capture').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'capture';
const redactedError = (value) => redactSensitiveText(String(value || '')).text.slice(0, 1200);

async function adb(serial, args, { timeoutMs = 15000, maxOutputBytes = 256 * 1024 } = {}) {
  return runProcess('adb', ['-s', serial, ...args], { capture: true, tee: false, timeoutMs, maxOutputBytes });
}

function parseAttributes(source) {
  const result = {};
  const attrPattern = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  for (const match of source.matchAll(attrPattern)) result[match[1]] = match[2]
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return result;
}

function parseNodes(xml) {
  const nodes = [];
  for (const match of String(xml).matchAll(/<node\b([^>]*)\/?\s*>/g)) {
    const attrs = parseAttributes(match[1]);
    const bounds = attrs.bounds?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
    if (bounds) attrs._bounds = bounds.slice(1).map(Number);
    nodes.push(attrs);
  }
  return nodes;
}

function validateSelector(selector) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) throw new Error('A UI selector object is required.');
  const keys = ['resourceId', 'text', 'textContains', 'contentDescription'];
  const selected = keys.filter((key) => typeof selector[key] === 'string' && selector[key].length > 0);
  if (selected.length !== 1 || Object.keys(selector).some((key) => !keys.includes(key))) throw new Error('A selector must contain exactly one of resourceId, text, textContains or contentDescription.');
  const value = selector[selected[0]];
  if (value.length > 256 || /[\r\n\0]/.test(value)) throw new Error('Selector values must be at most 256 characters and contain no control characters.');
  return { key: selected[0], value };
}

function findNode(nodes, selector) {
  const { key, value } = validateSelector(selector);
  const attribute = ({ resourceId: 'resource-id', text: 'text', textContains: 'text', contentDescription: 'content-desc' })[key];
  return nodes.find((node) => key === 'textContains' ? String(node[attribute] || '').includes(value) : node[attribute] === value) || null;
}

function stateFingerprint(nodes) {
  const compact = nodes.map((node) => [node.class || '', node['resource-id'] || '', node.text || '', node['content-desc'] || '', node.bounds || '', node.clickable || '', node.focused || ''].join('\u001f')).join('\u001e');
  return createHash('sha256').update(compact).digest('hex');
}

function selectorSummary(selector) {
  const { key, value } = validateSelector(selector);
  return { by: key, value: key === 'text' || key === 'textContains' || key === 'contentDescription' ? '[not retained]' : value };
}

async function readHierarchy(serial) {
  const remote = `/sdcard/paxi-doctor-journey-${randomUUID()}.xml`;
  try {
    const dump = await adb(serial, ['shell', 'uiautomator', 'dump', remote], { timeoutMs: 25000, maxOutputBytes: 16 * 1024 });
    if (dump.code !== 0) throw new Error(redactedError(dump.stderr || dump.stdout || 'uiautomator dump failed'));
    const read = await adb(serial, ['shell', 'cat', remote], { timeoutMs: 10000, maxOutputBytes: 2 * 1024 * 1024 });
    if (read.code !== 0 || !read.stdout.includes('<hierarchy')) throw new Error('Android UI hierarchy was not available.');
    return parseNodes(read.stdout);
  } finally {
    await adb(serial, ['shell', 'rm', '-f', remote], { timeoutMs: 5000, maxOutputBytes: 1024 }).catch(() => {});
  }
}

function posixRemoteQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function capturePng(serial, destination, timeoutMs = 20000) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  return new Promise((resolve, reject) => {
    const child = spawn('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    const chunks = []; let size = 0; let stderr = ''; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('ADB screenshot timed out.')); }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 40 * 1024 * 1024) { child.kill('SIGKILL'); finish(new Error('Screenshot exceeded the 40 MiB safety limit.')); return; }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.once('error', (error) => finish(new Error(`Could not start ADB screenshot: ${error.message}`)));
    child.once('close', async (code) => {
      if (settled) return;
      const bytes = Buffer.concat(chunks);
      if (code !== 0 || bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') return finish(new Error(redactedError(stderr || 'ADB returned an invalid PNG screenshot.')));
      try {
        await fs.writeFile(destination, bytes, { mode: 0o600 });
        finish(null, { path: destination, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: createHash('sha256').update(bytes).digest('hex') });
      } catch (error) { finish(error); }
    });
  });
}

async function getForeground(serial, packageId) {
  const result = await adb(serial, ['shell', 'dumpsys', 'activity', 'activities'], { timeoutMs: 8000, maxOutputBytes: 256 * 1024 });
  if (result.code !== 0) return 'unknown';
  const lines = result.stdout.split(/\r?\n/).filter((line) => /mResumedActivity|topResumedActivity|ResumedActivity/i.test(line));
  if (!lines.length) return 'unknown';
  return lines.some((line) => line.includes(`${packageId}/`)) ? 'foreground' : 'background';
}

async function crashSignals(serial, packageId, baseline) {
  if (typeof baseline !== 'string') return { available: false, signals: [], note: 'The baseline logcat snapshot was unavailable, so new crash signals cannot be distinguished from older buffered logs.' };
  const result = await adb(serial, ['logcat', '-d', '-t', '5000', '-v', 'brief'], { timeoutMs: 12000, maxOutputBytes: 2 * 1024 * 1024 });
  if (result.code !== 0) return { available: false, signals: [], note: 'Logcat could not be read with the current device permissions.' };
  const baselineLines = new Set(String(baseline || '').split(/\r?\n/));
  const fresh = result.stdout.split(/\r?\n/).filter((line) => line && !baselineLines.has(line));
  const categories = [
    { code: 'java-crash', regex: /FATAL EXCEPTION|AndroidRuntime.*FATAL/i },
    { code: 'application-not-responding', regex: /ANR in\s+|Application Not Responding/i },
    { code: 'native-crash', regex: /Fatal signal \d+|DEBUG.*backtrace/i },
    { code: 'app-process-died', regex: new RegExp(`Process ${packageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*has died|Force finishing activity ${packageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') }
  ];
  const signals = categories.map((item) => ({ code: item.code, count: fresh.filter((line) => item.regex.test(line)).length })).filter((item) => item.count > 0);
  return { available: true, signals, scannedNewLines: fresh.length };
}

export function validateJourneyDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition) || definition.schemaVersion !== 1) throw new Error('Journey file must be a JSON object with schemaVersion: 1.');
  const name = typeof definition.name === 'string' ? definition.name.trim() : 'PAXI user journey';
  if (!name || name.length > 100 || /[\r\n\0]/.test(name)) throw new Error('Journey name must be 1–100 characters without control characters.');
  if (!Array.isArray(definition.steps) || !definition.steps.length || definition.steps.length > MAX_STEPS) throw new Error(`Journey must contain between 1 and ${MAX_STEPS} steps.`);
  const allowedTop = new Set(['schemaVersion', 'name', 'description', 'steps']);
  if (Object.keys(definition).some((key) => !allowedTop.has(key))) throw new Error('Journey file contains unsupported top-level fields.');
  let totalWait = 0;
  const steps = definition.steps.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step) || typeof step.type !== 'string') throw new Error(`Journey step ${index + 1} is invalid.`);
    const type = step.type;
    const schemas = {
      tap: ['type', 'x', 'y', 'selector'],
      swipe: ['type', 'from', 'to', 'durationMs'],
      type: ['type', 'valueEnv'],
      press: ['type', 'key'],
      wait: ['type', 'ms'],
      screenshot: ['type', 'name'],
      assertVisible: ['type', 'selector'],
      assertNotVisible: ['type', 'selector'],
      assertForeground: ['type']
    };
    if (!schemas[type]) throw new Error(`Journey step ${index + 1} uses unsupported action '${type}'.`);
    if (Object.keys(step).some((key) => !schemas[type].includes(key))) throw new Error(`Journey step ${index + 1} has unsupported fields.`);
    const normalized = { type };
    if (type === 'tap') {
      const hasCoords = Number.isInteger(step.x) && Number.isInteger(step.y);
      if (hasCoords && (step.x < 0 || step.y < 0)) throw new Error(`Journey step ${index + 1} tap coordinates must be non-negative.`);
      if (Boolean(step.selector) === hasCoords) throw new Error(`Journey step ${index + 1} tap must use either selector or integer x/y coordinates.`);
      if (step.selector) { validateSelector(step.selector); normalized.selector = step.selector; }
      else { normalized.x = step.x; normalized.y = step.y; }
    } else if (type === 'swipe') {
      const point = (value) => value && Number.isInteger(value.x) && Number.isInteger(value.y) && value.x >= 0 && value.y >= 0;
      if (!point(step.from) || !point(step.to) || !Number.isInteger(step.durationMs ?? 400) || (step.durationMs ?? 400) < 100 || (step.durationMs ?? 400) > 5000) throw new Error(`Journey step ${index + 1} swipe requires valid from/to points and durationMs between 100 and 5000.`);
      normalized.from = step.from; normalized.to = step.to; normalized.durationMs = step.durationMs ?? 400;
    } else if (type === 'type') {
      if (typeof step.valueEnv !== 'string' || !ENV_KEY.test(step.valueEnv) || !step.valueEnv.startsWith('PAXI_TEST_')) throw new Error(`Journey step ${index + 1} type action must use a PAXI_TEST_ environment variable through valueEnv.`);
      normalized.valueEnv = step.valueEnv;
    } else if (type === 'press') {
      if (!Object.hasOwn(KEY_CODES, step.key)) throw new Error(`Journey step ${index + 1} uses an unsupported key. Allowed: ${Object.keys(KEY_CODES).join(', ')}.`);
      normalized.key = step.key;
    } else if (type === 'wait') {
      if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 30000) throw new Error(`Journey step ${index + 1} wait must be between 0 and 30000 ms.`);
      normalized.ms = step.ms; totalWait += step.ms;
    } else if (type === 'screenshot') {
      normalized.name = safeName(step.name || `step-${index + 1}`);
    } else if (type === 'assertVisible' || type === 'assertNotVisible') {
      validateSelector(step.selector); normalized.selector = step.selector;
    }
    return normalized;
  });
  if (totalWait > MAX_TOTAL_WAIT_MS) throw new Error('Total explicit wait time cannot exceed 10 minutes.');
  return { schemaVersion: 1, name, description: typeof definition.description === 'string' ? definition.description.slice(0, 500) : '', steps };
}

export async function loadJourneyFile(filePath) {
  const resolved = path.resolve(filePath);
  const info = await fs.lstat(resolved).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_JOURNEY_BYTES) throw new Error('Journey file must be a regular non-symlink JSON file between 2 bytes and 128 KiB.');
  let definition;
  try { definition = JSON.parse(await fs.readFile(resolved, 'utf8')); }
  catch { throw new Error('Journey file is not valid JSON.'); }
  return validateJourneyDefinition(definition);
}

export async function runAndroidJourney({ filePath, packageId, deviceId = null, launch = false, outputDir = null, timeoutMs = 10 * 60 * 1000 } = {}) {
  if (!(await commandExists('adb'))) throw new Error('ADB was not found on PATH. Install Android platform-tools and authorize a device or emulator.');
  if (!PACKAGE_ID.test(String(packageId || ''))) throw new Error('A valid Android application ID is required with --package.');
  if (timeoutMs < 1000 || timeoutMs > 10 * 60 * 1000) throw new Error('Journey timeout must be between 1 and 600 seconds.');
  const journey = typeof filePath === 'string' ? await loadJourneyFile(filePath) : validateJourneyDefinition(filePath);
  for (const step of journey.steps) {
    if (step.type === 'type') {
      const value = process.env[step.valueEnv];
      if (typeof value !== 'string') throw new Error(`Required environment variable '${step.valueEnv}' is not set.`);
      if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Environment variable '${step.valueEnv}' must be at most 4096 bytes and contain no control characters.`);
    }
  }
  const listing = await listAndroidDevices();
  if (!listing.available) throw new Error(listing.message || listing.error || 'Could not list Android devices.');
  const ready = (listing.devices || []).filter((item) => item.state === 'device');
  const selected = deviceId ? ready.find((item) => item.serial === deviceId) : ready.length === 1 ? ready[0] : null;
  if (!selected) throw new Error(ready.length > 1 && !deviceId ? `Multiple devices found. Select one with --device: ${ready.map((item) => item.serial).join(', ')}.` : `No authorized device matches ${deviceId || 'the default selection'}.`);
  const installed = await adb(selected.serial, ['shell', 'pm', 'path', packageId], { timeoutMs: 8000, maxOutputBytes: 8192 });
  if (installed.code !== 0 || !installed.stdout.includes('package:')) throw new Error(`Package '${packageId}' is not installed on the selected device.`);
  const sizeResult = await adb(selected.serial, ['shell', 'wm', 'size'], { timeoutMs: 5000, maxOutputBytes: 4096 });
  const sizeMatch = sizeResult.stdout.match(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)?.at(-1)?.match(/(\d+)x(\d+)/);
  const screen = sizeMatch ? { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) } : null;
  if (!screen) throw new Error('Could not determine device display dimensions; coordinate actions cannot be safely bounded.');
  const modelResult = await adb(selected.serial, ['shell', 'getprop', 'ro.product.model'], { timeoutMs: 5000, maxOutputBytes: 4096 });
  const releaseResult = await adb(selected.serial, ['shell', 'getprop', 'ro.build.version.release'], { timeoutMs: 5000, maxOutputBytes: 4096 });
  const sdkResult = await adb(selected.serial, ['shell', 'getprop', 'ro.build.version.sdk'], { timeoutMs: 5000, maxOutputBytes: 4096 });
  const qemuResult = await adb(selected.serial, ['shell', 'getprop', 'ro.kernel.qemu'], { timeoutMs: 5000, maxOutputBytes: 4096 });
  const densityResult = await adb(selected.serial, ['shell', 'wm', 'density'], { timeoutMs: 5000, maxOutputBytes: 4096 });
  const densityMatch = densityResult.stdout.match(/(?:Physical|Override) density:\s*(\d+)/g)?.at(-1)?.match(/(\d+)/);
  const isEmulator = qemuResult.stdout.trim() === '1' || /^emulator-/i.test(selected.serial) || /emulator|sdk_gphone|generic/i.test(`${selected.details} ${modelResult.stdout}`);
  for (const [index, step] of journey.steps.entries()) {
    const points = step.type === 'tap' && !step.selector ? [{ x: step.x, y: step.y }] : step.type === 'swipe' ? [step.from, step.to] : [];
    if (points.some((point) => point.x >= screen.width || point.y >= screen.height)) throw new Error(`Journey step ${index + 1} contains coordinates outside the ${screen.width}x${screen.height} display.`);
  }

  const runId = randomUUID();
  const reportDir = outputDir ? path.resolve(outputDir) : path.join(CONFIG_DIR, 'doctor-reports', 'android-journeys', runId);
  await fs.mkdir(reportDir, { recursive: true, mode: 0o700 });
  const reportDirInfo = await fs.lstat(reportDir);
  if (!reportDirInfo.isDirectory() || reportDirInfo.isSymbolicLink()) throw new Error('Journey evidence destination must be a regular directory, not a symbolic link.');
  if ((await fs.readdir(reportDir)).length) throw new Error('Journey evidence destination must be empty to prevent overwriting existing files. Choose a new --output directory.');
  const baselineLog = await adb(selected.serial, ['logcat', '-d', '-t', '5000', '-v', 'brief'], { timeoutMs: 12000, maxOutputBytes: 2 * 1024 * 1024 });
  const baseline = baselineLog.code === 0 ? baselineLog.stdout : null;
  const startedAt = Date.now();
  const stepResults = [];
  const issues = [];
  let screenshots = [];
  let initialForeground = 'unknown';
  let finalForeground = 'unknown';
  let launchResult = null;
  let stoppedEarly = false;
  try {
    if (launch) {
      let resolved = await adb(selected.serial, ['shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', packageId], { timeoutMs: 10000, maxOutputBytes: 16 * 1024 });
      if (resolved.code !== 0 || !resolved.stdout.trim()) resolved = await adb(selected.serial, ['shell', 'pm', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', packageId], { timeoutMs: 10000, maxOutputBytes: 16 * 1024 });
      const component = resolved.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.includes('/')).at(-1) || '';
      if (resolved.code !== 0 || !component || !component.startsWith(`${packageId}/`) || !/^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(component)) {
        throw new Error(`Could not safely resolve a launcher activity for ${packageId}. Start the app manually, then rerun without --launch.`);
      }
      launchResult = await adb(selected.serial, ['shell', 'am', 'start', '-W', '-n', component], { timeoutMs: 20000, maxOutputBytes: 16 * 1024 });
      if (launchResult.code !== 0 || /Error:|Exception|unable to resolve/i.test(`${launchResult.stdout}\n${launchResult.stderr}`)) throw new Error(redactedError(launchResult.stderr || launchResult.stdout || `Could not launch ${packageId}.`));
      await delay(1200);
    }
    initialForeground = await getForeground(selected.serial, packageId);
    let priorUiFingerprint = null;
    try { priorUiFingerprint = stateFingerprint(await readHierarchy(selected.serial)); } catch {}
    let consecutiveUnchangedInteractions = 0;
    const startShot = await capturePng(selected.serial, path.join(reportDir, 'start.png'));
    screenshots.push({ stage: 'start', ...startShot });

    for (let index = 0; index < journey.steps.length; index += 1) {
      if (Date.now() - startedAt > timeoutMs) {
        issues.push({ code: 'journey-timeout', severity: 'error', message: 'The journey exceeded its overall timeout.' });
        stoppedEarly = true;
        break;
      }
      const step = journey.steps[index];
      const record = { index: index + 1, type: step.type, status: 'passed', durationMs: 0 };
      const stepStarted = Date.now();
      try {
        if (step.type === 'tap') {
          let x = step.x; let y = step.y;
          if (step.selector) {
            const node = findNode(await readHierarchy(selected.serial), step.selector);
            if (!node?._bounds) throw new Error('UI selector was not found or did not have clickable bounds.');
            const [left, top, right, bottom] = node._bounds;
            x = Math.floor((left + right) / 2); y = Math.floor((top + bottom) / 2);
            record.selector = selectorSummary(step.selector);
          }
          const result = await adb(selected.serial, ['shell', 'input', 'tap', String(x), String(y)], { timeoutMs: 8000, maxOutputBytes: 4096 });
          if (result.code !== 0) throw new Error(redactedError(result.stderr || 'ADB tap failed.'));
          record.target = { x, y };
        } else if (step.type === 'swipe') {
          const result = await adb(selected.serial, ['shell', 'input', 'swipe', String(step.from.x), String(step.from.y), String(step.to.x), String(step.to.y), String(step.durationMs)], { timeoutMs: 10000, maxOutputBytes: 4096 });
          if (result.code !== 0) throw new Error(redactedError(result.stderr || 'ADB swipe failed.'));
        } else if (step.type === 'type') {
          const value = process.env[step.valueEnv].replace(/ /g, '%s');
          const result = await adb(selected.serial, ['shell', `input text ${posixRemoteQuote(value)}`], { timeoutMs: 10000, maxOutputBytes: 4096 });
          if (result.code !== 0) throw new Error(redactedError(result.stderr || 'ADB text input failed.'));
          record.input = { source: 'environment-variable', variable: step.valueEnv, characters: [...process.env[step.valueEnv]].length, valueRecorded: false };
        } else if (step.type === 'press') {
          const result = await adb(selected.serial, ['shell', 'input', 'keyevent', String(KEY_CODES[step.key])], { timeoutMs: 8000, maxOutputBytes: 4096 });
          if (result.code !== 0) throw new Error(redactedError(result.stderr || `ADB key event ${step.key} failed.`));
          record.key = step.key;
        } else if (step.type === 'wait') await delay(step.ms);
        else if (step.type === 'screenshot') {
          const shot = await capturePng(selected.serial, path.join(reportDir, `${String(index + 1).padStart(3, '0')}-${step.name}.png`));
          screenshots.push({ stage: `step-${index + 1}`, ...shot });
          record.screenshot = shot.path;
        } else if (step.type === 'assertVisible' || step.type === 'assertNotVisible') {
          const node = findNode(await readHierarchy(selected.serial), step.selector);
          const expected = step.type === 'assertVisible';
          if (Boolean(node) !== expected) throw new Error(expected ? 'Expected UI element was not visible.' : 'UI element was visible when it was expected to be absent.');
          record.selector = selectorSummary(step.selector);
        } else if (step.type === 'assertForeground') {
          const foreground = await getForeground(selected.serial, packageId);
          record.foreground = foreground;
          if (foreground !== 'foreground') throw new Error(foreground === 'background' ? 'The target app is not the resumed foreground activity.' : 'Could not verify the resumed foreground activity.');
        }
        if (['tap', 'swipe', 'type', 'press'].includes(step.type)) {
          await delay(250);
          try {
            const nextFingerprint = stateFingerprint(await readHierarchy(selected.serial));
            if (priorUiFingerprint && nextFingerprint === priorUiFingerprint) consecutiveUnchangedInteractions += 1;
            else consecutiveUnchangedInteractions = 0;
            record.uiStateChanged = priorUiFingerprint ? nextFingerprint !== priorUiFingerprint : null;
            priorUiFingerprint = nextFingerprint;
            if (consecutiveUnchangedInteractions >= 3 && !issues.some((item) => item.code === 'possible-stuck-ui-state')) {
              issues.push({ code: 'possible-stuck-ui-state', severity: 'warning', step: index + 1, consecutiveUnchangedInteractions, message: 'The accessible UI hierarchy did not change after three consecutive interactions. This is a heuristic; the screen may still have changed visually.' });
            }
          } catch { record.uiStateChanged = null; }
        }
        record.foregroundAfter = await getForeground(selected.serial, packageId);
      } catch (error) {
        record.status = 'failed';
        record.error = redactedError(error instanceof Error ? error.message : String(error));
        issues.push({ code: `step-${step.type}-failed`, severity: 'error', step: index + 1, message: record.error });
        stoppedEarly = true;
      }
      record.durationMs = Date.now() - stepStarted;
      stepResults.push(record);
      if (stoppedEarly) break;
    }
    finalForeground = await getForeground(selected.serial, packageId);
    const finalShot = await capturePng(selected.serial, path.join(reportDir, 'final.png'));
    screenshots.push({ stage: 'final', ...finalShot });
  } catch (error) {
    issues.push({ code: 'journey-setup-failed', severity: 'error', message: redactedError(error instanceof Error ? error.message : String(error)) });
    stoppedEarly = true;
  }

  const crashes = await crashSignals(selected.serial, packageId, baseline);
  if (!crashes.available) issues.push({ code: 'crash-scan-unavailable', severity: 'warning', message: crashes.note || 'Crash scanning could not be verified for this run.' });
  for (const signal of crashes.signals) issues.push({ code: signal.code, severity: 'error', count: signal.count, message: `New ${signal.code} signal(s) were detected in logcat during this run.` });
  if (finalForeground === 'background' && !crashes.signals.some((item) => item.code.includes('crash') || item.code === 'app-process-died')) {
    issues.push({ code: 'app-left-foreground', severity: 'warning', message: 'The app was not the resumed foreground activity at the end of the journey.' });
  } else if (finalForeground === 'unknown') {
    issues.push({ code: 'foreground-check-unavailable', severity: 'warning', message: 'The final resumed foreground activity could not be verified.' });
  }
  const assertions = stepResults.filter((item) => item.type.startsWith('assert')).length;
  const failedSteps = stepResults.filter((item) => item.status === 'failed').length;
  const passedSteps = stepResults.filter((item) => item.status === 'passed').length;
  const journeyPassClaim = !stoppedEarly && failedSteps === 0 && assertions > 0 && crashes.available && !crashes.signals.length && issues.length === 0;
  const report = {
    schemaVersion: 1,
    runId,
    runner: 'adb-android-user-journey',
    executionKind: selected.serial.startsWith('emulator-') ? 'android-emulator' : 'physical-android-device',
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    journey: { name: journey.name, description: journey.description, stepCount: journey.steps.length, sourceFile: typeof filePath === 'string' ? path.basename(filePath) : null },
    app: { packageId, launchRequested: launch, launchExitCode: launchResult?.code ?? null, initialForeground, finalForeground },
    device: { serial: isEmulator ? selected.serial : `…${selected.serial.slice(-4)}`, model: modelResult.stdout.trim() || 'unknown', androidRelease: releaseResult.stdout.trim() || 'unknown', sdk: sdkResult.stdout.trim() || 'unknown', type: isEmulator ? 'emulator' : 'physical-device', resolution: screen, density: densityMatch ? Number(densityMatch[1]) : null },
    status: issues.some((item) => item.severity === 'error') ? 'failed' : issues.length ? 'review' : 'completed',
    journeyPassClaim,
    devicePassClaim: false,
    summary: { steps: journey.steps.length, executed: stepResults.length, passed: passedSteps, failed: failedSteps, assertions, issues: issues.length },
    steps: stepResults,
    issues,
    crashScan: crashes,
    evidence: { screenshots },
    reportDirectory: reportDir,
    limitations: [
      'A scripted journey validates only the actions and assertions that were explicitly defined. It is not a complete app certification or a security audit.',
      'UI selectors are resolved against Android UIAutomator hierarchy; custom canvas-rendered controls may not expose selectable nodes.',
      'Text entry is read from environment variables and the entered values are never saved in this report. Screenshots may still contain sensitive on-screen information.',
      'Crash scanning compares a bounded logcat snapshot before and after execution; some vendor logging or log rotation may hide events.',
      'Unchanged UI hierarchy after repeated interactions is a heuristic for a possible stuck state. It can miss visual-only changes and can flag intentionally static screens.'
    ]
  };
  const reportPath = path.join(reportDir, 'journey-report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  report.reportPath = reportPath;
  report.archivePath = await recordLabRun(report);
  return report;
}

export function journeyExample() {
  return {
    schemaVersion: 1,
    name: 'Example sign-in journey',
    description: 'Replace the resource IDs and environment variable with values from your own app.',
    steps: [
      { type: 'assertVisible', selector: { resourceId: 'com.example.app:id/sign_in' } },
      { type: 'tap', selector: { resourceId: 'com.example.app:id/email' } },
      { type: 'type', valueEnv: 'PAXI_TEST_EMAIL' },
      { type: 'tap', selector: { resourceId: 'com.example.app:id/password' } },
      { type: 'type', valueEnv: 'PAXI_TEST_PASSWORD' },
      { type: 'tap', selector: { text: 'Sign in' } },
      { type: 'wait', ms: 1200 },
      { type: 'assertVisible', selector: { resourceId: 'com.example.app:id/home_screen' } },
      { type: 'screenshot', name: 'signed-in-home' }
    ]
  };
}
