import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateApiSmokePlan, writeGeneratedApiPlan, runApiSmokeTests } from '../src/doctor/api-contract.mjs';
import { analyzeCrossLayerEvidence } from '../src/doctor/cross-layer-correlation.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-doctor-v150-'));
async function fixture(name, content) {
  const file = path.join(temp, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return file;
}

test('OpenAPI generator creates bounded GET/HEAD cases and excludes mutations, dynamic and deprecated routes', async () => {
  const spec = {
    openapi: '3.1.0', info: { title: 'PAXI Test API', version: '2.0' }, servers: [{ url: 'http://127.0.0.1:8080/api' }],
    paths: {
      '/health': { get: { operationId: 'getHealth', responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string' } } } } } } } } },
      '/ready': { head: { operationId: 'headReady', responses: { '204': { description: 'Ready' } } } },
      '/users/{userId}': { get: { operationId: 'getUser', responses: { '200': { description: 'OK' } } } },
      '/users': { post: { operationId: 'createUser', responses: { '201': { description: 'Created' } } } },
      '/legacy': { get: { operationId: 'legacy', deprecated: true, responses: { '200': { description: 'OK' } } } }
    }
  };
  const openapi = await fixture('spec/openapi.json', spec);
  const plan = await generateApiSmokePlan({ filePath: openapi });
  assert.equal(plan.baseUrl, 'http://127.0.0.1:8080/api');
  assert.deepEqual(plan.cases.map((item) => `${item.method} ${item.path}`), ['GET /health', 'HEAD /ready']);
  assert.equal(plan.cases[0].contentTypeIncludes, 'json');
  assert.deepEqual(plan.cases[0].jsonPathsExist, ['status']);
  assert.deepEqual(plan.cases[0].expectedStatus, [200]);
  assert.equal(plan.generationSummary.skipped.templatedPaths, 1);
  assert.equal(plan.generationSummary.skipped.unsupportedMethods, 1);
  assert.equal(plan.generationSummary.skipped.deprecatedOperations, 1);
});

test('OpenAPI generator requires a resolvable server URL or explicit base URL and enforces case cap', async () => {
  const spec = { openapi: '3.0.3', info: { title: 'No server' }, paths: { '/a': { get: { responses: { '200': { description: 'OK' } } } } } };
  const file = await fixture('spec/no-server.json', spec);
  await assert.rejects(() => generateApiSmokePlan({ filePath: file }), /Supply an explicit --base-url/);
  const plan = await generateApiSmokePlan({ filePath: file, baseUrl: 'https://api.example.test/v1', maxCases: 1 });
  assert.equal(plan.cases.length, 1);
  await assert.rejects(() => generateApiSmokePlan({ filePath: file, baseUrl: 'file:///etc/passwd' }), /credentials, query strings or fragments/);
});

test('generated API plans write with private permissions and never overwrite existing output', async () => {
  const specFile = await fixture('write/openapi.json', { openapi: '3.0.0', info: { title: 'Write test' }, servers: [{ url: 'http://localhost:9000' }], paths: { '/health': { get: { responses: { '200': { description: 'OK' } } } } } });
  const plan = await generateApiSmokePlan({ filePath: specFile });
  const output = path.join(temp, 'write', 'generated.json');
  const result = await writeGeneratedApiPlan({ outputPath: output, plan });
  assert.equal(result.path, output);
  assert.equal(JSON.parse(await fs.readFile(output, 'utf8')).cases[0].path, '/health');
  if (process.platform !== 'win32') assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
  await assert.rejects(() => writeGeneratedApiPlan({ outputPath: output, plan }), /already exists/);
});

test('generated plans remain subject to the existing explicit consent and remote HTTPS guard', async () => {
  const file = await fixture('remote/openapi.json', { openapi: '3.0.0', info: { title: 'Remote' }, servers: [{ url: 'https://api.example.test' }], paths: { '/health': { get: { responses: { '200': { description: 'OK' } } } } } });
  const plan = await generateApiSmokePlan({ filePath: file });
  const planFile = await fixture('remote/plan.json', plan);
  await assert.rejects(() => runApiSmokeTests({ filePath: planFile, confirm: false }), /pass --confirm/);
  await assert.rejects(() => runApiSmokeTests({ filePath: planFile, confirm: true, fetchImpl: async () => { throw new Error('network must not run'); } }), /explicit --allow-remote/);
});

test('cross-layer correlation matches browser and API route/status evidence without retaining secrets or response bodies', async () => {
  const api = await fixture('reports/api.json', {
    schemaVersion: 1, executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test/api',
    results: [{ id: 'user-route', method: 'GET', path: '/users/123', status: 'failed', statusCode: 500, issues: [{ code: 'unexpected-status', message: 'Expected HTTP 200; received 500.' }], responseBody: 'PRIVATE RESPONSE BODY', authorization: 'Bearer DO_NOT_LEAK' }]
  });
  const website = await fixture('reports/website.json', {
    schemaVersion: 1, runner: 'playwright-chromium', executionKind: 'simulated-browser-viewport', targetUrl: 'https://www.example.test',
    results: [{ id: 'compact-light', status: 'failed', issues: [], evidence: { httpErrors: [{ url: 'https://api.example.test/api/users/999?token=never-copy', status: 500, resourceType: 'fetch' }] } }]
  });
  const report = await analyzeCrossLayerEvidence({ reportPaths: [api, website] });
  assert.equal(report.summary.reports, 2);
  assert.equal(report.summary.events, 2);
  assert.equal(report.correlations.length, 1);
  assert.equal(report.correlations[0].code, 'frontend-api-route-match');
  assert.equal(report.correlations[0].route, '/api/users/:id');
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('PRIVATE RESPONSE BODY'), false);
  assert.equal(serialized.includes('DO_NOT_LEAK'), false);
  assert.equal(serialized.includes('token=never-copy'), false);
  assert.match(report.limitations.join(' '), /establish causation/);
});

test('cross-layer correlation connects unhealthy runtime and API reports on the same host', async () => {
  const runtime = await fixture('reports/runtime.json', { schemaVersion: 1, probeId: 'probe-1', target: 'https://api.example.test/health', healthy: false, statusCode: 503, failure: 'HTTP 503', dependencies: [{ name: 'database', status: 'unhealthy' }] });
  const api = await fixture('reports/api-runtime.json', { schemaVersion: 1, executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test/api', results: [{ id: 'list', method: 'GET', path: '/users', status: 'failed', statusCode: 503, issues: [{ code: 'unexpected-status', message: 'HTTP 503' }] }] });
  const report = await analyzeCrossLayerEvidence({ reportPaths: [runtime, api] });
  assert.ok(report.correlations.some((item) => item.code === 'service-health-and-request-failure' && item.confidence === 'medium'));
  assert.ok(report.events.some((item) => item.code === 'runtime-dependency-unhealthy'));
});

test('cross-layer reports classify Android, database and security evidence without promoting capture-only results to passes', async () => {
  const android = await fixture('reports/android.json', { schemaVersion: 1, runner: 'adb-device-lab', executionKind: 'physical-android-device', devicePassClaim: false, device: { type: 'physical-device', model: 'test-phone', androidRelease: '15' } });
  const database = await fixture('reports/database.json', { schemaVersion: 1, executionKind: 'read-only-sql-migration-review', findings: [{ code: 'drop-column', severity: 'high', message: 'Column removed.' }] });
  const security = await fixture('reports/security.json', { schemaVersion: 1, executionKind: 'read-only-static-security-review', findings: [{ code: 'unsafe-storage', severity: 'warning', message: 'Potential insecure storage.' }] });
  const report = await analyzeCrossLayerEvidence({ reportPaths: [android, database, security] });
  assert.deepEqual(report.summary.layers, ['android-device-lab', 'database', 'security']);
  assert.ok(report.events.some((item) => item.code === 'android-device-context' && item.status === 'evidence-only'));
  assert.ok(report.correlations.length === 0);
});

test('cross-layer ingestion rejects symlinks, invalid JSON and unknown report schemas', async () => {
  const base = await fixture('invalid/plain.json', '{}');
  const link = path.join(temp, 'invalid', 'link.json');
  await fs.symlink(base, link);
  await assert.rejects(() => analyzeCrossLayerEvidence({ reportPaths: [link] }), /non-symlink/);
  const malformed = await fixture('invalid/malformed.json', '{bad');
  await assert.rejects(() => analyzeCrossLayerEvidence({ reportPaths: [malformed] }), /valid JSON/);
  const unknown = await fixture('invalid/unknown.json', { schemaVersion: 1, data: [] });
  await assert.rejects(() => analyzeCrossLayerEvidence({ reportPaths: [unknown] }), /unrecognized/);
});

test.after(async () => { await fs.rm(temp, { recursive: true, force: true }); });
