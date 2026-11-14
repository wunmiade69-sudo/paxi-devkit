# PAXI Doctor V1.6.0 — Trace, Regression and Verified-Fix Intelligence

V1.6.0 extends V1.5.0 by connecting browser/API evidence to backend logs, turning matching observed failures into reviewed regression drafts, and allowing the Agent Engine to reuse only locally recorded fixes backed by fully passing PAXI API regression reports.

## 1. Shared W3C trace context

Create one trace ID and copy it into the related test runs:

```bash
paxi doctor trace create
```

The ID is a non-zero 128-bit hexadecimal W3C trace ID. Supply the same ID when running the API and website tests:

```bash
paxi doctor api test \
  --file ./api-smoke.generated.json \
  --confirm \
  --trace-id <32-hex-trace-id> \
  --save-report ./evidence/api-report.json

paxi doctor lab run \
  --url http://127.0.0.1:4173 \
  --trace-id <32-hex-trace-id> \
  --output ./evidence/website
```

The API runner adds a W3C `traceparent` header to each read-only API request. The website runner adds it only to XHR/fetch requests, not document navigation or static assets. This option is deliberately opt-in. A custom trace header can cause a browser CORS preflight; configure the dedicated test server to allow `traceparent`, or leave tracing disabled for that run.

A backend must accept and record W3C trace context in its own instrumentation/logging for end-to-end backend evidence. PAXI does not silently modify backend source code or server configuration.

## 2. Inspect backend logs

Scan a local backend log for the same trace ID:

```bash
paxi doctor trace inspect \
  --log ./logs/api.log \
  --trace-id <32-hex-trace-id> \
  --output ./evidence/backend-trace.json
```

The inspector is read-only, accepts a regular non-symlink file up to 5 MiB by default, and returns at most 100 matching lines. It includes bounded redacted excerpts and basic timestamp/level/service fields; raw lines are never copied into the report. Redaction is best-effort—review before sharing logs or reports.

## 3. Correlate the full request path

```bash
paxi doctor correlate \
  --report ./evidence/api-report.json \
  --report ./evidence/website/report.json \
  --report ./evidence/backend-trace.json \
  --output ./evidence/correlation.json
```

The correlator recognizes exact W3C trace IDs, compatible API/browser route and method metadata, and backend trace-log records. Shared trace IDs connect evidence to a trace context; they do not prove span parentage, root cause or which service is responsible. Inspect service spans, timings and server logs before assigning causation. It stores no response bodies, bearer tokens, raw request headers, screenshot bytes or absolute report paths.

## 4. Draft regression checks from a defect

Provide an already reviewed API smoke plan and the correlation report:

```bash
paxi doctor regression draft \
  --plan ./api-smoke.generated.json \
  --evidence ./evidence/correlation.json \
  --output ./api-regression-after-fix.json
```

The generator selects only matching static GET/HEAD cases from the supplied plan. It does not invent expected statuses, create dynamic path values, send requests or modify source code. Browser-only issues and dynamic routes require a separately authored test. The resulting draft is written with owner-only permissions and is never overwritten.

Review the plan, then run it deliberately:

```bash
paxi doctor api test \
  --file ./api-regression-after-fix.json \
  --confirm \
  --save-report ./evidence/api-regression-after-fix.json
```

Remote targets still require HTTPS and `--allow-remote`; only GET/HEAD remain supported.

## 5. Learn from verified fixes

After a confirmed regression run passes every case, explicitly store a local record linked to the passing report and selected source files:

```bash
paxi doctor agent memory learn-verified \
  --evidence ./evidence/api-regression-after-fix.json \
  --summary "User profile endpoint regression corrected" \
  --file src/api/profile.ts \
  --confirm

paxi doctor agent memory verified
paxi doctor agent plan --project .
```

The command requires every case in a saved PAXI API smoke report to have passed. It stores a report hash, run ID, summary and SHA-256 fingerprints of explicitly selected project-relative files. It does not save source contents, report bodies, credentials or absolute source paths. If any selected file changes or disappears, the record is marked stale. The Agent Engine may use current verified records as historical context, but still recommends rerunning tests and never auto-applies patches.

Clear the project-scoped verified-fix ledger only with:

```bash
paxi doctor agent memory clear-verified --confirm
```

## 6. Commands added or extended

- `paxi doctor trace create`
- `paxi doctor trace inspect --log <file> --trace-id <id>`
- `paxi doctor api test ... --trace-id <id> --save-report <file>`
- `paxi doctor lab run ... --trace-id <id>`
- `paxi doctor regression draft --plan <file> --evidence <file>`
- `paxi doctor agent memory verified`
- `paxi doctor agent memory learn-verified ... --confirm`
- `paxi doctor agent memory clear-verified --confirm`

## 7. Boundaries

- Trace propagation is opt-in; browser trace headers may trigger CORS preflight.
- Backend log inspection reads only a user-selected local file and never tails a process or connects to production logging services.
- Regression drafts only reuse matching, previously reviewed read-only API cases.
- Verified knowledge is supported initially for fully passing PAXI API smoke reports. It is not yet a general certification format for website, Android, database or arbitrary test-runner reports.
- A file fingerprint says only that the selected file bytes have not changed since recording. It does not prove the entire project remains unchanged or that the recorded change caused the passing result.
- Shared trace IDs connect records to a trace context but do not establish root cause. PAXI remains an investigation and QA assistant, not a substitute for production observability or an independent security audit.
