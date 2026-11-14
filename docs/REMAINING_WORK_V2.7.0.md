# PAXI Doctor V2.7.0 — Remaining Work and Acceptance Gates

| Area | Current state | Remaining acceptance gate |
|---|---|---|
| Local heuristic security scan | Existing offline read-only scanner | Maintain multi-language positive/negative fixtures; tune confidence and false positives |
| Gitleaks | Adapter, redacted report normalizer and mocked tests | Install native version matrix on Linux/macOS/Termux/Windows; run seeded synthetic secrets and bounded history fixtures |
| Semgrep | Local-rule and online-registry adapter | Run pinned local rule packs in CI; verify result semantics against Semgrep versions |
| Trivy | Filesystem vuln/misconfig/secret adapter | Run pinned version against synthetic advisory, IaC and secret fixtures; record DB freshness |
| Slither/solc | Single-file analysis adapter | Run known safe/vulnerable contracts; add a full project/remapping adapter with explicit build sandbox |
| Android APK | Manifest and apksigner adapter | Test real debug/release APKs across SDK Build Tools versions; add network-security-config and deep-link inspection |
| Website headers | One-response bounded GET check | Add multi-route app scan, robust multi-cookie parsing, CSP policy review and proxy/CDN awareness |
| API object authorization | Paired-account GET-only plan runner | Expand role/tenant cases, expired credentials, authz evidence and authorized staging fixtures |
| Authentication | Contract heuristics | Add framework-aware checks for session rotation, MFA configuration, rate-limit policies and recovery flows |
| Authorization | Paired object access check | Add route-level role/tenant matrices and safe negative tests with explicit developer-provided test data |
| Injection | Semgrep/Trivy/SAST support | Add framework-specific, evidence-backed SQL/NoSQL/command/template injection fixtures and safe local reproduction |
| Android runtime | Existing ADB/Device Lab | Add runtime permission, exported component, deep link, WebView origin and local storage inspection on emulator/device |
| iOS | Static checks | Mac/Xcode bridge, entitlements, ATS, URL schemes, keychain and signing-profile review |
| Security intelligence | Static findings + external scanner outputs | Correlate findings with runtime/trace evidence; do not treat AI inference as scanner confirmation |
| AI remediation | Existing approved patch workflow | Security-specific patch benchmark, regression retest, rollback and secret-leak tests |

## Release acceptance rules

1. Missing native tools are reported as unavailable/not-run, never clean.
2. Invalid or truncated scanner output is incomplete.
3. Secret values, API tokens, response bodies and source snippets are not retained in reports.
4. Online scanner rule/database retrieval requires explicit consent.
5. Remote application checks require HTTPS, scope approval and explicit confirmation.
6. API authorization checks use two distinct developer-owned test accounts and only explicit GET routes.
7. APK analysis does not install/launch an artifact; Solidity analysis does not invoke project build scripts.
8. Unit tests, CLI tests, clean extracted-package tests and checksum verification must pass.
9. Live native scanners, hosted CI and physical devices require actual evidence before they can be called verified.
10. Security results must distinguish confirmed defects, probable risks, heuristic recommendations and environment limitations.
