# PAXI DevKit V2.1.1 — verification record

Creator attribution and voluntary support information are documented in [CREDITS_AND_SUPPORT.md](CREDITS_AND_SUPPORT.md); payment details are reproduced as supplied and are not independently verified.

## Verification run (2026-11-11)
The supplied archive was extracted to a clean working directory, then `npm ci`, `npm run check`, `npm test`, `node bin/paxi.mjs version`, and both human-readable and JSON `paxi doctor` modes were run.

| Check | Result |
|---|---:|
| Clean dependency install (`npm ci`) | passed; 0 vulnerabilities reported |
| JavaScript syntax checks | 85 files passed |
| Termux shell syntax checks | passed |
| Python helper syntax checks | 2 files passed |
| Full Node test suite | 262 total; 257 passed; 0 failed; 5 skipped |
| CLI version | 2.1.1, matches package metadata |
| `paxi doctor` | ran; environment PARTIAL, exit code 11 because Android SDK is absent/unconfigured in this Linux sandbox |
| `paxi doctor --json --project .` | valid JSON report; identifies Node.js project and the same Android SDK limitation |

## Skipped tests in this run
1. CMake adapter integration: CMake and a C++ compiler are required.
2. Official SBOM schema helper integration: optional Python `jsonschema` package is not installed on this host.
3. Real axe-core accessibility audit: optional Playwright/axe-core packages and browser binaries are not installed.
4. Real Playwright semantic browser journey: optional Playwright package/browser binaries are not installed.
5. Windows Flutter build integration: runs on Windows CI only.

Skipped integrations are not counted as passing. The test output reported zero failures.

## Follow-up integration run (2026-11-11)
With optional Playwright/axe dependencies installed, the suite reported 262 total; 259 passed; 0 failed; 3 skipped (CMake/compiler, optional Python `jsonschema`, and Windows-only Flutter). After the final SQL Server changes, `npm run check` passed again and `npm test` reported 262 total; 257 passed; 0 failed; 5 skipped. In this clean dependency state the additional two skips were the optional real-browser tests; those were independently run and passed in all three engines as shown below.

| Integration | Result |
|---|---|
| Chromium accessibility + semantic journey | both tests passed |
| Firefox accessibility + semantic journey | both tests passed |
| WebKit accessibility + semantic journey | both tests passed |
| PostgreSQL 16.15 disposable migration lab | passed; 1 migration; cleanup complete |
| MySQL 8.0.46 disposable migration lab | passed; 1 migration; cleanup complete |
| MariaDB 10.11.14 disposable migration lab | passed; 1 migration; cleanup complete |
| SQL Server 2025 Developer 17.0.5045.3 disposable migration lab | passed; 1 migration; cleanup complete; service bound to loopback |
| OSV Scanner 2.7.1, vulnerable lodash 4.17.20 fixture | completed with 4 advisory records; scanner exit 1 and `clean=false` as expected |
| OSV Scanner 2.7.1, clean is-number 7.0.0 fixture | 1 package scanned; 0 advisories; `clean=true` |

The live integrations use generated databases/users and a single synthetic migration on loopback services. All generated test database/user cleanup checks reported complete. PostgreSQL testing exposed and fixed PG16 ownership/authentication assumptions. MySQL testing exposed and fixed its 32-character user-name limit. SQL Server testing exposed that piped `sqlcmd` input needs an explicit `GO` batch terminator, and that a newly created database should be checked for `ONLINE` before connecting; both are fixed and regression-tested. Current OSV Scanner output exposed and fixed missing inherited package/version context and structured severity normalization in PAXI reports. Regression tests cover these paths.

## Not certified in the initial archive run
- PAXI Doctor reports a partial environment, not a package defect: this Linux packaging sandbox has no configured Android SDK (`ANDROID_HOME`/`ANDROID_SDK_ROOT`), and therefore `paxi doctor` exits with code 11. Configure a host-appropriate SDK when Android build readiness is required.
- The Termux launcher has been exercised in a POSIX harness that validates the wrapper body. It still needs installation and execution on an actual Android/Termux device to verify its installed `$PREFIX`, executable paths and Android kernel shebang.
- SQL Server lifecycle behaviour in that initial run was tested with a mocked `sqlcmd` process.
- SPDX registry membership checks require operator-provided official License List and Exception List snapshots. This release does not download or approve legal policy data for the user.
- SBOM JSON Schema validation against an official schema is not certified by this run. It requires the optional Python `jsonschema` dependency and an approved, pinned official CycloneDX/SPDX schema snapshot. The earlier synthetic-fixture result in the release notes is not evidence of an official-schema validation in this run.

## Reproducible clean-archive checks
The release package should be independently extracted, `npm ci` run from the extracted root, then `npm run check` and `npm test` rerun. ZIP integrity and SHA-256 should be checked separately. No checksum file was included with the supplied archive.

## Remaining acceptance gates after follow-up
- The actual Android phone is not attached to this task environment (no ADB binary or authorized device was available). Termux launcher installation plus physical accessibility and Device Lab checks still require the handset.
- Hosted GitHub Actions were not triggered because this task has no authenticated GitHub write session. Local cross-browser runs are not a substitute for hosted CI.
- The full hosted Linux/macOS/Windows matrix, CMake toolchain, official pinned SBOM schema validation, physical iOS/macOS checks and other optional native scanners remain environment-dependent.
