# PAXI Doctor — remaining work and acceptance gates (V2.1.1)

This ledger distinguishes implementation and local tests from environment certification. A feature command is not evidence of a successful live integration.

| Area | V2.1.1 state | Remaining acceptance gate |
|---|---|---|
| Termux launcher | Android-native `/system/bin/sh` wrapper; exact Node and entry paths; collision-safe; local test covers spaces/apostrophes and wrapper invocation | Install on the user's Termux device, verify `$PREFIX/bin/paxi`, `paxi version`, `paxi doctor --json`, `paxi ai studio`; test on official Termux and any fork used |
| Node CLI shebang | Standard `#!/usr/bin/env node` retained for Linux/macOS/Windows package managers | Non-Termux host installs still require their standard Node shebang environment |
| SPDX expression parser | AND/OR precedence, parentheses, WITH, LicenseRef and DocumentRef parsing | Expand test corpus from official SPDX conformance fixtures; keep syntax aligned with future SPDX grammar versions |
| SPDX registry | Paired local License List + Exception List, matching versions, optional SHA-256 pins, membership and deprecation | Operator must download/approve snapshots from SPDX; controlled refresh, legal/compliance approval and expiry handling remain |
| Licence policy | AND is cumulative; OR is alternative; WITH needs explicit allowExceptions; component exception remains explicit | Legal owner review, policy governance and review of license texts/notices/obligations |
| SBOM structural checks | Existing structural checks retained | Expand real Syft-generated fixtures for each supported output version |
| Official SBOM JSON Schema | Python jsonschema adapter, local schema only, remote refs blocked, file limits and optional hash pin | Validate real Syft SBOMs against pinned official schema versions in CI; schema origin/update approvals |
| Website accessibility | Real Chromium, Firefox and WebKit accessibility/semantic journeys passed locally | Test authenticated app fixtures, manual screen readers, keyboard-only and physical mobile assistive tech; hosted browser workflow remains unverified |
| PostgreSQL/MySQL/MariaDB | Disposable loopback migration labs passed on PostgreSQL 16.15, MySQL 8.0.46 and MariaDB 10.11.14; cleanup complete | Hosted disposable-service CI; verify cleanup after cancellation/timeouts; compare object definitions rather than counts only |
| SQL Server | Live SQL Server 2025 Developer disposable migration passed on loopback; cleanup complete; SQLCMD batch/readiness fixes regression-tested | Hosted disposable-service CI, other sqlcmd/server versions, cancellation/interrupt cleanup and additional failure-path coverage |
| Security scanners | OSV Scanner 2.7.1 ran against a vulnerable and a clean fixture; findings and clean result mapped correctly | Run other native tools in CI; verify exit codes, parser coverage, database freshness and transitive coverage. PAXI's own package inventory was not meaningfully audited because its lockfile had no dependencies |
| SBOM generation | Existing Syft adapter retained | Live Syft catalog completeness and schema validation matrix across OS/ecosystems |
| Android | Existing ADB journeys and Device Lab retained | Physical phone + emulator runs for compact/large/foldable, keyboard/font/zoom/offline and defect-specific assertions |
| iOS | Static/source checks only | macOS/Xcode bridge plus simulator and physical iPhone/iPad evidence |
| Framework adapters | Detection/planning and selected build integrations retained | Real language/framework fixtures across Node, Python, Go, Rust, PHP, Java/Kotlin, C/C++, Dart/Flutter, Swift and .NET |
| Agent intelligence | Adaptive profile, diagnosis, memory and approved patch workflow retained | Labeled benchmark, false-positive/negative rates, patch success, rollback and privacy-leak tests |
| Hosted CI | Workflows retained/configured | Push source and inspect actual Linux/macOS/Windows and browser workflow results; local tests do not prove hosted CI is green |

## Release acceptance rules

1. `npm test` and `npm run check` must pass on a clean extracted archive.
2. Termux installation must use `bash scripts/install-termux.sh`; verify the generated wrapper and run CLI commands from a fresh Termux session.
3. Missing Python, `jsonschema`, Playwright, axe-core, browser binaries, native scanners and database clients are reported as unavailable/not-run, never green.
4. Database labs use dedicated disposable loopback services and record resource cleanup outcomes. Never use production administrator credentials.
5. Browser audits block cross-origin and mutating requests; any required allowlist must be explicit and reviewed.
6. Simulated viewport evidence is not physical device evidence. Emulator evidence is not physical handset evidence.
7. iOS native claims require actual macOS/Xcode or iOS device execution.
8. The package ZIP must extract independently, run clean-install tests and match its published SHA-256 checksum.
