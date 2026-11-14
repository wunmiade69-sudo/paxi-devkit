import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v190-web-'));

function fakePlaywright({ missingName = false, sessionState = null, fetchUrl = 'http://127.0.0.1:4173/api/profile' } = {}) {
  let currentUrl = 'http://127.0.0.1:4173/';
  let routeHandler;
  const namedControl = {
    async getAttribute(name) { return name === 'aria-label' && !missingName ? 'Save changes' : null; },
    async innerText() { return ''; },
    async count() { return 1; },
    nth() { return this; },
    async click() {}, async fill() {}, async check() {}, async uncheck() {}, async press() {}, async waitFor() {}
  };
  const page = {
    setDefaultTimeout() {},
    on() {},
    async goto(url) {
      currentUrl = url;
      if (routeHandler) {
        let fulfilled = null;
        await routeHandler({
          request: () => ({ url: () => fetchUrl, resourceType: () => 'fetch', isNavigationRequest: () => false, method: () => 'GET', headers: () => ({ accept: 'application/json' }) }),
          fulfill: async (value) => { fulfilled = value; },
          continue: async (options) => { globalThis.__paxiContinuedOptionsV190 = options; },
          abort: async () => { globalThis.__paxiAbortedV190 = true; }
        });
        globalThis.__paxiMockFulfilled = fulfilled;
      }
      return { status: () => 200 };
    },
    url() { return currentUrl; },
    getByRole() { return namedControl; }, getByLabel() { return namedControl; }, getByText() { return namedControl; }, getByTestId() { return namedControl; }, getByPlaceholder() { return namedControl; },
    locator(selector) {
      if (selector === 'img:not([alt])') return { async count() { return 0; } };
      if (selector === 'button, [role="button"], input:not([type="hidden"]), select, textarea') return { async count() { return 1; }, nth() { return namedControl; } };
      if (selector === 'label[for]') return { async evaluateAll() { return false; } };
      if (selector === ':focus') return { async count() { return 1; } };
      return namedControl;
    },
    keyboard: { async press() {} },
    async waitForLoadState() {},
    async screenshot() { return Buffer.from('png'); }
  };
  const context = {
    async newPage() { return page; },
    async close() {}, on() {},
    async storageState() { return sessionState || { cookies: [], origins: [{ origin: 'http://127.0.0.1:4173', localStorage: [] }] }; },
    async route(_pattern, handler) { routeHandler = handler; globalThis.__paxiRouteHandlerV190 = handler; }
  };
  const browser = { async newContext(options) { globalThis.__paxiContextOptionsV190 = options; return context; }, async close() {} };
  return { chromium: { async launch() { return browser; } }, __page: page };
}

test('semantic website journey supports private same-origin storage state, exact JSON response mocks and a11y/keyboard assertions', async () => {
  const { runWebsiteJourney, validateWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const project = path.join(temp, 'project');
  await fs.mkdir(project, { recursive: true });
  const statePath = path.join(temp, 'private-storage-state.json');
  const cookieSecret = 'private-session-cookie-value';
  await fs.writeFile(statePath, JSON.stringify({ cookies: [{ name: 'sid', value: cookieSecret, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [{ origin: 'http://127.0.0.1:4173', localStorage: [] }] }), { mode: 0o600 });
  await fs.chmod(statePath, 0o600);
  const journey = validateWebsiteJourney({ schemaVersion: 1, name: 'Mocked profile journey', mocks: [{ method: 'GET', path: '/api/profile', status: 200, body: { id: 'test-user', displayName: 'PAXI Test' } }], steps: [{ type: 'assertAccessible' }, { type: 'assertKeyboard' }, { type: 'assertVisible', target: { role: 'heading', name: 'Profile' } }] });
  const report = await runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', projectRoot: project, storageStatePath: statePath, confirm: true, playwrightModule: fakePlaywright(), outputDir: path.join(temp, 'journey-out') });
  assert.equal(report.journeyPassClaim, true);
  assert.equal(report.sessionStateUsed, true);
  assert.equal(report.summary.mockedResponses, 1);
  assert.equal(globalThis.__paxiContextOptionsV190.storageState.cookies[0].value, cookieSecret);
  assert.equal(globalThis.__paxiMockFulfilled.status, 200);
  assert.deepEqual(JSON.parse(globalThis.__paxiMockFulfilled.body), { id: 'test-user', displayName: 'PAXI Test' });
  const saved = await fs.readFile(report.reportPath, 'utf8');
  assert.ok(!saved.includes(cookieSecret));
  assert.ok(!saved.includes('PAXI Test'));
});

test('website journeys reject storage state inside the project, permissive file modes and cross-origin session entries', async () => {
  const { runWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const project = path.join(temp, 'storage-project');
  await fs.mkdir(project, { recursive: true });
  const journey = { schemaVersion: 1, name: 'Session check', steps: [{ type: 'assertVisible', target: { testId: 'ready' } }] };
  const inside = path.join(project, 'state.json');
  await fs.writeFile(inside, JSON.stringify({ cookies: [], origins: [] }), { mode: 0o600 });
  await assert.rejects(() => runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', projectRoot: project, storageStatePath: inside, confirm: true, playwrightModule: fakePlaywright(), outputDir: path.join(temp, 'bad-storage-inside') }), /outside the project tree/);
  const publicFile = path.join(temp, 'public-state.json');
  await fs.writeFile(publicFile, JSON.stringify({ cookies: [], origins: [] }), { mode: 0o644 });
  if (process.platform !== 'win32') {
    await fs.chmod(publicFile, 0o644);
    await assert.rejects(() => runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', projectRoot: project, storageStatePath: publicFile, confirm: true, playwrightModule: fakePlaywright(), outputDir: path.join(temp, 'bad-storage-mode') }), /permissions must be private/);
  }
  const external = path.join(temp, 'external-state.json');
  await fs.writeFile(external, JSON.stringify({ cookies: [], origins: [{ origin: 'https://elsewhere.example', localStorage: [] }] }), { mode: 0o600 });
  await fs.chmod(external, 0o600);
  await assert.rejects(() => runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', projectRoot: project, storageStatePath: external, confirm: true, playwrightModule: fakePlaywright(), outputDir: path.join(temp, 'bad-storage-origin') }), /not explicitly allowed/);
});



test('website cross-origin APIs are blocked unless explicitly allowlisted and then receive the W3C trace header', async () => {
  const { runWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const journey = { schemaVersion: 1, name: 'Cross-origin API test', steps: [{ type: 'assertVisible', target: { testId: 'ready' } }] };
  const blocked = await runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', confirm: true, traceId: '0123456789abcdef0123456789abcdef', playwrightModule: fakePlaywright({ fetchUrl: 'https://api.example.test/profile' }), outputDir: path.join(temp, 'api-origin-blocked') });
  assert.equal(blocked.journeyPassClaim, false);
  assert.equal(blocked.blockedExternalRequests.length, 1);
  assert.equal(globalThis.__paxiAbortedV190, true);

  const allowed = await runWebsiteJourney({ filePath: journey, url: 'http://127.0.0.1:4173', allowedApiOrigins: ['https://api.example.test'], confirm: true, traceId: '0123456789abcdef0123456789abcdef', playwrightModule: fakePlaywright({ fetchUrl: 'https://api.example.test/profile' }), outputDir: path.join(temp, 'api-origin-allowed') });
  assert.equal(allowed.journeyPassClaim, true);
  assert.equal(allowed.blockedExternalRequests.length, 0);
  assert.deepEqual(allowed.allowedApiOrigins, ['https://api.example.test']);
  assert.match(globalThis.__paxiContinuedOptionsV190.headers.traceparent, /^00-0123456789abcdef0123456789abcdef-[a-f0-9]{16}-01$/);
});

test('website journeys save private browser storage state only after all assertions pass', async () => {
  const { runWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const project = path.join(temp, 'save-state-project');
  await fs.mkdir(project, { recursive: true });
  const secret = 'cookie-value-must-not-enter-report';
  const statePath = path.join(temp, 'saved-session-state.json');
  const report = await runWebsiteJourney({
    filePath: { schemaVersion: 1, name: 'Save auth session', steps: [{ type: 'assertVisible', target: { testId: 'profile' } }] },
    url: 'http://127.0.0.1:4173', projectRoot: project, saveStorageStatePath: statePath, confirm: true,
    playwrightModule: fakePlaywright({ sessionState: { cookies: [{ name: 'sid', value: secret, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [{ origin: 'http://127.0.0.1:4173', localStorage: [] }] } }),
    outputDir: path.join(temp, 'save-state-run')
  });
  assert.equal(report.sessionStateExported, true);
  assert.equal(report.sessionStateExportStatus, 'saved-private-file');
  const info = await fs.stat(statePath);
  if (process.platform !== 'win32') assert.equal(info.mode & 0o777, 0o600);
  assert.equal(JSON.parse(await fs.readFile(statePath, 'utf8')).cookies[0].value, secret);
  assert.ok(!(await fs.readFile(report.reportPath, 'utf8')).includes(secret));
});

test('assertAccessible fails when the fixed heuristic finds an unnamed control', async () => {
  const { runWebsiteJourney } = await import('../src/doctor/website-journey.mjs');
  const report = await runWebsiteJourney({
    filePath: { schemaVersion: 1, name: 'A11y heuristic failure', steps: [{ type: 'assertAccessible' }] },
    url: 'http://127.0.0.1:4173', confirm: true, playwrightModule: fakePlaywright({ missingName: true }),
    outputDir: path.join(temp, 'a11y-fails')
  });
  assert.equal(report.journeyPassClaim, false);
  assert.equal(report.summary.failed, 1);
  assert.match(report.results[0].error, /Accessibility heuristic/);
});

test('website matrix reports missing browser engines as unavailable instead of passing them', async () => {
  const { runWebsiteJourneyMatrix } = await import('../src/doctor/website-journey.mjs');
  const report = await runWebsiteJourneyMatrix({
    filePath: { schemaVersion: 1, name: 'Matrix', steps: [{ type: 'assertVisible', target: { testId: 'ready' } }] },
    url: 'http://127.0.0.1:4173', browsers: ['chromium','webkit'], confirm: true,
    playwrightModule: fakePlaywright(), outputDir: path.join(temp, 'matrix-out')
  });
  assert.equal(report.summary.ran, 1);
  assert.equal(report.summary.unavailable, 1);
  assert.equal(report.status, 'partial');
  assert.equal(report.results.find((item) => item.engine === 'webkit').status, 'engine-unavailable');
});

after(async () => {
  delete globalThis.__paxiRouteHandlerV190;
  delete globalThis.__paxiContextOptionsV190;
  delete globalThis.__paxiMockFulfilled;
  delete globalThis.__paxiContinuedOptionsV190;
  delete globalThis.__paxiAbortedV190;
  await fs.rm(temp, { recursive: true, force: true });
});
