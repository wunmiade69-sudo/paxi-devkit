import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redactSensitiveText } from '../lib/redact.mjs';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SPANS = 2000;
const TRACE_RE = /^[a-f0-9]{32}$/i;
const SPAN_RE = /^[a-f0-9]{16}$/i;
const ALLOWED = new Set([
  'service.name', 'http.request.method', 'http.method', 'http.route', 'url.path',
  'http.response.status_code', 'http.status_code', 'server.address', 'db.system',
  'db.namespace', 'db.operation.name', 'db.operation', 'db.collection.name',
  'exception.type', 'exception.message', 'rpc.system', 'rpc.method',
  'app.state.name', 'app.state.from', 'app.state.to', 'app.state.transition', 'state.name', 'state.transition'
]);

function attrValue(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of ['stringValue', 'intValue', 'doubleValue', 'boolValue']) {
    if (value[key] !== undefined) return value[key];
  }
  if (value.arrayValue || value.kvlistValue || value.bytesValue) return '[complex-value-omitted]';
  return null;
}

function safe(value, max = 180) {
  const result = redactSensitiveText(String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '));
  return result.text.replace(/\s+/g, ' ').trim().slice(0, max) || null;
}

function flattenSpans(document) {
  const result = [];
  for (const resourceGroup of Array.isArray(document?.resourceSpans) ? document.resourceSpans : []) {
    const resourceAttrs = Array.isArray(resourceGroup?.resource?.attributes) ? resourceGroup.resource.attributes : [];
    const service = resourceAttrs.find((item) => item?.key === 'service.name');
    const serviceName = safe(attrValue(service?.value), 80);
    for (const scopeGroup of Array.isArray(resourceGroup?.scopeSpans) ? resourceGroup.scopeSpans : []) {
      for (const span of Array.isArray(scopeGroup?.spans) ? scopeGroup.spans : []) result.push({ span, serviceName });
    }
  }
  // Some exporters wrap a direct span list for local fixtures and converted exports.
  if (!result.length && Array.isArray(document?.spans)) result.push(...document.spans.map((span) => ({ span, serviceName: null })));
  return result;
}

export async function inspectOtelSpans({ filePath, traceId = null, slowDatabaseMs = 500 } = {}) {
  if (!filePath) throw new Error('OpenTelemetry span import requires --spans <otel-export.json>.');
  if (!Number.isFinite(slowDatabaseMs) || slowDatabaseMs < 1 || slowDatabaseMs > 60000) throw new Error('--slow-database-ms must be between 1 and 60000.');
  const wantedTrace = traceId === null ? null : String(traceId).toLowerCase();
  if (wantedTrace && !TRACE_RE.test(wantedTrace)) throw new Error('Trace ID must be 32 hexadecimal characters.');
  const absolute = path.resolve(filePath);
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('OpenTelemetry input must be a regular non-symlink file.');
  if (info.size > MAX_BYTES) throw new Error(`OpenTelemetry input exceeds ${MAX_BYTES} bytes.`);
  const raw = await fs.readFile(absolute);
  if (raw.includes(0)) throw new Error('OpenTelemetry input must be UTF-8 JSON.');
  let document;
  try { document = JSON.parse(raw.toString('utf8')); } catch { throw new Error('OpenTelemetry input is not valid JSON.'); }
  const entries = flattenSpans(document);
  if (!entries.length) throw new Error('No spans were found. Expected OTLP JSON resourceSpans/scopeSpans or a normalized spans array.');
  if (entries.length > MAX_SPANS) throw new Error(`OpenTelemetry input contains more than ${MAX_SPANS} spans.`);

  const spans = [];
  for (const { span, serviceName } of entries) {
    const trace = String(span?.traceId || '').toLowerCase();
    const id = String(span?.spanId || '').toLowerCase();
    if (!TRACE_RE.test(trace) || /^0+$/.test(trace) || !SPAN_RE.test(id) || /^0+$/.test(id)) continue;
    if (wantedTrace && trace !== wantedTrace) continue;
    const parent = String(span?.parentSpanId || '').toLowerCase();
    const attrs = Object.create(null);
    for (const item of Array.isArray(span?.attributes) ? span.attributes.slice(0, 250) : []) {
      if (!ALLOWED.has(item?.key)) continue;
      const value = attrValue(item.value);
      if (value === null || value === undefined) continue;
      attrs[item.key] = safe(value, item.key === 'exception.message' ? 240 : 120);
    }
    const statusCode = Number(attrs['http.response.status_code'] ?? attrs['http.status_code'] ?? 0) || null;
    const start = String(span.startTimeUnixNano || '');
    const end = String(span.endTimeUnixNano || '');
    let durationNs = null;
    try {
      if (/^\d{1,24}$/.test(start) && /^\d{1,24}$/.test(end)) {
        const delta = BigInt(end) - BigInt(start);
        if (delta >= 0n && delta <= 86400000000000n) durationNs = delta.toString();
      }
    } catch {}
    const durationMs = durationNs === null ? null : Number(BigInt(durationNs) / 1000000n);
    const status = Number(span?.status?.code || 0);
    const error = status === 2 || (statusCode !== null && statusCode >= 500) || Boolean(attrs['exception.type']);
    const operation = safe(attrs['db.operation.name'] || attrs['db.operation'] || '', 80);
    const system = safe(attrs['db.system'] || '', 60);
    const isDatabase = Boolean(system || operation || attrs['db.collection.name']);
    const stateName = safe(attrs['app.state.name'] || attrs['state.name'], 80);
    const stateFrom = safe(attrs['app.state.from'], 80);
    const stateTo = safe(attrs['app.state.to'], 80);
    const stateTransition = safe(attrs['app.state.transition'] || attrs['state.transition'], 100);
    const applicationState = stateName || stateFrom || stateTo || stateTransition ? { name: stateName, from: stateFrom, to: stateTo, transition: stateTransition } : null;
    const spanName = safe(span?.name, 120) || 'unnamed-span';
    spans.push({
      traceId: trace, spanId: id, parentSpanId: SPAN_RE.test(parent) && !/^0+$/.test(parent) ? parent : null,
      service: serviceName, name: spanName, kind: Number(span?.kind) || 0,
      startTimeUnixNano: /^\d{1,24}$/.test(start) ? start : null,
      durationNs, durationMs, status: error ? 'error' : status === 1 ? 'ok' : 'unset',
      http: { method: safe(attrs['http.request.method'] || attrs['http.method'], 12), route: safe(attrs['http.route'] || attrs['url.path'], 240), statusCode, server: safe(attrs['server.address'], 120) },
      database: isDatabase ? { system, operation, namespace: safe(attrs['db.namespace'], 80), collection: safe(attrs['db.collection.name'], 100) } : null,
      applicationState,
      exception: attrs['exception.type'] ? { type: attrs['exception.type'], message: attrs['exception.message'] } : null,
      isError: error,
      isSlowDatabase: isDatabase && durationMs !== null && durationMs >= slowDatabaseMs
    });
  }
  if (!spans.length) throw new Error(wantedTrace ? 'No valid spans matched the requested trace ID.' : 'No valid non-zero trace/span IDs were found.');
  const dbSpans = spans.filter((item) => item.database);
  const errors = spans.filter((item) => item.isError);
  const slowDb = dbSpans.filter((item) => item.isSlowDatabase);
  const stateSpans = spans.filter((item) => item.applicationState);
  return {
    schemaVersion: 1,
    reportType: 'paxi-otel-span-report',
    executionKind: 'read-only-otel-span-import',
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(absolute).slice(0, 160),
    sourceSha256: createHash('sha256').update(raw).digest('hex'),
    traceFilter: wantedTrace,
    summary: { spans: spans.length, traceIds: new Set(spans.map((item) => item.traceId)).size, errors: errors.length, databaseSpans: dbSpans.length, slowDatabaseSpans: slowDb.length, applicationStateSpans: stateSpans.length },
    spans,
    limitations: [
      'This is a read-only import of a user-supplied OTLP JSON export; PAXI does not connect to a collector or production observability service.',
      'Only allowlisted span attributes are retained. Attribute scrubbing is best-effort; review evidence before sharing.',
      'A parent/child span relationship is an observability relationship, not by itself proof that a database error caused an application failure.',
      'Missing spans, unsampled traces, clock inconsistencies and exporter-specific fields can affect the completeness of the analysis.'
    ]
  };
}
