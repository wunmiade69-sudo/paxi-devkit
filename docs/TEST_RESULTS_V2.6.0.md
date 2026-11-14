# PAXI DevKit V2.6.0 — test results

## Final local verification

- Full regression suite: **298 tests total; 295 passed, 0 failed, 3 skipped**.
- New V2.6.0 targeted adapter tests: **10 passed, 0 failed, 0 skipped**.
- JavaScript syntax checks: **89 files passed**.
- Termux shell syntax checks: passed.
- Python helper syntax checks: **2 files passed**.
- `npm ci`: completed; npm reported **0 vulnerabilities** for the installed package graph.
- CLI version/help and diagnosis benchmark smoke tests: passed.
- `npm pack --dry-run`: passed.
- Workflow YAML syntax parse: `ci.yml`, `browser-matrix.yml` and `database-matrix.yml` parsed successfully using PyYAML.

The three skipped tests are optional Playwright/axe-core tests (not installed in the local packaging environment) and the Windows-only Flutter desktop integration test.

## New V2.6.0 integration evidence

- CMake/CTest: a real local C++ fixture configured, compiled and passed one registered CTest. PAXI removed the temporary build tree after the run.
- Empty CTest inventory: returned `no-tests`; it did not claim success.
- Truncated CTest inventory: blocked the build/test stages and marked evidence incomplete.
- CMake configure failure: stopped before build/test and retained the failed stage.
- Expo/React Native: local Jest resolution used Node with an already-installed Jest fixture; no `npx` or package download was invoked. Missing local Jest returned `tool-missing`.
- Diagnosis benchmark v1.1: **24/24 exact synthetic fixture matches**, 0 false positives and 0 false negatives for this synthetic dataset.
- Database CI report assertion: accepts a complete passing migration/cleanup report and rejects incomplete cleanup.

## External checks not claimed as passed

- PostgreSQL 16, MySQL 8.4 and MariaDB 11 GitHub Actions workflows are configured with ephemeral loopback services and retained JSON report artifacts; hosted runs are pending until push.
- Chromium, Firefox and WebKit workflows are configured to retain TAP test artifacts; hosted runs are pending until push.
- SQL Server live service verification is still open; the existing adapter/mock coverage remains.
- Physical Termux launcher installation, real Expo/React Native native app testing, Android physical-device testing, Mac/Xcode iOS testing and real native scanner runs were not performed on the packaging host.
- The diagnosis benchmark corpus is synthetic and does not measure LLM reasoning, root-cause accuracy, AI patch correctness or real incident performance.

A local workflow YAML parse is only a syntax check; it is not a GitHub Actions run. See `REMAINING_WORK_V2.6.0.md` for release acceptance gates.
