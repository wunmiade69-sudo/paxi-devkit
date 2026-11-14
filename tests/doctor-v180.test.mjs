import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v180-'));
process.env.XDG_CONFIG_HOME = path.join(temp, 'xdg-config');

function fakePlaywright({ externalOnClick = false, text = 'Saved' } = {}) {
  let currentUrl = 'http://127.0.0.1:4173/';
  const listeners = new Map();
  const locator = {
    async click() { if (externalOnClick) currentUrl = 'https://outside.example/path'; },
    async fill(value) { globalThis.__paxiLastFill = value; },
    async selectOption(value) { globalThis.__paxiLastSelect = value; },
    async check() {}, async uncheck() {}, async press() {},
    async waitFor() {}, async innerText() { return text; }
  };
  const page = {
    setDefaultTimeout() {},
    on(name, callback) { const values = listeners.get(name) || []; values.push(callback); listeners.set(name, values); },
    async goto(url) { currentUrl = url; return { status: () => 200 }; },
    url() { return currentUrl; },
    getByRole() { return locator; }, getByLabel() { return locator; }, getByText() { return locator; }, getByTestId() { return locator; }, getByPlaceholder() { return locator; },
    async waitForLoadState() {},
    async screenshot() { return Buffer.from('png'); }
  };
  const context = {
    async newPage() { return page; },
    async close() {},
    on() {},
    async route(_pattern, handler) { globalThis.__paxiRouteHandler = handler; }
  };
  const browser = { async newContext() { return context; }, async close() {} };
  return { chromium: { async launch(options) { globalThis.__paxiBrowserLaunchEnv = options?.env || {}; return browser; } }, __page: page, __context: context, get currentUrl() { return currentUrl; } };
}

test('observability packs are discoverable and installation writes reviewed templates without changing project manifests', async () => {
  const { listObservabilityPacks, getObservabilityPack, writeObservabilityPack } = await import('../src/doctor/observability-packs.mjs');
  const packs = listObservabilityPacks();
  assert.equal(packs.length, 5);
  assert.ok(packs.some((item) => item.id === 'node-express'));
  assert.match(getObservabilityPack('python-fastapi').title, /FastAPI/);
  const project = path.join(temp, 'obs-project');
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'package.json'), '{"name":"fixture"}');
  await assert.rejects(() => writeObservabilityPack({ id: 'node-express', projectPath: project }), /--confirm/);
  const result = await writeObservabilityPack({ id: 'node-express', projectPath: project, confirm: true });
  assert.equal(result.changedApplicationFiles, false);
  assert.equal(result.dependenciesInstalled, false);
  assert.ok(await fs.readFile(path.join(result.directory, 'paxi-otel-bootstrap.mjs'), 'utf8'));
  assert.equal(await fs.readFile(path.join(project, 'package.json'), 'utf8'), '{"name":"fixture"}');
  await assert.rejects(() => writeObservabilityPack({ id: 'node-express', projectPath: project, confirm: true }), /Refusing to overwrite/);
  await assert.rejects(() => writeObservabilityPack({ id: 'go-http', projectPath: project, outputPath: '../escape', confirm: true }), /inside the selected project/);
});

test('semantic website journey validates named locators and rejects arbitrary CSS selectors and unscoped values', async () => {
  const { validateWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const valid = validateWebsiteJourney({ schemaVersion: 1, name: 'Profile flow', steps: [
    { type: 'assertVisible', target: { role: 'heading', name: 'Profile' } },
    { type: 'fill', target: { label: 'Email' }, valueEnv: 'PAXI_TEST_EMAIL' },
    { type: 'assertText', target: { testId: 'save-status' }, expectedText: 'Saved' },
    { type: 'assertUrl', path: '/profile' }
  ] });
  assert.equal(valid.steps.length, 4);
  assert.throws(() => validateWebsiteJourney({ schemaVersion: 1, steps: [{ type: 'click', target: { css: 'button' } }] }), /arbitrary CSS\/XPath/);
  assert.throws(() => validateWebsiteJourney({ schemaVersion: 1, steps: [{ type: 'fill', target: { label: 'Password' }, value: 'secret' }] }), /unsupported fields/);
  assert.throws(() => validateWebsiteJourney({ schemaVersion: 1, steps: [{ type: 'press', target: { role: 'button', name: 'Submit' }, key: 'F12' }] }), /key is not supported/);
});

test('semantic website runner requires confirmation, keeps test input out of reports and claims only explicit assertions', async () => {
  const { runWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const directory = path.join(temp, 'web-journey-output');
  const secret = 'paxi-test-account-password-not-for-report';
  process.env.PAXI_TEST_PASSWORD = secret;
  process.env.OPENAI_API_KEY = 'do-not-pass-to-browser-process';
  const journey = { schemaVersion: 1, name: 'Safe sign-in', steps: [
    { type: 'fill', target: { label: 'Password' }, valueEnv: 'PAXI_TEST_PASSWORD' },
    { type: 'assertText', target: { testId: 'status' }, expectedText: 'Saved' },
    { type: 'assertUrl', path: '/' }
  ] };
  await assert.rejects(() => runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', playwrightModule: fakePlaywright(), outputDir: path.join(temp, 'no-confirm') }), /--confirm/);
  const report = await runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', confirm: true, playwrightModule: fakePlaywright(), outputDir: directory });
  assert.equal(report.journeyPassClaim, true);
  assert.equal(report.executionKind, 'simulated-browser-semantic-journey');
  assert.ok(report.archivePath);
  const serialized = await fs.readFile(report.reportPath, 'utf8');
  assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes('Saved'));
  assert.equal(report.summary.expectedAssertions, 2);
  assert.equal(globalThis.__paxiBrowserLaunchEnv.PAXI_TEST_PASSWORD, undefined);
  assert.equal(globalThis.__paxiBrowserLaunchEnv.OPENAI_API_KEY, undefined);
  delete process.env.PAXI_TEST_PASSWORD;
  delete process.env.OPENAI_API_KEY;
});

test('semantic website runner rejects remote hosts without explicit HTTPS authorization and stops on cross-origin navigation', async () => {
  const { runWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const journey = { schemaVersion: 1, name: 'External guard', steps: [
    { type: 'click', target: { role: 'link', name: 'External' } },
    { type: 'assertVisible', target: { role: 'heading', name: 'Done' } }
  ] };
  await assert.rejects(() => runWebsiteJourney({ filePath: journey, url: 'https://staging.example.test', confirm: true, playwrightModule: fakePlaywright(), outputDir: path.join(temp, 'remote-no-consent') }), /--allow-remote/);
  const report = await runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', confirm: true, playwrightModule: fakePlaywright({ externalOnClick: true }), outputDir: path.join(temp, 'cross-origin-stop') });
  assert.equal(report.journeyPassClaim, false);
  assert.equal(report.summary.failed, 1);
  assert.match(report.results[0].error, /outside the original target origin/);
});

test('Android selector proposals retain unique resource IDs but never retain visible text or content descriptions', async () => {
  const { proposeAndroidSelectors, writeAndroidJourneyFromSelector } = await import('../src/doctor/android-selector-proposals.mjs');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><hierarchy><node index="0" text="Private customer@example.test" resource-id="com.example:id/profile_save" class="android.widget.Button" clickable="true" visible-to-user="true" bounds="[10,20][210,80]"/><node index="1" text="Private customer@example.test" content-desc="Customer private name" class="android.widget.TextView" clickable="false" visible-to-user="true" bounds="[10,100][210,140]"/></hierarchy>`;
  const hierarchy = path.join(temp, 'ui.xml');
  await fs.writeFile(hierarchy, xml);
  const report = await proposeAndroidSelectors({ hierarchyPath: hierarchy });
  assert.equal(report.proposals.length, 1);
  assert.deepEqual(report.proposals[0].selector, { resourceId: 'com.example:id/profile_save' });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('customer@example.test'));
  assert.ok(!serialized.includes('Customer private name'));
  const output = path.join(temp, 'android-generated-journey.json');
  await assert.rejects(() => writeAndroidJourneyFromSelector({ hierarchyPath: hierarchy, packageId: 'com.example.app', candidateIndex: 1, outputPath: output }), /--confirm/);
  const written = await writeAndroidJourneyFromSelector({ hierarchyPath: hierarchy, packageId: 'com.example.app', candidateIndex: 1, outputPath: output, confirm: true });
  assert.equal(written.requiresHumanReview, true);
  assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')).steps[0], { type: 'assertVisible', selector: { resourceId: 'com.example:id/profile_save' } });
});

after(async () => { delete globalThis.__paxiLastFill; delete globalThis.__paxiLastSelect; delete globalThis.__paxiRouteHandler; delete globalThis.__paxiBrowserLaunchEnv; await fs.rm(temp, { recursive: true, force: true }); });

test('semantic website evidence is correlated with API failures when W3C trace ID and route match', async () => {
  const { analyzeCrossLayerEvidence } = await import('../src/doctor/cross-layer-correlation.mjs');
  const traceId = '0123456789abcdef0123456789abcdef';
  const apiPath = path.join(temp, 'correlation-api.json');
  const webPath = path.join(temp, 'correlation-web.json');
  await fs.writeFile(apiPath, JSON.stringify({ executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test', results: [{ id: 'profile', status: 'failed', method: 'GET', path: '/profile', statusCode: 500, traceId }] }));
  await fs.writeFile(webPath, JSON.stringify({ reportType: 'paxi-semantic-website-journey', runner: 'playwright-chromium', executionKind: 'simulated-browser-semantic-journey', targetUrl: 'https://api.example.test/', traceContext: { traceId }, results: [{ index: 2, type: 'assertVisible', status: 'failed', error: 'Expected element missing' }], httpErrors: [{ url: 'https://api.example.test/profile', method: 'GET', status: 500, resourceType: 'fetch' }], issues: [] }));
  const result = await analyzeCrossLayerEvidence({ reportPaths: [apiPath, webPath] });
  assert.ok(result.summary.layers.includes('website'));
  assert.ok(result.correlations.some((item) => item.code === 'distributed-trace-id-match' && item.route === '/profile'));
});

test('verified-fix memory accepts complete semantic website journeys but preserves simulated-browser assurance', async () => {
  process.env.XDG_CONFIG_HOME = path.join(temp, 'semantic-verified-config');
  const project = path.join(temp, 'semantic-verified-project');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'profile.ts'), 'export const profile = true;\n');
  const reportPath = path.join(temp, 'semantic-website-passing.json');
  await fs.writeFile(reportPath, JSON.stringify({
    reportType: 'paxi-semantic-website-journey', runner: 'playwright-chromium', executionKind: 'simulated-browser-semantic-journey',
    runId: 'semantic-run', completedAt: new Date().toISOString(), status: 'completed', journeyPassClaim: true,
    summary: { total: 2, executed: 2, passed: 2, failed: 0, assertions: 1, expectedAssertions: 1 },
    results: [{ status: 'passed', assertion: 'visible' }, { status: 'passed' }], issues: []
  }));
  const { recordVerifiedFix } = await import('../src/doctor/verified-fixes.mjs');
  const result = await recordVerifiedFix({ projectPath: project, evidencePath: reportPath, summary: 'Profile screen semantic journey verified', files: ['src/profile.ts'], confirm: true });
  assert.equal(result.record.evidence.reports[0].type, 'website-semantic');
  assert.ok(result.assurance.includes('simulated-semantic-browser-journey-only'));
});

test('semantic website journey runs are archived and can be compared by step status in Device Lab history', async () => {
  const { runWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const { compareLabRuns, listLabRuns } = await import('../src/doctor/lab-history.mjs');
  const journey = { schemaVersion: 1, name: 'History fixture', steps: [{ type: 'assertVisible', target: { testId: 'ready' } }] };
  const first = await runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', confirm: true, playwrightModule: fakePlaywright(), outputDir: path.join(temp, 'history-first') });
  const second = await runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', confirm: true, playwrightModule: fakePlaywright(), outputDir: path.join(temp, 'history-second') });
  const history = await listLabRuns();
  assert.ok(history.some((item) => item.runId === first.runId));
  assert.ok(history.some((item) => item.runId === second.runId));
  const comparison = await compareLabRuns(first.runId, second.runId);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.comparisonKind, 'browser-semantic-journey-results');
});

test('semantic website runner injects W3C traceparent only into fetch/XHR and blocks cross-origin top-level requests', async () => {
  const { runWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const fake = fakePlaywright();
  await runWebsiteJourney({ filePath: { schemaVersion: 1, name: 'Trace sample', steps: [{ type: 'assertVisible', target: { testId: 'ready' } }] }, url: 'http://127.0.0.1:4173', traceId: '0123456789abcdef0123456789abcdef', confirm: true, playwrightModule: fake, outputDir: path.join(temp, 'trace-route') });
  const handler = globalThis.__paxiRouteHandler;
  let forwarded = null;
  let aborted = false;
  await handler({
    request: () => ({ url: () => 'http://127.0.0.1:4173/api/profile', resourceType: () => 'fetch', isNavigationRequest: () => false, headers: () => ({ accept: 'application/json' }) }),
    continue: async (options) => { forwarded = options; }, abort: async () => { aborted = true; }
  });
  assert.match(forwarded.headers.traceparent, /^00-0123456789abcdef0123456789abcdef-[a-f0-9]{16}-01$/);
  await handler({
    request: () => ({ url: () => 'https://elsewhere.example/path', resourceType: () => 'document', isNavigationRequest: () => true, headers: () => ({}) }),
    continue: async () => { throw new Error('External navigation must not continue.'); }, abort: async () => { aborted = true; }
  });
  assert.equal(aborted, true);
});
