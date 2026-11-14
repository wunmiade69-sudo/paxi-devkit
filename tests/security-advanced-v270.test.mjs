import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  listAdvancedSecurityTools, scanSecrets, runSemgrepSast, runTrivyFilesystemScan,
  runSlitherSingleFile, inspectAndroidApk, checkWebSecurityHeaders, testApiObjectAuthorization
} from '../src/doctor/security-advanced.mjs';

async function tempDir(prefix = 'paxi-sec-') { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

test('advanced scanner inventory reports missing tools explicitly', async () => {
  const result = await listAdvancedSecurityTools({ exists: async (name) => name === 'gitleaks' });
  assert.equal(result.find((item) => item.id === 'gitleaks').available, true);
  assert.equal(result.find((item) => item.id === 'trivy').available, false);
});

test('Gitleaks findings omit secret values and snippets', async () => {
  const root = await tempDir();
  try {
    const report = await scanSecrets({ projectPath: root, confirm: true, exists: async () => true, runner: async (_cmd, args) => {
      const reportPath = args[args.indexOf('--report-path') + 1];
      await fs.writeFile(reportPath, JSON.stringify([{ RuleID: 'github-token', File: 'src/config.js', StartLine: 9, Fingerprint: 'abc123', Secret: 'ghp_SUPERSECRET_DO_NOT_LEAK', Match: 'token = ghp_SUPERSECRET_DO_NOT_LEAK' }]));
      return { code: 0, stdout: '', stderr: '', outputTruncated: false };
    } });
    assert.equal(report.status, 'findings');
    assert.equal(report.findings[0].file, 'src/config.js');
    assert.ok(!JSON.stringify(report).includes('SUPERSECRET'));
    assert.ok(!JSON.stringify(report).includes('token ='));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Gitleaks timeout is incomplete, never a clean scan', async () => {
  const root = await tempDir();
  try {
    const report = await scanSecrets({ projectPath: root, confirm: true, exists: async () => true, runner: async () => ({ code: 124, timedOut: true, stdout: '', stderr: '' }) });
    assert.equal(report.status, 'not-run');
    assert.equal(report.complete, false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Semgrep refuses registry rules without online consent and normalizes findings', async () => {
  const root = await tempDir();
  try {
    await assert.rejects(() => runSemgrepSast({ projectPath: root, confirm: true, exists: async () => true }), /local rules file/);
    const rules = path.join(root, 'rules.yml'); await fs.writeFile(rules, 'rules: []\n');
    const report = await runSemgrepSast({ projectPath: root, confirm: true, rulesPath: rules, exists: async () => true, runner: async () => ({ code: 0, stdout: JSON.stringify({ results: [{ check_id: 'xss.rule', path: 'src/view.ts', start: { line: 4 }, extra: { severity: 'ERROR', message: 'Unsafe sink' } }], errors: [] }), stderr: '', outputTruncated: false }) });
    assert.equal(report.complete, true);
    assert.equal(report.findings[0].code, 'xss.rule');
    assert.equal(report.findings[0].severity, 'high');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Trivy parsing drops secret values while retaining finding metadata', async () => {
  const root = await tempDir();
  try {
    const report = await runTrivyFilesystemScan({ projectPath: root, confirm: true, exists: async () => true, runner: async (_cmd, args) => {
      const reportPath = args[args.indexOf('--output') + 1];
      await fs.writeFile(reportPath, JSON.stringify({ Results: [{ Target: 'package-lock.json', Vulnerabilities: [{ VulnerabilityID: 'CVE-2025-1234', Severity: 'HIGH', PkgName: 'sample', InstalledVersion: '1.0', FixedVersion: '1.1' }], Secrets: [{ RuleID: 'generic-api-key', Severity: 'CRITICAL', StartLine: 12, Match: 'actual-secret-value' }] }] }));
      return { code: 0, stdout: '', stderr: '', outputTruncated: false };
    } });
    assert.equal(report.complete, true);
    assert.equal(report.summary.high, 1);
    assert.ok(!JSON.stringify(report).includes('actual-secret-value'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Slither is restricted to a single Solidity file and requires local compiler', async () => {
  const root = await tempDir();
  try {
    const sol = path.join(root, 'Token.sol'); await fs.writeFile(sol, 'pragma solidity ^0.8.20; contract Token {}');
    const missing = await runSlitherSingleFile({ filePath: sol, confirm: true, exists: async (name) => name === 'slither' });
    assert.equal(missing.status, 'not-run');
    assert.match(missing.note, /solc/);
    await assert.rejects(() => runSlitherSingleFile({ filePath: root, confirm: true, exists: async () => true }), /single .sol file/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('APK inspector identifies insecure manifest settings and keeps certificate digest only', async () => {
  const root = await tempDir();
  try {
    const apk = path.join(root, 'sample.apk'); await fs.writeFile(apk, 'fake-apk-fixture');
    const report = await inspectAndroidApk({ filePath: apk, confirm: true, exists: async () => true, runner: async (cmd) => cmd === 'apkanalyzer'
      ? { code: 0, stdout: '<manifest><application android:debuggable="true" android:usesCleartextTraffic="true" android:allowBackup="true"><activity android:exported="true" /></application></manifest>', stderr: '' }
      : { code: 0, stdout: 'Signer #1 certificate SHA-256 digest: AA:BB:CC', stderr: '' } });
    assert.equal(report.complete, true);
    assert.ok(report.findings.some((item) => item.code === 'apk-debuggable'));
    assert.equal(report.signature.certificateSha256, 'aabbcc');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('web security headers check only permits remote HTTPS with explicit scope', async () => {
  await assert.rejects(() => checkWebSecurityHeaders({ url: 'https://example.com', confirm: true }), /allow-remote/);
  const report = await checkWebSecurityHeaders({ url: 'http://127.0.0.1:8080/', confirm: true, fetchImpl: async () => new Response('ok', { status: 200, headers: { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" } }) });
  assert.equal(report.executionKind, 'loopback-http-check');
  assert.equal(report.status, 'clean');
});

test('API object authorization requires distinct identities and checks owner/non-owner status', async () => {
  const root = await tempDir(); const planPath = path.join(root, 'plan.json');
  const previousOwner = process.env.PAXI_TEST_OWNER_TOKEN; const previousOther = process.env.PAXI_TEST_OTHER_TOKEN;
  process.env.PAXI_TEST_OWNER_TOKEN = 'owner-test-token'; process.env.PAXI_TEST_OTHER_TOKEN = 'other-test-token';
  try {
    await fs.writeFile(planPath, JSON.stringify({ cases: [{ id: 'profile-object', method: 'GET', url: 'http://127.0.0.1:9000/api/profiles/1', ownerExpected: [200], nonOwnerExpected: [403, 404] }] }));
    const report = await testApiObjectAuthorization({ planPath, confirm: true, fetchImpl: async (_url, options) => new Response('discard this body', { status: options.headers.Authorization.endsWith('owner-test-token') ? 200 : 403 }) });
    assert.equal(report.status, 'passed');
    assert.equal(report.results[0].ownerStatus, 200);
    assert.equal(report.results[0].nonOwnerStatus, 403);
    assert.ok(!JSON.stringify(report).includes('test-token'));
  } finally {
    if (previousOwner === undefined) delete process.env.PAXI_TEST_OWNER_TOKEN; else process.env.PAXI_TEST_OWNER_TOKEN = previousOwner;
    if (previousOther === undefined) delete process.env.PAXI_TEST_OTHER_TOKEN; else process.env.PAXI_TEST_OTHER_TOKEN = previousOther;
    await fs.rm(root, { recursive: true, force: true });
  }
});
