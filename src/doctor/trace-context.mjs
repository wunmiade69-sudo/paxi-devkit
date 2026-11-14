import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { redactSensitiveText } from '../lib/redact.mjs';

const TRACE_ID_RE = /^[a-f0-9]{32}$/i;
const SPAN_ID_RE = /^[a-f0-9]{16}$/i;

export function validateTraceId(value) {
  if (typeof value !== 'string' || !TRACE_ID_RE.test(value) || /^0+$/.test(value)) {
    throw new Error('Trace ID must be 32 hexadecimal characters and cannot be all zeroes.');
  }
  return value.toLowerCase();
}

export function createTraceId() {
  return randomBytes(16).toString('hex');
}

export function createTraceparent(traceId, spanId = randomBytes(8).toString('hex')) {
  const normalizedTraceId = validateTraceId(traceId);
  if (typeof spanId !== 'string' || !SPAN_ID_RE.test(spanId) || /^0+$/.test(spanId)) {
    throw new Error('Trace span ID must be 16 hexadecimal characters and cannot be all zeroes.');
  }
  return `00-${normalizedTraceId}-${spanId.toLowerCase()}-01`;
}

export function parseTraceparent(value) {
  if (typeof value !== 'string' || value.length > 128) return null;
  const match = value.trim().match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-([0-9a-f]{2})$/i);
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null;
  return { traceId: match[1].toLowerCase(), spanId: match[2].toLowerCase(), flags: match[3].toLowerCase() };
}

function readHeader(headers, name) {
  if (!headers) return null;
  try {
    if (typeof headers.get === 'function') return headers.get(name);
    const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
  } catch { return null; }
}

export function extractTraceContext(headers) {
  const traceparent = readHeader(headers, 'traceparent');
  const parsed = parseTraceparent(traceparent);
  const paxiTraceId = readHeader(headers, 'x-paxi-trace-id');
  const traceId = parsed?.traceId || (typeof paxiTraceId === 'string' && TRACE_ID_RE.test(paxiTraceId) && !/^0+$/.test(paxiTraceId) ? paxiTraceId.toLowerCase() : null);
  const requestId = readHeader(headers, 'x-request-id') || readHeader(headers, 'request-id');
  const safeRequestId = typeof requestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ? requestId : null;
  return { traceId, spanId: parsed?.spanId || null, requestId: safeRequestId };
}


function nestedValue(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    if (keys.has(key.toLowerCase()) && typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const nested = nestedValue(item, keys, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function safeLogText(value, max = 220) {
  const initial = String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  const common = redactSensitiveText(initial).text;
  const redacted = common.replace(/\b(token|session[_-]?(?:token|id)|cookie|set-cookie|authorization)\b(\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)/gi, (_match, key, separator) => `${key}${separator}[REDACTED]`);
  return redacted.slice(0, max);
}

export async function inspectTraceLog({ filePath, traceId, maxBytes = 5 * 1024 * 1024, maxMatches = 100 } = {}) {
  const normalizedTraceId = validateTraceId(traceId);
  if (!filePath) throw new Error('Trace log inspection requires --log <backend.log>.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 20 * 1024 * 1024) throw new Error('Trace log inspection size limit must be 1 KiB–20 MiB.');
  if (!Number.isSafeInteger(maxMatches) || maxMatches < 1 || maxMatches > 500) throw new Error('Trace log match limit must be 1–500.');
  const absolute = path.resolve(filePath);
  const info = await fs.lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Trace log must be a regular, non-symlink file.');
  if (info.size > maxBytes) throw new Error(`Trace log exceeds the ${maxBytes}-byte inspection limit.`);
  const content = await fs.readFile(absolute, 'utf8');
  if (content.includes('\0')) throw new Error('Trace log must be UTF-8 text.');
  const lines = content.split(/\r?\n/);
  const matches = [];
  let totalMatches = 0;
  const levelPattern = /\b(fatal|critical|error|err|warning|warn|info|debug|trace)\b/i;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !line.toLowerCase().includes(normalizedTraceId)) continue;
    totalMatches += 1;
    if (matches.length >= maxMatches) continue;
    let record = null;
    if (line.trimStart().startsWith('{')) {
      try { const parsed = JSON.parse(line); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed; } catch {}
    }
    const level = safeLogText(nestedValue(record, new Set(['level', 'severity', 'loglevel'])) || line.match(levelPattern)?.[1] || 'unknown', 24).toLowerCase();
    const timestamp = safeLogText(nestedValue(record, new Set(['timestamp', '@timestamp', 'time', 'ts'])) || '', 40) || null;
    const service = safeLogText(nestedValue(record, new Set(['service', 'service_name', 'logger', 'component'])) || '', 64) || null;
    const message = nestedValue(record, new Set(['message', 'msg', 'error', 'event'])) || line;
    const safeMessage = safeLogText(message, 220);
    matches.push({ lineNumber: index + 1, timestamp, level, service, message: safeMessage || '[matching trace context; message omitted]' });
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    file: path.basename(absolute).slice(0, 160),
    traceId: normalizedTraceId,
    executionKind: 'read-only-trace-log-inspection',
    summary: { linesScanned: lines.length, matches: totalMatches, matchesReturned: matches.length, truncated: totalMatches > matches.length },
    matches,
    limitations: [
      'The log file was read locally and was not modified. Only bounded, redacted excerpts are returned; raw log lines are never copied to the report.',
      'Matching a trace ID links log records to the same W3C trace context. It does not prove root cause or validate span parentage.',
      'Secret redaction is best-effort. Review excerpts before sharing; do not put credentials, customer data or private payloads in log messages.'
    ]
  };
}
