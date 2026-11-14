import { randomBytes } from 'node:crypto';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function validateEndpoint(value, { allowRemote = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('OTLP endpoint must be a valid absolute URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('OTLP endpoint must use HTTP(S) without embedded credentials, query strings or fragments.');
  }
  if (!url.pathname.replace(/\/$/, '').endsWith('/v1/traces')) throw new Error('OTLP/HTTP traces endpoint must end in /v1/traces.');
  if (!LOOPBACK.has(url.hostname) && (!allowRemote || url.protocol !== 'https:')) {
    throw new Error('Remote OTLP export validation requires HTTPS and explicit --allow-remote.');
  }
  return url;
}

function makeSyntheticPayload({ traceId, spanId, serviceName, now }) {
  const start = BigInt(now) * 1000000n;
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }, { key: 'paxi.synthetic', value: { boolValue: true } }] },
      scopeSpans: [{ scope: { name: 'paxi-doctor-otlp-probe', version: '1.0.0' }, spans: [{
        traceId, spanId, name: 'paxi.doctor.synthetic_export_probe', kind: 1,
        startTimeUnixNano: start.toString(), endTimeUnixNano: (start + 1000000n).toString(),
        attributes: [{ key: 'http.request.method', value: { stringValue: 'GET' } }, { key: 'http.route', value: { stringValue: '/__paxi_doctor_probe__' } }, { key: 'http.response.status_code', value: { intValue: 200 } }],
        status: { code: 1 }
      }] }]
    }]
  };
}

/** Sends one synthetic span only after explicit consent; response bodies are never retained. */
export async function validateOtlpHttpExporter({ endpoint, confirm = false, allowRemote = false, serviceName = 'paxi-doctor-probe', timeoutMs = 5000, authorizationEnv = null, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!confirm) throw new Error('OTLP export validation sends a synthetic trace to the collector. Pass --confirm after reviewing the endpoint.');
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch; use Node.js 20 or newer.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000) throw new Error('OTLP probe timeout must be between 500 and 15000 milliseconds.');
  if (typeof serviceName !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(serviceName)) throw new Error('Service name must be 1–80 safe characters.');
  const target = validateEndpoint(endpoint, { allowRemote });
  let authorization = null;
  if (authorizationEnv !== null) {
    if (authorizationEnv !== 'PAXI_OTEL_AUTHORIZATION') throw new Error('OTLP auth may only be read from PAXI_OTEL_AUTHORIZATION.');
    authorization = process.env[authorizationEnv];
    if (typeof authorization !== 'string' || !authorization.trim() || authorization.length > 4096 || /[\r\n\0]/.test(authorization)) throw new Error('PAXI_OTEL_AUTHORIZATION must contain one non-empty authorization header value (max 4096 bytes).');
  }
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  const payload = makeSyntheticPayload({ traceId, spanId, serviceName, now: now() });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const startedAt = now();
  try {
    const response = await fetchImpl(target.href, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: controller.signal
    });
    try { await response.body?.cancel?.(); } catch {}
    const accepted = response.status >= 200 && response.status < 300;
    return {
      schemaVersion: 1,
      reportType: 'paxi-otel-export-validation',
      executionKind: 'confirmed-synthetic-otlp-http-export',
      target: `${target.origin}${target.pathname}`,
      scope: LOOPBACK.has(target.hostname) ? 'loopback' : 'remote-https',
      status: accepted ? 'accepted' : 'rejected',
      authConfigured: Boolean(authorization),
      acceptedByCollector: accepted,
      httpStatus: response.status,
      durationMs: Math.max(0, now() - startedAt),
      traceId,
      spanId,
      payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
      limitations: [
        'A 2xx response confirms that the endpoint accepted the synthetic export request; it does not prove that the span was persisted, indexed or queryable.',
        'This probe sends one synthetic span with no user data. It does not export project traces or application payloads.',
        'Remote endpoints require HTTPS and explicit consent. Redirects are disabled.'
      ]
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      reportType: 'paxi-otel-export-validation',
      executionKind: 'confirmed-synthetic-otlp-http-export',
      target: `${target.origin}${target.pathname}`,
      scope: LOOPBACK.has(target.hostname) ? 'loopback' : 'remote-https',
      status: 'unreachable', authConfigured: Boolean(authorization), acceptedByCollector: false, httpStatus: null,
      durationMs: Math.max(0, now() - startedAt), traceId, spanId,
      failure: error?.name === 'AbortError' ? 'timeout' : String(error?.name || 'network-error').slice(0, 80),
      limitations: ['The collector did not return a usable HTTP response. Inspect collector logs and network configuration. No response body was retained.']
    };
  } finally { clearTimeout(timer); }
}
