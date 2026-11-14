# PAXI Doctor V1.5.0 — API Regression Generation and Cross-Layer Evidence

V1.5.0 connects the API contract tools added in V1.4.0 to the website, Android, runtime and Agent Engine workflows.

## 1. Generate regression smoke plans from OpenAPI

```bash
paxi doctor api generate-tests --file ./openapi.json --output ./api-smoke.generated.json
```

The generator accepts OpenAPI 3.x and Swagger 2.0 JSON. It uses the first non-templated server URL unless `--base-url` is supplied. Server variables must be resolved explicitly by the developer. Only non-deprecated static GET and HEAD operations are eligible. Dynamic routes such as `/users/{id}` are skipped because the generator cannot safely invent path parameter values. POST, PUT, PATCH, DELETE and other methods are never generated.

For each included operation the generator derives successful 2xx response codes. GET operations with JSON success responses also get a content-type assertion and, when the schema declares them, a bounded list of required JSON paths. Local schema references are resolved in memory; external references are not fetched. The default cap is 25 cases and can be reduced with `--max-cases` (1–25).

The generator writes a new file with owner-only permissions and refuses to overwrite an existing output. It does not send a network request. Review the generated target and cases before running:

```bash
paxi doctor api test --file ./api-smoke.generated.json --confirm
```

The existing GET/HEAD-only API runner safeguards remain in force. Loopback HTTP is permitted. Remote targets require HTTPS plus `--allow-remote`. GET requests can still have side effects in a poorly designed service; use a dedicated test environment and a least-privilege test token.

## 2. Correlate evidence across layers

```bash
paxi doctor correlate \
  --report ./api-report.json \
  --report ./website-report.json \
  --report ./runtime-probe.json \
  --report ./android-journey-report.json \
  --json
```

One to twenty evidence reports can be supplied. Supported report types:

- Confirmed read-only API smoke tests.
- Runtime health probes.
- Playwright website Device Lab results.
- Android ADB user-journey and device-lab reports.
- Static project diagnosis.
- PNG visual-regression comparisons.
- Static source security scans and SQL migration reviews.
- Confirmed online npm dependency audit summaries.

The output contains a compact input inventory, normalized metadata events and candidate correlations. Route/status matches between browser and API reports are medium confidence when both statuses agree. Same-host unhealthy runtime and failed API/browser evidence are also medium confidence. API failures coexisting with high-severity database migration findings are only low-confidence context. No correlation is labeled as a proven root cause.

Input reports must be regular non-symlink JSON files no larger than 2 MiB each. The correlator limits report count and event extraction. It does not copy response bodies, request headers, bearer tokens, screenshot data, absolute file paths or raw customer content into the output.

## 3. Include evidence in Agent Engine plans

```bash
paxi doctor agent plan --project . \
  --evidence ./api-report.json \
  --evidence ./website-report.json \
  --evidence ./runtime-report.json \
  --json
```

The Agent Engine can include correlation results alongside project diagnosis, architecture and developer preferences. With `--ai`, it may send the selected bounded report metadata to the configured model; review the provider consent behavior and use `--no-profile` / `--no-memory` where desired. The Agent Engine does not rerun tests or change code in plan mode.

## 4. Verification boundaries

- Generated API plans are suggestions. Review route semantics, expected status codes, target URL and side effects before execution.
- Generation does not inspect live server behavior or prove contract conformance.
- Correlation uses only the selected reports. It does not query services, inspect distributed traces, correlate timestamps precisely or prove causation.
- Browser viewport evidence remains simulated. Android evidence retains the source report's physical-device/emulator classification; capture-only Device Lab evidence is not converted into a pass.
- Report metadata may still include project-specific labels and failure messages. Review output before sharing it externally.
- No migrations, writes, deployments, purchases, builds or project scripts are executed by the new API-plan generation or correlation features.
