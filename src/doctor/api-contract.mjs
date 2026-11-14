import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTraceparent, extractTraceContext, validateTraceId } from './trace-context.mjs';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const HTTP_METHODS = new Set(['get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'trace']);
const MAX_SPEC_BYTES = 2 * 1024 * 1024;
const MAX_PLAN_BYTES = 128 * 1024;
const MAX_CASES = 25;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

function cleanText(value, max = 300) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function readRegularJson(filePath, maxBytes, label) {
  const absolute = path.resolve(filePath);
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular, non-symlink file.`);
  if (info.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte size limit.`);
  const source = await fs.readFile(absolute, 'utf8');
  if (source.includes('\0')) throw new Error(`${label} must be UTF-8 JSON text.`);
  let value;
  try { value = JSON.parse(source); } catch { throw new Error(`${label} is not valid JSON. Convert YAML to JSON before using this version.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must contain a JSON object.`);
  return { absolute, value };
}

function pointerValue(root, pointer) {
  if (pointer === '#') return root;
  if (typeof pointer !== 'string' || !pointer.startsWith('#/')) return undefined;
  const segments = pointer.slice(2).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = root;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function safeServerUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /\{[^{}]+\}/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const local = LOOPBACK.has(url.hostname) || /^127\./.test(url.hostname);
    return { protocol: url.protocol, local };
  } catch { return null; }
}

export async function inspectOpenApiContract({ filePath } = {}) {
  if (!filePath) throw new Error('OpenAPI inspection requires --file <openapi.json>.');
  const { absolute, value: spec } = await readRegularJson(filePath, MAX_SPEC_BYTES, 'OpenAPI specification');
  const findings = [];
  const add = (code, severity, pathLabel, message) => findings.push({ code, severity, path: cleanText(pathLabel), message: cleanText(message) });
  const isOpenApi3 = typeof spec.openapi === 'string' && /^3\.\d+\.\d+(?:[-+].*)?$/.test(spec.openapi);
  const isSwagger2 = spec.swagger === '2.0';
  if (!isOpenApi3 && !isSwagger2) add('unsupported-version', 'error', 'openapi', 'Expected OpenAPI 3.x or Swagger 2.0 JSON.');
  if (!spec.info || typeof spec.info !== 'object' || typeof spec.info.title !== 'string' || !spec.info.title.trim()) add('missing-info-title', 'error', 'info.title', 'The API title is missing.');
  if (!spec.paths || typeof spec.paths !== 'object' || Array.isArray(spec.paths) || !Object.keys(spec.paths).length) add('missing-paths', 'error', 'paths', 'The specification does not define any API paths.');

  const operationIds = new Map();
  let operationCount = 0;
  let referenceCount = 0;
  const inspectReferences = (node, location, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) { node.slice(0, 500).forEach((item, index) => inspectReferences(item, `${location}[${index}]`, depth + 1)); return; }
    if (typeof node.$ref === 'string') {
      referenceCount += 1;
      if (node.$ref.startsWith('#/')) {
        if (pointerValue(spec, node.$ref) === undefined) add('broken-local-ref', 'error', location, 'A local reference does not resolve within this specification.');
      } else if (!node.$ref.startsWith('#')) add('external-ref-not-fetched', 'review', location, 'An external reference is present but is not fetched; validate it separately in a trusted tool.');
    }
    for (const [key, item] of Object.entries(node).slice(0, 2000)) inspectReferences(item, `${location}.${key}`.slice(0, 300), depth + 1);
  };
  inspectReferences(spec, '$');

  if (spec.paths && typeof spec.paths === 'object' && !Array.isArray(spec.paths)) {
    for (const [route, pathItem] of Object.entries(spec.paths).slice(0, 500)) {
      if (!route.startsWith('/') || route.length > 1000) add('invalid-path-key', 'error', `paths.${route.slice(0, 120)}`, 'Path keys must start with / and remain within 1000 characters.');
      if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) { add('invalid-path-item', 'error', `paths.${route}`, 'Path item must be an object.'); continue; }
      const declaredPathParams = new Set([...(Array.isArray(pathItem.parameters) ? pathItem.parameters : [])].filter((item) => item?.in === 'path' && typeof item.name === 'string').map((item) => item.name));
      for (const method of Object.keys(pathItem)) {
        if (!HTTP_METHODS.has(method.toLowerCase())) continue;
        const operation = pathItem[method];
        const at = `paths.${route}.${method}`;
        if (!operation || typeof operation !== 'object' || Array.isArray(operation)) { add('invalid-operation', 'error', at, 'Operation must be an object.'); continue; }
        operationCount += 1;
        if (typeof operation.operationId === 'string' && operation.operationId.trim()) {
          const previous = operationIds.get(operation.operationId);
          if (previous) add('duplicate-operation-id', 'error', at, `operationId duplicates ${previous}.`);
          else operationIds.set(operation.operationId, at);
        } else add('missing-operation-id', 'review', at, 'Add a stable operationId to improve generated clients and test traceability.');
        const responses = operation.responses;
        if (!responses || typeof responses !== 'object' || Array.isArray(responses) || !Object.keys(responses).some((code) => /^(?:[1-5]\d\d|default)$/.test(code))) add('missing-responses', 'error', at, 'Operation must define at least one valid HTTP response or default response.');
        const operationPathParams = new Set([...(Array.isArray(operation.parameters) ? operation.parameters : [])].filter((item) => item?.in === 'path' && typeof item.name === 'string').map((item) => item.name));
        for (const name of route.match(/\{([^{}]+)\}/g)?.map((part) => part.slice(1, -1)) || []) {
          if (!declaredPathParams.has(name) && !operationPathParams.has(name)) add('undeclared-path-parameter', 'error', at, `Path parameter {${name}} is not declared at path or operation level.`);
        }
        for (const parameter of [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
          if (parameter?.in === 'path' && parameter.required !== true) add('optional-path-parameter', 'error', at, 'OpenAPI path parameters must be marked required: true.');
        }
      }
    }
  }

  const servers = isSwagger2 ? (spec.host ? [{ url: `${spec.schemes?.[0] || 'https'}://${spec.host}${spec.basePath || '/'}` }] : []) : (Array.isArray(spec.servers) ? spec.servers : []);
  for (let index = 0; index < servers.length; index += 1) {
    const parsed = safeServerUrl(servers[index]?.url);
    if (!parsed) add('invalid-server-url', 'warning', `servers[${index}]`, 'Server URL is invalid, contains unsupported interpolation, or uses a non-HTTP protocol.');
    else if (parsed.protocol === 'http:' && !parsed.local) add('insecure-server-url', 'warning', `servers[${index}]`, 'A non-loopback API server uses HTTP rather than HTTPS.');
  }

  const errors = findings.filter((item) => item.severity === 'error').length;
  const warnings = findings.filter((item) => item.severity === 'warning').length;
  const review = findings.filter((item) => item.severity === 'review').length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    file: cleanText(path.basename(absolute), 180),
    format: 'json',
    api: { title: typeof spec.info?.title === 'string' ? cleanText(spec.info.title, 120) : null, version: typeof spec.info?.version === 'string' ? cleanText(spec.info.version, 80) : null, specificationVersion: isOpenApi3 ? spec.openapi : isSwagger2 ? spec.swagger : 'unsupported' },
    summary: { paths: spec.paths && typeof spec.paths === 'object' ? Object.keys(spec.paths).length : 0, operations: operationCount, references: referenceCount, findings: findings.length, errors, warnings, review },
    findings,
    valid: errors === 0,
    limitations: ['This checks JSON OpenAPI/Swagger structure and local references; YAML input must be converted to JSON.', 'External references are not fetched or validated.', 'Schema validation is structural and does not prove the live API matches this document.']
  };
}

function requiredSchemaPaths(spec, schema, prefix = '', depth = 0, visited = new Set()) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 3) return [];
  if (typeof schema.$ref === 'string') {
    if (!schema.$ref.startsWith('#/') || visited.has(schema.$ref)) return [];
    const resolved = pointerValue(spec, schema.$ref);
    if (!resolved) return [];
    const nextVisited = new Set(visited); nextVisited.add(schema.$ref);
    return requiredSchemaPaths(spec, resolved, prefix, depth + 1, nextVisited);
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties : {};
  const paths = [];
  for (const name of required.slice(0, 20)) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_$-]{1,80}$/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name)) continue;
    const next = prefix ? `${prefix}.${name}` : name;
    paths.push(next);
    if (properties[name] && typeof properties[name] === 'object' && (properties[name].type === 'object' || typeof properties[name].$ref === 'string')) paths.push(...requiredSchemaPaths(spec, properties[name], next, depth + 1, visited));
  }
  for (const branch of (Array.isArray(schema.allOf) ? schema.allOf : []).slice(0, 5)) paths.push(...requiredSchemaPaths(spec, branch, prefix, depth + 1, visited));
  return [...new Set(paths)].filter((item) => getJsonPath({}, item).valid).slice(0, 20);
}

export async function generateApiSmokePlan({ filePath, baseUrl = null, maxCases = MAX_CASES, name = null } = {}) {
  if (!filePath) throw new Error('API test generation requires --file <openapi.json>.');
  if (!Number.isSafeInteger(maxCases) || maxCases < 1 || maxCases > MAX_CASES) throw new Error(`maxCases must be between 1 and ${MAX_CASES}.`);
  const { absolute, value: spec } = await readRegularJson(filePath, MAX_SPEC_BYTES, 'OpenAPI specification');
  const openApi3 = typeof spec.openapi === 'string' && /^3\.\d+\.\d+(?:[-+].*)?$/.test(spec.openapi);
  const swagger2 = spec.swagger === '2.0';
  if (!openApi3 && !swagger2) throw new Error('Test generation requires an OpenAPI 3.x or Swagger 2.0 JSON specification.');

  let selectedBase = baseUrl;
  if (!selectedBase && openApi3 && Array.isArray(spec.servers) && spec.servers.length) {
    const candidate = spec.servers[0]?.url;
    if (safeServerUrl(candidate)) selectedBase = candidate;
  }
  if (!selectedBase && swagger2 && typeof spec.host === 'string' && spec.host.trim()) {
    const scheme = Array.isArray(spec.schemes) && spec.schemes.includes('https') ? 'https' : 'https';
    selectedBase = `${scheme}://${spec.host}${typeof spec.basePath === 'string' ? spec.basePath : '/'}`;
  }
  if (!selectedBase) throw new Error('No usable API server URL was found. Supply an explicit --base-url (server variables must be resolved by the developer).');
  const parsedBase = validateApiBaseUrl(selectedBase, true);
  const normalizedBase = `${parsedBase.url.origin}${parsedBase.url.pathname.replace(/\/$/, '')}`;
  const cases = [];
  const skipped = { templatedPaths: 0, unsupportedMethods: 0, invalidPaths: 0, deprecatedOperations: 0 };
  const paths = spec.paths && typeof spec.paths === 'object' && !Array.isArray(spec.paths) ? spec.paths : {};
  for (const [route, pathItem] of Object.entries(paths).slice(0, 500)) {
    if (typeof route !== 'string' || route.includes('{') || route.includes('}')) { skipped.templatedPaths += 1; continue; }
    let safeRoute;
    try { safeRoute = validatePath(route); } catch { skipped.invalidPaths += 1; continue; }
    if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) continue;
    for (const [rawMethod, operation] of Object.entries(pathItem)) {
      const method = rawMethod.toUpperCase();
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (!['GET', 'HEAD'].includes(method)) { skipped.unsupportedMethods += 1; continue; }
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
      if (operation.deprecated === true) { skipped.deprecatedOperations += 1; continue; }
      if (cases.length >= maxCases) continue;
      const responseMap = operation.responses && typeof operation.responses === 'object' && !Array.isArray(operation.responses) ? operation.responses : {};
      const successCodes = Object.keys(responseMap).filter((code) => /^2\d\d$/.test(code)).map(Number).sort((a, b) => a - b).slice(0, 10);
      const expectedStatus = successCodes.length ? successCodes : [200];
      const idSource = typeof operation.operationId === 'string' && operation.operationId.trim()
        ? operation.operationId
        : `${method.toLowerCase()}-${route.replace(/[^A-Za-z0-9]+/g, '-')}`;
      const id = idSource.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || `${method.toLowerCase()}-${cases.length + 1}`;
      const uniqueId = cases.some((item) => item.id === id) ? `${id.slice(0, 55)}-${cases.length + 1}` : id;
      const testCase = { id: uniqueId, method, path: safeRoute, expectedStatus };
      if (method === 'GET') {
        const jsonResponse = Object.entries(responseMap).find(([code, response]) => /^2\d\d$/.test(code) && response?.content && Object.entries(response.content).some(([type]) => /(?:application|[^/]+)\/(?:[^;]+\+)?json(?:\s*;|$)/i.test(type)));
        if (jsonResponse) {
          testCase.contentTypeIncludes = 'json';
          const media = Object.entries(jsonResponse[1].content).find(([type]) => /(?:application|[^/]+)\/(?:[^;]+\+)?json(?:\s*;|$)/i.test(type));
          const schema = media?.[1]?.schema;
          const requiredPaths = requiredSchemaPaths(spec, schema);
          if (requiredPaths.length) testCase.jsonPathsExist = requiredPaths;
        }
      }
      cases.push(testCase);
    }
  }
  if (!cases.length) throw new Error('No safe, static GET/HEAD routes could be generated. Dynamic path parameters are deliberately skipped; add a reviewed case manually.');
  return {
    schemaVersion: 1,
    name: cleanText(name || `${spec.info?.title || 'API'} generated smoke tests`, 120),
    baseUrl: normalizedBase,
    cases,
    generatedFrom: {
      file: path.basename(absolute),
      title: cleanText(spec.info?.title, 120) || null,
      version: cleanText(spec.info?.version, 80) || null,
      specificationVersion: openApi3 ? spec.openapi : '2.0',
      generatedAt: new Date().toISOString()
    },
    generationSummary: {
      included: cases.length,
      maximum: maxCases,
      skipped,
      note: 'Only static GET/HEAD routes were included. Dynamic path parameters, deprecated operations and mutating methods were excluded. Review this plan and test target before running with --confirm.'
    }
  };
}

export async function writeGeneratedApiPlan({ outputPath, plan } = {}) {
  if (!outputPath || !plan || typeof plan !== 'object') throw new Error('Writing a generated API plan requires an output path and plan.');
  const absolute = path.resolve(outputPath);
  const parent = path.dirname(absolute);
  const parentInfo = await fs.lstat(parent).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('API plan output directory must already exist and must not be a symlink.');
  await fs.realpath(parent); // Resolve platform aliases such as macOS /tmp before writing.
  const existing = await fs.lstat(absolute).catch(() => null);
  if (existing) throw new Error('API plan output already exists. Choose a new --output path; generated plans are never overwritten.');
  const payload = `${JSON.stringify(plan, null, 2)}\n`;
  await fs.writeFile(absolute, payload, { flag: 'wx', mode: 0o600 });
  return { path: absolute, bytes: Buffer.byteLength(payload, 'utf8') };
}

function validateApiBaseUrl(value, allowRemote) {
  let url;
  try { url = new URL(value); } catch { throw new Error('API base URL must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API base URL must not contain credentials, query strings or fragments.');
  const local = LOOPBACK.has(url.hostname) || /^127\./.test(url.hostname);
  if (!local && (!allowRemote || url.protocol !== 'https:')) throw new Error('Remote API tests require HTTPS and explicit --allow-remote. Loopback HTTP is allowed by default.');
  return { url, local };
}

function validatePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 512 || /[\u0000-\u001f\u007f#?]/.test(value) || value.includes('\\')) throw new Error('Each API case path must be a bounded absolute path without query strings, fragments, backslashes or control characters.');
  if (value.split('/').some((segment) => segment === '.' || segment === '..')) throw new Error('API case paths cannot contain dot segments.');
  return value;
}

function getJsonPath(root, expression) {
  if (typeof expression !== 'string' || expression.length > 240 || !/^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/.test(expression)) return { valid: false, exists: false };
  let value = root;
  for (const segment of expression.split('.')) {
    if (segment === '__proto__' || segment === 'prototype' || segment === 'constructor') return { valid: false, exists: false };
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return { valid: true, exists: false };
    value = value[segment];
  }
  return { valid: true, exists: true };
}

async function readResponseJson(response) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('JSON response exceeded the 64 KiB inspection limit.');
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESPONSE_BYTES) throw new Error('JSON response exceeded the 64 KiB inspection limit.');
    return JSON.parse(bytes.toString('utf8'));
  }
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); throw new Error('JSON response exceeded the 64 KiB inspection limit.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function runApiSmokeTests({ filePath, allowRemote = false, confirm = false, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch, env = process.env, now = () => new Date(), traceId: requestedTraceId = null } = {}) {
  if (!confirm) throw new Error('API smoke tests send network requests. Review the plan and pass --confirm to run them.');
  if (!filePath) throw new Error('API smoke tests require --file <test-plan.json>.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30000) throw new Error('API test timeout must be between 500 and 30000 milliseconds.');
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch; use Node.js 20 or newer.');
  const { absolute, value: plan } = await readRegularJson(filePath, MAX_PLAN_BYTES, 'API test plan');
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.cases) || plan.cases.length < 1 || plan.cases.length > MAX_CASES) throw new Error(`API test plan must have schemaVersion 1 and 1–${MAX_CASES} cases.`);
  const validatedBase = validateApiBaseUrl(plan.baseUrl, allowRemote);
  const traceId = requestedTraceId === null ? null : validateTraceId(requestedTraceId);
  const bearerEnv = plan.bearerTokenEnv;
  if (bearerEnv !== undefined && (typeof bearerEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(bearerEnv))) throw new Error('bearerTokenEnv must be a valid environment variable name.');
  const bearerToken = bearerEnv ? env[bearerEnv] : null;
  if (bearerEnv && (typeof bearerToken !== 'string' || !bearerToken || bearerToken.length > 8192)) throw new Error(`The bearer token environment variable ${bearerEnv} is missing or invalid.`);

  const seenIds = new Set();
  const cases = plan.cases.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`API case ${index + 1} must be an object.`);
    const id = typeof item.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(item.id) ? item.id : null;
    if (!id || seenIds.has(id)) throw new Error(`API case ${index + 1} has a missing, invalid or duplicate id.`);
    seenIds.add(id);
    const method = String(item.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) throw new Error(`API case ${id} uses ${method}; only GET and HEAD are supported. Mutating methods are deliberately excluded.`);
    const route = validatePath(item.path);
    const expectedStatus = item.expectedStatus === undefined ? [200] : item.expectedStatus;
    if (!Array.isArray(expectedStatus) || !expectedStatus.length || expectedStatus.length > 10 || expectedStatus.some((value) => !Number.isInteger(value) || value < 100 || value > 599)) throw new Error(`API case ${id} expectedStatus must be an array of HTTP status codes.`);
    const jsonPathsExist = item.jsonPathsExist === undefined ? [] : item.jsonPathsExist;
    if (!Array.isArray(jsonPathsExist) || jsonPathsExist.length > 20 || jsonPathsExist.some((value) => !getJsonPath({}, value).valid)) throw new Error(`API case ${id} jsonPathsExist must contain up to 20 simple dot-separated JSON paths.`);
    if (method === 'HEAD' && jsonPathsExist.length) throw new Error(`API case ${id} cannot assert JSON response fields with HEAD.`);
    if (item.contentTypeIncludes !== undefined && (typeof item.contentTypeIncludes !== 'string' || item.contentTypeIncludes.length > 80 || /[\r\n\0]/.test(item.contentTypeIncludes))) throw new Error(`API case ${id} has an invalid contentTypeIncludes value.`);
    return { id, method, path: route, expectedStatus: [...new Set(expectedStatus)], jsonPathsExist, contentTypeIncludes: item.contentTypeIncludes || null };
  });

  const startedAt = now().toISOString();
  const results = [];
  for (const item of cases) {
    const url = new URL(`${validatedBase.url.pathname.replace(/\/$/, '')}/${item.path.replace(/^\//, '')}`, validatedBase.url.origin);
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    try {
      const headers = { accept: item.jsonPathsExist.length ? 'application/json' : '*/*' };
      if (traceId) headers.traceparent = createTraceparent(traceId);
      if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
      const response = await fetchImpl(url.href, { method: item.method, headers, redirect: 'manual', signal: controller.signal });
      const durationMs = Date.now() - start;
      const responseTrace = extractTraceContext(response.headers);
      const rawContentType = String(response.headers?.get?.('content-type') || 'unknown').slice(0, 100).replace(/[\r\n\0]/g, '');
      const contentType = /^[\w.+/-]+(?:\s*;\s*[\w=.+/-]+)*$/.test(rawContentType) ? rawContentType : 'unknown';
      const issues = [];
      if (!item.expectedStatus.includes(response.status)) issues.push({ code: 'unexpected-status', message: `Expected HTTP ${item.expectedStatus.join(' or ')}; received ${response.status}.` });
      if (item.contentTypeIncludes && !contentType.toLowerCase().includes(item.contentTypeIncludes.toLowerCase())) issues.push({ code: 'unexpected-content-type', message: `Expected content type containing ${item.contentTypeIncludes}; received ${contentType}.` });
      if (item.jsonPathsExist.length) {
        if (!/\bjson\b/i.test(contentType)) issues.push({ code: 'non-json-response', message: 'JSON field assertions were requested but the response content type is not JSON.' });
        else {
          try {
            const payload = await readResponseJson(response);
            for (const expression of item.jsonPathsExist) if (!getJsonPath(payload, expression).exists) issues.push({ code: 'missing-json-path', message: `Expected JSON field ${expression} was not present.` });
          } catch (error) { issues.push({ code: 'invalid-json-response', message: String(error?.message || error).slice(0, 220) }); }
        }
      }
      if (!item.jsonPathsExist.length) await response.body?.cancel?.().catch(() => {});
      const redirect = [301, 302, 303, 307, 308].includes(response.status);
      if (redirect) issues.push({ code: 'redirect-not-followed', message: 'Redirect was not followed; configure the test against the final API URL.' });
      results.push({ id: item.id, method: item.method, path: item.path, status: issues.length ? 'failed' : 'passed', statusCode: response.status, durationMs, contentType, redirectNotFollowed: redirect, traceId: traceId || responseTrace.traceId, responseRequestId: responseTrace.requestId, issues, bodyIncluded: false });
    } catch (error) {
      results.push({ id: item.id, method: item.method, path: item.path, status: 'failed', durationMs: Date.now() - start, traceId, issues: [{ code: error?.name === 'AbortError' ? 'timeout' : 'network-error', message: error?.name === 'AbortError' ? `Request timed out after ${timeoutMs} ms.` : String(error?.message || error).slice(0, 220) }], bodyIncluded: false });
    } finally { clearTimeout(timer); }
  }
  const passed = results.filter((item) => item.status === 'passed').length;
  return {
    schemaVersion: 1,
    runId: randomUUID(),
    generatedAt: startedAt,
    completedAt: now().toISOString(),
    plan: path.basename(absolute),
    target: validatedBase.url.origin + validatedBase.url.pathname,
    scope: validatedBase.local ? 'loopback-local' : 'explicit-remote-https',
    auth: bearerEnv ? 'environment-bearer-token' : 'none',
    executionKind: 'confirmed-read-only-api-smoke-tests',
    traceContext: { enabled: Boolean(traceId), standard: traceId ? 'W3C Trace Context 1.0' : null, traceId, header: traceId ? 'traceparent' : null, note: traceId ? 'The same trace ID can be supplied to website runs to correlate cross-layer requests.' : 'No trace headers were injected. Re-run with --trace-id to enable request correlation.' },
    summary: { total: results.length, passed, failed: results.length - passed },
    results,
    limitations: ['Only GET and HEAD are sent; POST/PUT/PATCH/DELETE are not supported.', 'Response bodies are inspected only in memory for bounded JSON-path assertions and are never written to the report.', 'This is an API smoke/contract check, not load testing, authorization testing or proof of data correctness.', 'HTTPS and --allow-remote are required for non-loopback targets. The user remains responsible for selecting a safe target and a least-privilege test token.']
  };
}


export async function writeApiSmokeReport({ outputPath, report } = {}) {
  if (!outputPath || !report || report.executionKind !== 'confirmed-read-only-api-smoke-tests') throw new Error('Saving an API smoke report requires an output path and a PAXI API smoke report.');
  const absolute = path.resolve(outputPath);
  const parent = path.dirname(absolute);
  const parentInfo = await fs.lstat(parent).catch(() => null);
  if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('API report output directory must already exist and must not be a symlink.');
  const existing = await fs.lstat(absolute).catch(() => null);
  if (existing) throw new Error('API report output already exists. Choose a new path; reports are never overwritten.');
  const payload = `${JSON.stringify(report, null, 2)}\n`;
  await fs.writeFile(absolute, payload, { flag: 'wx', mode: 0o600 });
  return { path: absolute, bytes: Buffer.byteLength(payload, 'utf8') };
}
