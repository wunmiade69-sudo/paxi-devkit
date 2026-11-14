import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { validateOtlpHttpExporter } from '../src/doctor/otel-export-check.mjs';
import { runDisposableSqliteMigrationLab } from '../src/doctor/database-lab.mjs';
import { runNativeVulnerabilityScan, generateProjectSbom } from '../src/doctor/security-adapters.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v190-'));
const python = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0 ? 'python3'
  : spawnSync('python', ['--version'], { encoding: 'utf8' }).status === 0 ? 'python' : null;

async function project(name) {
  const root = path.join(temp, name);
  await fs.mkdir(root, { recursive: true });
  return root;
}

test('OTLP export validation requires consent and sends only one synthetic span to a loopback collector', async () => {
  await assert.rejects(() => validateOtlpHttpExporter({ endpoint: 'http://127.0.0.1:4318/v1/traces' }), /--confirm/);
  await assert.rejects(() => validateOtlpHttpExporter({ endpoint: 'http://collector.example/v1/traces', confirm: true }), /--allow-remote/);
  await assert.rejects(() => validateOtlpHttpExporter({ endpoint: 'https://user:secret@collector.example/v1/traces', confirm: true, allowRemote: true }), /without embedded credentials/);

  let received = null;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { method: request.method, contentType: request.headers['content-type'], body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"partialSuccess":{}}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const report = await validateOtlpHttpExporter({ endpoint: `http://127.0.0.1:${port}/v1/traces`, confirm: true });
    assert.equal(report.status, 'accepted');
    assert.equal(report.acceptedByCollector, true);
    assert.equal(received.method, 'POST');
    assert.equal(received.contentType, 'application/json');
    assert.equal(received.body.resourceSpans[0].scopeSpans[0].spans[0].name, 'paxi.doctor.synthetic_export_probe');
    assert.ok(!JSON.stringify(report).includes('partialSuccess'));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('OTLP export validator refuses non-OTLP paths and records non-2xx without response-body retention', async () => {
  await assert.rejects(() => validateOtlpHttpExporter({ endpoint: 'http://127.0.0.1:4318/', confirm: true }), /end in \/v1\/traces/);
  const report = await validateOtlpHttpExporter({ endpoint: 'http://127.0.0.1:4318/v1/traces', confirm: true, fetchImpl: async () => ({ status: 415, body: { cancel: async () => {} } }) });
  assert.equal(report.status, 'rejected');
  assert.equal(report.httpStatus, 415);
  assert.equal(report.acceptedByCollector, false);
});

test('disposable SQLite lab replays SQLite-compatible migrations in memory and reports schema changes only', { skip: !python && 'Python is not installed on this host.' }, async () => {
  const root = await project('sqlite-ok');
  await fs.mkdir(path.join(root, 'migrations'));
  await fs.writeFile(path.join(root, 'seed.sql'), 'CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT);');
  await fs.writeFile(path.join(root, 'migrations', '001_add_status.sql'), "ALTER TABLE accounts ADD COLUMN status TEXT DEFAULT 'active';");
  await fs.writeFile(path.join(root, 'migrations', '002_create_index.sql'), "CREATE INDEX idx_accounts_status ON accounts(status); INSERT INTO accounts(name) VALUES ('super-secret-row-value');");
  await assert.rejects(() => runDisposableSqliteMigrationLab({ projectPath: root, migrationsPath: 'migrations', seedSqlPath: 'seed.sql' }), /--confirm/);
  const report = await runDisposableSqliteMigrationLab({ projectPath: root, migrationsPath: 'migrations', seedSqlPath: 'seed.sql', confirm: true, pythonCommand: python });
  assert.equal(report.status, 'passed');
  assert.equal(report.summary.passed, 2);
  assert.equal(report.before.tables, 1);
  assert.equal(report.after.indexes, 1);
  assert.equal(report.schemaChanged, true);
  assert.equal(report.safety.databaseMode, 'sqlite-in-memory');
  assert.ok(!JSON.stringify(report).includes('super-secret-row-value'));
  assert.ok(!JSON.stringify(report).includes('accounts(name) VALUES'));
});

test('disposable SQLite lab blocks ATTACH and restores the migration snapshot after a failing script', { skip: !python && 'Python is not installed on this host.' }, async () => {
  const root = await project('sqlite-blocked');
  await fs.mkdir(path.join(root, 'migrations'));
  await fs.writeFile(path.join(root, 'migrations', '001_bad.sql'), "CREATE TABLE transient (id INTEGER); ATTACH DATABASE '/tmp/not-allowed.db' AS outside;");
  const report = await runDisposableSqliteMigrationLab({ projectPath: root, migrationsPath: 'migrations', confirm: true, pythonCommand: python });
  assert.equal(report.status, 'failed');
  assert.equal(report.summary.failed, 1);
  assert.equal(report.after.tables, 0);
  assert.match(report.results[0].message, /not authorized/i);
});

test('disposable SQLite lab blocks VACUUM INTO file writes', { skip: !python && 'Python is not installed on this host.' }, async () => {
  const root = await project('sqlite-vacuum');
  await fs.mkdir(path.join(root, 'migrations'));
  const escaped = path.join(temp, 'vacuum-escape.db');
  await fs.writeFile(path.join(root, 'migrations', '001.sql'), `CREATE TABLE harmless (id INTEGER); VACUUM INTO '${escaped.replaceAll('\\', '/')}'`);
  const report = await runDisposableSqliteMigrationLab({ projectPath: root, migrationsPath: 'migrations', confirm: true, pythonCommand: python });
  assert.equal(report.status, 'failed');
  assert.match(report.results[0].message, /VACUUM.*denied/);
  await assert.rejects(() => fs.stat(escaped), /ENOENT/);
});

test('disposable SQLite lab refuses symlinked migration inputs', async (t) => {
  if (process.platform === 'win32') return t.skip('Symlink creation requires additional Windows permissions.');
  const root = await project('sqlite-symlink');
  const outside = path.join(temp, 'outside-migrations');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, '001.sql'), 'CREATE TABLE x(id INTEGER);');
  await fs.symlink(outside, path.join(root, 'migrations'));
  await assert.rejects(() => runDisposableSqliteMigrationLab({ projectPath: root, migrationsPath: 'migrations', confirm: true, pythonCommand: python }), /non-symlink directory/);
});

test('native OSV scanner normalizes advisory records and never labels unparsed output as clean', async () => {
  const root = await project('osv-project');
  await assert.rejects(() => runNativeVulnerabilityScan({ scanner: 'osv-scanner', projectPath: root }), /--online --confirm/);
  const report = await runNativeVulnerabilityScan({ scanner: 'osv-scanner', projectPath: root, online: true, confirm: true, exists: async () => true, runner: async (command, args) => {
    assert.equal(command, 'osv-scanner');
    if (!args.includes(root)) return { code: 0, stdout: 'osv-scanner 2.0.0', stderr: '' };
    assert.ok(args.includes(root));
    assert.ok(args.includes('--all-packages'));
    return { code: 0, stdout: JSON.stringify({ results: [{ packages: [{ package: { name: 'fixture-package', version: '1.0.0' }, vulnerabilities: [{ id: 'CVE-2026-0001', summary: 'Test advisory', database_specific: { severity: 'HIGH' } }] }] }] }), stderr: '' };
  } });
  assert.equal(report.complete, true);
  assert.equal(report.summary.packagesScanned, 1);
  assert.equal(report.clean, false);
  assert.equal(report.advisories[0].id, 'CVE-2026-0001');
  const unparsed = await runNativeVulnerabilityScan({ scanner: 'osv-scanner', projectPath: root, online: true, confirm: true, exists: async () => true, runner: async () => ({ code: 0, stdout: 'not-json', stderr: '' }) });
  assert.equal(unparsed.status, 'completed-unparsed');
  assert.equal(unparsed.clean, false);
  const noInventory = await runNativeVulnerabilityScan({ scanner: 'osv-scanner', projectPath: root, online: true, confirm: true, exists: async () => true, runner: async () => ({ code: 0, stdout: JSON.stringify({ results: [] }), stderr: '' }) });
  assert.equal(noInventory.status, 'completed-coverage-unknown');
  assert.equal(noInventory.clean, false);
  const osv2 = await runNativeVulnerabilityScan({ scanner: 'osv-scanner', projectPath: root, online: true, confirm: true, exists: async () => true, runner: async (_command, args) => args.includes(root)
    ? { code: 1, stdout: JSON.stringify({ results: [{ packages: [{ package: { name: 'lodash', version: '4.17.20' }, groups: [{ ids: ['GHSA-29mw-wpgm-hmr9'] }], vulnerabilities: [{ id: 'GHSA-29mw-wpgm-hmr9', summary: 'ReDoS', database_specific: { severity: 'MODERATE' }, severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }] }] }] }] }), stderr: '' }
    : { code: 0, stdout: 'osv-scanner version: 2.7.1', stderr: '' } });
  assert.equal(osv2.complete, true);
  assert.equal(osv2.clean, false);
  assert.equal(osv2.summary.packagesScanned, 1);
  assert.equal(osv2.advisories[0].package, 'lodash');
  assert.equal(osv2.advisories[0].version, '4.17.20');
  assert.equal(osv2.advisories[0].severity, 'MODERATE');
});

test('SBOM generator validates CycloneDX output, refuses overwrite and requires an installed Syft binary', async () => {
  const root = await project('sbom-root');
  const output = path.join(temp, 'fixture-sbom.json');
  const missing = await generateProjectSbom({ projectPath: root, outputPath: output, confirm: true, exists: async () => false });
  assert.equal(missing.status, 'tool-missing');
  const report = await generateProjectSbom({ projectPath: root, outputPath: output, confirm: true, exists: async () => true, runner: async (_command, args) => {
    const format = args.find((item) => item.startsWith('cyclonedx-json='));
    assert.ok(format);
    await fs.writeFile(format.slice('cyclonedx-json='.length), JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, components: [{ name: 'fixture', version: '1.0' }] }));
    return { code: 0, stdout: '', stderr: '' };
  } });
  assert.equal(report.status, 'generated');
  assert.equal(report.summary.components, 1);
  await assert.rejects(() => generateProjectSbom({ projectPath: root, outputPath: output, confirm: true, exists: async () => true, runner: async () => { throw new Error('must not run'); } }), /already exists/);
});

test('security tool registry does not equate a missing scanner with a clean audit', async () => {
  const { listNativeSecurityScanners } = await import('../src/doctor/security-adapters.mjs');
  const items = await listNativeSecurityScanners({ exists: async () => false });
  assert.ok(items.length >= 5);
  assert.ok(items.every((item) => item.available === false));
});


test('framework test adapter planner identifies Swift, Ruby, PHP and Dart project types even when toolchains are missing', async () => {
  const { detectProjectTestCommand } = await import('../src/doctor/project-test-executor.mjs');
  const swift = await project('swift-plan');
  await fs.writeFile(path.join(swift, 'Package.swift'), '// swift package');
  assert.equal((await detectProjectTestCommand(swift, { exists: async () => false })).id, 'swift-test');
  assert.equal((await detectProjectTestCommand(swift, { exists: async () => false })).available, false);

  const ruby = await project('ruby-plan');
  await fs.writeFile(path.join(ruby, 'Gemfile'), 'source "https://rubygems.org"');
  await fs.writeFile(path.join(ruby, 'Rakefile'), 'task :test');
  assert.equal((await detectProjectTestCommand(ruby, { exists: async (command) => command === 'bundle' })).id, 'ruby-rake-test');

  const php = await project('php-plan');
  await fs.writeFile(path.join(php, 'phpunit.xml'), '<phpunit/>');
  assert.equal((await detectProjectTestCommand(php, { exists: async () => false })).id, 'php-phpunit-test');

  const dart = await project('dart-plan');
  await fs.writeFile(path.join(dart, 'pubspec.yaml'), 'name: fixture');
  assert.equal((await detectProjectTestCommand(dart, { exists: async (command) => command === 'dart' })).id, 'dart-test');
});


test('OTLP probe can use a designated authorization environment variable without serializing its value', async () => {
  const secret = 'Bearer paxi-collector-secret-token';
  process.env.PAXI_OTEL_AUTHORIZATION = secret;
  let authorization = null;
  try {
    const report = await validateOtlpHttpExporter({ endpoint: 'http://127.0.0.1:4318/v1/traces', confirm: true, authorizationEnv: 'PAXI_OTEL_AUTHORIZATION', fetchImpl: async (_url, options) => { authorization = options.headers.authorization; return { status: 202, body: { cancel: async () => {} } }; } });
    assert.equal(authorization, secret);
    assert.equal(report.authConfigured, true);
    assert.ok(!JSON.stringify(report).includes(secret));
  } finally { delete process.env.PAXI_OTEL_AUTHORIZATION; }
});
