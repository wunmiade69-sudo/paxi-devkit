import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-doctor-expanded-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config-home');
const { buildWebsiteLabMatrix, validateWebsiteUrl, runWebsiteDeviceLab } = await import('../src/doctor/website-lab.mjs');
const { learnProjectConventions, forgetLearnedProject } = await import('../src/doctor/learning.mjs');
const { getDoctorProfile, setDoctorPreference, setDoctorLearningMode } = await import('../src/doctor/profile.mjs');
const { cppToolchainReport, runConfirmedCMakeBuild } = await import('../src/doctor/cpp-toolchain.mjs');
const { handleMcpMessage, MCP_TOOLS, MCP_PROTOCOL_VERSION, MCP_STATELESS_PROTOCOL_VERSION } = await import('../src/doctor/mcp-server.mjs');

async function makeProject(files) {
  const root = await fs.mkdtemp(path.join(temp, 'project-'));
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, value);
  }
  return root;
}

function mockPlaywright({ overflow = false } = {}) {
  return {
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => ({
            on() {},
            goto: async () => {},
            addStyleTag: async () => {},
            evaluate: async (_fn, args) => args && Object.hasOwn(args, 'keyboard') ? {
              viewport: { innerWidth: 390, innerHeight: 844, documentWidth: overflow ? 440 : 390, documentHeight: 844 },
              horizontalOverflow: overflow,
              overflowingElements: overflow ? [{ tag: 'div', right: 440, width: 500 }] : [],
              titlePresent: true, viewportMetaPresent: true, imagesMissingAlt: 0, buttonsMissingName: 0, visibleInputCount: 1,
              keyboardApproximation: null, zoomApplied: null
            } : undefined,
            locator: () => ({ count: async () => 0 }),
            screenshot: async ({ path: screenshotPath }) => fs.writeFile(screenshotPath, Buffer.from('fake-png'))
          }),
          setOffline: async () => {},
          close: async () => {}
        }),
        close: async () => {}
      })
    }
  };
}

test('website Device Lab expands foldable, landscape and theme combinations predictably', () => {
  const cases = buildWebsiteLabMatrix({ profiles: ['foldable', 'compact'], conditions: ['landscape', 'dark'] });
  assert.equal(cases.length, 12);
  assert.ok(cases.some((item) => item.profile === 'foldable' && item.variant === 'unfolded' && item.orientation === 'landscape' && item.colorScheme === 'dark'));
  assert.ok(cases.every((item) => item.viewport.width >= item.viewport.height ? item.orientation === 'landscape' : item.orientation === 'portrait'));
  assert.throws(() => buildWebsiteLabMatrix({ profiles: ['unknown'], conditions: [] }), /Choose at least one web profile/);
  assert.throws(() => buildWebsiteLabMatrix({ profiles: ['standard'], conditions: ['root'] }), /Unknown Device Lab condition/);
});

test('website target accepts only credential-free absolute HTTP(S) URLs', () => {
  assert.equal(validateWebsiteUrl('http://127.0.0.1:4173').hostname, '127.0.0.1');
  assert.equal(validateWebsiteUrl('https://example.com/page').protocol, 'https:');
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com', '/relative']) assert.throws(() => validateWebsiteUrl(value));
});

test('website Device Lab records screenshots and correctly labels simulated evidence', async () => {
  const project = await makeProject({ 'package.json': '{"name":"fixture"}' });
  const output = path.join(temp, 'web-report');
  const report = await runWebsiteDeviceLab({
    url: 'http://127.0.0.1:4173', projectRoot: project, profiles: ['compact', 'tablet'], conditions: ['dark'],
    outputDir: output, playwrightModule: mockPlaywright()
  });
  assert.equal(report.summary.total, 4);
  assert.equal(report.executionKind, 'simulated-browser-viewport');
  assert.equal(report.realDeviceTested, false);
  assert.equal(report.devicePassClaim, false);
  assert.ok(report.results.every((item) => item.evidence.executionKind === 'browser-viewport-simulation'));
  assert.ok(await fs.stat(report.reportPath));
  assert.ok(await fs.stat(report.results[0].evidence.screenshot));
});

test('website Device Lab turns horizontal overflow into an evidence-backed failure', async () => {
  const project = await makeProject({ 'index.html': '<title>test</title>' });
  const report = await runWebsiteDeviceLab({ url: 'https://example.com', projectRoot: project, outputDir: path.join(temp, 'overflow-report'), playwrightModule: mockPlaywright({ overflow: true }) });
  assert.equal(report.summary.failed, 1);
  assert.ok(report.results[0].issues.some((item) => item.code === 'horizontal-overflow'));
});

test('developer learning stores project convention summaries only after explicit command', async () => {
  const project = await makeProject({
    'package.json': JSON.stringify({ name: 'learn-me', dependencies: { react: '^19.0.0', vite: '^6.0.0', prettier: '^3.0.0', tailwindcss: '^4.0.0', vitest: '^3.0.0' } }),
    'pnpm-lock.yaml': 'lockfileVersion: 9.0',
    'src/App.jsx': "import React from 'react';\nexport default function App() {\n  const title = \"hello\";\n  return <h1>{title}</h1>;\n}\n",
    'src/theme.css': ':root { --brand-gold: #d5ae54; }\n'
  });
  const learned = await learnProjectConventions(project);
  assert.equal(learned.projectName, 'learn-me');
  assert.equal(learned.conventions.packageManager, 'pnpm');
  assert.ok(learned.conventions.formatters.includes('Prettier'));
  assert.ok(learned.conventions.uiTools.includes('Tailwind CSS'));
  assert.ok(learned.conventions.testTools.includes('Vitest'));
  assert.ok(learned.conventions.codeStyle.cssCustomPropertiesObserved >= 1);
  assert.equal(JSON.stringify(learned).includes('import React'), false, 'source text must not be stored');
  const profile = await getDoctorProfile();
  assert.equal(profile.learnedProjects.length, 1);
  const updated = await setDoctorPreference('guidance', 'concise');
  assert.equal(updated.learnedProjects.length, 1, 'preference changes must preserve learned project conventions');
  await setDoctorLearningMode('off');
  await assert.rejects(() => learnProjectConventions(project), /learning is disabled/);
  assert.equal(await forgetLearnedProject(project), true);
});

test('C++ preflight detects root build markers without executing build scripts', async () => {
  const project = await makeProject({ 'CMakeLists.txt': 'project(sample)', 'src/main.cpp': 'int main(){return 0;}' });
  const report = await cppToolchainReport(project, { runVersionChecks: false });
  assert.equal(report.executionKind, 'toolchain-preflight-only');
  assert.equal(report.buildExecuted, false);
  assert.equal(report.markers.cmake, true);
  assert.equal(report.buildDefinitionAvailable, true);
  assert.ok(report.tools.every((item) => item.available === null));
});

test('CMake build requires explicit confirmation before invoking project code', async () => {
  const project = await makeProject({ 'CMakeLists.txt': 'project(sample)' });
  await assert.rejects(() => runConfirmedCMakeBuild({ projectPath: project, confirm: false }), /executes project-controlled CMake configuration/);
});



test('CMake adapter refuses a build directory that is a symlink into the source tree', async (t) => {
  if (process.platform === 'win32') { t.skip('Directory symlink creation may require elevated Windows privileges.'); return; }
  const project = await makeProject({ 'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.16)\nproject(safe_path LANGUAGES CXX)\n' });
  const linkPath = path.join(temp, `build-link-${Date.now()}`);
  await fs.symlink(project, linkPath, 'dir');
  const { runConfirmedCMakeBuild } = await import('../src/doctor/cpp-toolchain.mjs');
  await assert.rejects(() => runConfirmedCMakeBuild({ projectPath: project, buildDir: linkPath, confirm: true }), /symbolic link|resolve outside/);
});
test('CMake adapter builds an explicitly confirmed local sample project when the toolchain exists', async (t) => {
  const { commandExists } = await import('../src/lib/process.mjs');
  if (!(await commandExists('cmake')) || !(await commandExists('c++') || await commandExists('g++') || await commandExists('clang++'))) { t.skip('CMake and a C++ compiler are required for this integration test.'); return; }
  const project = await makeProject({
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.16)\nproject(paxi_doctor_fixture LANGUAGES CXX)\nadd_executable(paxi_fixture main.cpp)\n',
    'main.cpp': '#include <iostream>\nint main() { std::cout << "paxi-ok\\n"; return 0; }\n'
  });
  const buildDir = path.join(temp, 'outside-cmake-build');
  const { runConfirmedCMakeBuild } = await import('../src/doctor/cpp-toolchain.mjs');
  const result = await runConfirmedCMakeBuild({ projectPath: project, buildDir, confirm: true, timeoutMs: 60000 });
  assert.equal(result.succeeded, true, `${result.configure.stderr}\n${result.build?.stderr || ''}`);
  assert.equal(result.testExecuted, false);
  assert.ok(await fs.stat(buildDir));
});
test('PAXI MCP exposes only the read-only Doctor tools and returns useful results', async () => {
  const init = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(init.result.serverInfo.name, 'paxi-devkit-doctor');
  const list = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((item) => item.name), MCP_TOOLS.map((item) => item.name));
  const plan = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'paxi_doctor_device_lab_plan', arguments: { profiles: ['compact', 'tablet'], conditions: ['font', 'offline'] } } });
  assert.equal(plan.result.structuredContent.planStatus, 'planned-not-executed');
  const forbidden = await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'execute_shell', arguments: { command: 'rm -rf' } } });
  assert.equal(forbidden.error.code, -32602);
  const notification = await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification, null);
  const discovery = await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MCP_STATELESS_PROTOCOL_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0' } } } });
  assert.deepEqual(discovery.result.supportedVersions, [MCP_STATELESS_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION]);
  assert.equal(discovery.result._meta['io.modelcontextprotocol/serverInfo'].version, '0.7.0');
  const statelessList = await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MCP_STATELESS_PROTOCOL_VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } } });
  assert.equal(statelessList.result.tools.length, MCP_TOOLS.length);
  assert.equal(statelessList.result._meta['io.modelcontextprotocol/serverInfo'].name, 'paxi-devkit-doctor');
  const unsupported = await handleMcpMessage({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01', 'io.modelcontextprotocol/clientCapabilities': {} } } });
  assert.equal(unsupported.error.code, -32022);
  assert.ok(unsupported.error.data.supported.includes(MCP_STATELESS_PROTOCOL_VERSION));
});


test('Device Lab stores protected report archives and compares browser runs', async () => {
  const { recordLabRun, compareLabRuns } = await import('../src/doctor/lab-history.mjs');
  const now = new Date().toISOString();
  const before = { runId: 'before-run', runner: 'playwright-chromium', executionKind: 'simulated-browser-viewport', completedAt: now, summary: { total: 1, passed: 0, failed: 1, review: 0 }, results: [{ id: 'compact-default-portrait-light', status: 'failed', issues: [{ code: 'horizontal-overflow' }] }] };
  const after = { runId: 'after-run', runner: 'playwright-chromium', executionKind: 'simulated-browser-viewport', completedAt: now, summary: { total: 1, passed: 1, failed: 0, review: 0 }, results: [{ id: 'compact-default-portrait-light', status: 'passed', issues: [] }] };
  await recordLabRun(before);
  await recordLabRun(after);
  const comparison = await compareLabRuns('before-run', 'after-run');
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.summary.improvedCases, 1);
  assert.deepEqual(comparison.cases[0].resolvedIssues, ['horizontal-overflow']);
  await assert.rejects(() => compareLabRuns('before-run', 'missing-run'), /not found/);
});
test.after(async () => { await fs.rm(temp, { recursive: true, force: true }); });

test('Android Device Lab captures emulator metadata and private-safe UI hierarchy with fake ADB', async () => {
  const bin = path.join(temp, 'fake-adb-bin');
  await fs.mkdir(bin, { recursive: true });
  const fakeAdb = path.join(bin, 'adb');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=';
  const source = `#!/usr/bin/env node\nconst a=process.argv.slice(2);\nif(a[0]==='devices') process.stdout.write('List of devices attached\\nemulator-5554 device product:sdk_gphone64_x86_64\\n');\nelse if(a.includes('exec-out')) process.stdout.write(Buffer.from('${png}','base64'));\nelse if(a[0]==='-s' && a[2]==='shell') { const c=a.slice(3).join(' '); if(c==='getprop ro.product.model') process.stdout.write('Pixel Emulator\\n'); else if(c==='getprop ro.build.version.release') process.stdout.write('15\\n'); else if(c==='getprop ro.build.version.sdk') process.stdout.write('35\\n'); else if(c==='getprop ro.kernel.qemu') process.stdout.write('1\\n'); else if(c==='wm size') process.stdout.write('Physical size: 1080x2400\\n'); else if(c==='wm density') process.stdout.write('Physical density: 420\\n'); else if(c==='settings get system font_scale') process.stdout.write('1.15\\n'); else if(c==='dumpsys uimode') process.stdout.write('Night mode: yes\\n'); else if(c==='dumpsys input_method') process.stdout.write('mInputShown=true\\n'); else if(c==='dumpsys connectivity') process.stdout.write('NetworkAgentInfo CONNECTED\\n'); else if(c==='dumpsys display') process.stdout.write('rotation=0\\n'); else if(c==='pm path com.example.app') process.stdout.write('package:/data/app/example/base.apk\\n'); else if(c.startsWith('uiautomator dump ')) process.stdout.write('UI hierchary dumped to: /sdcard/fake.xml\\n'); else if(c.startsWith('cat ')) process.stdout.write('<hierarchy><node text=\"Private user text\" content-desc=\"Personal description\" bounds=\"[0,0][100,100]\"/></hierarchy>'); }\n`;
  await fs.writeFile(fakeAdb, source, { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${originalPath || ''}`;
  try {
    const { runAndroidDeviceLab } = await import('../src/doctor/android-lab.mjs');
    const report = await runAndroidDeviceLab({ packageId: 'com.example.app', deviceId: 'emulator-5554', launch: false, conditions: ['font', 'landscape', 'dark', 'keyboard', 'offline'], outputDir: path.join(temp, 'android-report') });
    assert.equal(report.executionKind, 'android-emulator');
    assert.equal(report.device.type, 'emulator');
    assert.equal(report.device.model, 'Pixel Emulator');
    assert.equal(report.conditionsObserved.font.value, 1.15);
    assert.equal(report.device.orientation, 'portrait-current');
    assert.equal(report.conditionsObserved.landscape.currentDisplayOrientation, 'portrait-current');
    assert.equal(report.conditionsObserved.dark.mode, 'yes');
    assert.equal(report.conditionsObserved.keyboard.visible, 'true');
    assert.equal(report.conditionsObserved.offline.verified, false);
    assert.equal(report.evidence.hierarchy.textAttributesRemoved, true);
    const xml = await fs.readFile(report.evidence.hierarchy.path, 'utf8');
    assert.equal(xml.includes('Private user text'), false);
    assert.equal(xml.includes('Personal description'), false);
    assert.ok(await fs.stat(report.evidence.screenshot.path));
  } finally {
    process.env.PATH = originalPath;
  }
});

test('patch workflow enforces clean Git tree, explicit confirmation and optional test rerun', async () => {
  const { execFileSync } = await import('node:child_process');
  const project = await makeProject({
    'README.md': 'before\n',
    'package.json': JSON.stringify({ name: 'patch-fixture', scripts: { test: 'node -e "process.exit(0)"' } })
  });
  const git = (args) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
  git(['init']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'PAXI Test']);
  git(['add', '.']);
  git(['commit', '-m', 'baseline']);
  const patchFile = path.join(temp, 'readme.patch');
  await fs.writeFile(patchFile, 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-before\n+after\n');
  const { reviewPatch, applyReviewedPatch } = await import('../src/doctor/patch-workflow.mjs');
  const review = await reviewPatch({ projectPath: project, patchFile });
  assert.equal(review.patchChecksPassed, true);
  assert.equal(review.approvalRequired, true);
  assert.equal(review.approvalGranted, false);
  assert.equal(review.applied, false);
  await assert.rejects(() => applyReviewedPatch({ projectPath: project, patchFile, confirm: false }), /rerun with --confirm/);
  const applied = await applyReviewedPatch({ projectPath: project, patchFile, confirm: true, runTests: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.approvalGranted, true);
  assert.equal(applied.tests.executed, true);
  assert.equal(applied.tests.passed, true);
  assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), 'after\n');
});

test('patch workflow rejects a dirty repository before applying changes', async () => {
  const { execFileSync } = await import('node:child_process');
  const project = await makeProject({ 'README.md': 'before\n' });
  const git = (args) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
  git(['init']); git(['config', 'user.email', 'test@example.invalid']); git(['config', 'user.name', 'PAXI Test']); git(['add', '.']); git(['commit', '-m', 'baseline']);
  await fs.writeFile(path.join(project, 'untracked.txt'), 'untracked');
  const patchFile = path.join(temp, 'dirty.patch');
  await fs.writeFile(patchFile, 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-before\n+after\n');
  const { reviewPatch } = await import('../src/doctor/patch-workflow.mjs');
  await assert.rejects(() => reviewPatch({ projectPath: project, patchFile }), /clean Git working tree/);
});

test('Android journey definition validates safe bounded actions and env-only text input', async () => {
  const { validateJourneyDefinition } = await import('../src/doctor/android-journey.mjs');
  const journey = validateJourneyDefinition({
    schemaVersion: 1,
    name: 'Basic onboarding',
    steps: [
      { type: 'assertVisible', selector: { resourceId: 'com.example.app:id/start' } },
      { type: 'tap', selector: { text: 'Continue' } },
      { type: 'type', valueEnv: 'PAXI_TEST_EMAIL' },
      { type: 'wait', ms: 500 },
      { type: 'press', key: 'BACK' }
    ]
  });
  assert.equal(journey.steps.length, 5);
  assert.throws(() => validateJourneyDefinition({ schemaVersion: 1, steps: [{ type: 'type', text: 'plaintext-secret' }] }), /unsupported fields/);
  assert.throws(() => validateJourneyDefinition({ schemaVersion: 1, steps: [{ type: 'tap', x: -1, y: 20 }] }), /coordinates/);
  assert.throws(() => validateJourneyDefinition({ schemaVersion: 1, steps: [{ type: 'press', key: 'POWER' }] }), /unsupported key/);
  assert.throws(() => validateJourneyDefinition({ schemaVersion: 1, steps: [{ type: 'type', valueEnv: 'PAXI SECRET' }] }), /PAXI_TEST_/);
});

test('Android journey runner executes assertions/actions and never archives entered values', async () => {
  const bin = path.join(temp, 'journey-adb-bin');
  await fs.mkdir(bin, { recursive: true });
  const fakeAdb = path.join(bin, 'adb');
  const invocationFile = path.join(temp, 'journey-input-invocations.jsonl');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=';
  const script = `#!/usr/bin/env node
const fs=require('node:fs'); const nl=String.fromCharCode(10); const a=process.argv.slice(2);
const pos=a.indexOf('-s'); const cmd=pos>=0?a.slice(pos+2):a; fs.appendFileSync('${invocationFile}', JSON.stringify(cmd)+nl);
if(cmd[0]==='devices') process.stdout.write('List of devices attached\\nemulator-5554 device product:sdk_gphone64_x86_64\\n');
else if(cmd[0]==='exec-out') process.stdout.write(Buffer.from('${png}','base64'));
else if(cmd[0]==='shell') { const c=cmd.slice(1); const joined=c.join(' ');
 if(joined==='pm path com.example.app') process.stdout.write('package:/data/app/example/base.apk\\n');
 else if(joined==='wm size') process.stdout.write('Physical size: 1080x2400\\n');
 else if(joined.startsWith('uiautomator dump ')) process.stdout.write('UI hierchary dumped to: /sdcard/fake.xml\\n');
 else if(joined.startsWith('cat ')) process.stdout.write('<hierarchy><node resource-id="com.example.app:id/start" text="Welcome" bounds="[0,100][300,200]"/><node text="Continue" bounds="[100,300][500,400]"/></hierarchy>');
 else if(c[0]==='dumpsys' && c[1]==='activity') process.stdout.write('mResumedActivity: ActivityRecord{123 com.example.app/.MainActivity}\\n');
 else if(c[0]==='logcat') process.stdout.write('I/init: fake log line\\n');
}
`;
  await fs.writeFile(fakeAdb, script, { mode: 0o755 });
  const previousPath = process.env.PATH;
  const previousValue = process.env.PAXI_TEST_EMAIL;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  process.env.PAXI_TEST_EMAIL = 'private test@example.invalid';
  try {
    const { runAndroidJourney } = await import('../src/doctor/android-journey.mjs');
    const report = await runAndroidJourney({
      packageId: 'com.example.app',
      launch: false,
      outputDir: path.join(temp, 'journey-output'),
      filePath: {
        schemaVersion: 1,
        name: 'Smoke journey',
        steps: [
          { type: 'assertVisible', selector: { resourceId: 'com.example.app:id/start' } },
          { type: 'tap', selector: { text: 'Continue' } },
          { type: 'type', valueEnv: 'PAXI_TEST_EMAIL' },
          { type: 'assertForeground' },
          { type: 'screenshot', name: 'after-sign-in' }
        ]
      }
    });
    assert.equal(report.executionKind, 'android-emulator');
    assert.equal(report.summary.executed, 5);
    assert.equal(report.summary.failed, 0);
    assert.equal(report.journeyPassClaim, true);
    assert.equal(report.devicePassClaim, false);
    assert.equal(report.steps[2].input.valueRecorded, false);
    assert.equal(JSON.stringify(report).includes('private test@example.invalid'), false);
    const adbCalls = (await fs.readFile(invocationFile, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(adbCalls.some((args) => args.join(' ') === "shell input text 'private%stest@example.invalid'"));
    assert.ok(await fs.stat(path.join(temp, 'journey-output', 'start.png')));
    assert.ok(await fs.stat(path.join(temp, 'journey-output', 'final.png')));
    assert.ok(await fs.stat(report.reportPath));
    assert.ok(report.archivePath);
  } finally {
    process.env.PATH = previousPath;
    if (previousValue === undefined) delete process.env.PAXI_TEST_EMAIL;
    else process.env.PAXI_TEST_EMAIL = previousValue;
  }
});

test('Android journey stops on failed assertions and never claims a device pass', async () => {
  const bin = path.join(temp, 'journey-fail-adb-bin');
  await fs.mkdir(bin, { recursive: true });
  const fakeAdb = path.join(bin, 'adb');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=';
  const script = `#!/usr/bin/env node
const a=process.argv.slice(2); const p=a.indexOf('-s'); const c=p>=0?a.slice(p+2):a;
if(c[0]==='devices') process.stdout.write('List of devices attached\\nemulator-5554 device\\n');
else if(c[0]==='exec-out') process.stdout.write(Buffer.from('${png}','base64'));
else if(c[0]==='shell') { const j=c.slice(1).join(' '); if(j==='pm path com.example.app') process.stdout.write('package:/data/app/base.apk\\n'); else if(j==='wm size') process.stdout.write('Physical size: 400x800\\n'); else if(j.startsWith('uiautomator dump')) process.stdout.write('dumped\\n'); else if(j.startsWith('cat ')) process.stdout.write('<hierarchy><node resource-id="com.example.app:id/other" bounds="[0,0][10,10]"/></hierarchy>'); else if(c[1]==='dumpsys') process.stdout.write('mResumedActivity: com.example.app/.Main\\n'); else if(c[1]==='logcat') process.stdout.write('I/init: clean\\n'); }
`;
  await fs.writeFile(fakeAdb, script, { mode: 0o755 });
  const previousPath = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const { runAndroidJourney } = await import('../src/doctor/android-journey.mjs');
    const report = await runAndroidJourney({ packageId: 'com.example.app', outputDir: path.join(temp, 'journey-fail-output'), filePath: { schemaVersion: 1, steps: [ { type: 'assertVisible', selector: { resourceId: 'com.example.app:id/missing' } }, { type: 'press', key: 'BACK' } ] } });
    assert.equal(report.status, 'failed');
    assert.equal(report.summary.executed, 1);
    assert.equal(report.summary.failed, 1);
    assert.equal(report.journeyPassClaim, false);
    assert.equal(report.devicePassClaim, false);
  } finally { process.env.PATH = previousPath; }
});

test('Android journey reports repeated unchanged UI after three interactions as a review heuristic', async () => {
  const bin = path.join(temp, 'journey-stuck-adb-bin');
  await fs.mkdir(bin, { recursive: true });
  const fakeAdb = path.join(bin, 'adb');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=';
  const script = `#!/usr/bin/env node
const a=process.argv.slice(2); const p=a.indexOf('-s'); const c=p>=0?a.slice(p+2):a;
if(c[0]==='devices') process.stdout.write('List of devices attached\\nemulator-5554 device\\n');
else if(c[0]==='exec-out') process.stdout.write(Buffer.from('${png}','base64'));
else if(c[0]==='shell') { const j=c.slice(1).join(' '); if(j==='pm path com.example.app') process.stdout.write('package:/data/app/base.apk\\n'); else if(j==='wm size') process.stdout.write('Physical size: 400x800\\n'); else if(j.startsWith('uiautomator dump')) process.stdout.write('dumped\\n'); else if(j.startsWith('cat ')) process.stdout.write('<hierarchy><node resource-id="com.example.app:id/home" text="Home" bounds="[0,0][200,100]" clickable="true"/></hierarchy>'); else if(c[1]==='dumpsys' && c[2]==='activity') process.stdout.write('mResumedActivity: com.example.app/.Main\\n'); else if(c[1]==='logcat') process.stdout.write('I/init: clean\\n'); }
`;
  await fs.writeFile(fakeAdb, script, { mode: 0o755 });
  const previousPath = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const { runAndroidJourney } = await import('../src/doctor/android-journey.mjs');
    const report = await runAndroidJourney({ packageId: 'com.example.app', outputDir: path.join(temp, 'journey-stuck-output'), filePath: { schemaVersion: 1, steps: [ { type: 'tap', x: 20, y: 30 }, { type: 'tap', x: 20, y: 30 }, { type: 'tap', x: 20, y: 30 } ] } });
    assert.equal(report.status, 'review');
    assert.ok(report.issues.some((item) => item.code === 'possible-stuck-ui-state'));
    assert.equal(report.journeyPassClaim, false);
  } finally { process.env.PATH = previousPath; }
});

test('Android journey detects new Java crash signals without saving raw logcat lines', async () => {
  const bin = path.join(temp, 'journey-crash-adb-bin');
  await fs.mkdir(bin, { recursive: true });
  const fakeAdb = path.join(bin, 'adb');
  const stateFile = path.join(temp, 'journey-logcat-state');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=';
  const script = `#!/usr/bin/env node
const fs=require('node:fs'); const nl=String.fromCharCode(10); const a=process.argv.slice(2); const p=a.indexOf('-s'); const c=p>=0?a.slice(p+2):a;
if(c[0]==='devices') process.stdout.write('List of devices attached'+nl+'emulator-5554 device'+nl);
else if(c[0]==='exec-out') process.stdout.write(Buffer.from('${png}','base64'));
else if(c[0]==='logcat') { if(!fs.existsSync('${stateFile}')) { fs.writeFileSync('${stateFile}','1'); process.stdout.write('I/init: baseline'+nl); } else process.stdout.write('E/AndroidRuntime: FATAL EXCEPTION: main'+nl); }
else if(c[0]==='shell') { const j=c.slice(1).join(' '); if(j==='pm path com.example.app') process.stdout.write('package:/data/app/base.apk'+nl); else if(j==='wm size') process.stdout.write('Physical size: 400x800'+nl); else if(j.startsWith('uiautomator dump')) process.stdout.write('dumped'+nl); else if(j.startsWith('cat ')) process.stdout.write('<hierarchy><node resource-id="com.example.app:id/home" bounds="[0,0][200,100]"/></hierarchy>'); else if(c[1]==='dumpsys' && c[2]==='activity') process.stdout.write('mResumedActivity: com.example.app/.Main'+nl); }
`;
  await fs.writeFile(fakeAdb, script, { mode: 0o755 });
  const previousPath = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const { runAndroidJourney } = await import('../src/doctor/android-journey.mjs');
    const report = await runAndroidJourney({ packageId: 'com.example.app', outputDir: path.join(temp, 'journey-crash-output'), filePath: { schemaVersion: 1, steps: [{ type: 'wait', ms: 0 }] } });
    assert.equal(report.status, 'failed');
    assert.ok(report.issues.some((item) => item.code === 'java-crash'));
    const archived = await fs.readFile(report.reportPath, 'utf8');
    assert.equal(archived.includes('FATAL EXCEPTION'), false);
    assert.equal(report.crashScan.signals[0].code, 'java-crash');
  } finally { process.env.PATH = previousPath; }
});

test('Android journey launches the resolved activity directly without injecting random events', async () => {
  const bin = path.join(temp, 'journey-launch-adb-bin');
  await fs.mkdir(bin, { recursive: true });
  const fakeAdb = path.join(bin, 'adb');
  const invocationFile = path.join(temp, 'journey-launch-invocations.jsonl');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=';
  const script = `#!/usr/bin/env node
const fs=require('node:fs'); const nl=String.fromCharCode(10); const a=process.argv.slice(2); const p=a.indexOf('-s'); const c=p>=0?a.slice(p+2):a;
fs.appendFileSync('${invocationFile}', JSON.stringify(c)+nl);
if(c[0]==='devices') process.stdout.write('List of devices attached'+nl+'emulator-5554 device'+nl);
else if(c[0]==='exec-out') process.stdout.write(Buffer.from('${png}','base64'));
else if(c[0]==='logcat') process.stdout.write('I/init: clean'+nl);
else if(c[0]==='shell') { const j=c.slice(1).join(' '); if(j==='pm path com.example.app') process.stdout.write('package:/data/app/base.apk'+nl); else if(j==='wm size') process.stdout.write('Physical size: 400x800'+nl); else if(j==='cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER com.example.app') process.stdout.write('com.example.app/.MainActivity'+nl); else if(j.startsWith('uiautomator dump')) process.stdout.write('dumped'+nl); else if(j.startsWith('cat ')) process.stdout.write('<hierarchy><node resource-id=\"com.example.app:id/home\" bounds=\"[0,0][200,100]\"/></hierarchy>'); else if(c[1]==='dumpsys' && c[2]==='activity') process.stdout.write('mResumedActivity: com.example.app/.MainActivity'+nl); else if(c[1]==='am' && c[2]==='start') process.stdout.write('Status: ok'+nl); }
`;
  await fs.writeFile(fakeAdb, script, { mode: 0o755 });
  const previousPath = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const { runAndroidJourney } = await import('../src/doctor/android-journey.mjs');
    const report = await runAndroidJourney({ packageId: 'com.example.app', launch: true, outputDir: path.join(temp, 'journey-launch-output'), filePath: { schemaVersion: 1, steps: [{ type: 'assertForeground' }] } });
    assert.equal(report.app.launchExitCode, 0);
    const invocations = (await fs.readFile(invocationFile, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(invocations.some((args) => args.join(' ') === 'shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER com.example.app'));
    assert.ok(invocations.some((args) => args.join(' ') === 'shell am start -W -n com.example.app/.MainActivity'));
    assert.equal(invocations.some((args) => args[0] === 'shell' && args[1] === 'monkey'), false);
  } finally { process.env.PATH = previousPath; }
});
