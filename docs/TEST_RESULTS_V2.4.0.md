# PAXI DevKit V2.4.0 — test results

## Local verification

- Full automated suite: **282 tests total; 279 passed, 0 failed, 3 skipped**.
- JavaScript syntax: 88 files passed.
- Termux shell syntax: both installer/bootstrap scripts passed.
- Python helper syntax: both helper scripts passed.
- Targeted V2.4.0 certification tests: 5 passed.
- CLI confirmation workflow: verified with temporary fixture projects.
- Failed test output redaction: verified with a synthetic credential marker.

## Skipped tests

1. Optional axe-core/Playwright browser audit: skipped because optional Playwright and axe-core packages are not installed in this packaging environment.
2. Optional Playwright semantic journey: skipped because Playwright is not installed in this packaging environment.
3. Windows Flutter build integration: skipped because this verification host is not Windows.

## What was actually exercised

- Default certification did not execute the fixture project's test script.
- `--run-tests` without `--confirm` returned an error and did not execute the script.
- `--confirm` without `--run-tests` returned an error and did not execute the script.
- Confirmed certification executed a temporary Node test script and returned `passed` with complete captured evidence.
- A failing temporary test script returned a failed status and non-zero CLI exit; token-like text in captured output was redacted.
- The injected tool-availability detector was used consistently in plan and execution validation.

## Verification limits

These are local automated tests using disposable fixture projects. They do not establish live Termux installation on a physical phone, real database-service compatibility, scanner coverage, hosted GitHub Actions success, browser-engine coverage or physical-device/iOS behavior. See `REMAINING_WORK_V2.4.0.md`.
