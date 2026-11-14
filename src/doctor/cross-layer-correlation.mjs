import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redactSensitiveText } from '../lib/redact.mjs';

const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_REPORTS = 20;
const MAX_EVENTS = 1000;
const MAX_FINDINGS = 300;

function canonicalTraceId(value) { return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value) && !/^0+$/.test(value) ? value.toLowerCase() : null; }

function safeText(value, max = 300) {
  const sanitized = String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return redactSensitiveText(sanitized).text.slice(0, max);
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  const clean = value.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  if (clean.length > 512 || /[\u0000-\u001f\\]/.test(clean) || clean.split('/').some((part) => part === '.' || part === '..')) return null;
  return clean.split('/').map((part) => {
    if (/^\d{1,18}$/.test(part)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part)) return ':uuid';
    return part;
  }).join('/');
}

function parseUrl(value) {
  try {
    const url = new URL(value);
    return { host: url.host.toLowerCase(), path: normalizePath(url.pathname), origin: url.origin };
  } catch { return { host: null, path: normalizePath(value), origin: null }; }
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  let milliseconds = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    milliseconds = value < 1e11 ? value * 1000 : value;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d{16,24}$/.test(text)) {
      try { milliseconds = Number(BigInt(text) / 1000000n); } catch {}
    } else if (/^\d{10}(?:\.\d+)?$/.test(text)) milliseconds = Number(text) * 1000;
    else if (/^\d{13}(?:\.\d+)?$/.test(text)) milliseconds = Number(text);
    else {
      const parsed = Date.parse(text);
      if (Number.isFinite(parsed)) milliseconds = parsed;
    }
  }
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 8640000000000000) return null;
  return { ms: Math.round(milliseconds), iso: new Date(milliseconds).toISOString() };
}

function reportTimestamp(report) {
  return report.completedAt || report.generatedAt || report.createdAt || report.checkedAt || report.timestamp || null;
}

function evidenceKind(type, executionKind) {
  const kind = String(executionKind || '').toLowerCase();
  if (type === 'android-journey') return kind === 'physical-android-device' ? 'physical-device' : kind === 'android-emulator' ? 'emulator' : 'android-unverified';
  if (type === 'android-device-lab') return kind.includes('physical') ? 'physical-device-capture' : kind.includes('emulator') ? 'emulator-capture' : 'device-capture-unverified';
  if (type === 'website') return 'browser-simulation';
  if (type === 'backend-spans' || type === 'backend-trace' || type === 'runtime') return 'runtime-observability';
  if (type === 'api') return 'api-smoke';
  if (type === 'security' || type === 'dependency-audit' || type === 'database') return 'static-or-tool-report';
  if (type === 'visual') return 'image-comparison';
  return 'local-report';
}

function eventKey(event) {
  return createHash('sha256').update([event.sourceType, event.sourceFile, event.sourceId, event.traceId || '', event.code || '', event.path || ''].join('|')).digest('hex').slice(0, 20);
}

async function readReport(filePath) {
  const absolute = path.resolve(filePath);
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Evidence report must be a regular, non-symlink file: ${path.basename(absolute)}`);
  if (info.size > MAX_REPORT_BYTES) throw new Error(`Evidence report exceeds ${MAX_REPORT_BYTES} bytes: ${path.basename(absolute)}`);
  const raw = await fs.readFile(absolute);
  if (raw.includes(0)) throw new Error(`Evidence report is not UTF-8 JSON: ${path.basename(absolute)}`);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch { throw new Error(`Evidence report is not valid UTF-8: ${path.basename(absolute)}`); }
  let report;
  try { report = JSON.parse(source); } catch { throw new Error(`Evidence report is not valid JSON: ${path.basename(absolute)}`); }
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error(`Evidence report must be a JSON object: ${path.basename(absolute)}`);
  return { absolute, report, bytes: info.size, sha256: createHash('sha256').update(raw).digest('hex') };
}

function classify(report) {
  if (report.executionKind === 'confirmed-read-only-api-smoke-tests') return 'api';
  if (report.executionKind === 'read-only-trace-log-inspection' && Array.isArray(report.matches)) return 'backend-trace';
  if (report.reportType === 'paxi-otel-span-report' && report.executionKind === 'read-only-otel-span-import' && Array.isArray(report.spans)) return 'backend-spans';
  if (typeof report.probeId === 'string' && typeof report.target === 'string') return 'runtime';
  if (typeof report.runner === 'string' && report.runner.startsWith('playwright-') && ['simulated-browser-viewport', 'simulated-browser-semantic-journey'].includes(report.executionKind)) return 'website';
  if (report.runner === 'adb-android-user-journey') return 'android-journey';
  if (report.runner === 'adb-device-lab') return 'android-device-lab';
  if (report.executionKind === 'read-only-static-security-review') return 'security';
  if (report.executionKind === 'read-only-sql-migration-review') return 'database';
  if (typeof report.diagnosisId === 'string' && Array.isArray(report.findings)) return 'diagnosis';
  if (typeof report.comparable === 'boolean' && typeof report.passed === 'boolean' && typeof report.baselineSha256 === 'string') return 'visual';
  if (report.executionKind === 'confirmed-online-npm-audit') return 'dependency-audit';
  throw new Error(`Unsupported or unrecognized PAXI evidence report: ${path.basename(report.__file || 'report.json')}. Expected API, backend trace, runtime, website, Android, diagnosis, visual, security, database or dependency-audit evidence.`);
}

function issueSeverity(value) {
  const normalized = String(value || '').toLowerCase();
  if (['critical', 'error', 'high', 'failed'].includes(normalized)) return 'high';
  if (['warning', 'medium', 'review'].includes(normalized)) return 'medium';
  return 'low';
}

function extractEvents(type, report, fileName, sourceSha256) {
  const events = [];
  const fallbackTimestamp = reportTimestamp(report);
  const add = (event) => {
    if (events.length >= MAX_EVENTS) return;
    const traceId = canonicalTraceId(event.traceId);
    const timestampValue = event.timestamp ?? event.occurredAt ?? event.startedAt ?? event.startTimeUnixNano ?? fallbackTimestamp;
    const timestamp = normalizeTimestamp(timestampValue);
    const normalized = {
      sourceType: type,
      sourceFile: fileName,
      ...event,
      traceId,
      eventAt: timestamp?.iso || null,
      timestampSource: timestamp ? (event.timestampSource || (event.startTimeUnixNano ? 'otel-span-start' : event.timestamp || event.occurredAt || event.startedAt ? 'event-timestamp' : 'report-timestamp')) : 'unavailable',
      evidenceKind: evidenceKind(type, event.executionKind || report.executionKind || report.runner)
    };
    normalized.eventId = `ev-${createHash('sha256').update(`${sourceSha256}|${eventKey(normalized)}`).digest('hex').slice(0, 20)}`;
    delete normalized.timestamp;
    delete normalized.occurredAt;
    delete normalized.startedAt;
    delete normalized.startTimeUnixNano;
    events.push(normalized);
  };
  if (type === 'api') {
    let base = { host: null, path: '/' };
    try { base = parseUrl(report.target); } catch {}
    for (const item of (Array.isArray(report.results) ? report.results : []).slice(0, MAX_FINDINGS)) {
      if (item?.status !== 'failed') continue;
      const route = typeof item.path === 'string' ? `${base.path === '/' ? '' : base.path}${item.path.startsWith('/') ? item.path : `/${item.path}`}` : null;
      add({ sourceId: safeText(item.id, 64), status: 'failed', severity: 'high', code: 'api-smoke-failed', method: safeText(item.method, 8), path: normalizePath(route), host: base.host, traceId: item.traceId || report.traceContext?.traceId, timestamp: item.timestamp || item.completedAt || item.startedAt, statusCode: Number.isInteger(item.statusCode) ? item.statusCode : null, codes: (item.issues || []).slice(0, 8).map((issue) => safeText(issue.code, 80)), summary: safeText((item.issues || []).map((issue) => issue.message).join('; ') || 'API smoke case failed.') });
    }
  } else if (type === 'backend-spans') {
    for (const span of (Array.isArray(report.spans) ? report.spans : []).slice(0, MAX_FINDINGS)) {
      const database = span.database && typeof span.database === 'object' ? { system: safeText(span.database.system, 60), operation: safeText(span.database.operation, 80), namespace: safeText(span.database.namespace, 80), collection: safeText(span.database.collection, 100) } : null;
      const error = span.isError === true || span.status === 'error';
      const slow = span.isSlowDatabase === true;
      const severity = error ? 'high' : slow ? 'medium' : 'low';
      const state = span.applicationState && typeof span.applicationState === 'object' ? { name: safeText(span.applicationState.name, 80), from: safeText(span.applicationState.from, 80), to: safeText(span.applicationState.to, 80), transition: safeText(span.applicationState.transition, 100) } : null;
      add({ sourceId: safeText(span.spanId, 32), status: error ? 'failed' : slow ? 'slow' : 'finding', severity, code: error ? state ? 'application-state-transition-error' : database ? 'database-span-error' : 'backend-span-error' : slow ? 'slow-database-span' : state ? 'application-state-transition' : 'backend-span', traceId: span.traceId, startTimeUnixNano: span.startTimeUnixNano, spanId: safeText(span.spanId, 32), parentSpanId: safeText(span.parentSpanId, 32), service: safeText(span.service, 80), spanName: safeText(span.name, 120), durationMs: Number.isFinite(Number(span.durationMs)) ? Number(span.durationMs) : null, method: safeText(span.http?.method, 12), path: normalizePath(span.http?.route), host: safeText(span.http?.server, 120), statusCode: Number.isInteger(span.http?.statusCode) ? span.http.statusCode : null, database, applicationState: state, summary: safeText([span.service, span.name, database ? `${database.system || 'database'} ${database.operation || ''}` : '', state?.transition, state?.from && state?.to ? `${state.from} → ${state.to}` : '', span.exception?.type, span.exception?.message].filter(Boolean).join(' · ') || span.name || 'OpenTelemetry span') });
    }
  } else if (type === 'backend-trace') {
    for (const match of (Array.isArray(report.matches) ? report.matches : []).slice(0, MAX_FINDINGS)) {
      const level = safeText(match?.level, 24).toLowerCase();
      const isError = ['fatal', 'critical', 'error', 'err'].includes(level);
      add({ sourceId: `line-${Number(match?.lineNumber) || 0}`, status: isError ? 'failed' : 'finding', severity: isError ? 'high' : ['warn', 'warning'].includes(level) ? 'medium' : 'low', code: isError ? 'backend-trace-log-error' : 'backend-trace-log-event', host: null, path: null, traceId: report.traceId, timestamp: match?.timestamp, summary: safeText([match?.timestamp, match?.service, match?.message].filter(Boolean).join(' · ') || `Backend trace log ${level}.`) });
    }
  } else if (type === 'runtime') {
    const target = parseUrl(report.target);
    if (report.healthy !== true) add({ sourceId: safeText(report.probeId, 80), status: 'unhealthy', severity: 'high', code: 'runtime-probe-unhealthy', host: target.host, path: target.path, traceId: report.traceId, statusCode: Number.isInteger(report.statusCode) ? report.statusCode : null, summary: safeText(report.failure || 'Runtime probe reported unhealthy.') });
    for (const dependency of (Array.isArray(report.dependencies) ? report.dependencies : []).slice(0, 30)) {
      if (/^(?:healthy|ready|ok|up|pass|passed)$/i.test(String(dependency?.status || ''))) continue;
      add({ sourceId: safeText(dependency?.name, 80), status: 'dependency-unhealthy', severity: 'high', code: 'runtime-dependency-unhealthy', host: target.host, path: target.path, summary: `Runtime probe reported ${safeText(dependency?.name, 80)} as ${safeText(dependency?.status, 80)}.` });
    }
  } else if (type === 'website') {
    const pageTarget = parseUrl(report.targetUrl || '');
    if (report.reportType === 'paxi-semantic-website-journey') {
      for (const result of (Array.isArray(report.results) ? report.results : []).filter((item) => item?.status === 'failed').slice(0, 100)) {
        add({ sourceId: `step-${Number(result.index) || 0}`, status: 'failed', severity: 'high', code: 'website-semantic-step-failed', host: pageTarget.host, path: pageTarget.path, method: null, traceId: report.traceContext?.traceId, timestamp: result.timestamp || result.completedAt || result.startedAt, summary: `Semantic browser journey step ${Number(result.index) || '?'} (${safeText(result.type, 40)}) failed: ${safeText(result.error, 240)}`, executionKind: report.executionKind });
      }
      for (const response of (Array.isArray(report.httpErrors) ? report.httpErrors : []).slice(0, 40)) {
        const target = parseUrl(response.url);
        add({ sourceId: `http-${Number(response.status) || 0}`, status: 'failed', severity: Number(response.status) >= 500 ? 'high' : 'medium', code: 'website-api-http-error', method: safeText(response.method, 8), host: target.host, path: target.path, traceId: response.traceId || report.traceContext?.traceId, timestamp: response.timestamp || response.receivedAt, statusCode: Number.isInteger(response.status) ? response.status : null, summary: `Semantic journey browser request returned HTTP ${Number(response.status) || 'unknown'}.`, executionKind: report.executionKind });
      }
      for (const issue of (Array.isArray(report.issues) ? report.issues : []).slice(0, 30)) {
        add({ sourceId: safeText(issue.code, 80), status: issue.severity === 'error' ? 'failed' : 'finding', severity: issueSeverity(issue.severity), code: safeText(issue.code, 100), host: pageTarget.host, path: pageTarget.path, traceId: report.traceContext?.traceId, summary: safeText(issue.message || issue.code), executionKind: report.executionKind });
      }
    }
    for (const result of (Array.isArray(report.results) ? report.results : []).slice(0, 100)) {
      for (const response of (Array.isArray(result?.evidence?.httpErrors) ? result.evidence.httpErrors : []).slice(0, 50)) {
        const target = parseUrl(response.url);
        add({ sourceId: safeText(result.id, 80), status: 'failed', severity: Number(response.status) >= 500 ? 'high' : 'medium', code: 'website-api-http-error', method: safeText(response.method, 8), host: target.host, path: target.path, traceId: response.traceId, statusCode: Number.isInteger(response.status) ? response.status : null, summary: `Browser ${safeText(response.resourceType, 40)} request returned HTTP ${Number(response.status) || 'unknown'}.`, executionKind: report.executionKind || 'simulated-browser-viewport' });
      }
      for (const issue of (Array.isArray(result?.issues) ? result.issues : []).slice(0, 30)) {
        if (!['browser-runtime-error', 'network-request-failed', 'website-navigation-failed', 'horizontal-overflow', 'visual-regression'].includes(issue?.code)) continue;
        add({ sourceId: safeText(result.id, 80), status: 'failed', severity: issueSeverity(issue.severity), code: safeText(issue.code, 100), host: pageTarget.host, origin: pageTarget.origin, path: pageTarget.path, method: 'GET', timestamp: issue.timestamp, summary: safeText(issue.message), executionKind: report.executionKind || 'simulated-browser-viewport', profile: safeText(result.profile, 40), viewport: result.viewport && typeof result.viewport === 'object' ? { width: Number(result.viewport.width) || null, height: Number(result.viewport.height) || null } : null });
      }
    }
  } else if (type === 'android-journey') {
    for (const issue of (Array.isArray(report.issues) ? report.issues : []).slice(0, 100)) add({ sourceId: safeText(issue.step ?? issue.code, 80), status: issue.severity === 'error' ? 'failed' : 'review', severity: issueSeverity(issue.severity), code: safeText(issue.code, 100), host: null, path: null, timestamp: issue.timestamp, summary: safeText(issue.message), executionKind: report.executionKind || 'unknown', packageId: safeText(report.app?.packageId, 160), deviceType: safeText(report.device?.type, 40) });
  } else if (type === 'android-device-lab') {
    add({ sourceId: safeText(report.runId, 80), status: 'evidence-only', severity: 'low', code: 'android-device-context', host: null, path: null, summary: `Android device context: ${safeText(report.device?.model, 80)} · ${safeText(report.device?.androidRelease, 40)} · ${safeText(report.executionKind, 80)}. No pass/fail assertion is inferred from a capture-only run.`, deviceType: safeText(report.device?.type, 40) });
  } else if (type === 'diagnosis') {
    for (const finding of (Array.isArray(report.findings) ? report.findings : []).slice(0, MAX_FINDINGS)) add({ sourceId: safeText(finding.code, 80), status: 'finding', severity: issueSeverity(finding.severity), code: safeText(finding.code, 100), host: null, path: null, summary: safeText(finding.title || finding.evidence || finding.recommendation) });
  } else if (type === 'security' || type === 'database' || type === 'dependency-audit') {
    const source = Array.isArray(report.findings) ? report.findings : Array.isArray(report.advisories) ? report.advisories : [];
    for (const finding of source.slice(0, MAX_FINDINGS)) add({ sourceId: safeText(finding.file || finding.name || finding.code, 100), status: 'finding', severity: issueSeverity(finding.severity), code: safeText(finding.code || `dependency-${finding.severity || 'finding'}`, 100), host: null, path: null, summary: safeText(finding.message || finding.title || `${finding.name || 'Dependency'}: ${finding.severity || 'review'}`) });
  } else if (type === 'visual' && !report.passed) {
    add({ sourceId: 'visual-regression', status: 'failed', severity: 'medium', code: 'visual-regression', host: null, path: null, summary: `Visual comparison changed ${Number(report.changedPercent || 0)}% of pixels; configured allowance was ${Number(report.maxChangedPercent || 0)}%.` });
  }
  return events;
}

function correlateEvents(events) {
  const correlations = [];
  const apiFailures = events.filter((item) => item.sourceType === 'api' && item.path);
  const webFailures = events.filter((item) => item.sourceType === 'website' && item.path);
  const exactTracePairs = new Set();
  for (const api of apiFailures) {
    if (!api.traceId) continue;
    for (const web of webFailures) {
      if (!web.traceId || api.traceId !== web.traceId) continue;
      if (api.host && web.host && api.host !== web.host) continue;
      if (api.path !== web.path) continue;
      if (api.method && web.method && api.method !== web.method) continue;
      exactTracePairs.add(`${api.sourceFile}:${api.sourceId}|${web.sourceFile}:${web.sourceId}`);
      correlations.push({
        code: 'distributed-trace-id-match', confidence: api.statusCode !== null && api.statusCode === web.statusCode ? 'high' : 'medium', layers: ['api', 'website'], traceId: api.traceId,
        route: api.path,
        statusCode: api.statusCode !== null && api.statusCode === web.statusCode ? api.statusCode : null,
        evidence: [{ sourceType: api.sourceType, sourceFile: api.sourceFile, sourceId: api.sourceId }, { sourceType: web.sourceType, sourceFile: web.sourceFile, sourceId: web.sourceId }],
        interpretation: 'The API and browser reports contain the same explicitly propagated W3C trace ID, normalized route and compatible method. This is a high-value request investigation lead; inspect backend spans/logs to establish the failing component.'
      });
    }
  }
  for (const api of apiFailures) {
    for (const web of webFailures) {
      if (api.path !== web.path) continue;
      if (exactTracePairs.has(`${api.sourceFile}:${api.sourceId}|${web.sourceFile}:${web.sourceId}`)) continue;
      const sameStatus = api.statusCode !== null && web.statusCode !== null && api.statusCode === web.statusCode;
      if (!sameStatus && api.statusCode !== null && web.statusCode !== null) continue;
      correlations.push({
        code: 'frontend-api-route-match',
        confidence: sameStatus ? 'medium' : 'low',
        layers: ['website', 'api'],
        route: api.path,
        statusCode: sameStatus ? api.statusCode : null,
        evidence: [{ sourceType: api.sourceType, sourceFile: api.sourceFile, sourceId: api.sourceId }, { sourceType: web.sourceType, sourceFile: web.sourceFile, sourceId: web.sourceId }],
        interpretation: sameStatus ? 'The API smoke test and browser evidence observed the same normalized route and HTTP status. This is a strong investigation lead, not proof that one caused the other.' : 'The API smoke test and browser evidence observed the same normalized route; status information was incomplete.'
      });
    }
  }
  const runtimeFailures = events.filter((item) => item.sourceType === 'runtime' && item.host && item.status === 'unhealthy');
  for (const runtime of runtimeFailures) {
    for (const other of events.filter((item) => ['api', 'website'].includes(item.sourceType) && item.host === runtime.host && item.status === 'failed')) {
      correlations.push({ code: 'service-health-and-request-failure', confidence: 'medium', layers: [...new Set(['runtime', other.sourceType])], host: runtime.host, route: other.path, evidence: [{ sourceType: runtime.sourceType, sourceFile: runtime.sourceFile, sourceId: runtime.sourceId }, { sourceType: other.sourceType, sourceFile: other.sourceFile, sourceId: other.sourceId }], interpretation: 'A runtime health probe and a request-level failure occurred on the same host in the supplied evidence set. Verify service health, logs and deployment timing before assigning a root cause.' });
    }
  }
  const traceGroups = new Map();
  for (const event of events) {
    if (!event.traceId) continue;
    const group = traceGroups.get(event.traceId) || [];
    group.push(event);
    traceGroups.set(event.traceId, group);
  }
  for (const [traceId, group] of traceGroups) {
    const layers = [...new Set(group.map((item) => item.sourceType))].sort();
    const hasBackendTrace = layers.includes('backend-trace');
    const hasBackendSpans = layers.includes('backend-spans');
    if ((!hasBackendTrace && !hasBackendSpans) || layers.length < 2) continue;
    correlations.push({ code: hasBackendSpans ? 'backend-span-context-match' : 'backend-trace-context-match', confidence: 'high', traceId, layers, evidence: group.slice(0, 10).map(({ sourceType, sourceFile, sourceId, code, status, spanId, parentSpanId }) => ({ sourceType, sourceFile, sourceId, code, status, spanId, parentSpanId })), interpretation: hasBackendSpans ? 'Backend OpenTelemetry spans and other supplied evidence share the exact W3C trace ID. Span ancestry adds request-path context, but timing, sampling, async links and service semantics still require human review before assigning root cause.' : 'Backend log records and other supplied evidence share the exact W3C trace ID. This links them to the same trace context, but span parentage, timing and causal responsibility still require observability data and human review.' });
  }
  const apiFailed = events.some((item) => item.sourceType === 'api' && item.status === 'failed');
  const databaseRisk = events.filter((item) => item.sourceType === 'database' && item.severity === 'high');
  if (apiFailed && databaseRisk.length) correlations.push({ code: 'api-failure-with-database-migration-risk', confidence: 'low', layers: ['api', 'database'], evidence: [...events.filter((item) => item.sourceType === 'api' && item.status === 'failed').slice(0, 2), ...databaseRisk.slice(0, 3)].map(({ sourceType, sourceFile, sourceId }) => ({ sourceType, sourceFile, sourceId })), interpretation: 'API failures and high-severity migration findings coexist in the supplied evidence. This is contextual correlation only; it does not establish that a migration caused the API failure.' });
  return correlations.slice(0, 200);
}

function buildRootCauseCandidates(events, correlations) {
  const candidates = [];
  const spans = events.filter((item) => item.sourceType === 'backend-spans' && item.traceId && item.spanId);
  const spanIndex = new Map(spans.map((item) => [`${item.traceId}:${item.spanId}`, item]));
  const apiFailures = events.filter((item) => item.sourceType === 'api' && item.status === 'failed' && item.traceId);
  for (const db of spans.filter((item) => item.database && (item.status === 'failed' || item.status === 'slow'))) {
    const relatedApi = apiFailures.find((api) => api.traceId === db.traceId);
    if (!relatedApi) continue;
    let cursor = db;
    let linkedToService = false;
    const chain = [db];
    const visited = new Set([db.spanId]);
    for (let depth = 0; depth < 16 && cursor.parentSpanId; depth += 1) {
      const parent = spanIndex.get(`${db.traceId}:${cursor.parentSpanId}`);
      if (!parent || visited.has(parent.spanId)) break;
      visited.add(parent.spanId);
      chain.push(parent);
      if (parent.service && parent.service !== db.service) linkedToService = true;
      cursor = parent;
    }
    const requestAncestor = chain.slice(1).find((item) => item.path && item.path === relatedApi.path && (!relatedApi.method || !item.method || item.method === relatedApi.method)) || null;
    const strong = db.status === 'failed' && Boolean(requestAncestor);
    candidates.push({
      id: `db-${db.spanId}`,
      category: db.status === 'failed' ? 'database-error-in-request-trace' : 'slow-database-operation-in-request-trace',
      rank: 0,
      confidence: strong ? 'high' : 'medium',
      candidate: db.status === 'failed' ? 'A database span reported an error on the same trace as a failed API request.' : 'A slow database operation occurred on the same trace as a failed API request.',
      evidence: { traceId: db.traceId, api: { sourceFile: relatedApi.sourceFile, route: relatedApi.path, statusCode: relatedApi.statusCode }, databaseSpan: { spanId: db.spanId, parentSpanId: db.parentSpanId, service: db.service, operation: db.database.operation, system: db.database.system, durationMs: db.durationMs, status: db.status }, requestAncestor: requestAncestor ? { spanId: requestAncestor.spanId, service: requestAncestor.service, route: requestAncestor.path, method: requestAncestor.method, statusCode: requestAncestor.statusCode } : null, parentChain: chain.slice(0, 8).map((item) => ({ spanId: item.spanId, parentSpanId: item.parentSpanId, service: item.service, name: item.spanName, status: item.status })) },
      interpretation: 'This is a prioritized root-cause hypothesis. High confidence requires a failed database span whose parent chain reaches a matching HTTP route in the failed API request. Confirm timing, retries, transaction outcome and application semantics before attributing causation.',
      requiresHumanVerification: true
    });
  }
  for (const stateSpan of spans.filter((item) => item.code === 'application-state-transition-error')) {
    const relatedApi = apiFailures.find((api) => api.traceId === stateSpan.traceId);
    if (!relatedApi) continue;
    candidates.push({ id: `state-${stateSpan.spanId}`, category: 'application-state-transition-error-in-request-trace', rank: 0, confidence: 'medium', candidate: 'An application-state transition span reported an error on the same trace as a failed API request.', evidence: { traceId: stateSpan.traceId, api: { sourceFile: relatedApi.sourceFile, route: relatedApi.path, statusCode: relatedApi.statusCode }, stateSpan: { spanId: stateSpan.spanId, parentSpanId: stateSpan.parentSpanId, service: stateSpan.service, transition: stateSpan.applicationState } }, interpretation: 'Check the state machine contract, transition guard, cancellation/retry path and persisted state. Shared trace context does not prove the API failure caused the transition error.', requiresHumanVerification: true });
  }
  for (const correlation of correlations) {
    if (correlation.code === 'service-health-and-request-failure' || correlation.code === 'distributed-trace-id-match' || correlation.code === 'frontend-api-route-match' || correlation.code === 'backend-span-context-match' || correlation.code === 'backend-trace-context-match') {
      candidates.push({ id: `correlation-${candidates.length + 1}`, category: correlation.code, rank: 2, confidence: correlation.confidence, candidate: correlation.interpretation, evidence: correlation.evidence, requiresHumanVerification: true, interpretation: 'Cross-layer correlation is an investigation lead, not a proven root cause.' });
    }
  }
  const seen = new Set();
  return candidates.filter((item) => { const key = `${item.category}:${item.evidence?.traceId || ''}:${item.evidence?.databaseSpan?.spanId || item.evidence?.stateSpan?.spanId || ''}`; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => a.rank - b.rank || ({ high: 0, medium: 1, low: 2 }[a.confidence] - { high: 0, medium: 1, low: 2 }[b.confidence])).slice(0, 100).map((item, index) => ({ ...item, rank: index + 1 }));
}

function eventEvidenceRef(event) {
  return { eventId: event.eventId, sourceType: event.sourceType, sourceFile: event.sourceFile, sourceId: event.sourceId, code: event.code, status: event.status, eventAt: event.eventAt };
}

function buildTimeline(events) {
  const rows = events.map((event) => ({
    eventId: event.eventId,
    eventAt: event.eventAt,
    timestampSource: event.timestampSource,
    sourceType: event.sourceType,
    sourceFile: event.sourceFile,
    sourceId: event.sourceId,
    severity: event.severity,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : null,
    status: event.status,
    code: event.code,
    traceId: event.traceId,
    summary: event.summary
  }));
  rows.sort((a, b) => {
    if (a.eventAt && b.eventAt) return Date.parse(a.eventAt) - Date.parse(b.eventAt) || a.sourceType.localeCompare(b.sourceType);
    if (a.eventAt) return -1;
    if (b.eventAt) return 1;
    return a.sourceType.localeCompare(b.sourceType) || a.sourceFile.localeCompare(b.sourceFile);
  });
  const timestamped = rows.filter((item) => item.eventAt);
  const first = timestamped[0] ? Date.parse(timestamped[0].eventAt) : null;
  return {
    ordering: timestamped.length === rows.length ? 'timestamp-sorted' : timestamped.length ? 'partial-timestamp-order' : 'source-order-only',
    timestampedEvents: timestamped.length,
    events: rows.map((item) => ({ ...item, offsetFromFirstMs: item.eventAt && first !== null ? Date.parse(item.eventAt) - first : null }))
  };
}

function buildInvestigationCases(events, correlations) {
  const groups = new Map();
  for (const event of events) {
    const key = event.traceId
      ? `trace:${event.traceId}`
      : event.path
        ? `route:${event.path}`
        : null;
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(event);
    groups.set(key, group);
  }
  const cases = [];
  for (const [key, group] of groups) {
    const layers = [...new Set(group.map((item) => item.sourceType))].sort();
    if (layers.length < 2) continue;
    const failed = group.filter((item) => item.status === 'failed' || item.status === 'unhealthy' || item.status === 'dependency-unhealthy');
    const traceBased = key.startsWith('trace:');
    const relatedCorrelations = correlations.filter((item) => (traceBased && item.traceId === key.slice(6)) || (item.evidence || []).some((ref) => group.some((event) => event.sourceFile === ref.sourceFile && event.sourceId === ref.sourceId)));
    const eventsForCase = group.slice(0, 100);
    const kinds = [...new Set(group.map((item) => item.evidenceKind))].sort();
    const missingEvidence = [];
    if (layers.some((layer) => ['api', 'website'].includes(layer)) && !layers.some((layer) => ['backend-spans', 'backend-trace'].includes(layer))) {
      missingEvidence.push({ id: 'backend-observability', priority: 'high', recommendation: 'Collect backend OpenTelemetry spans or trace-filtered logs for the same request context.' });
    }
    if (layers.includes('api') && layers.includes('website') && !traceBased) {
      missingEvidence.push({ id: 'w3c-trace-propagation', priority: 'high', recommendation: 'Propagate W3C traceparent from the browser through the API and backend, then rerun both checks with the same trace ID.' });
    }
    if (layers.some((layer) => ['backend-spans', 'backend-trace'].includes(layer)) && !layers.includes('database')) {
      const hasDbSpan = group.some((item) => item.sourceType === 'backend-spans' && item.database);
      if (!hasDbSpan) missingEvidence.push({ id: 'database-span-coverage', priority: 'medium', recommendation: 'Add database client spans (without SQL bind values or customer payloads) to determine whether persistence calls are involved.' });
    }
    if (layers.includes('android-journey')) missingEvidence.push({ id: 'android-feature-assertion', priority: 'medium', recommendation: 'Capture the UI hierarchy and add a selector-specific assertion for the failed user-visible behavior.' });
    if (layers.includes('website')) missingEvidence.push({ id: 'browser-reproduction', priority: 'low', recommendation: 'Re-run the same route and journey on the target browser with console, failed-request and screenshot evidence.' });
    const fingerprint = createHash('sha256').update(key).digest('hex').slice(0, 16);
    const timeline = buildTimeline(eventsForCase);
    const confidence = traceBased ? (relatedCorrelations.some((item) => item.code === 'backend-span-context-match' || item.code === 'backend-trace-context-match') ? 'high-context-link' : 'medium-context-link') : 'low-route-context-only';
    cases.push({
      id: `case-${fingerprint}`,
      identityBasis: traceBased ? 'exact-w3c-trace-id' : 'normalized-host-method-route-only',
      traceId: traceBased ? key.slice(6) : null,
      route: traceBased ? null : { hosts: [...new Set(group.map((item) => item.host).filter(Boolean))].sort(), methods: [...new Set(group.map((item) => item.method).filter(Boolean))].sort(), path: group[0].path },
      layers,
      confidence,
      eventCount: group.length,
      failedEventCount: failed.length,
      highestSeverity: group.some((item) => item.severity === 'high') ? 'high' : group.some((item) => item.severity === 'medium') ? 'medium' : 'low',
      evidenceKinds: kinds,
      correlations: relatedCorrelations.map((item) => ({ code: item.code, confidence: item.confidence })),
      timeline,
      evidence: eventsForCase.map(eventEvidenceRef),
      missingEvidence,
      interpretation: traceBased
        ? 'Events share the same valid W3C trace ID. This links context but does not prove causality.'
        : 'Events share only a normalized route key. They may come from different hosts, requests or times; this is a weak grouping aid, not a single-incident assertion and does not prove causality.'
    });
  }
  return cases.sort((a, b) => (b.failedEventCount - a.failedEventCount) || ({ high: 0, medium: 1, low: 2 }[a.highestSeverity] - { high: 0, medium: 1, low: 2 }[b.highestSeverity]) || a.id.localeCompare(b.id)).slice(0, 100);
}

function buildEvidenceCoverage(inputs, events, cases, eventsTruncated = false) {
  const layers = [...new Set(inputs.map((item) => item.type))].sort();
  const evidenceKinds = [...new Set(events.map((item) => item.evidenceKind))].sort();
  const hasTraceContext = events.some((item) => item.traceId);
  const hasBackend = layers.includes('backend-spans') || layers.includes('backend-trace');
  const recommendations = [];
  if (eventsTruncated) recommendations.push('The global event limit was reached; some extracted events were omitted. Split the evidence into smaller investigation batches before drawing conclusions.');
  if ((layers.includes('api') || layers.includes('website')) && !hasBackend) recommendations.push('Backend trace/span evidence is absent; root-cause candidates may remain frontend/API level only.');
  if (layers.includes('api') && layers.includes('website') && !hasTraceContext) recommendations.push('No valid W3C trace ID was present; route correlation cannot establish request identity.');
  if (layers.includes('android-journey') && !events.some((item) => item.sourceType === 'android-journey' && item.deviceType === 'physical-device')) recommendations.push('Android evidence does not establish a physical-device run.');
  if (layers.includes('website')) recommendations.push('Browser evidence is a browser execution/simulation and must not be described as a native Android or iOS result.');
  return {
    status: recommendations.length ? 'partial' : 'evidence-linked',
    eventsTruncated,
    reports: inputs.length,
    layers,
    evidenceKinds,
    traceContextAvailable: hasTraceContext,
    backendTelemetryAvailable: hasBackend,
    investigationCases: cases.length,
    timestampCoverage: events.length ? Number((events.filter((item) => item.eventAt).length / events.length).toFixed(3)) : 0,
    recommendations
  };
}

export async function analyzeCrossLayerEvidence({ reportPaths = [] } = {}) {
  if (!Array.isArray(reportPaths) || reportPaths.length < 1 || reportPaths.length > MAX_REPORTS) throw new Error(`Cross-layer correlation requires 1–${MAX_REPORTS} --report files.`);
  const inputs = [];
  const events = [];
  const layers = new Set();
  const seenInputHashes = new Set();
  let eventsTruncated = false;
  for (const filePath of reportPaths) {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('Every evidence report path must be a non-empty string.');
    const { absolute, report, bytes, sha256 } = await readReport(filePath);
    if (seenInputHashes.has(sha256)) throw new Error(`Duplicate evidence input detected by SHA-256: ${path.basename(absolute)}. Supply each report only once.`);
    seenInputHashes.add(sha256);
    const type = classify(report);
    const extracted = extractEvents(type, report, path.basename(absolute), sha256);
    const remaining = Math.max(0, MAX_EVENTS - events.length);
    const accepted = extracted.slice(0, remaining);
    const omitted = extracted.length - accepted.length;
    if (omitted > 0) eventsTruncated = true;
    layers.add(type);
    events.push(...accepted);
    inputs.push({ file: path.basename(absolute), type, bytes, sha256, events: accepted.length, eventsExtracted: extracted.length, eventsOmitted: omitted, executionKind: safeText(report.executionKind || report.runner || type, 100) });
  }
  const correlations = correlateEvents(events);
  const rootCauseCandidates = buildRootCauseCandidates(events, correlations);
  const investigationCases = buildInvestigationCases(events, correlations);
  const evidenceCoverage = buildEvidenceCoverage(inputs, events, investigationCases, eventsTruncated);
  const counts = events.reduce((summary, event) => { summary[event.severity] = (summary[event.severity] || 0) + 1; return summary; }, {});
  return {
    schemaVersion: 1,
    reportType: 'paxi-cross-layer-evidence-correlation',
    generatedAt: new Date().toISOString(),
    summary: { reports: inputs.length, layers: [...layers].sort(), events: events.length, traceIds: new Set(events.map((item) => item.traceId).filter(Boolean)).size, high: counts.high || 0, medium: counts.medium || 0, low: counts.low || 0, correlations: correlations.length, investigationCases: investigationCases.length, timestampedEvents: events.filter((item) => item.eventAt).length, eventsTruncated },
    evidenceCoverage,
    inputs,
    events,
    timeline: buildTimeline(events),
    correlations,
    investigationCases,
    rootCauseCandidates,
    limitations: [
      'Correlation is based only on the explicitly supplied reports and normalized metadata. Input SHA-256 values provide integrity references, not proof that an input is authentic or complete.',
      'Browser viewport reports are simulations; Android journey reports retain their own emulator/physical-device classification.',
      'No screenshot bytes, response bodies, request headers, bearer tokens, absolute report paths or raw customer data are copied into this report. Trace IDs are retained only when they are valid non-zero 32-character hexadecimal W3C identifiers.',
      'A route match is weak grouping evidence and can combine separate requests. Exact shared W3C trace IDs link reports to one trace context but do not prove which service caused the failure and do not establish causation; inspect server spans/logs before declaring root cause.',
      'Timelines sort only the timestamps supplied by source reports. Cross-host clock skew, sampling, retries, async messaging, missing parent spans and exporter conventions can distort ordering. Root-cause candidates are hypotheses, never automatic conclusions.'
    ]
  };
}
