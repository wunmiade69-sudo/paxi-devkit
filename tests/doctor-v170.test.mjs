import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-doctor-v170-'));
async function fixture(relative, value) {
  const target = path.join(temp, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return target;
}

test('OpenTelemetry importer parses OTLP JSON, preserves trace ancestry and redacts exception secrets', async () => {
  const traceId = 'a'.repeat(32);
  const spanFile = await fixture('otel/spans.json', {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'orders-api' } }] },
      scopeSpans: [{ spans: [
        { traceId, spanId: '1'.repeat(16), parentSpanId: '', name: 'GET /orders', startTimeUnixNano: '1000000000', endTimeUnixNano: '1400000000', status: { code: 2 }, attributes: [{ key: 'http.request.method', value: { stringValue: 'GET' } }, { key: 'http.route', value: { stringValue: '/orders' } }, { key: 'http.response.status_code', value: { intValue: 500 } }, { key: 'app.state.from', value: { stringValue: 'loading' } }, { key: 'app.state.to', value: { stringValue: 'error' } }, { key: 'app.state.transition', value: { stringValue: 'request-failed' } }] },
        { traceId, spanId: '2'.repeat(16), parentSpanId: '1'.repeat(16), name: 'SELECT orders', startTimeUnixNano: '1100000000', endTimeUnixNano: '1350000000', status: { code: 2 }, attributes: [{ key: 'db.system', value: { stringValue: 'postgresql' } }, { key: 'db.operation.name', value: { stringValue: 'SELECT' } }, { key: 'exception.type', value: { stringValue: 'QueryError' } }, { key: 'exception.message', value: { stringValue: 'password=do-not-leak' } }] }
      ] }]
    }]
  });
  const { inspectOtelSpans } = await import('../src/doctor/otel-spans.mjs');
  const report = await inspectOtelSpans({ filePath: spanFile, traceId, slowDatabaseMs: 100 });
  assert.equal(report.summary.spans, 2);
  assert.equal(report.summary.errors, 2);
  assert.equal(report.summary.databaseSpans, 1);
  assert.equal(report.spans[1].parentSpanId, '1'.repeat(16));
  assert.equal(report.spans[1].isSlowDatabase, true);
  assert.equal(report.spans[0].applicationState.transition, 'request-failed');
  assert.equal(report.summary.applicationStateSpans, 1);
  assert.equal(JSON.stringify(report).includes('do-not-leak'), false);
});

test('Cross-layer correlator ranks a database span in the parent chain as an investigation hypothesis', async () => {
  const traceId = 'b'.repeat(32);
  const api = await fixture('root/api.json', { executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test', traceContext: { traceId }, results: [{ id: 'orders', method: 'GET', path: '/orders', status: 'failed', statusCode: 500, traceId, issues: [] }] });
  const spans = await fixture('root/spans.json', {
    reportType: 'paxi-otel-span-report', executionKind: 'read-only-otel-span-import',
    spans: [
      { traceId, spanId: '1'.repeat(16), parentSpanId: null, name: 'GET /orders', service: 'orders-api', status: 'error', isError: true, database: null, applicationState: { from: 'loading', to: 'error', transition: 'request-failed' }, durationMs: 400, http: { method: 'GET', route: '/orders', statusCode: 500 } },
      { traceId, spanId: '2'.repeat(16), parentSpanId: '1'.repeat(16), name: 'SELECT orders', service: 'orders-api', status: 'error', isError: true, isSlowDatabase: false, database: { system: 'postgresql', operation: 'SELECT' }, durationMs: 240, http: {} }
    ]
  });
  const { analyzeCrossLayerEvidence } = await import('../src/doctor/cross-layer-correlation.mjs');
  const report = await analyzeCrossLayerEvidence({ reportPaths: [api, spans] });
  assert.equal(report.rootCauseCandidates[0].category, 'database-error-in-request-trace');
  assert.equal(report.rootCauseCandidates[0].confidence, 'high');
  assert.ok(report.correlations.some((item) => item.code === 'backend-span-context-match'));
  assert.equal(report.rootCauseCandidates[0].requiresHumanVerification, true);
  assert.ok(report.rootCauseCandidates.some((item) => item.category === 'application-state-transition-error-in-request-trace'));
});

test('website lab can run same-origin route regression paths and rejects unsafe route traversal', async () => {
  const { runWebsiteDeviceLab } = await import('../src/doctor/website-lab.mjs');
  const visited = [];
  const fakePage = {
    on() {},
    async goto(url) { visited.push(url); },
    async evaluate() { return { viewport: { innerWidth: 360, innerHeight: 800, documentWidth: 360, documentHeight: 800 }, horizontalOverflow: false, overflowingElements: [], titlePresent: true, viewportMetaPresent: true, imagesMissingAlt: 0, buttonsMissingName: 0, visibleInputCount: 0 }; },
    async screenshot({ path: file }) { await fs.writeFile(file, Buffer.from('screenshot-fixture')); },
    locator() { return { count: async () => 0 }; },
    async addStyleTag() {}
  };
  const fakeContext = { async route() {}, async newPage() { return fakePage; }, async close() {}, async setOffline() {} };
  const fakePlaywright = { chromium: { async launch() { return { async newContext() { return fakeContext; }, async close() {} }; } } };
  const outputDir = path.join(temp, 'website-route-output');
  const report = await runWebsiteDeviceLab({ url: 'https://www.example.test', projectRoot: temp, profiles: ['compact'], routes: ['/settings', '/profile'], outputDir, playwrightModule: fakePlaywright });
  assert.equal(report.summary.total, 2);
  assert.deepEqual(visited.sort(), ['https://www.example.test/profile', 'https://www.example.test/settings']);
  assert.equal(report.routePlan.sameOriginOnly, true);
  await assert.rejects(() => runWebsiteDeviceLab({ url: 'https://www.example.test', projectRoot: temp, profiles: ['compact'], routes: ['//evil.example.test/path'], outputDir: path.join(temp, 'unsafe-route-output'), playwrightModule: fakePlaywright }), /same-origin/);
});

test('multiplatform regression draft emits API cases, same-origin website routes and a review-required Android starter', async () => {
  const plan = await fixture('multidraft/api-plan.json', { schemaVersion: 1, baseUrl: 'https://api.example.test', cases: [{ id: 'users', method: 'GET', path: '/users', expectedStatus: [200] }] });
  const evidence = await fixture('multidraft/correlation.json', {
    schemaVersion: 1, reportType: 'paxi-cross-layer-evidence-correlation', events: [
      { sourceType: 'api', sourceFile: 'api.json', sourceId: 'users', status: 'failed', severity: 'high', host: 'api.example.test', path: '/users', method: 'GET', code: 'api-smoke-failed', summary: 'HTTP 500' },
      { sourceType: 'website', sourceFile: 'web.json', sourceId: 'compact', status: 'failed', severity: 'high', host: 'www.example.test', origin: 'https://www.example.test', path: '/settings', method: 'GET', code: 'horizontal-overflow', summary: 'Overflow detected' },
      { sourceType: 'android-journey', sourceFile: 'android.json', sourceId: '4', status: 'failed', severity: 'high', code: 'step-assertVisible-failed', packageId: 'com.example.app', deviceType: 'physical-device', summary: 'Expected settings screen not visible' }
    ]
  });
  const { draftRegressionSuite } = await import('../src/doctor/regression-draft.mjs');
  const output = path.join(temp, 'multidraft', 'draft.json');
  const androidOutput = path.join(temp, 'multidraft', 'android-journey.json');
  const draft = await draftRegressionSuite({ planPath: plan, evidencePath: evidence, targets: ['all'], outputPath: output, androidOutputPath: androidOutput });
  assert.deepEqual(draft.targets, ['api', 'website', 'android']);
  assert.equal(draft.api.count, 1);
  assert.equal(draft.website.count, 1);
  assert.equal(draft.android.readyToRun, true);
  assert.equal(draft.android.requiresManualAssertion, true);
  assert.equal(JSON.parse(await fs.readFile(androidOutput, 'utf8')).steps[0].type, 'assertForeground');
});


test('security inventory estimates dependencies across Cargo, Go, Python, Maven and .NET without claiming vulnerability results', async () => {
  const project = await fs.mkdtemp(path.join(temp, 'multi-deps-'));
  await fs.mkdir(path.join(project, 'app'), { recursive: true });
  await fs.writeFile(path.join(project, 'Cargo.toml'), '[dependencies]\nserde = "1"\ntokio = "1"\n');
  await fs.writeFile(path.join(project, 'Cargo.lock'), '[[package]]\nname = "serde"\nversion = "1.0.0"\n[[package]]\nname = "tokio"\nversion = "1.0.0"\n');
  await fs.writeFile(path.join(project, 'go.mod'), 'module example.test/app\nrequire (\n example.test/lib v1.0.0\n)\n');
  await fs.writeFile(path.join(project, 'go.sum'), 'example.test/lib v1.0.0 h1:abc\n');
  await fs.writeFile(path.join(project, 'requirements-prod.txt'), 'requests==2.32.0\n# comment\nflask>=3\n');
  await fs.writeFile(path.join(project, 'pom.xml'), '<project><dependencies><dependency></dependency></dependencies></project>');
  await fs.writeFile(path.join(project, 'app', 'Example.csproj'), '<Project><ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0" /></ItemGroup></Project>');
  const { scanProjectSecurity } = await import('../src/doctor/security-scan.mjs');
  const report = await scanProjectSecurity(project);
  const byName = Object.fromEntries(report.dependencies.ecosystems.map((item) => [item.ecosystem, item]));
  assert.equal(byName.cargo.estimatedDirectDependencies, 2);
  assert.equal(byName.cargo.estimatedLockedEntries, 2);
  assert.equal(byName.go.estimatedDirectDependencies, 1);
  assert.equal(byName.python.estimatedDirectDependencies, 2);
  assert.equal(byName.maven.estimatedDirectDependencies, 1);
  assert.equal(byName.dotnet.estimatedDirectDependencies, 1);
  assert.equal(report.dependencies.vulnerabilityDatabaseQueried, false);
  assert.match(report.dependencies.note, /static manifest heuristics/);
});

// Isolate the verified-fix ledger before importing the module.
process.env.XDG_CONFIG_HOME = path.join(temp, 'verified-config');
test('verified-fix memory accepts passing API, browser-simulation and physical Android journey evidence with separate assurance labels', async () => {
  const project = path.join(temp, 'verified-multi-project');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'flow.ts'), 'export const flow = true;\n');
  const api = await fixture('verified-multi/api.json', { runId: 'api-run', completedAt: new Date().toISOString(), executionKind: 'confirmed-read-only-api-smoke-tests', summary: { total: 1, passed: 1, failed: 0 }, results: [{ status: 'passed' }] });
  const website = await fixture('verified-multi/web.json', { runId: 'web-run', completedAt: new Date().toISOString(), runner: 'playwright-chromium', executionKind: 'simulated-browser-viewport', summary: { total: 1, passed: 1, failed: 0, review: 0 }, results: [{ status: 'passed' }] });
  const android = await fixture('verified-multi/android.json', { runId: 'android-run', completedAt: new Date().toISOString(), runner: 'adb-android-user-journey', executionKind: 'physical-android-device', status: 'completed', journeyPassClaim: true, device: { type: 'physical-device', model: 'test-device' }, summary: { steps: 2, passed: 2, failed: 0, assertions: 1, issues: 0 }, crashScan: { available: true, signals: [] }, issues: [] });
  const { recordVerifiedFix, listVerifiedFixes } = await import('../src/doctor/verified-fixes.mjs');
  const result = await recordVerifiedFix({ projectPath: project, evidencePaths: [api, website, android], summary: 'Cross-layer login regression verified', files: ['src/flow.ts'], confirm: true });
  assert.equal(result.record.evidence.reports.length, 3);
  assert.deepEqual(result.record.evidence.reports.map((item) => item.type), ['api', 'website', 'android-physical']);
  assert.ok(result.assurance.includes('simulated-browser-viewport-only'));
  assert.ok(result.assurance.includes('scripted-journey-on-physical-android; not full-device-certification'));
  const listed = await listVerifiedFixes(project);
  assert.equal(listed.records[0].freshness, 'source-snapshot-unchanged');
  assert.match(listed.note, /Browser results are simulations/);
});

test('verified-fix memory rejects Android emulator evidence as physical proof', async () => {
  const project = path.join(temp, 'verified-emulator-project');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'app.js'), 'export const value = 1;');
  const emulator = await fixture('verified-emulator/android.json', { completedAt: new Date().toISOString(), runner: 'adb-android-user-journey', executionKind: 'android-emulator', status: 'completed', journeyPassClaim: true, device: { type: 'emulator' }, summary: { steps: 1, passed: 1, failed: 0, assertions: 1 }, crashScan: { available: true, signals: [] }, issues: [] });
  const { recordVerifiedFix } = await import('../src/doctor/verified-fixes.mjs');
  await assert.rejects(() => recordVerifiedFix({ projectPath: project, evidencePath: emulator, summary: 'Emulator only', files: ['src/app.js'], confirm: true }), /emulator/);
});

after(async () => { await fs.rm(temp, { recursive: true, force: true }); });
