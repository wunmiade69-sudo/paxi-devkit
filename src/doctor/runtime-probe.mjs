import { randomUUID } from 'node:crypto';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const SENSITIVE_KEY = /(?:password|passwd|secret|token|api[-_]?key|authorization|credential)/i;

export function validateRuntimeProbeUrl(value, { allowRemote = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Runtime probe URL must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Runtime probe URL must not contain credentials, query parameters or fragments; use a clean HTTP(S) endpoint URL.');
  }
  const local = LOOPBACK.has(url.hostname) || /^127\./.test(url.hostname);
  if (!local && (!allowRemote || url.protocol !== 'https:')) throw new Error('Remote runtime probes require HTTPS and explicit --allow-remote. Local loopback HTTP is allowed by default.');
  return { url, local };
}

function safeLabel(value, fallback = 'unknown') {
  if (typeof value === 'string' && value.length <= 80 && /^[\w .:/;=+-]+$/.test(value)) return value;
  return fallback;
}

function summarizeDependencies(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const source = payload.dependencies || payload.checks || payload.components || {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
  return Object.entries(source).slice(0, 30).filter(([name]) => !SENSITIVE_KEY.test(name)).map(([name, item]) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const status = item.status ?? item.state ?? (typeof item.healthy === 'boolean' ? item.healthy ? 'healthy' : 'unhealthy' : null);
      return { name: safeLabel(name), status: safeLabel(status, 'reported') };
    }
    if (typeof item === 'boolean') return { name: safeLabel(name), status: item ? 'healthy' : 'unhealthy' };
    return { name: safeLabel(name), status: safeLabel(item, 'reported') };
  });
}

async function readBodyLimited(response, maxBytes) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new Error(`Runtime health response exceeds the ${maxBytes}-byte limit.`);
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`Runtime health response exceeds the ${maxBytes}-byte limit.`);
    return bytes.toString('utf8');
  }
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new Error(`Runtime health response exceeds the ${maxBytes}-byte limit.`); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function probeRuntimeEndpoint({ url, allowRemote = false, timeoutMs = 8000, method = 'GET', fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const validated = validateRuntimeProbeUrl(url, { allowRemote });
  if (!['GET', 'HEAD'].includes(method)) throw new Error('Runtime probe supports only GET or HEAD; mutating HTTP methods are not allowed.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30000) throw new Error('Runtime probe timeout must be between 500 and 30000 milliseconds.');
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch; use Node.js 20 or newer.');
  const probeId = randomUUID(); const startedAt = now().toISOString(); const started = Date.now();
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(validated.url.href, {
      method,
      headers: { accept: 'application/json, text/plain;q=0.8', 'x-paxi-doctor-probe-id': probeId },
      redirect: 'manual',
      signal: controller.signal
    });
    const durationMs = Date.now() - started;
    const contentType = safeLabel(response.headers?.get?.('content-type') || 'unknown');
    let body = '';
    if (method !== 'HEAD' && ![301, 302, 303, 307, 308].includes(response.status)) body = await readBodyLimited(response, 64 * 1024);
    let payload = null; let bodyKind = 'empty-or-text';
    if (body && /json/i.test(contentType)) {
      try { payload = JSON.parse(body); bodyKind = 'json'; } catch { bodyKind = 'invalid-json'; }
    }
    const healthStatus = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.status ?? payload.health ?? null : null;
    const normalizedHealth = typeof healthStatus === 'string' ? healthStatus.toLowerCase() : null;
    const healthExplicitlyBad = normalizedHealth && /^(?:error|failed|unhealthy|down|critical)$/.test(normalizedHealth);
    const healthExplicitlyGood = normalizedHealth && /^(?:ok|healthy|up|ready|pass|passed)$/.test(normalizedHealth);
    const redirect = [301, 302, 303, 307, 308].includes(response.status);
    return {
      schemaVersion: 1,
      probeId,
      startedAt,
      completedAt: now().toISOString(),
      target: validated.url.origin + validated.url.pathname,
      scope: validated.local ? 'loopback-local' : 'explicit-remote-https',
      method,
      statusCode: response.status,
      statusText: safeLabel(response.statusText || 'unknown'),
      ok: response.ok,
      durationMs,
      contentType,
      bodyKind,
      applicationHealth: healthExplicitlyBad ? 'unhealthy' : healthExplicitlyGood ? 'healthy' : 'not-declared',
      dependencies: summarizeDependencies(payload),
      redirectNotFollowed: redirect,
      healthy: response.ok && !healthExplicitlyBad && !redirect,
      failure: !response.ok ? `HTTP ${response.status}` : healthExplicitlyBad ? 'Application health payload reports an unhealthy state.' : redirect ? 'Redirect response was not followed.' : null,
      bodyIncluded: false,
      limitations: [
        'This is a bounded HTTP health probe, not distributed tracing or proof of full backend correctness.',
        'Only status and safe dependency health labels are retained; response bodies, credentials and headers are not stored.',
        'Database checks are reported only when the endpoint explicitly exposes a dependency/check status.'
      ]
    };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      schemaVersion: 1, probeId, startedAt, completedAt: now().toISOString(),
      target: validated.url.origin + validated.url.pathname,
      scope: validated.local ? 'loopback-local' : 'explicit-remote-https', method,
      healthy: false, durationMs: Date.now() - started,
      failure: timedOut ? `Probe timed out after ${timeoutMs} ms.` : String(error?.message || error).slice(0, 400),
      bodyIncluded: false,
      limitations: ['No response was received; this does not distinguish application failure from DNS, routing, TLS or host firewall problems.']
    };
  } finally { clearTimeout(timer); }
}
