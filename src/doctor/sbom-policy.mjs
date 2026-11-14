import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseSpdxExpression, collectSpdxIdentifiers } from './spdx-expression.mjs';

const MAX_SBOM_BYTES = 50 * 1024 * 1024;
const MAX_POLICY_BYTES = 256 * 1024;
const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$/;
const OPERATORS = new Set(['AND', 'OR', 'WITH']);
const UNKNOWN = new Set(['', 'NONE', 'NOASSERTION', 'UNKNOWN']);

async function readJsonFile(filePath, maxBytes, label) {
  if (!filePath) throw new Error(`${label} file path is required.`);
  const absolute = path.resolve(filePath);
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink file.`);
  if (stat.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
  const raw = await fs.readFile(absolute, 'utf8');
  let document;
  try { document = JSON.parse(raw); } catch { throw new Error(`${label} must contain valid JSON.`); }
  return { absolute, raw, document, sha256: createHash('sha256').update(raw).digest('hex') };
}

function pushIssue(issues, severity, code, message, component = null) {
  issues.push({ severity, code, message, ...(component ? { component } : {}) });
}

export async function validateSbomFile({ filePath } = {}) {
  const loaded = await readJsonFile(filePath, MAX_SBOM_BYTES, 'SBOM');
  const doc = loaded.document;
  const issues = [];
  let format = 'unknown';
  let records = [];
  if (doc?.bomFormat === 'CycloneDX') {
    format = 'cyclonedx';
    if (typeof doc.specVersion !== 'string' || !/^1\.[0-9]+$/.test(doc.specVersion)) pushIssue(issues, 'error', 'CYCLONEDX_SPEC_VERSION', 'CycloneDX specVersion is missing or invalid.');
    if (!Number.isInteger(doc.version) || doc.version < 1) pushIssue(issues, 'error', 'CYCLONEDX_VERSION', 'CycloneDX document version must be a positive integer.');
    if (!Array.isArray(doc.components)) pushIssue(issues, 'error', 'CYCLONEDX_COMPONENTS', 'CycloneDX components must be an array.');
    records = Array.isArray(doc.components) ? doc.components : [];
    const refs = new Set();
    for (const [index, item] of records.entries()) {
      if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()) pushIssue(issues, 'error', 'COMPONENT_NAME', `Component ${index + 1} has no name.`);
      if (item?.['bom-ref']) {
        if (refs.has(item['bom-ref'])) pushIssue(issues, 'error', 'DUPLICATE_BOM_REF', `Duplicate bom-ref '${item['bom-ref']}'.`, item.name || `component-${index + 1}`);
        refs.add(item['bom-ref']);
      }
      if (item?.licenses !== undefined && !Array.isArray(item.licenses)) pushIssue(issues, 'error', 'COMPONENT_LICENSES', `Component ${item.name || index + 1} licenses must be an array.`, item.name || null);
    }
  } else if (typeof doc?.spdxVersion === 'string' && Array.isArray(doc.packages)) {
    format = 'spdx'; records = doc.packages;
    if (!/^SPDX-2\.[0-9]+$/.test(doc.spdxVersion)) pushIssue(issues, 'error', 'SPDX_VERSION', 'SPDX version is not a recognised 2.x version.');
    if (typeof doc.SPDXID !== 'string' || !doc.SPDXID.startsWith('SPDXRef-')) pushIssue(issues, 'error', 'SPDX_DOCUMENT_ID', 'SPDX document SPDXID is missing or invalid.');
    if (typeof doc.dataLicense !== 'string' || doc.dataLicense !== 'CC0-1.0') pushIssue(issues, 'warning', 'SPDX_DATA_LICENSE', 'SPDX dataLicense is normally CC0-1.0.');
    const ids = new Set();
    for (const [index, item] of records.entries()) {
      if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim()) pushIssue(issues, 'error', 'PACKAGE_NAME', `SPDX package ${index + 1} has no name.`);
      if (typeof item.SPDXID !== 'string' || !item.SPDXID.startsWith('SPDXRef-')) pushIssue(issues, 'error', 'SPDX_PACKAGE_ID', `SPDX package ${item.name || index + 1} has no valid SPDXID.`, item.name || null);
      else if (ids.has(item.SPDXID)) pushIssue(issues, 'error', 'DUPLICATE_SPDX_ID', `Duplicate SPDXID '${item.SPDXID}'.`, item.name || null);
      else ids.add(item.SPDXID);
    }
  } else {
    pushIssue(issues, 'error', 'SBOM_FORMAT', 'SBOM must be a supported CycloneDX JSON or SPDX JSON document.');
  }
  const errors = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.filter((item) => item.severity === 'warning').length;
  return {
    schemaVersion: 1, reportType: 'paxi-sbom-validation', status: errors ? 'invalid' : warnings ? 'valid-with-warnings' : 'structurally-valid',
    validationLevel: 'structural-only-not-official-json-schema-validation', format, specVersion: doc?.specVersion || doc?.spdxVersion || null,
    summary: { components: records.length, errors, warnings }, issues, artifact: { path: loaded.absolute, bytes: Buffer.byteLength(loaded.raw), sha256: loaded.sha256 },
    limitations: ['This is structural validation, not official CycloneDX/SPDX JSON Schema validation. Use a schema validator for formal conformance.', 'A structurally valid SBOM may be incomplete or omit dependencies that Syft could not catalog.']
  };
}

function licenseValuesFromComponent(item, format) {
  const values = [];
  if (format === 'cyclonedx') {
    for (const entry of Array.isArray(item.licenses) ? item.licenses : []) {
      if (typeof entry?.expression === 'string') values.push(entry.expression);
      if (typeof entry?.license?.id === 'string') values.push(entry.license.id);
      else if (typeof entry?.license?.name === 'string') values.push(entry.license.name);
      else if (typeof entry?.id === 'string') values.push(entry.id);
    }
  } else {
    for (const key of ['licenseDeclared', 'licenseConcluded']) if (typeof item[key] === 'string') values.push(item[key]);
    if (Array.isArray(item.licenseInfoInFiles)) values.push(...item.licenseInfoInFiles.filter((value) => typeof value === 'string'));
  }
  return [...new Set(values)];
}

const normalizeId = (value) => String(value || '').toLowerCase();

async function loadSpdxSnapshot(filePath, kind, expectedSha256 = null) {
  if (!filePath) return null;
  const loaded = await readJsonFile(filePath, 10 * 1024 * 1024, `SPDX ${kind} snapshot`);
  if (expectedSha256 && (!/^[a-f0-9]{64}$/i.test(expectedSha256) || loaded.sha256 !== expectedSha256.toLowerCase())) {
    throw new Error(`SPDX ${kind} snapshot SHA-256 does not match the supplied pin.`);
  }
  const records = kind === 'license' ? loaded.document?.licenses : loaded.document?.exceptions;
  if (!Array.isArray(records) || records.length > 10000) throw new Error(`SPDX ${kind} snapshot must contain a bounded ${kind === 'license' ? 'licenses' : 'exceptions'} array.`);
  const idField = kind === 'license' ? 'licenseId' : 'licenseExceptionId';
  const ids = new Map();
  for (const item of records) {
    if (!item || typeof item[idField] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$/.test(item[idField])) continue;
    ids.set(normalizeId(item[idField]), { id: item[idField], deprecated: Boolean(item.isDeprecatedLicenseId || item.isDeprecatedLicenseExceptionId) });
  }
  const version = String(loaded.document.licenseListVersion || loaded.document.licenseListData?.licenseListVersion || '').trim() || null;
  return { version, ids, path: loaded.absolute, sha256: loaded.sha256, count: ids.size };
}

function evaluateSpdxAst(ast, context) {
  const { allow, deny, allowExceptions, denyExceptions, licenseSnapshot, exceptionSnapshot } = context;
  const evaluateLicense = (id) => {
    const key = normalizeId(id);
    if (licenseSnapshot && !licenseSnapshot.ids.has(key)) return { state: 'unknown', reason: `License identifier '${id}' is not present in the supplied SPDX License List snapshot.`, id };
    if (deny.has(key)) return { state: 'denied', reason: `License identifier '${id}' is explicitly denied.`, id };
    if (allow.size && !allow.has(key)) return { state: 'denied', reason: `License identifier '${id}' is not on the allow-list.`, id };
    const registryItem = licenseSnapshot?.ids.get(key);
    return { state: registryItem?.deprecated ? 'review' : 'allowed', reason: registryItem?.deprecated ? `License '${id}' is deprecated in the supplied SPDX snapshot.` : `License '${id}' satisfies the configured policy.`, id, deprecated: Boolean(registryItem?.deprecated) };
  };
  if (ast.type === 'license') return evaluateLicense(ast.id);
  if (ast.type === 'with') {
    const license = evaluateLicense(ast.license);
    const exceptionKey = normalizeId(ast.exception);
    if (license.state === 'denied' || license.state === 'unknown') return { ...license, exception: ast.exception };
    if (exceptionSnapshot && !exceptionSnapshot.ids.has(exceptionKey)) return { state: 'unknown', reason: `SPDX exception '${ast.exception}' is not in the supplied Exception List snapshot.`, id: ast.license, exception: ast.exception };
    if (denyExceptions.has(exceptionKey)) return { state: 'denied', reason: `SPDX exception '${ast.exception}' is explicitly denied.`, id: ast.license, exception: ast.exception };
    if (!allowExceptions.has(exceptionKey)) return { state: 'review', reason: `SPDX exception '${ast.exception}' requires explicit policy approval.`, id: ast.license, exception: ast.exception };
    return { state: license.state === 'review' ? 'review' : 'allowed', reason: `License '${ast.license}' with approved exception '${ast.exception}'.`, id: ast.license, exception: ast.exception };
  }
  if (ast.type === 'and' || ast.type === 'or') {
    const left = evaluateSpdxAst(ast.left, context);
    const right = evaluateSpdxAst(ast.right, context);
    const states = [left.state, right.state];
    if (ast.type === 'and') {
      const state = states.includes('denied') ? 'denied' : states.includes('unknown') ? 'unknown' : states.includes('review') ? 'review' : 'allowed';
      return { state, reason: `AND expression: ${left.reason} ${right.reason}`, branches: [left, right] };
    }
    const state = states.includes('allowed') ? 'allowed' : states.includes('review') ? 'review' : states.includes('unknown') ? 'unknown' : 'denied';
    return { state, reason: `OR expression: ${left.reason} OR ${right.reason}`, branches: [left, right] };
  }
  return { state: 'unknown', reason: 'Unsupported SPDX expression node.' };
}

export async function evaluateSbomLicensePolicy({ sbomPath, policyPath, licenseListPath = null, exceptionListPath = null, licenseListSha256 = null, exceptionListSha256 = null } = {}) {
  const loadedSbom = await readJsonFile(sbomPath, MAX_SBOM_BYTES, 'SBOM');
  const loadedPolicy = await readJsonFile(policyPath, MAX_POLICY_BYTES, 'License policy');
  const doc = loadedSbom.document;
  const format = doc?.bomFormat === 'CycloneDX' ? 'cyclonedx' : typeof doc?.spdxVersion === 'string' ? 'spdx' : null;
  if (!format) throw new Error('SBOM must be CycloneDX JSON or SPDX JSON. Run `paxi doctor security sbom-validate` first.');
  if (Boolean(licenseListPath) !== Boolean(exceptionListPath)) throw new Error('Provide both --license-list and --exception-list together.');
  const [licenseSnapshot, exceptionSnapshot] = await Promise.all([
    loadSpdxSnapshot(licenseListPath, 'license', licenseListSha256),
    loadSpdxSnapshot(exceptionListPath, 'exception', exceptionListSha256)
  ]);
  if (licenseSnapshot && exceptionSnapshot && licenseSnapshot.version && exceptionSnapshot.version && licenseSnapshot.version !== exceptionSnapshot.version) {
    throw new Error(`SPDX License List and Exception List versions differ (${licenseSnapshot.version} vs ${exceptionSnapshot.version}).`);
  }
  const policy = loadedPolicy.document;
  const allowList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9.+:-]{0,160}$/.test(item) && !OPERATORS.has(item.toUpperCase()));
  if (policy?.schemaVersion !== 1 || !allowList(policy.allow) || !allowList(policy.deny) || !['fail','warn'].includes(policy.unknown || 'fail')) throw new Error('License policy must use schemaVersion 1, allow/deny arrays of SPDX identifiers only, and unknown: fail|warn.');
  if (policy.allowExceptions !== undefined && !allowList(policy.allowExceptions)) throw new Error('License policy allowExceptions must contain SPDX exception identifiers only.');
  if (policy.denyExceptions !== undefined && !allowList(policy.denyExceptions)) throw new Error('License policy denyExceptions must contain SPDX exception identifiers only.');
  if (policy.exceptions !== undefined && !Array.isArray(policy.exceptions)) throw new Error('License policy exceptions must be an array.');
  for (const [index, exception] of (policy.exceptions || []).entries()) {
    if (!exception || typeof exception !== 'object' || Array.isArray(exception) || typeof exception.name !== 'string' || !exception.name.trim() || (exception.version !== undefined && typeof exception.version !== 'string') || typeof exception.reason !== 'string' || !exception.reason.trim() || exception.name.length > 200 || (exception.version || '').length > 100 || exception.reason.length > 500) {
      throw new Error(`License policy exception ${index + 1} must have a component name, optional version and a non-empty review reason.`);
    }
  }
  const allow = new Set(policy.allow.map(normalizeId));
  const deny = new Set(policy.deny.map(normalizeId));
  const allowExceptions = new Set((policy.allowExceptions || []).map(normalizeId));
  const denyExceptions = new Set((policy.denyExceptions || []).map(normalizeId));
  const components = format === 'cyclonedx' ? (Array.isArray(doc.components) ? doc.components : []) : doc.packages;
  const findings = [];
  for (const item of components) {
    const name = String(item?.name || '(unnamed component)').slice(0, 200);
    const version = String(item?.version || '').slice(0, 100);
    const componentException = (policy.exceptions || []).find((candidate) => candidate && candidate.name === name && (!candidate.version || candidate.version === version) && typeof candidate.reason === 'string' && candidate.reason.trim());
    if (componentException) { findings.push({ component: name, version, status: 'excepted', reason: String(componentException.reason).slice(0, 300), licenses: licenseValuesFromComponent(item, format) }); continue; }
    const rawValues = licenseValuesFromComponent(item, format);
    if (!rawValues.length) {
      findings.push({ component: name, version, status: policy.unknown === 'fail' ? 'unknown-denied' : 'unknown-warning', licenses: [], licenseIds: [], reason: 'License metadata is missing.' });
      continue;
    }
    const parsed = [];
    for (const expression of rawValues) {
      if (UNKNOWN.has(String(expression).trim().toUpperCase())) { parsed.push({ state: 'unknown', reason: 'License metadata is marked unknown.' }); continue; }
      try {
        const ast = parseSpdxExpression(expression);
        const identifiers = collectSpdxIdentifiers(ast);
        parsed.push({ ...evaluateSpdxAst(ast, { allow, deny, allowExceptions, denyExceptions, licenseSnapshot, exceptionSnapshot }), ast, identifiers });
      } catch (error) { parsed.push({ state: 'unknown', reason: `Could not parse SPDX expression: ${error.message}` }); }
    }
    // Multiple declared license entries are alternatives in CycloneDX; choose a
    // policy-satisfying expression if one exists, otherwise retain review/unknown.
    const state = parsed.some((item) => item.state === 'allowed') ? 'allowed'
      : parsed.some((item) => item.state === 'review') ? 'review'
        : parsed.some((item) => item.state === 'unknown') ? 'unknown' : 'denied';
    const licenseIds = [...new Set(parsed.flatMap((item) => item.identifiers?.licenses || []))];
    const exceptionIds = [...new Set(parsed.flatMap((item) => item.identifiers?.exceptions || []))];
    const deprecated = parsed.some((item) => item.deprecated || item.branches?.some((branch) => branch.deprecated));
    const reason = parsed.map((item) => item.reason).filter(Boolean).join(' | ').slice(0, 800);
    const status = state === 'allowed' ? (deprecated ? 'review' : 'allowed')
      : state === 'denied' ? (parsed.some((item) => /explicitly denied/.test(item.reason || '')) ? 'denied' : 'not-allowlisted')
        : state === 'review' ? 'review' : policy.unknown === 'fail' ? 'unknown-denied' : 'unknown-warning';
    findings.push({ component: name, version, status, licenses: rawValues, licenseIds, exceptionIds, reason });
  }
  const deniedCount = findings.filter((item) => ['denied','unknown-denied','not-allowlisted'].includes(item.status)).length;
  const warningCount = findings.filter((item) => ['unknown-warning','review'].includes(item.status)).length;
  return {
    schemaVersion: 1, reportType: 'paxi-sbom-license-policy', status: deniedCount ? 'failed' : warningCount ? 'passed-with-warnings' : 'passed',
    passed: deniedCount === 0, policy: { path: loadedPolicy.absolute, sha256: loadedPolicy.sha256, unknown: policy.unknown || 'fail', allowCount: allow.size, denyCount: deny.size, allowedExceptionCount: allowExceptions.size, deniedExceptionCount: denyExceptions.size, componentExceptionCount: (policy.exceptions || []).length },
    spdxRegistry: licenseSnapshot ? { licenseList: { path: licenseSnapshot.path, sha256: licenseSnapshot.sha256, version: licenseSnapshot.version, count: licenseSnapshot.count }, exceptionList: { path: exceptionSnapshot.path, sha256: exceptionSnapshot.sha256, version: exceptionSnapshot.version, count: exceptionSnapshot.count } } : { membership: 'not-checked-no-official-snapshot-supplied' },
    sbom: { path: loadedSbom.absolute, sha256: loadedSbom.sha256, format },
    summary: { components: findings.length, allowed: findings.filter((item) => item.status === 'allowed').length, denied: deniedCount, warnings: warningCount, excepted: findings.filter((item) => item.status === 'excepted').length, review: findings.filter((item) => item.status === 'review').length },
    findings,
    limitations: ['SPDX expressions are parsed with AND/OR precedence, parentheses and WITH; this is a policy screening result, not legal advice.', 'When official SPDX registry snapshots are omitted, identifier membership and deprecation are not verified.', 'An OR expression passes when at least one branch is permitted; AND requires every branch to be permitted.', 'A deprecated license or unapproved exception requires human review.', 'This report does not replace review of full license texts, notices, attribution and distribution obligations.']
  };
}
