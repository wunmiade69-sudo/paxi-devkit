import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateSbomLicensePolicy } from '../src/doctor/sbom-policy.mjs';
import { validateSbomAgainstSchema } from '../src/doctor/sbom-schema.mjs';
import { runWebsiteAccessibilityAudit } from '../src/doctor/website-accessibility.mjs';
import { runDisposableServiceMigrationLab } from '../src/doctor/database-service-lab.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paxi-v211-'));
const write = async (name, value) => {
  const file = path.join(root, name);
  await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};

test('SPDX policy treats OR as an alternative and AND as cumulative', async () => {
  const sbomPath = await write('compound.cdx.json', {
    bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    components: [
      { name: 'or-choice', licenses: [{ expression: 'MIT OR GPL-3.0-only' }] },
      { name: 'and-choice', licenses: [{ expression: 'MIT AND GPL-3.0-only' }] }
    ]
  });
  const policyPath = await write('compound-policy.json', { schemaVersion: 1, allow: ['MIT'], deny: ['GPL-3.0-only'], unknown: 'fail' });
  const report = await evaluateSbomLicensePolicy({ sbomPath, policyPath });
  assert.equal(report.findings.find((item) => item.component === 'or-choice').status, 'allowed');
  assert.equal(report.findings.find((item) => item.component === 'and-choice').status, 'denied');
});

test('SPDX WITH exception requires explicit allow-list approval', async () => {
  const sbomPath = await write('with.cdx.json', { bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, components: [{ name: 'legacy', licenses: [{ expression: 'GPL-2.0-only WITH Classpath-exception-2.0' }] }] });
  const policyPath = await write('with-policy.json', { schemaVersion: 1, allow: ['GPL-2.0-only'], deny: [], unknown: 'fail' });
  const review = await evaluateSbomLicensePolicy({ sbomPath, policyPath });
  assert.equal(review.findings[0].status, 'review');
  await fs.writeFile(policyPath, JSON.stringify({ schemaVersion: 1, allow: ['GPL-2.0-only'], deny: [], allowExceptions: ['Classpath-exception-2.0'], unknown: 'fail' }));
  const approved = await evaluateSbomLicensePolicy({ sbomPath, policyPath });
  assert.equal(approved.findings[0].status, 'allowed');
});

test('SPDX membership snapshots are hash-pinned and their versions must match', async () => {
  const sbomPath = await write('registry.cdx.json', { bomFormat: 'CycloneDX', specVersion: '1.6', version: 1, components: [{ name: 'alpha', licenses: [{ expression: 'MIT' }] }] });
  const policyPath = await write('registry-policy.json', { schemaVersion: 1, allow: ['MIT'], deny: [], unknown: 'fail' });
  const licenseList = await write('licenses.json', { licenseListVersion: '3.27', licenses: [{ licenseId: 'MIT', isDeprecatedLicenseId: false }] });
  const exceptionList = await write('exceptions.json', { licenseListVersion: '3.27', exceptions: [{ licenseExceptionId: 'Classpath-exception-2.0', isDeprecatedLicenseExceptionId: false }] });
  const hash = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const report = await evaluateSbomLicensePolicy({ sbomPath, policyPath, licenseListPath: licenseList, exceptionListPath: exceptionList, licenseListSha256: await hash(licenseList), exceptionListSha256: await hash(exceptionList) });
  assert.equal(report.spdxRegistry.licenseList.version, '3.27');
  await assert.rejects(() => evaluateSbomLicensePolicy({ sbomPath, policyPath, licenseListPath: licenseList, exceptionListPath: exceptionList, licenseListSha256: '0'.repeat(64) }), /does not match/);
  await fs.writeFile(exceptionList, JSON.stringify({ licenseListVersion: '3.26', exceptions: [] }));
  await assert.rejects(() => evaluateSbomLicensePolicy({ sbomPath, policyPath, licenseListPath: licenseList, exceptionListPath: exceptionList }), /versions differ/);
});

test('SBOM schema validator enforces optional SHA-256 pin and does not shell out', async () => {
  const document = await write('sbom.json', { bomFormat: 'CycloneDX' });
  const schema = await write('schema.json', { type: 'object' });
  let call = null;
  const runner = async (command, args, options) => {
    call = { command, args, options };
    return { code: 0, stdout: JSON.stringify({ status: 'valid', valid: true, errors: [], schema: { sha256: createHash('sha256').update(await fs.readFile(schema)).digest('hex') } }), stderr: '' };
  };
  const schemaHash = createHash('sha256').update(await fs.readFile(schema)).digest('hex');
  const report = await validateSbomAgainstSchema({ filePath: document, schemaPath: schema, schemaSha256: schemaHash, python: 'python3', runner, exists: async () => true });
  assert.equal(report.status, 'valid');
  assert.equal(call.options.stdin, undefined);
  assert.equal(call.options.shell, undefined);
  await assert.rejects(() => validateSbomAgainstSchema({ filePath: document, schemaPath: schema, schemaSha256: 'a'.repeat(64), runner, exists: async () => true }), /does not match/);
});

test('Official SBOM schema helper validates a supplied local schema when jsonschema is installed', async (t) => {
  const document = await write('official-schema-good.json', { bomFormat: 'CycloneDX' });
  const invalidDocument = await write('official-schema-bad.json', { wrong: true });
  const schema = await write('official-schema.json', {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object', required: ['bomFormat'], properties: { bomFormat: { const: 'CycloneDX' } }, additionalProperties: true
  });
  const valid = await validateSbomAgainstSchema({ filePath: document, schemaPath: schema });
  if (valid.status === 'tool-missing') return t.skip('Python jsonschema is optional on this host; hosted CI installs it.');
  assert.equal(valid.status, 'valid');
  const invalid = await validateSbomAgainstSchema({ filePath: invalidDocument, schemaPath: schema });
  assert.equal(invalid.status, 'invalid');
  assert.ok(invalid.errors.length > 0);
  const externalSchema = await write('external-ref-schema.json', { $ref: 'https://example.com/schema.json' });
  const external = await validateSbomAgainstSchema({ filePath: document, schemaPath: externalSchema });
  assert.equal(external.status, 'error');
  assert.match(external.message, /External or non-local JSON Schema reference is blocked/);
});

test('Website accessibility refuses remote URLs without explicit HTTPS consent before loading tools', async () => {
  await assert.rejects(() => runWebsiteAccessibilityAudit({ url: 'https://example.com', confirm: true, allowRemote: false }), /require an HTTPS URL and explicit --allow-remote/);
  await assert.rejects(() => runWebsiteAccessibilityAudit({ url: 'http://example.com', confirm: true, allowRemote: true }), /require an HTTPS URL and explicit --allow-remote/);
  await assert.rejects(() => runWebsiteAccessibilityAudit({ url: 'http://127.0.0.1:4173', confirm: false }), /Pass --confirm/);
});


test('SQL Server disposable lab scopes the generated login to a random database and cleans up', async () => {
  const project = path.join(root, 'sqlserver-project');
  const migrations = path.join(project, 'migrations');
  await fs.mkdir(migrations, { recursive: true });
  await fs.writeFile(path.join(migrations, '001_init.sql'), 'CREATE TABLE dbo.accounts (id INT NOT NULL PRIMARY KEY);');
  const calls = [];
  let snapshots = 0;
  let catalogSnapshots = 0;
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, stdin: options.stdin, env: options.env });
    const sql = String(options.stdin || '');
    if (sql.includes('PAXI_SCHEMA_CATALOG')) {
      catalogSnapshots += 1;
      return { code: 0, stdout: catalogSnapshots === 1 ? 'column|accounts|id|int\n' : 'column|accounts|id|int\n', stderr: '', outputTruncated: false };
    }
    if (sql.includes('sys.databases')) return { code: 0, stdout: 'ONLINE\n', stderr: '' };
    if (sql.includes('sys.tables')) {
      snapshots += 1;
      return { code: 0, stdout: snapshots === 1 ? '0\n0\n0\n0\n0\n0\n' : '1\n1\n1\n0\n0\n0\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const secret = 'very-private-sqlserver-password';
  const report = await runDisposableServiceMigrationLab({
    engine: 'sqlserver', projectPath: project, confirm: true,
    env: { PAXI_TEST_SQLSERVER_ADMIN_URL: `mssql://admin:${secret}@127.0.0.1:1433/master` },
    exists: async (name) => name === 'sqlcmd', runner
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.cleanupComplete, true);
  assert.equal(report.database.hostScope, 'loopback-only');
  assert.equal(report.safety.sqlServerLoginScopedToGeneratedDatabase, true);
  assert.equal(report.safety.sqlServerPasswordPassedThroughEnvironment, true);
  assert.ok(calls.some((call) => /CREATE LOGIN/.test(String(call.stdin))));
  assert.ok(calls.some((call) => /SELECT state_desc FROM sys\.databases/.test(String(call.stdin))));
  assert.ok(calls.some((call) => /ALTER ROLE \[db_owner\] ADD MEMBER/.test(String(call.stdin))));
  assert.ok(calls.some((call) => /CREATE TABLE dbo.accounts/.test(String(call.stdin))));
  assert.ok(calls.some((call) => /DROP LOGIN/.test(String(call.stdin))));
  assert.ok(calls.every((call) => String(call.stdin).endsWith('\nGO\n')));
  assert.ok(calls.every((call) => !call.args.join(' ').includes(secret)));
  assert.ok(calls.every((call) => typeof call.env.SQLCMDPASSWORD === 'string' && call.env.SQLCMDPASSWORD.length >= 24));
  assert.equal(calls[0].env.SQLCMDPASSWORD, secret);
  assert.ok(!JSON.stringify(report).includes(secret));
});

test('SQL Server disposable lab blocks SQLCMD directives and server-level access commands', async () => {
  const project = path.join(root, 'sqlserver-blocked');
  const migrations = path.join(project, 'migrations');
  await fs.mkdir(migrations, { recursive: true });
  await fs.writeFile(path.join(migrations, '001_bad.sql'), "EXEC xp_cmdshell 'whoami';");
  let invoked = false;
  await assert.rejects(() => runDisposableServiceMigrationLab({
    engine: 'sqlserver', projectPath: project, confirm: true,
    env: { PAXI_TEST_SQLSERVER_ADMIN_URL: 'mssql://admin:secret@localhost:1433/master' },
    exists: async () => true, runner: async () => { invoked = true; return { code: 0 }; }
  }), /blocked SQL Server/);
  assert.equal(invoked, false);
});

test.after(async () => fs.rm(root, { recursive: true, force: true }));

test('accessibility evidence cannot be marked passed when axe checks are incomplete', async () => {
  const { classifyAccessibilityEvidence } = await import('../src/doctor/website-accessibility.mjs');
  const result = classifyAccessibilityEvidence({ incomplete: [{ id: 'color-contrast' }] });
  assert.equal(result.status, 'review');
  assert.ok(result.reviewReasons.includes('axe-incomplete-needs-manual-review'));
});

test('accessibility evidence requires review when browser requests or runtime responses were blocked or errored', async () => {
  const { classifyAccessibilityEvidence } = await import('../src/doctor/website-accessibility.mjs');
  const result = classifyAccessibilityEvidence({
    blockedRequests: [{ reason: 'cross-origin' }],
    runtimeErrors: ['TypeError: failed'],
    httpErrors: [{ status: 500 }]
  });
  assert.equal(result.status, 'review');
  assert.deepEqual(result.reviewReasons, [
    'blocked-requests-may-affect-rendering',
    'browser-runtime-errors',
    'http-response-errors'
  ]);
});

test('accessibility evidence is passed only when the audit evidence is complete and clean', async () => {
  const { classifyAccessibilityEvidence } = await import('../src/doctor/website-accessibility.mjs');
  assert.deepEqual(classifyAccessibilityEvidence({ violations: [], incomplete: [], blockedRequests: [], runtimeErrors: [], httpErrors: [] }), {
    status: 'passed', reviewReasons: []
  });
});
