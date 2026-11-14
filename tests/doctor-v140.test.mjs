import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v140-'));
async function writeFixture(name, contents) {
  const file = path.join(temp, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  return file;
}

test('OpenAPI inspector validates OpenAPI 3 JSON operations, local references and path parameters', async () => {
  const { inspectOpenApiContract } = await import('../src/doctor/api-contract.mjs');
  const spec = {
    openapi: '3.0.3',
    info: { title: 'PAXI Test API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.test/v1' }],
    paths: {
      '/users/{userId}': {
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'getUser', responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } }
      }
    },
    components: { schemas: { User: { type: 'object', properties: { id: { type: 'string' } } } } }
  };
  const file = await writeFixture('openapi/good.json', JSON.stringify(spec));
  const report = await inspectOpenApiContract({ filePath: file });
  assert.equal(report.valid, true);
  assert.equal(report.summary.paths, 1);
  assert.equal(report.summary.operations, 1);
  assert.equal(report.summary.references, 1);
  assert.deepEqual(report.findings, []);
});

test('OpenAPI inspector finds duplicate operation IDs, broken references and undeclared path parameters', async () => {
  const { inspectOpenApiContract } = await import('../src/doctor/api-contract.mjs');
  const spec = {
    openapi: '3.1.0', info: { title: 'Bad API' },
    paths: {
      '/accounts/{accountId}': {
        get: {
          operationId: 'readAccount',
          responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } }
        }
      },
      '/users': { get: { operationId: 'readAccount', responses: { '200': { description: 'OK' } } } }
    }
  };
  const file = await writeFixture('openapi/bad.json', JSON.stringify(spec));
  const report = await inspectOpenApiContract({ filePath: file });
  const codes = report.findings.map((item) => item.code);
  assert.ok(codes.includes('broken-local-ref'));
  assert.ok(codes.includes('undeclared-path-parameter'));
  assert.ok(codes.includes('duplicate-operation-id'));
  assert.equal(report.valid, false);
});

test('OpenAPI inspector bounds input, rejects symlink files and reports YAML conversion requirement', async () => {
  const { inspectOpenApiContract } = await import('../src/doctor/api-contract.mjs');
  const yaml = await writeFixture('openapi/spec.yaml', 'openapi: 3.0.0\n');
  await assert.rejects(() => inspectOpenApiContract({ filePath: yaml }), /Convert YAML to JSON/);
  const link = path.join(temp, 'openapi', 'linked.json');
  await fs.symlink(yaml, link);
  await assert.rejects(() => inspectOpenApiContract({ filePath: link }), /regular, non-symlink/);
});

test('API smoke tests require confirmation and reject mutating methods and query strings', async () => {
  const { runApiSmokeTests } = await import('../src/doctor/api-contract.mjs');
  const file = await writeFixture('api/unsafe.json', JSON.stringify({ schemaVersion: 1, baseUrl: 'http://127.0.0.1:8080', cases: [{ id: 'create', method: 'POST', path: '/users' }] }));
  await assert.rejects(() => runApiSmokeTests({ filePath: file, confirm: false, fetchImpl: async () => { throw new Error('must not fetch'); } }), /pass --confirm/);
  await assert.rejects(() => runApiSmokeTests({ filePath: file, confirm: true }), /only GET and HEAD/);
  const queryFile = await writeFixture('api/query.json', JSON.stringify({ schemaVersion: 1, baseUrl: 'http://127.0.0.1:8080?token=hidden', cases: [{ id: 'health', path: '/health' }] }));
  await assert.rejects(() => runApiSmokeTests({ filePath: queryFile, confirm: true }), /must not contain credentials, query strings or fragments/);
});

test('API smoke tests run bounded GET/HEAD cases, assert JSON paths, redact bearer token and never retain bodies', async () => {
  const { runApiSmokeTests } = await import('../src/doctor/api-contract.mjs');
  const token = 'PAXI_TEST_SECRET_DO_NOT_REPORT';
  const file = await writeFixture('api/plan.json', JSON.stringify({
    schemaVersion: 1, name: 'Local API', baseUrl: 'http://127.0.0.1:8080/api', bearerTokenEnv: 'PAXI_TEST_API_TOKEN',
    cases: [
      { id: 'health', path: '/health', expectedStatus: [200], contentTypeIncludes: 'application/json', jsonPathsExist: ['status', 'dependencies.database.status'] },
      { id: 'not-found-is-expected', path: '/missing', expectedStatus: [404] },
      { id: 'bad-server-response', path: '/broken', expectedStatus: [200] }
    ]
  }));
  const calls = [];
  const report = await runApiSmokeTests({
    filePath: file, confirm: true, env: { PAXI_TEST_API_TOKEN: token },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok', dependencies: { database: { status: 'ready' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/missing')) return new Response('', { status: 404 });
      return new Response('failure', { status: 503, headers: { 'content-type': 'text/plain' } });
    }
  });
  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.passed, 2);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.results[0].status, 'passed');
  assert.equal(report.results[1].status, 'passed');
  assert.equal(report.results[2].issues[0].code, 'unexpected-status');
  assert.ok(calls.every((item) => item.options.redirect === 'manual'));
  assert.ok(calls.every((item) => item.options.headers.authorization === `Bearer ${token}`));
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.equal(JSON.stringify(report).includes('dependencies'), false);
  assert.ok(report.results.every((item) => item.bodyIncluded === false));
});

test('API smoke tests require HTTPS and explicit remote permission, and never follow redirects', async () => {
  const { runApiSmokeTests } = await import('../src/doctor/api-contract.mjs');
  const file = await writeFixture('api/remote.json', JSON.stringify({ schemaVersion: 1, baseUrl: 'https://api.example.test', cases: [{ id: 'health', path: '/health' }] }));
  await assert.rejects(() => runApiSmokeTests({ filePath: file, confirm: true, fetchImpl: async () => { throw new Error('must not fetch'); } }), /explicit --allow-remote/);
  const report = await runApiSmokeTests({ filePath: file, confirm: true, allowRemote: true, fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response('', { status: 302, headers: { location: 'https://other.example.test/' } });
  } });
  assert.equal(report.scope, 'explicit-remote-https');
  assert.equal(report.results[0].status, 'failed');
  assert.equal(report.results[0].redirectNotFollowed, true);
});

test('API smoke tests reject excessive cases, path traversal, unsafe JSON paths and oversized JSON responses', async () => {
  const { runApiSmokeTests } = await import('../src/doctor/api-contract.mjs');
  const traversal = await writeFixture('api/traversal.json', JSON.stringify({ schemaVersion: 1, baseUrl: 'http://127.0.0.1:8080', cases: [{ id: 'bad', path: '/../admin' }] }));
  await assert.rejects(() => runApiSmokeTests({ filePath: traversal, confirm: true }), /dot segments/);
  const unsafeJson = await writeFixture('api/unsafe-json-path.json', JSON.stringify({ schemaVersion: 1, baseUrl: 'http://127.0.0.1:8080', cases: [{ id: 'bad', path: '/x', jsonPathsExist: ['constructor.prototype'] }] }));
  await assert.rejects(() => runApiSmokeTests({ filePath: unsafeJson, confirm: true }), /simple dot-separated/);
  const oversized = await writeFixture('api/large-response.json', JSON.stringify({ schemaVersion: 1, baseUrl: 'http://127.0.0.1:8080', cases: [{ id: 'large', path: '/large', jsonPathsExist: ['status'] }] }));
  const report = await runApiSmokeTests({ filePath: oversized, confirm: true, fetchImpl: async () => new Response(' '.repeat(66 * 1024), { status: 200, headers: { 'content-type': 'application/json' } }) });
  assert.ok(report.results[0].issues.some((item) => item.code === 'invalid-json-response' && /64 KiB/.test(item.message)));
});

test('database migration scanner detects destructive and lock-risk SQL while ignoring comments and string literals', async () => {
  const { scanDatabaseMigrations } = await import('../src/doctor/database-migrations.mjs');
  const project = path.join(temp, 'migration-project');
  await fs.mkdir(path.join(project, 'supabase', 'migrations'), { recursive: true });
  await fs.writeFile(path.join(project, 'supabase', 'migrations', '001.sql'), [
    '-- DROP TABLE safe_comment;',
    "SELECT 'TRUNCATE TABLE fake_data';",
    'DELETE FROM users;',
    'UPDATE accounts SET active = false;',
    'ALTER TABLE profiles ADD COLUMN country TEXT NOT NULL;',
    'ALTER TABLE profiles DROP COLUMN legacy_name;',
    'CREATE INDEX idx_profiles_country ON profiles(country);'
  ].join('\n'));
  const report = await scanDatabaseMigrations(project);
  const codes = report.findings.map((item) => item.code);
  assert.equal(report.inventory.migrationFiles, 1);
  assert.ok(codes.includes('delete-without-where'));
  assert.ok(codes.includes('update-without-where'));
  assert.ok(codes.includes('add-not-null-without-default'));
  assert.ok(codes.includes('drop-column'));
  assert.ok(codes.includes('create-index-lock-risk'));
  assert.equal(codes.includes('drop-table-or-schema'), false);
  assert.equal(codes.includes('truncate-table'), false);
  assert.ok(report.summary.critical >= 1);
  assert.ok(report.findings.every((item) => item.recommendation && item.line > 0));
});

test('database migration scanner ignores symlinked files and rejects a symlink root', async () => {
  const { scanDatabaseMigrations } = await import('../src/doctor/database-migrations.mjs');
  const project = path.join(temp, 'migration-links');
  await fs.mkdir(project, { recursive: true });
  const external = await writeFixture('external-danger.sql', 'DROP TABLE important;');
  await fs.symlink(external, path.join(project, 'linked.sql'));
  const report = await scanDatabaseMigrations(project);
  assert.equal(report.inventory.migrationFiles, 0);
  const rootLink = path.join(temp, 'migration-root-link');
  await fs.symlink(project, rootLink);
  await assert.rejects(() => scanDatabaseMigrations(rootLink), /real, non-symlink/);
});

test.after(async () => { await fs.rm(temp, { recursive: true, force: true }); });
