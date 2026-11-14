# PAXI Doctor — remaining work and acceptance gates (V2.4.0)

This ledger separates implemented code from external certification. A command existing in the CLI is not evidence that an integration has passed against a real host, service, browser or device.

| Area | V2.4.0 state | Remaining acceptance gate |
|---|---|---|
| Termux launcher | Android-native launcher and shell harness tests retained | Install on actual Termux; verify fresh shell, relocated source, `paxi version`, `paxi doctor --json`, `paxi ai studio` |
| Environment certification | Read-only tool inventory plus optional detected test execution behind `--run-tests --confirm` | Compare output on physical Termux, Windows, Linux and macOS; review any command-detection false positives |
| Project test execution | Bounded capture, timeout/cancellation states and redacted output; planning and execution share one capability detector | Add a labeled multi-framework fixture matrix and exercise Ctrl+C/process-tree termination on Windows and POSIX hosts |
| Diagnosis benchmark | 16 small synthetic deterministic-signature fixtures | Build a reviewed, sanitized real-incident corpus with class balance and independent ground truth; separately benchmark each LLM route |
| LLM diagnosis | Adaptive plan and provider routing | Measure root-cause accuracy, reviewer agreement, uncertainty calibration, prompt-injection resistance, latency and cost per model |
| Native scanners | Adapters and incomplete-output safeguards | Run real OSV, cargo-audit, govulncheck, pip-audit, Composer and .NET scanner fixtures in CI; verify package coverage and feed freshness |
| SBOM | Syft adapter and CycloneDX/SPDX validation | Generate real multi-ecosystem SBOMs; verify with pinned schema versions and retain tool/schema metadata |
| Databases | SQLite plus service adapters for PostgreSQL, MySQL, MariaDB and SQL Server | Hosted live-service matrix; interruption, timeout, partial-create and cleanup-failure checks; detailed schema definition comparisons |
| Website accessibility | Playwright/axe auditor and responsive viewport simulation | Real Chromium/Firefox/WebKit artifacts; keyboard, screen reader, contrast, zoom and physical mobile review |
| Android | ADB journeys and Device Lab | Physical device runs across profiles/conditions; Compose, Flutter and React Native selector adapters |
| iOS | Static/source checks | Mac/Xcode bridge, simulator and physical iPhone/iPad execution |
| Framework adapters | Project detection and conventional test command planning | Build/test fixture matrix for every advertised ecosystem; distinguish detection-only from actual build/test support |
| Agent patches | Approval-based draft/review/apply/retest | Benchmark patch correctness, diff scope, test success, rollback integrity and accidental changes |
| Hosted CI | Cross-platform and browser workflows configured | Push source; record successful hosted run IDs/artifacts for all matrix cells |
| Windows release | ZIP app-bundle validation | Authenticode signing and MSIX/MSI packaging on an approved Windows signing host |

## V2.4.0 acceptance

1. `npm ci`, `npm run check` and `npm test` pass from a clean extracted archive.
2. `doctor certify` remains read-only by default.
3. `doctor certify --run-tests` without `--confirm` executes no project code.
4. A confirmed project test report distinguishes process outcome from evidence completeness.
5. Timeouts, missing tools, failed runs and truncated output are not reported as clean passes.
6. Test output is redacted before appearing in reports.
7. Missing optional tools, unavailable services and unrun CI are never shown as passing.
8. Physical device and platform-specific claims require actual execution evidence.
