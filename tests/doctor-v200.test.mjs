import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDisposableServiceMigrationLab } from '../src/doctor/database-service-lab.mjs';
import { validateSbomFile, evaluateSbomLicensePolicy } from '../src/doctor/sbom-policy.mjs';
import { runNativeVulnerabilityScan } from '../src/doctor/security-adapters.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v200-'));
async function project(name) {
  const root = path.join(temp, name);
  await fs.mkdir(path.join(root, 'migrations'), { recursive: true });
  await fs.writeFile(path.join(root, 'migrations', '001_init.sql'), 'CREATE TABLE accounts (id INTEGER PRIMARY KEY, email TEXT NOT NULL);');
  return root;
}

function fakeDbRunner(engine, { migrationCode = 0, cleanupCode = 0 } = {}) {
  const calls = [];
  let snapshots = 0;
  let catalogSnapshots = 0;
  const runner = async (command, args, options = {}) => {
    const pgpassContent = options.env?.PGPASSFILE ? await fs.readFile(options.env.PGPASSFILE, 'utf8').catch(() => '') : '';
    calls.push({ command, args, stdin: options.stdin, env: options.env, pgpassContent });
    const sql = String(options.stdin || '');
    if (sql.includes('PAXI_SCHEMA_CATALOG')) {
      catalogSnapshots += 1;
      const catalog = catalogSnapshots === 1
        ? 'table|accounts\ncolumn|accounts|id|integer\n'
        : 'table|accounts\ncolumn|accounts|id|integer\ncolumn|accounts|email|text\n';
      return { code: 0, stdout: catalog, stderr: '', durationMs: 1, outputTruncated: false };
    }
    if (sql.includes('information_schema') || sql.includes('sys.tables')) {
      snapshots += 1;
      return { code: 0, stdout: snapshots === 1 ? '0\n0\n' : '1\n1\n', stderr: '', durationMs: 1 };
    }
    if (/CREATE TABLE accounts/i.test(sql)) return { code: migrationCode, stdout: '', stderr: migrationCode ? 'migration failed' : '', durationMs: 2 };
    if (/DROP DATABASE|DROP ROLE|DROP USER/i.test(sql)) return { code: cleanupCode, stdout: '', stderr: cleanupCode ? 'cleanup failed' : '' };
    return { code: 0, stdout: '', stderr: '', durationMs: 1 };
  };
  return { runner, calls };
}

test('service database lab requires confirmation, a loopback URL, local client and bounded SQL files', async () => {
  const root = await project('pg-preflight');
  await assert.rejects(() => runDisposableServiceMigrationLab({ engine: 'postgres', projectPath: root }), /--confirm/);
  await assert.rejects(() => runDisposableServiceMigrationLab({ engine: 'postgres', projectPath: root, confirm: true, env: { PAXI_TEST_POSTGRES_ADMIN_URL: 'postgres://admin:secret@db.example.com:5432/postgres' } }), /loopback/);
  const missing = await runDisposableServiceMigrationLab({ engine: 'postgres', projectPath: root, confirm: true, env: { PAXI_TEST_POSTGRES_ADMIN_URL: 'postgres://admin:secret@127.0.0.1:5432/postgres' }, exists: async () => false });
  assert.equal(missing.status, 'tool-missing');
  assert.equal(missing.passed, false);
});

test('PostgreSQL disposable service lab uses random restricted role, pipes SQL on stdin, redacts credentials and cleans up', async () => {
  const root = await project('pg-pass');
  const adminUrl = 'postgresql://doctor_admin:highly-private-password@127.0.0.1:5432/postgres';
  const fake = fakeDbRunner('postgres');
  const report = await runDisposableServiceMigrationLab({
    engine: 'postgres', projectPath: root, confirm: true,
    env: { PAXI_TEST_POSTGRES_ADMIN_URL: adminUrl },
    exists: async (command) => command === 'psql', runner: fake.runner
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.cleanupComplete, true);
  assert.equal(report.database.hostScope, 'loopback-only');
  assert.equal(report.database.persistentTarget, false);
  assert.equal(report.schemaComparison.status, 'changed');
  assert.equal(report.schemaChanged, true);
  assert.equal(report.before.catalog.available, true);
  assert.equal(report.after.catalog.available, true);
  assert.equal(report.after.catalog.rawMetadataRetained, false);
  assert.ok(fake.calls.some((call) => /NOSUPERUSER NOCREATEDB NOCREATEROLE/.test(String(call.stdin))));
  assert.ok(fake.calls.some((call) => /CREATE DATABASE .* OWNER "doctor_admin" TEMPLATE template0/.test(String(call.stdin))));
  assert.ok(fake.calls.some((call) => /GRANT CONNECT, CREATE, TEMPORARY ON DATABASE/.test(String(call.stdin)) && /GRANT USAGE, CREATE ON SCHEMA public/.test(String(call.stdin))));
  assert.ok(fake.calls.some((call) => call.pgpassContent.includes('127.0.0.1:5432:*:doctor_admin:highly-private-password')));
  assert.ok(fake.calls.some((call) => call.stdin?.includes('CREATE TABLE accounts')));
  assert.ok(fake.calls.some((call) => call.stdin?.includes('DROP DATABASE')));
  assert.ok(fake.calls.every((call) => !call.args.join(' ').includes('highly-private-password')));
  assert.ok(!JSON.stringify(report).includes('highly-private-password'));
  assert.ok(fake.calls.every((call) => call.options?.shell !== true));
});

test('MySQL and MariaDB labs use restricted per-database grants and clean up generated resources', async () => {
  for (const engine of ['mysql', 'mariadb']) {
    const root = await project(`${engine}-pass`);
    const envName = engine === 'mysql' ? 'PAXI_TEST_MYSQL_ADMIN_URL' : 'PAXI_TEST_MARIADB_ADMIN_URL';
    const protocol = engine === 'mysql' ? 'mysql' : 'mariadb';
    const fake = fakeDbRunner(engine);
    const report = await runDisposableServiceMigrationLab({
      engine, projectPath: root, confirm: true,
      env: { [envName]: `${protocol}://admin:local-secret@localhost:3306/mysql` },
      exists: async (command) => command === (engine === 'mysql' ? 'mysql' : 'mariadb'), runner: fake.runner
    });
    assert.equal(report.status, 'passed');
    assert.ok(fake.calls.some((call) => /GRANT ALL PRIVILEGES ON `paxi_test_/.test(String(call.stdin))));
    assert.ok(fake.calls.some((call) => call.stdin?.includes('DROP DATABASE')));
    assert.ok(fake.calls.every((call) => !call.args.join(' ').includes('local-secret')));
  }
});

test('service database lab blocks external client directives and still cleans up a partially created database', async () => {
  const root = await project('mysql-directive');
  await fs.writeFile(path.join(root, 'migrations', '001_init.sql'), 'CREATE TABLE t(id INT);\n\\! touch /tmp/paxi-should-never-exist');
  const fake = fakeDbRunner('mysql');
  await assert.rejects(() => runDisposableServiceMigrationLab({
    engine: 'mysql', projectPath: root, confirm: true,
    env: { PAXI_TEST_MYSQL_ADMIN_URL: 'mysql://admin:secret@127.0.0.1:3306/mysql' },
    exists: async () => true, runner: fake.runner
  }), /client command/);
  assert.equal(fake.calls.length, 0);
});

test('service database lab reports migration failure and cleanup failure without claiming success', async () => {
  const root = await project('pg-fail');
  const fake = fakeDbRunner('postgres', { migrationCode: 1, cleanupCode: 1 });
  const report = await runDisposableServiceMigrationLab({
    engine: 'postgres', projectPath: root, confirm: true,
    env: { PAXI_TEST_POSTGRES_ADMIN_URL: 'postgres://admin:secret@localhost:5432/postgres' },
    exists: async () => true, runner: fake.runner
  });
  assert.equal(report.passed, false);
  assert.equal(report.cleanupComplete, false);
  assert.equal(report.results[0].status, 'failed');
});

test('SBOM structural validator recognises CycloneDX and reports malformed references', async () => {
  const goodPath = path.join(temp, 'valid.cdx.json');
  await fs.writeFile(goodPath, JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, components: [{ type: 'library', name: 'alpha', version: '1.0', 'bom-ref': 'pkg:alpha' }] }));
  const good = await validateSbomFile({ filePath: goodPath });
  assert.equal(good.status, 'structurally-valid');
  const badPath = path.join(temp, 'invalid.cdx.json');
  await fs.writeFile(badPath, JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, components: [{ name: 'alpha', 'bom-ref': 'dup' }, { name: 'beta', 'bom-ref': 'dup' }] }));
  const bad = await validateSbomFile({ filePath: badPath });
  assert.equal(bad.status, 'invalid');
  assert.ok(bad.issues.some((item) => item.code === 'DUPLICATE_BOM_REF'));
});

test('SPDX SBOM structural validation checks document and package identifiers', async () => {
  const filePath = path.join(temp, 'spdx.json');
  await fs.writeFile(filePath, JSON.stringify({ spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0', SPDXID: 'SPDXRef-DOCUMENT', name: 'test', packages: [{ name: 'dep', SPDXID: 'SPDXRef-dep', licenseDeclared: 'MIT' }] }));
  const report = await validateSbomFile({ filePath });
  assert.equal(report.format, 'spdx');
  assert.equal(report.summary.errors, 0);
});

test('license policy allows configured identifiers, blocks denied/not-allowlisted packages and flags unknown metadata', async () => {
  const sbomPath = path.join(temp, 'licenses.cdx.json');
  const policyPath = path.join(temp, 'license-policy.json');
  await fs.writeFile(sbomPath, JSON.stringify({
    bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    components: [
      { name: 'good', version: '1.0', licenses: [{ license: { id: 'MIT' } }] },
      { name: 'denied', version: '2.0', licenses: [{ license: { id: 'GPL-3.0-only' } }] },
      { name: 'unknown', version: '1.0', licenses: [] }
    ]
  }));
  await fs.writeFile(policyPath, JSON.stringify({ schemaVersion: 1, allow: ['MIT', 'Apache-2.0'], deny: ['GPL-3.0-only'], unknown: 'fail' }));
  const report = await evaluateSbomLicensePolicy({ sbomPath, policyPath });
  assert.equal(report.passed, false);
  assert.equal(report.summary.allowed, 1);
  assert.equal(report.summary.denied, 2);
  assert.equal(report.findings.find((item) => item.component === 'denied').status, 'denied');
  assert.equal(report.findings.find((item) => item.component === 'unknown').status, 'unknown-denied');
});

test('license policy supports exact component exceptions and rejects malformed policy identifiers', async () => {
  const sbomPath = path.join(temp, 'exception.cdx.json');
  const policyPath = path.join(temp, 'exception-policy.json');
  await fs.writeFile(sbomPath, JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, components: [{ name: 'legacy', version: '2.1', licenses: [{ license: { id: 'GPL-2.0-only' } }] }] }));
  await fs.writeFile(policyPath, JSON.stringify({ schemaVersion: 1, allow: ['MIT'], deny: ['GPL-2.0-only'], unknown: 'warn', exceptions: [{ name: 'legacy', version: '2.1', reason: 'Approved by architecture review ticket ARCH-12.' }] }));
  const accepted = await evaluateSbomLicensePolicy({ sbomPath, policyPath });
  assert.equal(accepted.passed, true);
  assert.equal(accepted.summary.excepted, 1);
  await fs.writeFile(policyPath, JSON.stringify({ schemaVersion: 1, allow: ['; DROP TABLE'], deny: [], unknown: 'fail' }));
  await assert.rejects(() => evaluateSbomLicensePolicy({ sbomPath, policyPath }), /SPDX identifiers/);
});


test('native scanner reports its locally detected version separately from advisory results', async () => {
  const root = await project('scanner-version');
  let calls = 0;
  const report = await runNativeVulnerabilityScan({
    scanner: 'osv-scanner', projectPath: root, online: true, confirm: true,
    exists: async () => true,
    runner: async (_command, args) => {
      calls += 1;
      if (args.length === 1 && args[0] === '--version') return { code: 0, stdout: 'osv-scanner 2.1.0\n', stderr: '' };
      return { code: 0, stdout: JSON.stringify({ results: [{ packages: [{ package: { name: 'fixture', version: '1.0.0' }, vulnerabilities: [] }] }] }), stderr: '' };
    }
  });
  assert.equal(calls, 2);
  assert.equal(report.scannerVersion, 'osv-scanner 2.1.0');
  assert.equal(report.complete, true);
});

test('MySQL loopback account host follows the selected IPv6 loopback endpoint', async () => {
  const root = await project('mysql-ipv6');
  const fake = fakeDbRunner('mysql');
  const report = await runDisposableServiceMigrationLab({
    engine: 'mysql', projectPath: root, confirm: true,
    env: { PAXI_TEST_MYSQL_ADMIN_URL: 'mysql://admin:secret@[::1]:3306/mysql' },
    exists: async () => true, runner: fake.runner
  });
  assert.equal(report.status, 'passed');
  const createUser = fake.calls.find((call) => /CREATE USER 'pxrole_[a-f0-9]+'@'::1'/.test(String(call.stdin)));
  assert.ok(createUser);
  const generatedRole = String(createUser.stdin).match(/CREATE USER '([^']+)'/)[1];
  assert.ok(generatedRole.length <= 32);
  assert.ok(fake.calls.some((call) => /DROP USER IF EXISTS 'pxrole_[a-f0-9]+'@'::1'/.test(String(call.stdin))));
});

test('license policy rejects malformed exception entries instead of silently ignoring them', async () => {
  const sbomPath = path.join(temp, 'invalid-exception.cdx.json');
  const policyPath = path.join(temp, 'invalid-exception-policy.json');
  await fs.writeFile(sbomPath, JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, components: [{ name: 'legacy', version: '2.1', licenses: [{ license: { id: 'MIT' } }] }] }));
  await fs.writeFile(policyPath, JSON.stringify({ schemaVersion: 1, allow: ['MIT'], deny: [], unknown: 'fail', exceptions: [{ name: 'legacy', reason: '   ' }] }));
  await assert.rejects(() => evaluateSbomLicensePolicy({ sbomPath, policyPath }), /exception 1/);
});


test('database lab detects schema-definition changes even when object counts are unchanged', async () => {
  const root = await project('pg-definition-change');
  let countCalls = 0;
  let catalogCalls = 0;
  const runner = async (_command, _args, options = {}) => {
    const sql = String(options.stdin || '');
    if (sql.includes('PAXI_SCHEMA_CATALOG')) {
      catalogCalls += 1;
      return { code: 0, stdout: catalogCalls === 1 ? 'column|accounts|email|varchar|64\n' : 'column|accounts|email|varchar|128\n', stderr: '', outputTruncated: false };
    }
    if (sql.includes('information_schema')) {
      countCalls += 1;
      return { code: 0, stdout: '1\n1\n1\n0\n0\n0\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const report = await runDisposableServiceMigrationLab({
    engine: 'postgres', projectPath: root, confirm: true,
    env: { PAXI_TEST_POSTGRES_ADMIN_URL: 'postgres://admin:secret@127.0.0.1:5432/postgres' },
    exists: async () => true, runner
  });
  assert.equal(countCalls, 2);
  assert.equal(report.before.tables, report.after.tables);
  assert.equal(report.schemaComparison.status, 'changed');
  assert.equal(report.schemaChanged, true);
});


test('database lab returns indeterminate rather than unchanged when metadata capture is truncated and counts are stable', async () => {
  const root = await project('pg-indeterminate-catalog');
  let countSnapshots = 0;
  const runner = async (_command, _args, options = {}) => {
    const sql = String(options.stdin || '');
    if (sql.includes('PAXI_SCHEMA_CATALOG')) return { code: 0, stdout: 'partial metadata', stderr: '', outputTruncated: true };
    if (sql.includes('information_schema')) {
      countSnapshots += 1;
      return { code: 0, stdout: '1\n1\n1\n0\n0\n0\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const report = await runDisposableServiceMigrationLab({
    engine: 'postgres', projectPath: root, confirm: true,
    env: { PAXI_TEST_POSTGRES_ADMIN_URL: 'postgres://admin:secret@127.0.0.1:5432/postgres' },
    exists: async () => true, runner
  });
  assert.equal(countSnapshots, 2);
  assert.equal(report.before.catalog.available, false);
  assert.equal(report.after.catalog.available, false);
  assert.equal(report.schemaComparison.status, 'indeterminate');
  assert.equal(report.schemaChanged, null);
  assert.equal(report.status, 'partial');
  assert.equal(report.passed, false);
  assert.equal(report.migrationReplayPassed, true);
});
