# PAXI Doctor — remaining work and acceptance gates (V2.2.0)

This ledger distinguishes implemented source and local tests from real environment certification.

| Area | V2.2.0 state | Remaining acceptance gate |
|---|---|---|
| Termux launcher | Android-native `/system/bin/sh` wrapper, exact Node/entry paths, collision protection and POSIX harness tests | Install and execute on the user's actual Termux build; verify fresh-shell `paxi version`, `paxi doctor --json`, AI Studio and launch from private/shared-storage extraction paths |
| Process evidence | Output byte count and truncation signal included in process result | Add call-site assertions for every subsystem that parses captured output; add large stderr/stdout tests for log streaming and cancellation |
| Database metadata | PostgreSQL/MySQL/MariaDB/SQL Server catalog metadata query adapters and in-memory SHA-256 fingerprints | Live run each engine/version and test empty DB, same-count column alterations, view/trigger/routine changes, large catalogs and truncation behavior |
| Database cleanup | Generated disposable identities/resources, explicit cleanup report and partial-failure handling | Exercise SIGINT, process termination, timeout during create/migration/drop, and permission-limited admin users against all live engines |
| SPDX | Full expression structure used by current parser, paired hash-pinned registry snapshots | Run the official SPDX conformance corpus; add registry expiry/refresh governance and legal/compliance approval |
| SBOM | Structural validation and optional official local JSON Schema validation with external refs blocked | Validate genuine Syft outputs for several ecosystems and pinned CycloneDX/SPDX schema releases on CI |
| Accessibility | Review status for violations, incomplete checks, blocked requests, browser runtime errors and HTTP errors | Add manual screen-reader, keyboard-only, speech input, zoom/font scaling and physical Android/iOS accessibility evidence |
| Browser matrix | GitHub Actions Chromium/Firefox/WebKit workflow configured | Push to GitHub and retain actual hosted browser run links/artifacts; add authenticated staging fixtures without using production sessions |
| Cross-platform CI | Node 20/22/24 matrix across Ubuntu/macOS/Windows configured | Push and verify each hosted matrix cell; inspect any OS-specific failures and attach evidence before claiming CI green |
| SQL Server | Loopback disposable migration adapter and local mocked/live claims documented in V2.1.1 record | Hosted CI matrix, sqlcmd version coverage, cancellation/timeout cleanup evidence and actual metadata fingerprint validation |
| Security scanners | Optional adapters and scanner version/report parsing | Live OSV, cargo-audit, govulncheck, pip-audit, Composer and .NET scanner fixtures on hosted runners; prove transitive coverage and freshness states |
| SBOM generation | Syft adapter | Run native Syft across OS and ecosystem fixtures, then validate artifacts with the pinned official schemas |
| Android | ADB journeys and Device Lab retained | Physical handset and emulator evidence across font, landscape, dark, keyboard, zoom and offline conditions; validate Jetpack Compose, Flutter and React Native selectors |
| iOS | Static/source review only | Mac/Xcode bridge plus simulator and physical iPhone/iPad runtime testing |
| Framework adapters | Detection/planning and selected local builders | Real fixture build/test jobs for every advertised language/framework; split detection-only from build/test verified status |
| Agent intelligence | Adaptive profile, project memory, diagnosis, approved patch workflow | Labeled diagnostic benchmark, precision/recall, patch acceptance and success rates, rollback drills, privacy-leak tests and cost-aware routing benchmark |
| Windows release security | ZIP packaging and structural verification | Authenticode signing/verification and MSIX/MSI installer only after a Windows-host signing design is approved |

## Release acceptance rules

1. `npm run check`, `npm test` and a clean extracted-package test must pass.
2. Missing optional tools and unavailable services must be `tool-missing`, `unavailable`, `not-run` or `indeterminate`, never a green result.
3. Database schema comparison must be `indeterminate` when detailed metadata is truncated and counts do not prove a change.
4. Accessibility `passed` must mean no violations, incomplete checks, blocked requests, browser runtime errors or HTTP response errors were captured.
5. Database labs must use dedicated disposable loopback services and report cleanup outcome.
6. Simulated viewport evidence must never be reported as physical-device evidence.
7. Hosted CI/browser workflows are not complete until actual GitHub runs are reviewed.
8. Physical Android and native iOS claims require actual device/host evidence.
9. The final source ZIP must extract independently, pass tests/checks and match its SHA-256 file.
