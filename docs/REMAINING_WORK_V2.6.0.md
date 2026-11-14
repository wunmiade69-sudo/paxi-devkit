# PAXI Doctor — remaining work and acceptance gates (V2.6.0)

This ledger distinguishes implemented source, local fixtures and real environment certification. A workflow file or adapter is not a passing integration until its run evidence exists.

| Area | V2.6.0 state | Remaining acceptance gate |
|---|---|---|
| Termux launcher | Android-native `/system/bin/sh` launcher retained | Install on the physical Termux phone; test clean shell, shared-storage relocation, upgrade and rollback |
| CMake/CTest | Configure, test discovery, build and test in a disposable temporary directory; real local C++ fixture passed | Run the full C++ fixture on Linux/macOS/Windows hosted matrix; test SIGINT and timeout on each host |
| Expo / React Native | Package test script identity plus local-Jest fallback; no npx/download fallback | Validate with real Expo SDK/Jest preset and React Native projects across supported Node/Jest versions |
| Flutter / Dart | Existing `flutter test` / `dart test` planner | Validate on a real Flutter project with local SDK/cache and Android ARM64 Termux host |
| Other language adapters | Existing Python, Go, Rust, Swift, PHP, Java/Maven, Gradle, .NET, Solidity and CTest plans retained | Add real fixture build/test matrix for each advertised language and explicitly label tool-missing/detection-only states |
| Diagnosis benchmark | 24 synthetic fixtures, including hard negatives and six new environment failure classes | Collect independently reviewed, sanitized real incident cases with source provenance; measure reviewer agreement and false positives |
| Database CI | Ephemeral PostgreSQL 16, MySQL 8.4 and MariaDB 11 jobs configured; each retains JSON artifact | Push source, run workflow, inspect all three report artifacts and cleanup records; add SQL Server live CI after stable runner setup |
| Browser CI | Chromium/Firefox/WebKit matrix configured with TAP artifact upload | Push source and inspect three browser artifacts; add authenticated app fixture and accessibility baseline |
| Security scanners | Existing native scanner adapters and output safeguards | Install actual scanner binaries in isolated CI, validate version-specific JSON, advisory fixtures, coverage and feed freshness |
| SBOM | Syft generation, CycloneDX/SPDX structural and local schema validation | Run real Syft catalogs for npm, Python, Rust, Go, PHP, Java, Dart and .NET fixtures against pinned schemas |
| Android selectors | UIAutomator resource-ID selector proposals and scripted journeys | Dedicated Compose/Flutter/React Native semantic-selector test adapters plus physical-device defect reproduction |
| iOS | Static/source checks only | Mac/Xcode bridge, simulator and physical iPhone/iPad builds/tests |
| AI diagnosis | Adaptive routes, project evidence context and deterministic 24-case signature benchmark | Evaluate each configured local/cloud model on a sanitized, independently labelled incident corpus; report cost, latency, uncertainty, privacy and reviewer agreement |
| AI patching | Draft/review/apply/retest workflow | Measure patch scope, correctness, test success, rollback integrity and collateral changes against reviewed patch tasks |
| Hosted CI | Cross-platform Node workflow plus browser and DB workflow definitions | Execute on GitHub and retain workflow IDs, platform logs and artifacts; local results are not hosted CI evidence |
| Windows signing | ZIP bundle build/verification | Authenticode signing and MSIX/MSI packaging on an approved Windows signing host |

## V2.6.0 acceptance rules

1. Clean extracted ZIP: `npm ci`, `npm run check`, and `npm test` pass.
2. A CMake project with zero registered tests must return `no-tests`, never `passed`.
3. CMake temporary build output must be cleaned after success and failure; cleanup failure must be visible.
4. CMake configure/build/CTest shares one timeout budget and retains bounded/redacted output.
5. Expo/React Native Jest fallback may resolve only a local installed Jest package; it must not use `npx` or trigger package downloads.
6. Missing Jest, compiler or build tools must be reported as `tool-missing`/blocked.
7. Database jobs use ephemeral test services, test-only credentials and explicit cleanup assertions.
8. Browser/DB workflow files and artifact upload steps are not counted as hosted successes until actually run.
9. Synthetic benchmark scores must be labelled synthetic and must not be presented as AI model or real-incident accuracy.
10. Device, iOS, scanner and service integrations not run in this environment remain open.
