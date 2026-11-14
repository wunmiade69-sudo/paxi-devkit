# PAXI DevKit V2.2.0 — verification record

## Local verification

| Check | Result |
|---|---|
| `npm run check` | Passed: 85 JavaScript files, Termux shell syntax and 2 Python helpers |
| Full Node test suite | 269 total; 266 passed; 0 failed; 3 skipped |
| Targeted process/database/SPDX/accessibility tests | 30 passed; 0 failed; 0 skipped |
| CLI version | `2.2.0`, matches package metadata |
| CLI help | Passed |
| `npm pack --dry-run` | Passed |

## Skipped integration tests

1. Real axe-core browser accessibility fixture: optional Playwright/axe-core packages were not installed in the local project environment.
2. Real Playwright semantic browser journey: optional Playwright package/browser binaries were not installed in the local project environment.
3. Windows Flutter integration: requires a Windows host.

The Python `jsonschema` helper test ran successfully in this environment. CMake/compiler tests also ran because CMake and Clang were available.

## V2.2.0-specific tests

- `runProcess` reports actual output byte count and `outputTruncated` when captured stdout/stderr exceeds the configured combined cap.
- Database schema comparison detects a column-definition fingerprint change when table/index/object counts remain identical.
- Database schema comparison returns `indeterminate` when catalog metadata capture is truncated and object counts are unchanged.
- Accessibility cases with axe incomplete checks, blocked requests, browser runtime errors or HTTP response errors require review rather than passing.
- Existing Termux installer, collision protection, SPDX parser/policy, SBOM schema, SQL Server adapter, AI, build, process, state-machine and project detection regressions remain in the suite.

## Clean archive verification

A separate release-extraction run is required before delivery. It performs `npm ci`, `npm run check`, `npm test`, CLI version/help smoke tests, archive integrity validation and SHA-256 verification; the final results are recorded in the release conversation alongside the verified archive.

## Not certified by local tests

- Actual execution on the user's Termux device and Android shell environment.
- Live database engine metadata queries in this V2.2.0 packaging environment.
- Real Chromium/Firefox/WebKit checks in the local environment; hosted workflow results are pending until push.
- Hosted Linux/macOS/Windows CI runs.
- Physical Android and native iOS testing.
