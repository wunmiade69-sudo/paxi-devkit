import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v130-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config-home');

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii'); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  return Buffer.concat([length, typeBuffer, data, Buffer.alloc(4)]);
}
function makePng(width, height, color) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4); row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4; row.set(color(x, y), offset);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
async function makeProject(files) {
  const root = await fs.mkdtemp(path.join(temp, 'project-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content);
  }
  return root;
}
function mockPlaywright(image) {
  return { chromium: { launch: async () => ({
    newContext: async () => ({
      newPage: async () => ({
        on() {}, goto: async () => {}, addStyleTag: async () => {},
        evaluate: async (_fn, args) => args && Object.hasOwn(args, 'keyboard') ? {
          viewport: { innerWidth: 390, innerHeight: 844, documentWidth: 390, documentHeight: 844 }, horizontalOverflow: false,
          overflowingElements: [], titlePresent: true, viewportMetaPresent: true, imagesMissingAlt: 0, buttonsMissingName: 0,
          visibleInputCount: 0, keyboardApproximation: null, zoomApplied: null
        } : undefined,
        locator: () => ({ count: async () => 0 }),
        screenshot: async ({ path: destination }) => fs.writeFile(destination, image)
      }),
      setOffline: async () => {}, close: async () => {}
    }), close: async () => {}
  }) } };
}

test('PNG visual comparison measures changed pixels, bounds and configured tolerance', async () => {
  const { comparePngBuffers, decodePng } = await import('../src/doctor/visual-regression.mjs');
  const before = makePng(4, 3, () => [10, 20, 30, 255]);
  const after = makePng(4, 3, (x, y) => x === 2 && y === 1 ? [240, 20, 30, 255] : [10, 20, 30, 255]);
  assert.equal(decodePng(before).width, 4);
  const diff = comparePngBuffers(before, after, { pixelThreshold: 10, maxChangedPercent: 10 });
  assert.equal(diff.comparable, true);
  assert.equal(diff.changedPixels, 1);
  assert.equal(diff.changedPercent, 8.33333);
  assert.deepEqual(diff.changedBounds, { left: 2, top: 1, right: 2, bottom: 1, width: 1, height: 1 });
  assert.equal(diff.passed, true);
  assert.equal(comparePngBuffers(before, after, { pixelThreshold: 10, maxChangedPercent: 1 }).passed, false);
});

test('PNG visual comparison rejects unsupported, malformed and oversized images', async () => {
  const { comparePngBuffers, decodePng } = await import('../src/doctor/visual-regression.mjs');
  assert.throws(() => decodePng(Buffer.from('not png')), /valid PNG/);
  const source = makePng(2, 2, () => [1,2,3,255]);
  const bad = Buffer.from(source); bad[24] = 4;
  assert.throws(() => decodePng(bad), /Supported PNG format/);
  const otherSize = makePng(3, 2, () => [1,2,3,255]);
  assert.equal(comparePngBuffers(source, otherSize).comparable, false);
});

test('website Device Lab can create and compare explicit screenshot baselines', async () => {
  const { runWebsiteDeviceLab } = await import('../src/doctor/website-lab.mjs');
  const project = await makeProject({ 'package.json': '{"name":"baseline-test"}' });
  const baselineDir = path.join(temp, 'baselines');
  const firstImage = makePng(2, 2, () => [20, 40, 60, 255]);
  const first = await runWebsiteDeviceLab({ url: 'http://127.0.0.1:4173', projectRoot: project, profiles: ['compact'], outputDir: path.join(temp, 'web-first'), baselineDir, updateBaseline: true, confirmBaselineUpdate: true, playwrightModule: mockPlaywright(firstImage) });
  assert.equal(first.results[0].evidence.visualBaseline.status, 'updated');
  const same = await runWebsiteDeviceLab({ url: 'http://127.0.0.1:4173', projectRoot: project, profiles: ['compact'], outputDir: path.join(temp, 'web-same'), baselineDir, playwrightModule: mockPlaywright(firstImage) });
  assert.equal(same.results[0].evidence.visualComparison.passed, true);
  const changedImage = makePng(2, 2, (x) => x === 0 ? [255, 0, 0, 255] : [20, 40, 60, 255]);
  const changed = await runWebsiteDeviceLab({ url: 'http://127.0.0.1:4173', projectRoot: project, profiles: ['compact'], outputDir: path.join(temp, 'web-changed'), baselineDir, visualMaxChangedPercent: 1, playwrightModule: mockPlaywright(changedImage) });
  assert.equal(changed.results[0].status, 'failed');
  assert.ok(changed.results[0].issues.some((item) => item.code === 'visual-regression'));
});

test('website baseline replacement requires explicit confirmation and a baseline directory', async () => {
  const { runWebsiteDeviceLab } = await import('../src/doctor/website-lab.mjs');
  await assert.rejects(() => runWebsiteDeviceLab({ url: 'http://127.0.0.1:4173', updateBaseline: true }), /explicit --update-baseline --confirm/);
});

test('runtime probe is loopback-only by default and reports safe health labels only', async () => {
  const { probeRuntimeEndpoint, validateRuntimeProbeUrl } = await import('../src/doctor/runtime-probe.mjs');
  assert.throws(() => validateRuntimeProbeUrl('https://api.example.test/health'), /explicit --allow-remote/);
  assert.throws(() => validateRuntimeProbeUrl('http://127.0.0.1/health?token=secret'), /query parameters/);
  await assert.rejects(() => probeRuntimeEndpoint({ url: 'http://127.0.0.1/health', method: 'POST' }), /only GET or HEAD/);
  let sentHeaders;
  const result = await probeRuntimeEndpoint({
    url: 'http://127.0.0.1:8080/health',
    fetchImpl: async (_url, options) => {
      sentHeaders = options.headers;
      return new Response(JSON.stringify({ status: 'ok', dependencies: { database: { status: 'healthy', password: 'do-not-copy' }, cache: 'ready' } }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
  });
  assert.equal(result.healthy, true);
  assert.equal(result.applicationHealth, 'healthy');
  assert.deepEqual(result.dependencies, [{ name: 'database', status: 'healthy' }, { name: 'cache', status: 'ready' }]);
  assert.equal(result.bodyIncluded, false);
  assert.ok(sentHeaders['x-paxi-doctor-probe-id']);
  assert.equal(JSON.stringify(result).includes('do-not-copy'), false);
});

test('runtime probe requires explicit remote consent and never follows redirects', async () => {
  const { probeRuntimeEndpoint } = await import('../src/doctor/runtime-probe.mjs');
  const result = await probeRuntimeEndpoint({ url: 'https://api.example.test/health', allowRemote: true, fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response('', { status: 302, headers: { location: 'https://other.example.test/' } });
  } });
  assert.equal(result.healthy, false);
  assert.equal(result.redirectNotFollowed, true);
});

test('cross-language security scan redacts credential values and identifies risky patterns', async () => {
  const { scanProjectSecurity } = await import('../src/doctor/security-scan.mjs');
  const secret = 'sk-proj-THIS_IS_A_FAKE_BUT_LONG_TOKEN_VALUE_0123456789';
  const project = await makeProject({
    'src/app.js': `const apiKey = "${secret}";\neval(userInput);\nfetch(url, { rejectUnauthorized: false });\n`,
    'service.py': 'subprocess.run(command, shell=True)\n',
    'contracts/Wallet.sol': 'require(tx.origin == owner);\n',
    '.env.production': `SECRET=${secret}\n`,
    'node_modules/pkg/index.js': 'eval(foo);\n',
    'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' }, scripts: { postinstall: 'node install.js' } }),
    'package-lock.json': '{"lockfileVersion":3}'
  });
  const report = await scanProjectSecurity(project);
  const codes = report.findings.map((item) => item.code);
  assert.ok(codes.includes('provider-token-literal'));
  assert.ok(codes.includes('dynamic-eval'));
  assert.ok(codes.includes('tls-verification-disabled'));
  assert.ok(codes.includes('shell-true-subprocess'));
  assert.ok(codes.includes('solidity-tx-origin'));
  assert.ok(codes.includes('sensitive-file-present'));
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(report.dependencies.package.directDependencyCount, 1);
  assert.equal(report.dependencies.vulnerabilityDatabaseQueried, false);
  assert.equal(JSON.stringify(report).includes('node_modules/pkg'), false);
});

test('online npm audit cannot run without both explicit network and confirmation flags', async () => {
  const { runNpmDependencyAudit } = await import('../src/doctor/security-scan.mjs');
  const project = await makeProject({ 'package.json': '{"name":"audit-test"}', 'package-lock.json': '{"lockfileVersion":3}' });
  await assert.rejects(() => runNpmDependencyAudit({ projectPath: project, online: true, confirm: false, runner: async () => { throw new Error('must not execute'); } }), /pass --online --confirm/);
  await assert.rejects(() => runNpmDependencyAudit({ projectPath: project, online: false, confirm: true, runner: async () => { throw new Error('must not execute'); } }), /pass --online --confirm/);
  const report = await runNpmDependencyAudit({ projectPath: project, online: true, confirm: true, runner: async () => ({ code: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: { total: 0 } }, vulnerabilities: {} }) }) });
  assert.equal(report.registryContacted, true);
  assert.equal(report.summary.total, 0);
});

test('Android Device Lab launch resolves a launcher activity and avoids Monkey random-event launch', async () => {
  const bin = path.join(temp, 'adb-bin'); await fs.mkdir(bin, { recursive: true });
  const callsFile = path.join(temp, 'adb-calls.jsonl');
  const png = makePng(2, 2, () => [1, 2, 3, 255]).toString('base64');
  const script = `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.PAXI_ADB_CALLS,JSON.stringify(a)+'\\n');if(a[0]==='devices')process.stdout.write('List of devices attached\\nemulator-5554 device product:sdk\\n');else if(a.includes('exec-out'))process.stdout.write(Buffer.from('${png}','base64'));else if(a[0]==='-s'&&a[2]==='shell'){const c=a.slice(3).join(' ');if(c==='pm path com.example.app')process.stdout.write('package:/data/app/base.apk\\n');else if(c.startsWith('cmd package resolve-activity'))process.stdout.write('com.example.app/.MainActivity\\n');else if(c.startsWith('am start -W -n'))process.stdout.write('Status: ok\\n');else if(c==='getprop ro.product.model')process.stdout.write('Pixel Emulator\\n');else if(c==='getprop ro.build.version.release')process.stdout.write('15\\n');else if(c==='getprop ro.build.version.sdk')process.stdout.write('35\\n');else if(c==='getprop ro.kernel.qemu')process.stdout.write('1\\n');else if(c==='wm size')process.stdout.write('Physical size: 1080x2400\\n');else if(c==='wm density')process.stdout.write('Physical density: 420\\n');else if(c==='settings get system font_scale')process.stdout.write('1\\n');else if(c==='dumpsys uimode')process.stdout.write('Night mode: no\\n');else if(c==='dumpsys input_method')process.stdout.write('mInputShown=false\\n');else if(c==='dumpsys connectivity')process.stdout.write('CONNECTED\\n');else if(c==='dumpsys display')process.stdout.write('rotation=0\\n');else if(c.startsWith('uiautomator dump'))process.stdout.write('dumped\\n');else if(c.startsWith('cat '))process.stdout.write('<hierarchy/>');}\n`;
  const adb = path.join(bin, 'adb'); await fs.writeFile(adb, script, { mode: 0o755 });
  const originalPath = process.env.PATH; const originalCalls = process.env.PAXI_ADB_CALLS;
  process.env.PATH = `${bin}${path.delimiter}${originalPath || ''}`; process.env.PAXI_ADB_CALLS = callsFile;
  try {
    const { runAndroidDeviceLab } = await import('../src/doctor/android-lab.mjs');
    const report = await runAndroidDeviceLab({ packageId: 'com.example.app', deviceId: 'emulator-5554', launch: true, outputDir: path.join(temp, 'android-launch-report') });
    assert.equal(report.device.launchExitCode, 0);
    const calls = (await fs.readFile(callsFile, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(calls.some((args) => args.join(' ') === '-s emulator-5554 shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER com.example.app'));
    assert.ok(calls.some((args) => args.join(' ') === '-s emulator-5554 shell am start -W -n com.example.app/.MainActivity'));
    assert.equal(calls.some((args) => args.some((value) => value === 'monkey')), false);
  } finally {
    process.env.PATH = originalPath; if (originalCalls === undefined) delete process.env.PAXI_ADB_CALLS; else process.env.PAXI_ADB_CALLS = originalCalls;
  }
});

test.after(async () => { await fs.rm(temp, { recursive: true, force: true }); });

test('browser Device Lab history comparison includes pixel-level screenshot differences', async () => {
  const { recordLabRun, compareLabRuns } = await import('../src/doctor/lab-history.mjs');
  const beforeDir = path.join(temp, 'history-before'); const afterDir = path.join(temp, 'history-after');
  await fs.mkdir(beforeDir, { recursive: true }); await fs.mkdir(afterDir, { recursive: true });
  const beforeShot = path.join(beforeDir, 'shot.png'); const afterShot = path.join(afterDir, 'shot.png');
  await fs.writeFile(beforeShot, makePng(3, 3, () => [0, 0, 0, 255]));
  await fs.writeFile(afterShot, makePng(3, 3, (x, y) => x === 1 && y === 1 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const common = { runner: 'playwright-chromium', executionKind: 'simulated-browser-viewport', summary: { total: 1, passed: 1, failed: 0, review: 0 }, results: [{ id: 'standard-default-portrait-light', status: 'passed', issues: [] }] };
  await recordLabRun({ ...common, runId: 'visual-before', completedAt: new Date().toISOString(), reportDirectory: beforeDir, results: [{ ...common.results[0], evidence: { screenshot: beforeShot } }] });
  await recordLabRun({ ...common, runId: 'visual-after', completedAt: new Date().toISOString(), reportDirectory: afterDir, results: [{ ...common.results[0], evidence: { screenshot: afterShot } }] });
  const comparison = await compareLabRuns('visual-before', 'visual-after');
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.summary.visualComparisons, 1);
  assert.equal(comparison.summary.visualRegressions, 1);
  assert.equal(comparison.visualComparisons[0].changedPixels, 1);
});

test('website Device Lab records failed frontend API responses separately from transport failures', async () => {
  const { runWebsiteDeviceLab } = await import('../src/doctor/website-lab.mjs');
  const project = await makeProject({ 'index.html': '<title>api</title>' });
  const image = makePng(1, 1, () => [10, 10, 10, 255]);
  const playwright = { chromium: { launch: async () => ({
    newContext: async () => ({
      newPage: async () => {
        const handlers = new Map();
        return {
          on: (name, callback) => handlers.set(name, callback),
          goto: async () => handlers.get('response')?.({ status: () => 503, url: () => 'http://127.0.0.1:8080/api/health', request: () => ({ resourceType: () => 'fetch' }) }),
          addStyleTag: async () => {}, evaluate: async () => ({ viewport: { innerWidth: 390, innerHeight: 844, documentWidth: 390, documentHeight: 844 }, horizontalOverflow: false, overflowingElements: [], titlePresent: true, viewportMetaPresent: true, imagesMissingAlt: 0, buttonsMissingName: 0, visibleInputCount: 0 }),
          locator: () => ({ count: async () => 0 }), screenshot: async ({ path: destination }) => fs.writeFile(destination, image)
        };
      }, setOffline: async () => {}, close: async () => {}
    }), close: async () => {}
  }) } };
  const report = await runWebsiteDeviceLab({ url: 'http://127.0.0.1:4173', projectRoot: project, outputDir: path.join(temp, 'api-error-web'), playwrightModule: playwright });
  assert.ok(report.results[0].issues.some((item) => item.code === 'api-http-error'));
  assert.equal(report.results[0].evidence.httpErrors[0].status, 503);
});
