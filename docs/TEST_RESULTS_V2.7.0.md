# PAXI DevKit V2.7.0 — Test Results

## Local packaging verification

- Full automated suite: **310 tests total; 307 passed, 0 failed, 3 skipped**.
- New V2.7 security adapter and CLI tests: **12 passed, 0 failed**.
- JavaScript syntax checks: **90 files passed**.
- Termux shell syntax checks: **passed**.
- Python helper syntax checks: **2 files passed**.
- CLI version/help and security scanner inventory smoke tests: **passed**.

## Skips

- Optional real Playwright/axe-core website accessibility test: skipped because Playwright and axe-core are not installed in this packaging environment.
- Optional real Playwright Chromium journey test: skipped because Playwright is not installed.
- Windows Flutter desktop build integration: skipped because this is not a Windows host.

## Native scanner availability

The following native binaries were not installed in this packaging environment: Gitleaks, Semgrep, Trivy, Slither, solc, apkanalyzer and apksigner. Their adapters were tested with deterministic runner/report fixtures, including tool-missing and incomplete-output behavior. No live native scanner result is claimed.

## Integration evidence

- Website security header checks use a loopback HTTP response fixture.
- API object authorization uses a loopback fixture with two different test identities; owner status and non-owner denial are checked, and response bodies/token values are omitted from reports.
- APK inspector uses a simulated manifest/signature runner fixture; it has not processed a real APK here.
- Solidity adapter input and missing-solc gates are tested; Slither has not run against a real contract here.

## Clean extracted archive gate

The release ZIP was extracted to a new directory, `npm ci` was run from that extracted project, then `npm run check` and the complete test suite were rerun. Results: **310 total; 307 passed, 0 failed, 3 skipped**. Archive integrity and SHA-256 were verified.

A passing unit test suite is not a penetration test or a guarantee that a scanned application is secure. See `REMAINING_WORK_V2.7.0.md` for native scanner and real-environment acceptance gates.
