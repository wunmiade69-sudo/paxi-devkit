# PAXI DevKit V2.5.0 — test results

## Local verification

- Full Node test suite: **288 total, 285 passed, 0 failed, 3 skipped**.
- JavaScript syntax: **88 files passed**.
- Termux shell syntax: **2 scripts passed**.
- Python helper syntax: **2 files passed**.
- Targeted new V2.5.0 investigation tests: **6 passed**.
- `npm ci --ignore-scripts`: passed; the package currently declares no runtime dependencies.
- `npm audit`: 0 reported vulnerabilities (empty dependency tree).

## New V2.5.0 coverage

1. Input SHA-256 fingerprint and stable event identifier generation.
2. Timestamp normalization for report timestamps, event timestamps and OpenTelemetry Unix nanoseconds.
3. Timestamp-ordered global and per-investigation-case timelines.
4. Exact W3C trace ID grouping and deliberately low-confidence route-only grouping across API/browser hosts.
5. Missing evidence suggestions for backend telemetry, W3C propagation and database span coverage.
6. Sensitive database metadata redaction and omission of absolute report paths.
7. Agent Engine plan-only steps for evidence gaps.
8. Website regression draft checks derived from known issue codes, without generating selectors or business assertions.
9. Duplicate evidence file rejection to prevent duplicate events inflating correlation.
10. Global 1,000-event cap with omitted-event counts and partial coverage status.
11. CLI correlation smoke test from saved API and backend-span reports, including output-file creation and input fingerprint verification.

## Skipped tests

- Optional axe-core/Playwright accessibility integration: Playwright and axe-core are not installed in this local packaging environment.
- Optional real Playwright browser journey integration: Playwright is not installed in this local packaging environment.
- Windows Flutter host integration: this test runs only on Windows CI.

## Verification boundary

The complete test suite was rerun from a fresh extraction of the exact release archive. The CLI correlation smoke test used synthetic saved reports. These results are local tests against fixtures and installed dependencies in this packaging environment. They do not establish hosted GitHub Actions success, physical Termux installation, live database compatibility, real production OpenTelemetry queryability, actual remote AI diagnosis accuracy, native Android/iOS behavior or real browser matrix results. See `REMAINING_WORK_V2.5.0.md` for acceptance gates.
