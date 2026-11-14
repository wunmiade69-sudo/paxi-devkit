import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTraceId, createTraceparent, parseTraceparent, extractTraceContext, validateTraceId, inspectTraceLog } from '../src/doctor/trace-context.mjs';
import { runApiSmokeTests, writeApiSmokeReport } from '../src/doctor/api-contract.mjs';
import { analyzeCrossLayerEvidence } from '../src/doctor/cross-layer-correlation.mjs';
import { draftRegressionSuite } from '../src/doctor/regression-draft.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-doctor-v160-'));
async function fixture(name, value) {
  const file = path.join(temp, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
}

test('W3C trace context creates valid non-zero identifiers and parses only supported version-00 traceparents', () => {
  const traceId = createTraceId();
  assert.match(traceId, /^[a-f0-9]{32}$/);
  const parent = createTraceparent(traceId);
  assert.match(parent, /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  assert.equal(parseTraceparent(parent).traceId, traceId);
  assert.equal(extractTraceContext({ traceparent: parent }).traceId, traceId);
  assert.equal(extractTraceContext({ 'X-Request-Id': 'req-123' }).requestId, 'req-123');
  assert.equal(parseTraceparent(`00-${'0'.repeat(32)}-${'1'.repeat(16)}-01`), null);
  assert.throws(() => validateTraceId('not-a-trace'), /32 hexadecimal/);
});

test('API smoke runner propagates an explicitly supplied W3C trace ID and records it without response bodies', async () => {
  const planFile = await fixture('api/plan.json', { schemaVersion: 1, baseUrl: 'http://127.0.0.1:8080', cases: [{ id: 'health', method: 'GET', path: '/health', expectedStatus: [200] }] });
  const traceId = 'a'.repeat(32);
  let observed = null;
  const report = await runApiSmokeTests({
    filePath: planFile, confirm: true, traceId,
    fetchImpl: async (_url, options) => {
      observed = options.headers.traceparent;
      return { status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: null };
    }
  });
  assert.equal(parseTraceparent(observed).traceId, traceId);
  assert.equal(report.traceContext.traceId, traceId);
  assert.equal(report.results[0].traceId, traceId);
  assert.equal(report.results[0].bodyIncluded, false);
  const output = path.join(temp, 'api', 'report.json');
  const saved = await writeApiSmokeReport({ outputPath: output, report });
  assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).traceContext.traceId, traceId);
  assert.equal(saved.path, output);
  if (process.platform !== 'win32') assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
});

test('cross-layer correlation elevates only exact shared trace IDs and does not retain arbitrary IDs', async () => {
  const traceId = 'b'.repeat(32);
  const api = await fixture('trace/api.json', {
    schemaVersion: 1, executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test', traceContext: { traceId },
    results: [{ id: 'users', method: 'GET', path: '/users', status: 'failed', statusCode: 500, traceId, issues: [{ code: 'unexpected-status', message: 'HTTP 500' }] }]
  });
  const web = await fixture('trace/web.json', {
    schemaVersion: 1, runner: 'playwright-chromium', executionKind: 'simulated-browser-viewport', targetUrl: 'https://app.example.test',
    results: [{ id: 'standard', status: 'failed', issues: [], evidence: { httpErrors: [{ url: 'https://api.example.test/users', method: 'GET', status: 500, resourceType: 'fetch', traceId }] } }]
  });
  const report = await analyzeCrossLayerEvidence({ reportPaths: [api, web] });
  const exact = report.correlations.find((item) => item.code === 'distributed-trace-id-match');
  assert.equal(exact.confidence, 'high');
  assert.equal(exact.traceId, traceId);
  assert.equal(report.summary.traceIds, 1);
});

test('regression draft selects only matching reviewed GET/HEAD API plan cases and never calls network', async () => {
  const plan = await fixture('regression/api-plan.json', {
    schemaVersion: 1, baseUrl: 'https://api.example.test/v1',
    cases: [
      { id: 'health', method: 'GET', path: '/health', expectedStatus: [200] },
      { id: 'users', method: 'GET', path: '/users', expectedStatus: [200] },
      { id: 'write', method: 'POST', path: '/users', expectedStatus: [201] }
    ]
  });
  const evidence = await fixture('regression/correlation.json', {
    schemaVersion: 1, reportType: 'paxi-cross-layer-evidence-correlation', events: [
      { sourceType: 'api', sourceFile: 'api.json', sourceId: 'users', status: 'failed', severity: 'high', host: 'api.example.test', path: '/v1/users', method: 'GET', code: 'api-smoke-failed', summary: 'HTTP 500' },
      { sourceType: 'website', sourceFile: 'web.json', sourceId: 'other', status: 'failed', severity: 'high', host: 'api.example.test', path: '/v1/health', method: 'GET', code: 'api-http-error', summary: 'HTTP 503' }
    ]
  });
  const output = path.join(temp, 'regression', 'draft.json');
  const draft = await draftRegressionSuite({ planPath: plan, evidencePath: evidence, outputPath: output });
  assert.deepEqual(draft.cases.map((item) => item.id), ['users', 'health']);
  assert.ok(draft.generatedFromDefects.reviewRequired);
  assert.ok((await fs.stat(output)).mode & 0o600);
  await assert.rejects(() => draftRegressionSuite({ planPath: plan, evidencePath: evidence, outputPath: output }), /already exists/);
});

test('regression drafting refuses non-correlation evidence and unsafe/non-matching cases', async () => {
  const plan = await fixture('regression/unsafe-plan.json', { schemaVersion: 1, baseUrl: 'https://api.example.test', cases: [{ id: 'mutate', method: 'POST', path: '/write' }] });
  const evidence = await fixture('regression/not-correlation.json', { summary: {}, events: [] });
  await assert.rejects(() => draftRegressionSuite({ planPath: plan, evidencePath: evidence }), /cross-layer correlation report/);
});

after(async () => { await fs.rm(temp, { recursive: true, force: true }); });

// Isolate the verified-fix ledger in this test process before importing its config path.
process.env.XDG_CONFIG_HOME = path.join(temp, 'isolated-config');
const { recordVerifiedFix, listVerifiedFixes, clearVerifiedFixes } = await import('../src/doctor/verified-fixes.mjs');

test('verified regression memory requires all API cases to pass and becomes stale when tracked source changes', async () => {
  const project = path.join(temp, 'verified-project');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  const sourceFile = path.join(project, 'src', 'auth.mjs');
  await fs.writeFile(sourceFile, 'export const auth = true;\n');
  const reportPath = await fixture('verified/passing-report.json', {
    schemaVersion: 1, runId: 'run-123', completedAt: new Date().toISOString(),
    executionKind: 'confirmed-read-only-api-smoke-tests', summary: { total: 2, passed: 2, failed: 0 },
    results: [{ id: 'health', status: 'passed' }, { id: 'profile', status: 'passed' }]
  });
  await assert.rejects(() => recordVerifiedFix({ projectPath: project, evidencePath: reportPath, summary: 'API auth fix verified', files: ['src/auth.mjs'] }), /pass --confirm/);
  const saved = await recordVerifiedFix({ projectPath: project, evidencePath: reportPath, summary: 'API auth fix verified', files: ['src/auth.mjs'], confirm: true });
  assert.equal(saved.verification, 'all API regression cases passed');
  let listed = await listVerifiedFixes(project);
  assert.equal(listed.count, 1);
  assert.equal(listed.records[0].freshness, 'source-snapshot-unchanged');
  await fs.appendFile(sourceFile, 'export const revised = true;\n');
  listed = await listVerifiedFixes(project);
  assert.equal(listed.records[0].freshness, 'stale-source-changed');
  const cleared = await clearVerifiedFixes(project);
  assert.equal(cleared.removed, 1);
});

test('verified regression memory rejects partial failures, symlinked files and path traversal', async () => {
  const project = path.join(temp, 'verified-reject-project');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'main.js'), 'ok');
  const failingReport = await fixture('verified/failing-report.json', {
    executionKind: 'confirmed-read-only-api-smoke-tests', completedAt: new Date().toISOString(),
    summary: { total: 2, passed: 1, failed: 1 }, results: [{ status: 'passed' }, { status: 'failed' }]
  });
  await assert.rejects(() => recordVerifiedFix({ projectPath: project, evidencePath: failingReport, summary: 'not verified', files: ['src/main.js'], confirm: true }), /did not pass every case/);
  const passingReport = await fixture('verified/passing-path-report.json', {
    executionKind: 'confirmed-read-only-api-smoke-tests', completedAt: new Date().toISOString(),
    summary: { total: 1, passed: 1, failed: 0 }, results: [{ status: 'passed' }]
  });
  await assert.rejects(() => recordVerifiedFix({ projectPath: project, evidencePath: passingReport, summary: 'unsafe traversal', files: ['../outside.js'], confirm: true }), /remain inside the project/);
  await fs.symlink(path.join(project, 'src', 'main.js'), path.join(project, 'src', 'linked.js'));
  await assert.rejects(() => recordVerifiedFix({ projectPath: project, evidencePath: passingReport, summary: 'symlink rejected', files: ['src/linked.js'], confirm: true }), /cannot traverse a symlink/);
});

const { runWebsiteDeviceLab } = await import('../src/doctor/website-lab.mjs');
test('website lab injects W3C traceparent only into XHR/fetch requests when explicitly enabled', async () => {
  const traceId = 'c'.repeat(32);
  let routeHandler = null;
  let continued = null;
  const fakePage = {
    on() {},
    async goto() {},
    async evaluate() { return { viewport: { innerWidth: 390, innerHeight: 844, documentWidth: 390, documentHeight: 844 }, horizontalOverflow: false, overflowingElements: [], titlePresent: true, viewportMetaPresent: true, imagesMissingAlt: 0, buttonsMissingName: 0, visibleInputCount: 0 }; },
    async screenshot({ path: file }) { await fs.writeFile(file, Buffer.from('screenshot-fixture')); },
    locator() { return { count: async () => 0 }; },
    async addStyleTag() {}
  };
  const fakeContext = {
    async route(_pattern, handler) { routeHandler = handler; },
    async newPage() { return fakePage; },
    async close() {},
    async setOffline() {}
  };
  const fakePlaywright = { chromium: { async launch() { return { async newContext() { return fakeContext; }, async close() {} }; } } };
  const report = await runWebsiteDeviceLab({
    url: 'http://127.0.0.1:4173', projectRoot: temp, outputDir: path.join(temp, 'website-trace-output'),
    profiles: ['compact'], traceId, playwrightModule: fakePlaywright
  });
  assert.equal(report.traceContext.enabled, true);
  assert.equal(report.traceContext.traceId, traceId);
  assert.equal(typeof routeHandler, 'function');
  await routeHandler({
    request: () => ({ resourceType: () => 'fetch', headers: () => ({ accept: 'application/json' }), method: () => 'GET' }),
    async continue(options) { continued = options; }
  });
  assert.equal(parseTraceparent(continued.headers.traceparent).traceId, traceId);
  let documentOptions = null;
  await routeHandler({
    request: () => ({ resourceType: () => 'document', headers: () => ({}), method: () => 'GET' }),
    async continue(options) { documentOptions = options; }
  });
  assert.equal(documentOptions, undefined);
});


test('backend trace-log inspector returns bounded redacted matching excerpts and correlation accepts the report', async () => {
  const traceId = 'd'.repeat(32);
  const log = await fixture('backend/app.log', [
    JSON.stringify({ timestamp: '2026-11-10T12:00:00Z', level: 'error', service: 'api', trace_id: traceId, message: 'GET /users failed token=super-secret-value' }),
    JSON.stringify({ level: 'info', trace_id: 'e'.repeat(32), message: 'unrelated request' })
  ].join('\n'));
  const traceReport = await inspectTraceLog({ filePath: log, traceId });
  assert.equal(traceReport.summary.matches, 1);
  assert.equal(traceReport.matches[0].level, 'error');
  assert.equal(traceReport.matches[0].service, 'api');
  assert.equal(JSON.stringify(traceReport).includes('super-secret-value'), false);
  const api = await fixture('backend/api-report.json', {
    executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test', traceContext: { traceId },
    results: [{ id: 'users', method: 'GET', path: '/users', status: 'failed', statusCode: 500, traceId, issues: [{ code: 'unexpected-status', message: 'HTTP 500' }] }]
  });
  const traceFile = await fixture('backend/trace-report.json', traceReport);
  const correlated = await analyzeCrossLayerEvidence({ reportPaths: [api, traceFile] });
  assert.ok(correlated.correlations.some((item) => item.code === 'backend-trace-context-match' && item.layers.includes('backend-trace')));
});

test('backend trace-log inspector refuses symlink files and oversized logs', async () => {
  const traceId = 'f'.repeat(32);
  const log = await fixture('backend/large.log', 'x'.repeat(4096));
  await assert.rejects(() => inspectTraceLog({ filePath: log, traceId, maxBytes: 1024 }), /exceeds/);
  const link = path.join(temp, 'backend', 'log-link');
  await fs.symlink(log, link);
  await assert.rejects(() => inspectTraceLog({ filePath: link, traceId }), /non-symlink/);
});

const { buildAgentPlan } = await import('../src/doctor/agent-engine.mjs');
test('Agent Engine exposes only current verified regression knowledge as advisory planning context', async () => {
  const project = path.join(temp, 'agent-verified-project');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'agent-verified-project', version: '1.0.0', scripts: { test: 'node --test' } }));
  await fs.writeFile(path.join(project, 'src', 'routes.mjs'), 'export const route = "/health";\n');
  const evidence = await fixture('agent-verified/passing.json', {
    executionKind: 'confirmed-read-only-api-smoke-tests', runId: 'agent-run', completedAt: new Date().toISOString(),
    summary: { total: 1, passed: 1, failed: 0 }, results: [{ id: 'health', status: 'passed' }]
  });
  await recordVerifiedFix({ projectPath: project, evidencePath: evidence, summary: 'Health route returned expected response after correction', files: ['src/routes.mjs'], confirm: true });
  const plan = await buildAgentPlan({ projectPath: project });
  assert.equal(plan.verifiedKnowledge.count, 1);
  assert.equal(plan.verifiedKnowledge.current, 1);
  assert.equal(plan.verifiedKnowledge.stale, 0);
  assert.ok(plan.steps.some((item) => item.id === 'reuse-verified-regression-knowledge'));
  await fs.appendFile(path.join(project, 'src', 'routes.mjs'), '// changed\n');
  const refreshed = await buildAgentPlan({ projectPath: project });
  assert.equal(refreshed.verifiedKnowledge.current, 0);
  assert.equal(refreshed.verifiedKnowledge.stale, 1);
  assert.ok(refreshed.steps.some((item) => item.id === 'refresh-stale-regression-knowledge'));
});
