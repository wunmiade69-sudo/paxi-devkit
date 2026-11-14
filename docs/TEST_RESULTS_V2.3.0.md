# PAXI DevKit V2.3.0 — test results

## Local packaging host

- OS: Linux x64
- Node.js: v22.16.0
- Python helpers: syntax-checked successfully
- npm install audit: 0 reported vulnerabilities in the package's dependency graph (the package has no runtime dependencies)

## Automated checks

| Check | Result |
|---|---:|
| Full Node test suite | 277 total; 274 passed; 0 failed; 3 skipped |
| New V2.3.0 assurance tests | 8 passed; 0 failed |
| JavaScript syntax | 88 files passed |
| Termux shell syntax | Passed |
| Python helper syntax | 2 files passed |
| CLI version/help smoke tests | Passed |
| Diagnosis benchmark CLI | Passed; 16/16 synthetic exact matches |
| Environment certification CLI | Passed; detected Node.js/npm test plan without running it |

## Diagnosis benchmark output

- Cases: 16
- Exact-case accuracy: 1.0000
- True positives: 14
- False positives: 0
- False negatives: 0
- Precision: 1.0000
- Recall: 1.0000
- F1: 1.0000

The small, embedded corpus is synthetic and only measures deterministic failure-signature classification.

## Skipped tests

1. axe-core real-browser test: optional Playwright/axe-core and browser packages were not installed in this packaging environment.
2. Playwright Chromium journey test: optional Playwright package was not installed in this environment.
3. Windows Flutter integration: this test runs on Windows CI only.

## Certification smoke report

The read-only certification command identified the project as Node.js, detected `npm test`, and returned `ready-for-test` because npm was available. It did not execute the project test command. It also detected two workflow files; this is workflow configuration evidence only, not a claim that GitHub Actions ran.

## Environment-dependent validations still open

- Actual Termux installation and fresh-shell execution on the user's Android device.
- Live PostgreSQL, MySQL, MariaDB and SQL Server disposable service matrix.
- Real Chromium, Firefox and WebKit jobs on hosted CI.
- Native vulnerability scanner and Syft fixture matrix.
- Physical Android and native iOS device tests.
- Windows/macOS hosted matrix results.
