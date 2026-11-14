import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyzeCrossLayerEvidence } from '../src/doctor/cross-layer-correlation.mjs';
import { draftRegressionSuite } from '../src/doctor/regression-draft.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v250-investigation-'));
async function fixture(name, value) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const raw = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(file, raw);
  return file;
}

test('cross-layer report records integrity hashes, normalized event IDs and a timestamp-sorted trace timeline', async () => {
  const traceId = 'a'.repeat(32);
  const apiValue = {
    executionKind: 'confirmed-read-only-api-smoke-tests',
    target: 'https://api.example.test',
    completedAt: '2026-11-13T08:00:02.000Z',
    traceContext: { traceId },
    results: [{ id: 'profile-get', method: 'GET', path: '/profile', status: 'failed', statusCode: 500, timestamp: '2026-11-13T08:00:02.000Z', traceId, issues: [{ code: 'http-status', message: 'HTTP 500' }] }]
  };
  const spanValue = {
    reportType: 'paxi-otel-span-report', executionKind: 'read-only-otel-span-import',
    spans: [
      { traceId, spanId: '1'.repeat(16), parentSpanId: null, name: 'GET /profile', service: 'profile-api', status: 'error', isError: true, startTimeUnixNano: '1794556800000000000', durationMs: 30, http: { method: 'GET', route: '/profile', statusCode: 500 } },
      { traceId, spanId: '2'.repeat(16), parentSpanId: '1'.repeat(16), name: 'SELECT profile', service: 'profile-api', status: 'error', isError: true, database: { system: 'postgresql', operation: 'SELECT', namespace: 'password=do-not-leak' }, startTimeUnixNano: '1794556800100000000', durationMs: 10, http: {} }
    ]
  };
  const api = await fixture('trace/api.json', apiValue);
  const spans = await fixture('trace/spans.json', spanValue);
  const report = await analyzeCrossLayerEvidence({ reportPaths: [api, spans] });
  assert.equal(report.inputs[0].sha256, createHash('sha256').update(await fs.readFile(api)).digest('hex'));
  assert.ok(report.events.every((item) => /^ev-[a-f0-9]{20}$/.test(item.eventId)));
  assert.ok(report.events.every((item) => !('eventTimeMs' in item)));
  assert.ok(report.events.some((item) => item.timestampSource === 'otel-span-start'));
  assert.ok(!JSON.stringify(report).includes('do-not-leak'));
  assert.equal(report.evidenceCoverage.status, 'evidence-linked');
  assert.equal(report.timeline.timestampedEvents, 3);
  assert.equal(report.timeline.ordering, 'timestamp-sorted');
  assert.ok(report.investigationCases.some((item) => item.identityBasis === 'exact-w3c-trace-id' && item.layers.includes('api') && item.layers.includes('backend-spans')));
  assert.equal(report.evidenceCoverage.backendTelemetryAvailable, true);
  assert.equal(JSON.stringify(report).includes(path.resolve(api)), false);
});

test('route-only groups are explicitly weak and request W3C propagation instead of claiming a shared incident', async () => {
  const api = await fixture('route/api.json', {
    executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test',
    results: [{ id: 'profile', method: 'GET', path: '/profile', status: 'failed', statusCode: 500, issues: [] }]
  });
  const web = await fixture('route/web.json', {
    reportType: 'paxi-semantic-website-journey', runner: 'playwright-chromium', executionKind: 'simulated-browser-semantic-journey',
    targetUrl: 'https://www.example.test/profile',
    results: [{ index: 1, type: 'assertText', status: 'failed', error: 'Profile heading missing' }],
    httpErrors: []
  });
  const report = await analyzeCrossLayerEvidence({ reportPaths: [api, web] });
  const routeCase = report.investigationCases.find((item) => item.identityBasis === 'normalized-host-method-route-only');
  assert.ok(routeCase);
  assert.equal(routeCase.confidence, 'low-route-context-only');
  assert.deepEqual(routeCase.layers, ['api', 'website']);
  assert.ok(report.evidenceCoverage.recommendations.some((item) => item.includes('W3C trace ID')));
  assert.ok(routeCase.interpretation.includes('does not prove causality'));
  assert.ok(routeCase.missingEvidence.some((item) => item.id === 'w3c-trace-propagation'));
  assert.ok(routeCase.missingEvidence.some((item) => item.id === 'backend-observability'));
});

test('correlator rejects the same evidence bytes supplied more than once', async () => {
  const reportFile = await fixture('duplicates/api.json', {
    executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test',
    results: [{ id: 'health', method: 'GET', path: '/health', status: 'failed', statusCode: 503, issues: [] }]
  });
  await assert.rejects(() => analyzeCrossLayerEvidence({ reportPaths: [reportFile, reportFile] }), /Duplicate evidence input detected by SHA-256/);
});

test('regression website draft includes bounded suggested checks from observed issue codes without inventing selectors', async () => {
  const evidence = await fixture('draft/correlation.json', {
    schemaVersion: 2, reportType: 'paxi-cross-layer-evidence-correlation', events: [
      { eventId: 'ev-abc', sourceType: 'website', sourceFile: 'web.json', sourceId: 'compact', status: 'failed', severity: 'high', host: 'www.example.test', origin: 'https://www.example.test', path: '/settings', method: 'GET', code: 'horizontal-overflow', summary: 'Document wider than viewport' },
      { eventId: 'ev-def', sourceType: 'website', sourceFile: 'web.json', sourceId: 'compact', status: 'failed', severity: 'medium', host: 'www.example.test', origin: 'https://www.example.test', path: '/settings', method: 'GET', code: 'browser-runtime-error', summary: 'Uncaught error' }
    ]
  });
  const result = await draftRegressionSuite({ evidencePath: evidence, targets: ['website'] });
  assert.equal(result.website.count, 1);
  assert.deepEqual(result.website.routes[0].suggestedChecks.sort(), ['assertNoBrowserRuntimeErrors', 'assertNoHorizontalOverflow']);
  assert.equal(result.website.routes[0].manualAssertionsRequired, true);
  assert.ok(result.website.routes[0].evidence.some((item) => item.eventId === 'ev-abc'));
});


test('global event cap is enforced and evidence coverage reports omitted events', async () => {
  const reports = [];
  for (let index = 0; index < 4; index += 1) {
    reports.push(await fixture(`cap/api-${index}.json`, {
      generatedAt: `2026-11-13T08:00:0${index}.000Z`,
      executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test',
      results: Array.from({ length: 300 }, (_, item) => ({ id: `case-${index}-${item}`, method: 'GET', path: `/resource/${item}`, status: 'failed', statusCode: 500, issues: [] }))
    }));
  }
  const report = await analyzeCrossLayerEvidence({ reportPaths: reports });
  assert.equal(report.events.length, 1000);
  assert.equal(report.summary.eventsTruncated, true);
  assert.equal(report.evidenceCoverage.eventsTruncated, true);
  assert.ok(report.evidenceCoverage.recommendations.some((item) => item.includes('global event limit')));
  assert.equal(report.inputs.reduce((sum, item) => sum + item.eventsOmitted, 0), 200);
});

test('Agent Engine turns missing cross-layer coverage into concrete evidence-collection steps', async () => {
  const project = path.join(root, 'agent-project');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'agent-fixture', private: true, scripts: { test: 'node --test' } }));
  const api = await fixture('agent/api.json', {
    executionKind: 'confirmed-read-only-api-smoke-tests', target: 'https://api.example.test',
    results: [{ id: 'profile', method: 'GET', path: '/profile', status: 'failed', statusCode: 500, issues: [] }]
  });
  const web = await fixture('agent/web.json', {
    reportType: 'paxi-semantic-website-journey', runner: 'playwright-chromium', executionKind: 'simulated-browser-semantic-journey',
    targetUrl: 'https://www.example.test/profile', results: [{ index: 1, type: 'assertText', status: 'failed', error: 'Profile heading missing' }], httpErrors: []
  });
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/paxi.mjs');
  const configRoot = path.join(root, 'isolated-config');
  const run = spawnSync(process.execPath, [cli, 'doctor', 'agent', 'plan', '--project', project, '--evidence', api, '--evidence', web, '--json'], {
    encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: configRoot }, timeout: 30000
  });
  assert.equal(run.status, 0, run.stderr);
  const plan = JSON.parse(run.stdout);
  assert.ok(plan.steps.some((step) => step.id === 'collect-missing-cross-layer-evidence'));
  assert.ok(plan.steps.some((step) => step.type === 'evidence-collection' && step.action.includes('W3C traceparent')));
  assert.equal(plan.execution.status, 'plan-only');
  assert.equal(plan.execution.testsRun, false);
  assert.equal(plan.execution.filesChanged, false);
});

after(async () => fs.rm(root, { recursive: true, force: true }));
