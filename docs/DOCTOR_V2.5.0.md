# PAXI Doctor V2.5.0 — evidence-linked application investigation

## Purpose

V2.5.0 turns the previous cross-layer correlation output into a bounded investigation record. It links supplied API, browser, runtime, backend trace/span, Android, database, security and visual reports; shows the timeline and source integrity fingerprints; assesses evidence gaps; and feeds missing-evidence recommendations into the Agent Engine.

This is a local report-analysis workflow. It does not connect to a telemetry backend, instrument a running service automatically, claim causality, or apply source changes.

## Commands

Build a correlation/investigation report from evidence already saved by PAXI:

```bash
paxi doctor correlate \
  --report ./api-report.json \
  --report ./website-report.json \
  --report ./backend-spans.json \
  --output ./investigation.json
```

Include database or Android evidence where relevant:

```bash
paxi doctor correlate \
  --report ./api-report.json \
  --report ./otel-spans.json \
  --report ./android-journey.json \
  --report ./database-scan.json \
  --json
```

Ask the Agent Engine to prepare an investigation plan using the same evidence:

```bash
paxi doctor agent plan \
  --project . \
  --evidence ./api-report.json \
  --evidence ./website-report.json \
  --evidence ./backend-spans.json \
  --json
```

Draft regression material from the correlation report:

```bash
paxi doctor regression draft \
  --targets api,website,android \
  --plan ./reviewed-api-plan.json \
  --evidence ./investigation.json \
  --output ./regression-draft.json \
  --android-output ./android-regression-starter.json
```

## V2.5.0 report fields

### Input manifest

Each input record contains only the basename, report type, execution kind, byte count, extracted event count and SHA-256 fingerprint. The hash detects later byte changes when the same file is checked again. It does not authenticate the report source or prove that the report is complete.

### Event records

Extracted events have deterministic event IDs, normalized trace IDs, redacted bounded text, source type, evidence kind and an optional normalized timestamp. Absolute report paths and raw request/response payloads are not retained.

### Timeline

The correlator rejects duplicate input bytes and caps extracted events globally at 1,000; if the cap is reached, each input reports extracted/included/omitted counts and evidence coverage becomes partial. The report includes a global timeline and a per-investigation-case timeline. Timestamp ordering is labelled as `timestamp-sorted`, `partial-timestamp-order` or `source-order-only`. Timestamp offsets are descriptive only; clocks on separate devices/services may be skewed.

### Evidence coverage

`evidenceCoverage` summarizes layers supplied, available trace context, backend telemetry, timestamp coverage, execution-evidence categories and recommended missing evidence.

Examples of evidence kinds include `browser-simulation`, `physical-device`, `emulator`, `runtime-observability`, `api-smoke` and `static-or-tool-report`. Browser runs are not native Android/iOS evidence. Capture-only Android evidence is not a passed user journey.

### Investigation cases

- `exact-w3c-trace-id`: events share a valid non-zero W3C trace ID. This is a context link, not proof of causation.
- `normalized-host-method-route-only`: events share only a normalized route path (host and method variations are included in the case metadata). This is deliberately low-confidence because separate requests can use the same route.

Each case contains the source layers, event references, timeline, related correlations, missing-evidence recommendations and a bounded interpretation.

### Root-cause hypotheses

A database error is ranked high only when the database span is failed, shares a trace with a failed API test, and its parent chain reaches an HTTP span matching that API route and compatible method. Other database-span matches remain medium. Every hypothesis still requires human verification.

## Website regression draft behavior

Website draft routes can include suggested check identifiers derived from known issue codes, such as horizontal-overflow, browser-runtime-error and network-request-failed. These are not executable test assertions. A developer must review the route, select the expected application behavior, add selectors/assertions and run only against an authorized test environment.

API regression cases still reuse only matching previously reviewed GET/HEAD plan cases and preserve the plan's original expected assertions. Android output remains a starter journey that requires a feature-specific selector assertion.

## Agent Engine integration

When correlation evidence is supplied, the Agent Engine adds review-required steps for missing backend telemetry, W3C trace propagation, database span coverage, browser reproduction or Android feature assertions. It remains plan-only: no tests, builds, scripts, browser sessions, device actions or code edits are performed by `doctor agent plan`.

## Privacy and safety

- Each report input is bounded to 2 MiB; the number of reports and extracted events is bounded.
- Inputs must be regular, non-symlink JSON files.
- Sensitive text is redacted during extraction; database span attributes are copied through a narrow allowlist.
- Absolute file paths, response bodies, request headers and screenshot bytes are not copied into correlation output.
- Report hashes are integrity fingerprints only, not attestations.
- A route match, shared trace ID, span parent chain or timeline is not causal proof.
- Generated regression files are reviewable drafts and do not run network requests.
- Source changes remain behind the separate patch review and explicit apply confirmation workflow.

## Limitations

V2.5.0 does not automatically add OpenTelemetry SDKs to applications, query Tempo/Jaeger/Zipkin, read production databases, recover unsampled spans, prove clock synchronization, certify an application, or measure the accuracy of a remote LLM root-cause explanation. Real service/browser/device evidence must be collected in the target environment and attached to the remaining-work ledger.
