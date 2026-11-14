# PAXI Doctor — remaining work and acceptance gates (V2.3.0)

This ledger separates implementation in the repository from validation that requires a real host, service, browser, scanner or device.

| Area | V2.3.0 state | Remaining acceptance gate |
|---|---|---|
| Termux launcher | Android-native launcher and POSIX harness tests retained | Install on user's Termux release; verify fresh-shell `paxi version`, `paxi doctor --json`, `paxi ai studio`, and launch after relocation from shared storage |
| Certification | Read-only tool/package inventory and test-plan availability report | Compare report against real Termux, Windows, Linux and macOS hosts; ensure no status overclaims runtime success |
| Diagnosis benchmark | 16 synthetic classifier fixtures; 100% exact match on the embedded corpus | Build reviewed sanitized corpus from real incidents; publish class balance, ground truth process, precision/recall by project ecosystem and false-positive review |
| LLM diagnosis | Agent plan and optional model reasoning retained | Add labeled root-cause benchmark, reviewer agreement, refusal/uncertainty tests, prompt-injection corpus and per-model cost/latency reporting |
| Project test evidence | Output truncation is explicit; successful process exit can remain passed while evidence is flagged incomplete | Add streaming log mode and process cancellation tests across Windows/POSIX; define evidence retention/size limits |
| Native scanners | Output truncation can no longer be marked clean | Run OSV, cargo-audit, govulncheck, pip-audit, Composer and .NET scanners on real lockfile/advisory fixtures across CI; validate package coverage and feed freshness |
| SBOM | Syft generation, CycloneDX/SPDX structural and local schema validation | Generate real SBOMs for multiple ecosystems and Syft versions; validate with pinned official schemas; preserve tool/schema version metadata |
| Databases | SQLite local lab; service adapters for PostgreSQL, MySQL, MariaDB and SQL Server | Run live service CI matrix; cancellation/timeout/permission-failure cleanup; compare actual column/index/constraint/view/trigger/routine definitions |
| Accessibility | axe-core browser auditor and responsive viewport simulation | Real hosted Chromium/Firefox/WebKit artifacts plus manual keyboard, screen-reader, zoom, font scaling and physical mobile validation |
| Android | ADB journeys, selector proposals and Device Lab | Physical-device runs across compact/large/foldable/tablet and font/landscape/dark/keyboard/zoom/offline conditions; add framework-specific Compose/Flutter/React Native selectors |
| iOS | Static/source checks | Mac/Xcode bridge, simulator and physical iPhone/iPad execution |
| Language/framework support | Detection and selected conventional test commands | Fixture-backed real builds/tests for each claimed ecosystem; explicitly separate detection-only from verified build/test support |
| Agent patches | Review/approve/apply/retest safeguards | Benchmark patch quality, acceptance, test success, rollback integrity and accidental diff scope |
| Hosted CI | Node 20/22/24 cross-platform and browser workflows configured | Push source and retain successful GitHub Actions run IDs/artifacts for every matrix cell |
| Windows release | ZIP app-bundle validation | Approved Authenticode signing and MSIX/MSI packaging design on Windows signing infrastructure |

## V2.3.0 release acceptance

1. `npm ci`, `npm run check` and `npm test` pass from a clean extracted archive.
2. `paxi doctor benchmark diagnosis` returns deterministic metrics and reveals any false positives/negatives; a perfect score on the small synthetic corpus must not be marketed as real-world AI accuracy.
3. `paxi doctor certify` makes no runtime or production-readiness claims.
4. Truncated scanner output cannot be reported as complete or clean.
5. Truncated test output is clearly marked as incomplete evidence, even if the process exit code was zero.
6. Missing optional tools, unavailable services and unrun CI are never presented as passing.
7. Physical-device, native iOS and hosted-CI claims require actual execution evidence.
