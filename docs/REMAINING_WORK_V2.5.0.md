# PAXI Doctor — remaining work and acceptance gates (V2.5.0)

A feature is not certified merely because a command or adapter exists. This ledger separates implemented behavior, local tests and external acceptance evidence.

| Area | V2.5.0 state | Remaining acceptance gate |
|---|---|---|
| Termux launcher | Android-native shell launcher retained with quoted absolute Node/CLI paths and collision checks | Install on physical Termux; test fresh shell, storage relocation, upgrade from V2.4.0 and uninstall/rollback behavior |
| Environment certification | Read-only inventory plus explicit-confirmation test command execution | Run the framework fixture matrix and validate Ctrl+C/process-tree termination on real POSIX and Windows hosts |
| Cross-layer investigation | Event IDs, input SHA-256, timestamp timeline, evidence coverage, trace and route-only cases, sanitized extraction | Validate against independent real incident reports; test clock skew, duplicate reports, sampled traces and high-volume inputs |
| Agent evidence planning | Converts missing layers into plan-only evidence collection steps | Measure usefulness with reviewed incident cases and human reviewer agreement |
| Root-cause ranking | Database error hypotheses require parent-chain HTTP route matching for high confidence | Add labelled multi-service, retry, async, queue, transaction rollback and missing-parent-span fixtures |
| Website regression drafts | Suggested checks derived from observed issue codes; selectors and expected business behavior remain human-supplied | Validate generated drafts against real React/Next/Vite projects and real browser sessions |
| Android regression | Physical/emulator evidence is distinct; generated starter requires a selector-specific assertion | Add Compose/Flutter/React Native selector adapters and physical-device defect reproduction |
| Native scanners | Adapters and incomplete-output safeguards retained | Run actual OSV, cargo-audit, govulncheck, pip-audit, Composer and .NET scanner fixtures; verify feed freshness and package coverage |
| SBOM | Syft adapter, CycloneDX/SPDX structure and local schema validation | Catalog real multi-ecosystem projects and validate against pinned official schema versions |
| Databases | SQLite and service adapters for PostgreSQL, MySQL, MariaDB and SQL Server | Hosted service matrix for supported versions; interruption, timeout, partial create, cleanup failure and exact schema-diff tests |
| Accessibility | Playwright/axe and responsive viewport checks | Run Chromium/Firefox/WebKit matrix, then manual keyboard/screen-reader/contrast/zoom checks on physical devices |
| Framework adapters | Detection/test planning across supported ecosystems | Real build and test fixture matrix for every advertised language; clearly label detection-only versus tested build support |
| iOS | Static/source checks | Mac/Xcode bridge, simulator and physical iPhone/iPad runtime tests |
| AI model diagnosis | Adaptive route selection and evidence-aware plan context | Benchmark each configured local/cloud model against a sanitized labelled corpus: root cause, uncertainty, prompt injection, privacy, latency, cost and reviewer agreement |
| AI patch workflow | Separate draft/review/apply/ret-test gates | Benchmark patch scope, correctness, clean diff, test success, rollback integrity and collateral changes |
| Hosted CI | Linux/macOS/Windows and browser workflows configured | Push repository and save actual hosted workflow run IDs and artifacts; local tests are not hosted CI evidence |
| Windows release | ZIP app-bundle packaging and verification | Authenticode signing and MSIX/MSI packaging on an approved Windows signing host |

## V2.5.0 release acceptance

1. `npm ci`, `npm run check` and `npm test` pass from a clean extracted ZIP.
2. Cross-layer report inputs are bounded, non-symlink JSON files; absolute paths and report payloads are not leaked.
3. Event IDs and input fingerprints are deterministic for unchanged source reports.
4. Timestamp order is explicitly labelled as complete, partial or source-order-only.
5. Route-only grouping is always low-confidence and never represented as one confirmed incident.
6. Exact W3C trace ID links are context links, not proof of causation.
7. Database high-confidence candidates require a matching HTTP route ancestor and still require human review.
8. Missing evidence becomes a plan-only recommendation; no tests or device actions run from an Agent plan.
9. Website suggested checks remain drafts until the developer adds actual assertions.
10. Optional tools, unavailable services, simulated browsers and skipped host-specific tests never appear as successful physical/hosted validations.

## Next suggested work

V2.6.0 should add the first real integration certification pack: live database service CI, real browser matrix artifacts, actual scanner fixture runs and a small independently labelled incident corpus. After those, improve React Native/Compose/Flutter selectors and build the Mac/Xcode bridge. Do not add more autonomy until diagnosis and patch benchmarks can measure its reliability.
