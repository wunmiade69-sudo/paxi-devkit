# PAXI Doctor — Remaining Work and Build Gates after V1.9.0

This ledger distinguishes implemented source features from environment-dependent validation. A command being present is not evidence that a live application passed.

## V1.9.0 capability status

| Area | Source capability | Current verification boundary | Remaining gate |
|---|---|---|---|
| OTLP | Synthetic OTLP/HTTP traces exporter probe | Local HTTP receiver integration test | Test a real Collector and query the span in a backend |
| OpenTelemetry packs | Five opt-in templates retained | Template installation and no-manifest-edit tests | Run on real Node/FastAPI/Go/Spring/.NET projects; verify supported SDK versions and shutdown |
| Database lab | In-memory SQLite migration replay with authorizer restrictions | Python sqlite3 integration tests, ATTACH/VACUUM blocking | Add Postgres, MySQL/MariaDB and SQL Server adapters using isolated disposable services |
| Database migration scan | Static SQL heuristics | Fixture tests | Vendor-aware parser and schema-diff tests |
| Vulnerability tools | OSV-Scanner, cargo-audit, govulncheck, pip-audit, Composer and .NET command adapters | Stubbed process/output tests; tools are optional | Run each installed scanner on fixture projects and validate native output formats/advisory counts |
| SBOM | Syft CycloneDX/SPDX generator | Stubbed Syft output validation | Run with real Syft binaries on Linux/macOS/Windows/Termux; validate output against schema and verify licenses |
| Website sessions | Load/save external private same-origin Playwright state | Mock browser tests for permissions, origin and redaction | Run against a real staging login/logout flow and verify cookie rotation/expiry |
| Website mocks | Exact same-origin JSON fetch/XHR mocks | Route-handler tests | Run browser-level API mock and unmocked integration flows |
| Accessibility | Missing-alt, accessible-name and Tab-focus heuristics | Mock locator tests | Add optional axe-core/pa11y WCAG checks, contrast analysis and manual screen-reader testing |
| Browser matrix | Chromium/Firefox/WebKit independent runner | Fake browser; unavailable engines explicitly reported | Install and run each real engine in hosted CI and on supported developer hosts |
| Framework tests | Additional Swift/Ruby/PHP/Dart planning | Planner fixture tests | Actual project tests on matching toolchains; do not assume every host can build every framework |
| Android | Journey/selector proposals retained | Simulated ADB tests | Execute defect-specific journey on at least one physical Android device and one emulator |
| iOS | Project/source recognition retained | Static checks only | Mac/Xcode bridge, iOS Simulator and physical iPhone validation |

## Required P0 validation before claiming production readiness

1. **Real OTLP pipeline:** instrument a test service, send spans through an actual OpenTelemetry Collector, confirm the trace is stored and queryable in a tracing backend, and verify request IDs propagate across frontend and backend.
2. **Real database migrations:** run disposable service-backed migration replay for the project's actual database engine, with before/after schema diff, rollback, integrity check and test-data isolation.
3. **Real browser engines:** run the same semantic journey in installed Chromium, Firefox and WebKit; retain screenshots, console/network errors, test result and engine/version.
4. **Real Android:** run a defect-specific journey against a physical device; collect Android version, model, display, selectors, screenshots and logs; compare before/after a fix.
5. **Cross-platform CI:** execute the existing Linux/macOS/Windows GitHub Actions matrix after pushing the repository. Locally added workflow files are not the same as successful hosted runs.
6. **Native security scanners:** run OSV and the applicable ecosystem-native scanners on representative projects, verify their advisory outputs, and keep the scanner/database versions in the report.

## V2.0 roadmap — next implementation slices

### Slice A — database adapters

- PostgreSQL disposable service using a local container or explicit user-provided test endpoint with isolation checks.
- MySQL/MariaDB disposable service.
- SQL Server disposable service where a supported host exists.
- Apply/rollback in an isolated database only; refuse production-looking hostnames and require a per-run confirmation token.
- Schema diff, lock/transaction timing and deterministic test-data fixtures.

### Slice B — complete observability packs

- Add optional database driver instrumentation for supported frameworks.
- Add message queue and background-job instrumentation.
- Add propagation tests for W3C trace context and baggage.
- Provide verified package version compatibility tables and exporter config tests.

### Slice C — website quality

- Optional axe-core or pa11y checks for WCAG rules.
- Color-contrast and keyboard trap analysis.
- Request mocking of GraphQL and documented API contracts.
- Browser version pinning and OS-specific matrix reporting.
- Safe login fixtures and explicit teardown/logout steps.

### Slice D — Android and iOS

- Flutter/Compose/React Native-specific selector adapters.
- Multi-screen expected-state assertions from approved defect records.
- Emulator profile matrix and physical-device evidence validation.
- Mac bridge for Xcode builds, simulator tests and iOS evidence.

### Slice E — security supply chain

- Verify SBOMs against CycloneDX/SPDX schemas.
- Add license policy checks with a user-supplied allow/deny policy.
- Add transitive dependency and reachability reporting where scanners support it.
- Verify scanner coverage and record scanner/database versions.
- Add artifact signing/attestation as a separate explicit release workflow.

### Slice F — intelligence quality

- Benchmark Agent diagnoses against labeled fixture failures.
- Measure false-positive and false-negative rates by ecosystem.
- Learn only from reviewed/verified fixes; stale evidence must be excluded.
- Add regression tests to prevent remembered recommendations from overruling current evidence.
- Keep autonomous modifications disabled unless a patch is reviewed and explicitly approved.

## Definition of done for each future release

- A feature has a specific user problem and measurable acceptance criteria.
- Unit and integration tests are added before feature claims.
- Negative/security tests cover unsafe inputs, missing tools, timeouts and partial failures.
- Existing DevKit/Android/Termux/AI workflows remain green.
- The actual release ZIP is extracted and tested independently.
- Hosted OS matrix results are captured when available.
- Real-device/backend tests are labeled by the environment that ran them.
- Unimplemented items remain visible in this ledger.
