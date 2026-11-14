import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { CONFIG_DIR } from '../lib/paths.mjs';
import { runProcess, commandExists } from '../lib/process.mjs';
import { listAndroidDevices } from './android-lab.mjs';
import { recordLabRun } from './lab-history.mjs';

const PACKAGE_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const ALLOWED_NAVIGATION = new Set(['home', 'dashboard', 'settings', 'profile', 'about', 'help', 'discover', 'activity', 'assets', 'me', 'menu']);
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function adb(serial, args, { timeoutMs = 15000, maxOutputBytes = 256 * 1024 } = {}) {
  return runProcess('adb', ['-s', serial, ...args], { capture: true, tee: false, timeoutMs, maxOutputBytes });
}

function sha(value) { return createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }
function displaySerial(serial, emulator) { return emulator ? serial : String(serial).length > 4 ? `…${String(serial).slice(-4)}` : 'redacted'; }

function attributes(source) {
  const result = {};
  for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    result[match[1]] = match[2].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  return result;
}

export function parseExplorationHierarchy(xml) {
  const nodes = [];
  for (const match of String(xml).matchAll(/<node\b([^>]*)\/?\s*>/g)) {
    const attrs = attributes(match[1]);
    const bounds = attrs.bounds?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
    if (bounds) attrs._bounds = bounds.slice(1).map(Number);
    nodes.push(attrs);
  }
  return nodes;
}

function nodeLabel(node) {
  const text = (node.text || '').trim();
  const description = (node['content-desc'] || '').trim();
  return text || description;
}

export function safeNavigationCandidates(nodes) {
  const candidates = [];
  const seen = new Set();
  for (const node of nodes) {
    if (node.clickable !== 'true' || node['visible-to-user'] === 'false' || !node._bounds) continue;
    const label = nodeLabel(node);
    const normalized = label.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (!ALLOWED_NAVIGATION.has(normalized)) continue;
    const [left, top, right, bottom] = node._bounds;
    if (right <= left || bottom <= top) continue;
    const resourceId = node['resource-id'] || '';
    const identity = `${normalized}|${resourceId}|${node.bounds}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    candidates.push({
      selector: resourceId ? { kind: 'resourceId', value: resourceId } : { kind: node.text?.trim() ? 'text' : 'contentDescription', value: label },
      labelHash: sha(normalized),
      resourceHash: resourceId ? sha(resourceId) : null,
      bounds: [left, top, right, bottom]
    });
  }
  return candidates;
}

function navigationSignature(nodes) {
  return safeNavigationCandidates(nodes).map((item) => `${item.labelHash}:${item.resourceHash || ''}:${item.bounds.join(',')}`).sort().join('|');
}

function screenSignature(nodes) {
  // Hash visible labels and structural attributes in memory; never persist raw UI text.
  const rows = nodes.map((node) => [node.class || '', node['resource-id'] ? sha(node['resource-id']) : '', node.text ? sha(node.text) : '', node['content-desc'] ? sha(node['content-desc']) : '', node.bounds || '', node.clickable || '', node.focused || ''].join(':')).sort();
  return sha(rows.join('|'));
}

function resolveCandidate(nodes, candidate) {
  return nodes.find((node) => {
    if (node.clickable !== 'true' || !node._bounds) return false;
    const [left, top, right, bottom] = node._bounds;
    if (left !== candidate.bounds[0] || top !== candidate.bounds[1] || right !== candidate.bounds[2] || bottom !== candidate.bounds[3]) return false;
    if (candidate.selector.kind === 'resourceId') return node['resource-id'] === candidate.selector.value;
    if (candidate.selector.kind === 'text') return node.text === candidate.selector.value;
    return node['content-desc'] === candidate.selector.value;
  }) || null;
}

async function readHierarchy(serial) {
  const remote = `/sdcard/paxi-explore-${randomUUID()}.xml`;
  try {
    const dump = await adb(serial, ['shell', 'uiautomator', 'dump', remote], { timeoutMs: 20000, maxOutputBytes: 16 * 1024 });
    if (dump.code !== 0) throw new Error('Android UI hierarchy dump failed.');
    const read = await adb(serial, ['shell', 'cat', remote], { timeoutMs: 10000, maxOutputBytes: 2 * 1024 * 1024 });
    if (read.code !== 0 || !read.stdout.includes('<hierarchy')) throw new Error('Android UI hierarchy was unavailable.');
    return parseExplorationHierarchy(read.stdout);
  } finally {
    await adb(serial, ['shell', 'rm', '-f', remote], { timeoutMs: 5000, maxOutputBytes: 1024 }).catch(() => {});
  }
}

async function screenshot(serial, target) {
  const bytes = await new Promise((resolve, reject) => {
    const child = spawn('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks = [];
    let total = 0;
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill('SIGKILL'); reject(new Error('Android exploration screenshot timed out.')); } }, 20000);
    child.stdout.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_SCREENSHOT_BYTES && !settled) { settled = true; clearTimeout(timer); child.kill('SIGKILL'); reject(new Error('Exploration screenshot exceeded the 20 MiB evidence limit.')); return; }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.once('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Could not start ADB screenshot: ${error.message}`)); } });
    child.once('close', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const image = Buffer.concat(chunks);
      if (code !== 0 || image.length < 24 || image.toString('hex', 0, 8) !== '89504e470d0a1a0a') return reject(new Error(stderr || 'ADB returned an invalid PNG screenshot.'));
      resolve(image);
    });
  });
  await fs.writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
  return { path: target, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function createReportDirectory(outputDir, runId) {
  const dir = outputDir ? path.resolve(outputDir) : path.join(CONFIG_DIR, 'doctor-reports', 'android-exploration', runId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Exploration evidence directory must be a real directory, not a symbolic link.');
  if ((await fs.readdir(dir)).length) throw new Error('Exploration evidence directory must be empty; choose a new --output location.');
  return dir;
}

export async function runAndroidSafeExploration({ packageId, deviceId = null, launch = false, confirm = false, maxActions = 5, outputDir = null } = {}) {
  if (!confirm) throw new Error('This exploration taps a small allowlist of navigation controls. Review the safety scope and pass --confirm to proceed.');
  if (!PACKAGE_ID.test(String(packageId || ''))) throw new Error('A valid Android package ID is required.');
  if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 8) throw new Error('Exploration --max-actions must be an integer between 1 and 8.');
  if (!(await commandExists('adb'))) throw new Error('ADB was not found on PATH. Install Android platform-tools and authorize a device or emulator.');
  const listing = await listAndroidDevices();
  if (!listing.available) throw new Error(listing.message || 'Could not list ADB devices.');
  const ready = (listing.devices || []).filter((device) => device.state === 'device');
  const selected = deviceId ? ready.find((device) => device.serial === deviceId) : ready.length === 1 ? ready[0] : null;
  if (!selected) throw new Error(ready.length > 1 && !deviceId ? `Multiple devices found. Specify --device: ${ready.map((device) => device.serial).join(', ')}.` : 'No matching authorized Android device is available.');
  const installed = await adb(selected.serial, ['shell', 'pm', 'path', packageId], { timeoutMs: 8000, maxOutputBytes: 8192 });
  if (installed.code !== 0 || !installed.stdout.includes('package:')) throw new Error(`Package '${packageId}' is not installed on the selected device.`);
  const qemu = await adb(selected.serial, ['shell', 'getprop', 'ro.kernel.qemu'], { timeoutMs: 5000, maxOutputBytes: 1024 });
  const modelResult = await adb(selected.serial, ['shell', 'getprop', 'ro.product.model'], { timeoutMs: 5000, maxOutputBytes: 4096 });
  const releaseResult = await adb(selected.serial, ['shell', 'getprop', 'ro.build.version.release'], { timeoutMs: 5000, maxOutputBytes: 4096 });
  const isEmulator = qemu.stdout.trim() === '1' || /^emulator-/i.test(selected.serial) || /emulator|sdk_gphone|generic/i.test(`${selected.details} ${modelResult.stdout}`);
  const runId = randomUUID();
  const reportDir = await createReportDirectory(outputDir, runId);
  const launchResult = launch ? await adb(selected.serial, ['shell', 'am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-p', packageId], { timeoutMs: 20000, maxOutputBytes: 16 * 1024 }) : null;
  if (launch && (launchResult.code !== 0 || /Error|Exception|unable to resolve/i.test(`${launchResult.stdout}\n${launchResult.stderr}`))) throw new Error(`Could not launch ${packageId} using its MAIN/LAUNCHER intent.`);
  if (launch) await wait(1200);

  const screenshots = [];
  let totalScreenshotBytes = 0;
  const captureEvidence = async (filename) => {
    const shot = await screenshot(selected.serial, path.join(reportDir, filename));
    totalScreenshotBytes += shot.bytes;
    if (totalScreenshotBytes > 50 * 1024 * 1024) {
      await fs.unlink(shot.path).catch(() => {});
      totalScreenshotBytes -= shot.bytes;
      throw new Error('Android exploration exceeded the 50 MiB total screenshot evidence limit.');
    }
    return shot;
  };
  const explored = [];
  const issues = [];
  let rootNodes;
  try {
    rootNodes = await readHierarchy(selected.serial);
    const rootNavSignature = navigationSignature(rootNodes);
    const rootScreenSignature = screenSignature(rootNodes);
    const rootShot = await captureEvidence('00-start.png');
    screenshots.push(rootShot);
    const candidates = safeNavigationCandidates(rootNodes).slice(0, maxActions);
    let returnedToRoot = true;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const currentNodes = await readHierarchy(selected.serial);
      const node = resolveCandidate(currentNodes, candidate);
      if (!node) {
        explored.push({ index: index + 1, labelHash: candidate.labelHash, outcome: 'control-no-longer-present', screenChanged: false });
        continue;
      }
      const [left, top, right, bottom] = node._bounds;
      const x = Math.floor((left + right) / 2);
      const y = Math.floor((top + bottom) / 2);
      if (x < 0 || y < 0 || right <= left || bottom <= top) {
        explored.push({ index: index + 1, labelHash: candidate.labelHash, outcome: 'invalid-bounds', screenChanged: false });
        continue;
      }
      const tap = await adb(selected.serial, ['shell', 'input', 'tap', String(x), String(y)], { timeoutMs: 5000, maxOutputBytes: 2048 });
      if (tap.code !== 0) {
        explored.push({ index: index + 1, labelHash: candidate.labelHash, outcome: 'tap-failed', screenChanged: false });
        issues.push({ code: 'navigation-tap-failed', severity: 'warning' });
        continue;
      }
      await wait(900);
      let afterNodes;
      try { afterNodes = await readHierarchy(selected.serial); }
      catch {
        explored.push({ index: index + 1, labelHash: candidate.labelHash, outcome: 'post-tap-hierarchy-unavailable', screenChanged: null });
        issues.push({ code: 'post-tap-hierarchy-unavailable', severity: 'warning' });
        // Do not issue Back blindly when the screen state is unknown; that could exit the app.
        returnedToRoot = false;
        break;
      }
      const afterSignature = screenSignature(afterNodes);
      const changed = afterSignature !== rootScreenSignature;
      let screenshotCaptured = null;
      if (changed) {
        try {
          const screenIndex = screenshots.length;
          const shot = await captureEvidence(`${String(screenIndex).padStart(2, '0')}-screen-${candidate.labelHash}.png`);
          screenshots.push(shot);
          screenshotCaptured = true;
        } catch (error) {
          screenshotCaptured = false;
          issues.push({ code: 'screenshot-capture-failed', severity: 'warning', message: String(error.message || error).slice(0, 300) });
        }
      }
      explored.push({ index: index + 1, labelHash: candidate.labelHash, outcome: changed ? 'new-screen-state-observed' : 'no-screen-change-observed', screenChanged: changed, screenshotCaptured, afterStateHash: afterSignature });
      if (!changed) continue;
      // Once a navigation transition is positively observed, always attempt to return before moving on.
      const back = await adb(selected.serial, ['shell', 'input', 'keyevent', '4'], { timeoutMs: 5000, maxOutputBytes: 2048 });
      if (back.code !== 0) {
        issues.push({ code: 'back-navigation-failed', severity: 'warning' });
        returnedToRoot = false;
        break;
      }
      await wait(650);
      let restoredNodes;
      try { restoredNodes = await readHierarchy(selected.serial); }
      catch {
        issues.push({ code: 'root-state-not-verifiable', severity: 'warning' });
        returnedToRoot = false;
        break;
      }
      if (screenSignature(restoredNodes) !== rootScreenSignature || navigationSignature(restoredNodes) !== rootNavSignature) {
        issues.push({ code: 'root-state-not-restored', severity: 'warning' });
        returnedToRoot = false;
        break;
      }
      if (screenshotCaptured === false) break;
    }
    if (rootNavSignature && candidates.length < safeNavigationCandidates(rootNodes).length) issues.push({ code: 'navigation-candidate-limit-reached', severity: 'info' });
    if (!candidates.length) issues.push({ code: 'no-allowlisted-navigation-controls', severity: 'info' });
    if (!returnedToRoot) issues.push({ code: 'exploration-stopped-to-preserve-state', severity: 'warning' });
  } catch (error) {
    issues.push({ code: 'exploration-setup-or-capture-failed', severity: 'error', message: String(error.message || error).slice(0, 500) });
  }

  const report = {
    schemaVersion: 1,
    runId,
    completedAt: new Date().toISOString(),
    runner: 'android-safe-navigation-exploration',
    executionKind: isEmulator ? 'android-emulator' : 'physical-android-device',
    exploratoryPassClaim: false,
    device: {
      serial: displaySerial(selected.serial, isEmulator),
      model: modelResult.stdout.trim() || 'unknown',
      androidRelease: releaseResult.stdout.trim() || 'unknown',
      type: isEmulator ? 'emulator' : 'physical-device'
    },
    targetPackage: packageId,
    launchRequested: launch,
    safetyScope: {
      actions: ['tap-center-of-allowlisted-navigation-control', 'press-Android-back-to-return-to-observed-root'],
      allowlistedLabels: [...ALLOWED_NAVIGATION],
      maxActions,
      maximumScreenshotEvidenceBytes: 50 * 1024 * 1024,
      noTextEntry: true,
      noUnknownControls: true,
      noPurchasesTransfersSubmissionsPermissionsOrDestructiveActions: true
    },
    summary: { navigationCandidates: explored.length, screensCaptured: screenshots.length, changedScreens: explored.filter((item) => item.screenChanged === true).length, issues: issues.length },
    explored: explored.map(({ index, labelHash, outcome, screenChanged, screenshotCaptured, afterStateHash }) => ({ index, labelHash, outcome, screenChanged, screenshotCaptured: screenshotCaptured ?? null, afterStateHash: afterStateHash || null })),
    issues,
    evidence: { screenshots },
    reportDirectory: reportDir,
    limitations: [
      'Exploration is intentionally shallow: it tests allowlisted navigation controls visible on the starting screen, then returns with Android Back.',
      'Only exact allowlisted navigation labels are tapped. Unknown controls and all data-changing actions are ignored.',
      'A screenshot is visual evidence, not proof that the screen is correct or accessible. No AI visual interpretation is performed by this runner.',
      'The report never claims complete app coverage or a device pass. UI screenshots may contain private information; review before sharing.'
    ]
  };
  const reportPath = path.join(reportDir, 'exploration-report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  report.reportPath = reportPath;
  report.archivePath = await recordLabRun(report);
  return report;
}
