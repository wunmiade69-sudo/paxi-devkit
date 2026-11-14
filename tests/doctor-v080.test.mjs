import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-doctor-v080-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'config-home');

const { draftJourneyFromGoal, writeJourneyDraft } = await import('../src/doctor/journey-draft.mjs');
const { parseExplorationHierarchy, safeNavigationCandidates, runAndroidSafeExploration } = await import('../src/doctor/android-explore.mjs');
const { analyzeScreenshot } = await import('../src/doctor/vision.mjs');

test('plain-language journey draft creates validated, review-required navigation actions', () => {
  const result = draftJourneyFromGoal('tap Settings, then verify About is visible, then take screenshot');
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.journey.steps.map((step) => step.type), ['assertForeground', 'tap', 'wait', 'assertVisible', 'screenshot']);
  assert.deepEqual(result.journey.steps[1].selector, { text: 'Settings' });
  assert.deepEqual(result.journey.steps[3].selector, { text: 'About' });
  assert.equal(result.unresolvedInstructions.length, 0);
  assert.ok(result.assumptions.length >= 2);
});

test('journey draft supports actions joined by and / and then and rejects risky data-changing goals', () => {
  const result = draftJourneyFromGoal('open Discover and verify Assets is visible');
  assert.deepEqual(result.journey.steps.filter((step) => step.type === 'tap').length, 1);
  const ordered = draftJourneyFromGoal('tap Settings and then verify About is visible');
  assert.deepEqual(ordered.journey.steps[1].selector, { text: 'Settings' });
  assert.deepEqual(ordered.journey.steps[3].selector, { text: 'About' });
  assert.throws(() => draftJourneyFromGoal('open wallet then send 2 tokens'), /will not auto-generate/);
  assert.throws(() => draftJourneyFromGoal('purchase the premium subscription and verify success'), /will not auto-generate/);
  assert.throws(() => draftJourneyFromGoal('do a thing'), /could not safely convert/);
});

test('journey draft writes a new protected file and never overwrites an existing file', async () => {
  const output = path.join(temp, 'draft.json');
  const written = await writeJourneyDraft('tap Settings, then verify About is visible', output);
  assert.equal(written.outputPath, output);
  assert.ok((await fs.stat(output)).mode & 0o600);
  const onDisk = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(onDisk.schemaVersion, 1);
  await assert.rejects(() => writeJourneyDraft('tap Settings', output), /will not overwrite/);
});

test('Android exploration hierarchy parser keeps values transient and only recognizes allowlisted navigation', () => {
  const xml = '<hierarchy><node text="Settings" resource-id="app:id/settings" clickable="true" bounds="[0,0][100,80]" class="Button"/><node text="Send" clickable="true" bounds="[0,80][100,160]"/><node text="Delete" clickable="true" bounds="[0,160][100,240]"/><node text="About" clickable="false" bounds="[0,240][100,320]"/></hierarchy>';
  const nodes = parseExplorationHierarchy(xml);
  const candidates = safeNavigationCandidates(nodes);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].selector.kind, 'resourceId');
  assert.equal(candidates[0].selector.value, 'app:id/settings');
  assert.equal('label' in candidates[0], false);
});

test('Android exploration refuses to tap anything without explicit confirmation', async () => {
  await assert.rejects(() => runAndroidSafeExploration({ packageId: 'com.example.app', confirm: false }), /pass --confirm/);
});

test('Android exploration performs bounded allowlisted navigation and returns to the original screen', async (t) => {
  const bin = path.join(temp, 'fake-adb-bin');
  await fs.mkdir(bin, { recursive: true });
  const stateFile = path.join(temp, 'adb-state.json');
  const fakeAdb = path.join(bin, 'adb');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=';
  const script = `#!/usr/bin/env node
const fs=require('node:fs'); const a=process.argv.slice(2); const p=a.indexOf('-s'); const c=p>=0?a.slice(p+2):a;
const state=()=>fs.existsSync('${stateFile}')?JSON.parse(fs.readFileSync('${stateFile}','utf8')).state:'root';
if(c[0]==='devices') process.stdout.write('List of devices attached\\nemulator-5554 device product:sdk_gphone64_x86_64\\n');
else if(c[0]==='exec-out') process.stdout.write(Buffer.from('${png}','base64'));
else if(c[0]==='shell') { const j=c.slice(1).join(' ');
 if(j==='pm path com.example.app') process.stdout.write('package:/data/app/base.apk\\n');
 else if(j==='getprop ro.kernel.qemu') process.stdout.write('1\\n');
 else if(j==='getprop ro.product.model') process.stdout.write('Pixel Emulator\\n');
 else if(j==='getprop ro.build.version.release') process.stdout.write('15\\n');
 else if(j.startsWith('uiautomator dump')) process.stdout.write('dumped\\n');
 else if(j.startsWith('cat ')) process.stdout.write(state()==='root' ? '<hierarchy><node text="Settings" resource-id="com.example.app:id/settings" clickable="true" bounds="[0,0][200,100]" class="Button"/></hierarchy>' : '<hierarchy><node text="About" resource-id="com.example.app:id/about" clickable="false" bounds="[0,0][200,100]" class="TextView"/></hierarchy>');
 else if(c[1]==='input' && c[2]==='tap') fs.writeFileSync('${stateFile}',JSON.stringify({state:'detail'}));
 else if(c[1]==='input' && c[2]==='keyevent' && c[3]==='4') fs.writeFileSync('${stateFile}',JSON.stringify({state:'root'}));
}
`;
  await fs.writeFile(fakeAdb, script, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  t.after(() => { process.env.PATH = previousPath; });
  const output = path.join(temp, 'exploration-output');
  const report = await runAndroidSafeExploration({ packageId: 'com.example.app', deviceId: 'emulator-5554', confirm: true, maxActions: 3, outputDir: output });
  assert.equal(report.exploratoryPassClaim, false);
  assert.equal(report.executionKind, 'android-emulator');
  assert.equal(report.summary.navigationCandidates, 1);
  assert.equal(report.summary.changedScreens, 1);
  assert.equal(report.explored[0].outcome, 'new-screen-state-observed');
  assert.equal('label' in report.explored[0], false);
  const archived = JSON.parse(await fs.readFile(report.reportPath, 'utf8'));
  assert.equal(JSON.stringify(archived).includes('Settings'), false);
  assert.ok(await fs.stat(path.join(output, '00-start.png')));
  assert.ok(await fs.stat(path.join(output, '01-screen-' + report.explored[0].labelHash + '.png')));
});

test('local AI vision sends a bounded image as multimodal input and returns analysis without storing image bytes', async (t) => {
  process.env.PAXI_AI_MODE = 'local';
  process.env.PAXI_AI_LOCAL_URL = 'http://127.0.0.1:8080';
  const screenshot = path.join(temp, 'sample.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(screenshot, png);
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '## Overall\nThe page is readable.\n## Confirmed observations\nNo visible clipping.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = previousFetch; delete process.env.PAXI_AI_MODE; delete process.env.PAXI_AI_LOCAL_URL; });
  const report = await analyzeScreenshot(screenshot);
  assert.equal(report.providerMode, 'local');
  assert.equal(report.image.width, 1);
  assert.match(report.analysis, /No visible clipping/);
  assert.equal(request.url, 'http://127.0.0.1:8080/chat/completions');
  const content = request.body.messages[1].content;
  assert.equal(content[1].type, 'image_url');
  assert.match(content[1].image_url.url, /^data:image\/png;base64,/);
  assert.doesNotMatch(JSON.stringify(report), /data:image\/png/);
});

test('vision analysis refuses remote image transfer without explicit consent', async (t) => {
  process.env.PAXI_AI_MODE = 'api';
  process.env.PAXI_AI_API_URL = 'https://vision.example.invalid/v1';
  process.env.PAXI_AI_MODEL = 'vision-model';
  process.env.PAXI_AI_API_KEY = 'test-key';
  const screenshot = path.join(temp, 'remote.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(screenshot, png);
  const previousTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
  t.after(() => {
    delete process.env.PAXI_AI_MODE; delete process.env.PAXI_AI_API_URL; delete process.env.PAXI_AI_MODEL; delete process.env.PAXI_AI_API_KEY;
    if (previousTTY === undefined) delete process.stdin.isTTY; else Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: previousTTY });
  });
  await assert.rejects(() => analyzeScreenshot(screenshot), /screenshot image to a remote provider/);
});

test.after(async () => { await fs.rm(temp, { recursive: true, force: true }); });

test('Android exploration attempts Back and restores the root even when a post-navigation screenshot fails', async (t) => {
  const bin = path.join(temp, 'fake-adb-screenshot-failure-bin');
  await fs.mkdir(bin, { recursive: true });
  const stateFile = path.join(temp, 'adb-screenshot-failure-state.json');
  const shotCounter = path.join(temp, 'adb-shot-counter.txt');
  const invocationFile = path.join(temp, 'adb-explore-calls.txt');
  const fakeAdb = path.join(bin, 'adb');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bggAAAAASUVORK5CYII=';
  const script = `#!/usr/bin/env node
const fs=require('node:fs'); const a=process.argv.slice(2); const p=a.indexOf('-s'); const c=p>=0?a.slice(p+2):a;
const state=()=>fs.existsSync('${stateFile}')?JSON.parse(fs.readFileSync('${stateFile}','utf8')).state:'root';
fs.appendFileSync('${invocationFile}',c.join(' ')+'\\n');
if(c[0]==='devices') process.stdout.write('List of devices attached\\nemulator-5554 device\\n');
else if(c[0]==='exec-out') { let n=fs.existsSync('${shotCounter}')?Number(fs.readFileSync('${shotCounter}','utf8')):0; n++; fs.writeFileSync('${shotCounter}',String(n)); if(n===2) { process.stderr.write('intentional screenshot failure'); process.exit(1); } process.stdout.write(Buffer.from('${png}','base64')); }
else if(c[0]==='shell') { const j=c.slice(1).join(' ');
 if(j==='pm path com.example.app') process.stdout.write('package:/data/app/base.apk\\n');
 else if(j==='getprop ro.kernel.qemu') process.stdout.write('1\\n');
 else if(j==='getprop ro.product.model') process.stdout.write('Pixel Emulator\\n');
 else if(j==='getprop ro.build.version.release') process.stdout.write('15\\n');
 else if(j.startsWith('uiautomator dump')) process.stdout.write('dumped\\n');
 else if(j.startsWith('cat ')) process.stdout.write(state()==='root' ? '<hierarchy><node text="Settings" resource-id="com.example.app:id/settings" clickable="true" bounds="[0,0][200,100]" class="Button"/></hierarchy>' : '<hierarchy><node text="About" resource-id="com.example.app:id/about" clickable="false" bounds="[0,0][200,100]" class="TextView"/></hierarchy>');
 else if(c[1]==='input' && c[2]==='tap') fs.writeFileSync('${stateFile}',JSON.stringify({state:'detail'}));
 else if(c[1]==='input' && c[2]==='keyevent' && c[3]==='4') fs.writeFileSync('${stateFile}',JSON.stringify({state:'root'}));
}
`;
  await fs.writeFile(fakeAdb, script, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  t.after(() => { process.env.PATH = previousPath; });
  const report = await runAndroidSafeExploration({ packageId: 'com.example.app', deviceId: 'emulator-5554', confirm: true, maxActions: 1, outputDir: path.join(temp, 'exploration-screenshot-failure') });
  assert.ok(report.issues.some((issue) => issue.code === 'screenshot-capture-failed'));
  assert.ok((await fs.readFile(invocationFile, 'utf8')).includes('shell input keyevent 4'));
  assert.equal(JSON.parse(await fs.readFile(stateFile, 'utf8')).state, 'root');
  assert.ok(report.explored[0].screenChanged);
  assert.equal(report.explored[0].screenshotCaptured, false);
});
