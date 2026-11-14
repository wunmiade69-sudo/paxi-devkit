# PAXI Doctor — Remaining Work and Build Gates after V1.8.0

This document prevents feature-count-driven development. A capability is not production-ready merely because its interface or fixture tests exist. Each adapter must have a real integration run, a known failure case, bounded evidence, an assurance label and a documented environment requirement.

## V1.8.0 capability ledger

| Capability | Status | What has actually been delivered | Not yet established |
|---|---|---|---|
| Observability setup packs | Implemented as opt-in templates | Node/Express, FastAPI, Go/net/http, Spring Boot and ASP.NET examples generated into new files | No real project instrumentation or collector has been tested; no automatic dependency/source edits |
| Semantic website journey | Implemented | Reviewable Playwright schema, semantic locators, test-only fill/select values, assertions, same-origin path navigation, screenshots, trace headers | Real application run by user; multi-engine coverage; storage-state/session support; request mocking; accessibility assertions |
| Android selector proposals | Implemented | Local UIAutomator XML parsing, resource-ID candidate confidence, report redaction, reviewed one-assertion journey generation | Selector quality on real complex apps; multi-screen path reconstruction; framework-specific Compose/Flutter selectors |
| Cross-layer evidence | Extended | Semantic browser reports classified and correlated; W3C trace can link API and browser route evidence | Full causal inference; complete live traces and backend instrumentation |
| Verified-fix memory | Extended | Passing semantic journey can be saved with simulated-browser assurance | Git commit/branch and full repository snapshot linkage; native-device semantic memory for generated journeys |
| CI matrix | Added to repository | GitHub Actions config for Linux/macOS/Windows with Node 20/22 | CI has not run until the repository is pushed and hosted runners complete |

## P0 — Real environment validation before claiming platform readiness

1. Generate a Node/Express or FastAPI observability pack in a disposable sample service.
2. Manually install compatible OpenTelemetry packages and integrate the template.
3. Run a test request through frontend → API → service → database, export OTLP JSON, and verify parent-child spans and trace ID propagation.
4. Test semantic website journey against a local fixture app with a passing sign-in/profile flow and a deliberately broken assertion.
5. Run the website journey again after a correction and confirm fail-before/pass-after evidence.
6. Capture a physical Android UIAutomator hierarchy, generate selector proposals, check resource IDs against the live screen, and replay a manually reviewed journey.
7. Confirm no test values, cookies, response bodies or private visible labels are present in saved reports.

**Acceptance gate:** one real sample full-stack project demonstrates matching browser/API/service/database trace context; one website defect fails then passes after correction; one physical Android test has a meaningful selector assertion; report assurance categories remain accurate.

## P1 — Complete observability integrations

- Add tested setup packs/fixtures for supported SDK versions and database drivers, not just starter examples.
- Add async job/message propagation examples for queues and background workers.
- Add collector-health checks and OTLP export validation for OTLP JSON, protobuf/gRPC and HTTP endpoints.
- Add trace sampling diagnostics, clock-skew indicators and missing-parent diagnostics.
- Add configurable attribute allowlists and redaction validation before export.

Acceptance: sample fixtures run with pinned dependency versions and prove traceparent propagation across HTTP and an async boundary without recording payloads or secrets.

## P1 — Website journey maturity

- Add explicit storage-state creation/loading for disposable test accounts, with secret files outside source control and permissions verified.
- Add network request/response mocks and deterministic cleanup hooks that do not call arbitrary user code by default.
- Add accessible-name, contrast and keyboard/focus assertions to semantic journeys.
- Add Chromium/Firefox/WebKit fixtures and browser capability detection.
- Add route-level screenshots on failed assertions and support safe retries for transient navigation only.
- Add a recorder/import format for developer-reviewed Playwright journeys rather than generating code automatically.

Acceptance: a local fixture app reproduces a known defect, can be tested in all installed browser engines, reports each engine separately, and cleanup leaves the fixture in a known state.

## P1 — Android defect reproduction maturity

- Generate selector proposals from UIAutomator, Compose semantics and Flutter semantics where accessible.
- Propose selectors with uniqueness and stability scoring plus screenshot coordinates as evidence only.
- Support reviewed action sequences, preconditions, postconditions and state checkpoints.
- Capture accessibility tree, app version/build variant, locale, font scale, theme, density and orientation as part of each run.
- Add defect templates for navigation, forms, permission prompts, deep links and offline behavior.

Acceptance: a real named defect is reproduced by a selector-specific Android journey on a physical test device; the old build fails, corrected build passes, and device identity/OS conditions are recorded.

## P2 — Disposable database lab

- Support only explicitly selected local disposable database instances/profiles.
- Add schema snapshots and before/after comparison.
- Replay migrations only inside the disposable database, with target identity printed before execution.
- Add rollback/teardown and verify cleanup; refuse production endpoints and unrecognized hosts.
- Add read-only invariant queries and transaction/state-transition tests.

Acceptance: tests prove the selected database was disposable, production targets are refused, before/after schema is retained and cleanup is successful. Never auto-connect to a production database.

## P2 — Native vulnerability scanning and SBOM

- Add version-checked adapters for cargo-audit/OSV, govulncheck, pip-audit, Composer audit and an OSV scanner fallback.
- Normalize advisory ID, package, installed/fixed version, severity, source database, scan time and direct/transitive reachability when the tool supplies it.
- Generate CycloneDX or SPDX SBOMs only from an installed, version-detected scanner or label manifest-based component lists as incomplete.
- Add license-policy review and transitive dependency resolution.

Acceptance: each ecosystem has fixtures for vulnerable, fixed, unpinned and unresolved packages; network scans require explicit consent; reports never say “clean” when the scanner is missing or incomplete.

## P2 — Language and framework adapters

- Implement framework-specific build/test/check adapters for Python, Go, Rust, Java/Kotlin, PHP, .NET, Ruby, Swift, Dart/Flutter and C/C++.
- Add AST/type-aware analyzers where possible; current pattern scanners remain heuristic.
- Run adapter fixtures against minimum and current tool versions.

Acceptance: adapter preview identifies the exact command, execution requires confirmation, exit codes and logs are preserved, and all project-controlled commands are run without a shell using bounded time/output.

## P2/P3 — Platform and release confidence

- Let the new GitHub Actions matrix run on Linux, macOS and Windows for Node 20/22.
- Add Android device/emulator CI only when a safe runner is available; do not infer physical-device passes from emulator CI.
- Add a Mac/Xcode bridge or user-host runner for actual iOS builds and simulator/physical tests.
- Add artifact provenance, reproducible archive checks, signed release metadata and a release checklist.

Acceptance: hosted OS matrix is green, platform-specific skips are explicit, release archives have a verified checksum and provenance, and native iOS claims are backed by a Mac/Xcode run.

## P3 — Agent quality and autonomy gates

- Build a fixed benchmark suite of known project bugs and expected diagnosis plans.
- Measure precision, recall, unsupported assertions and false-root-cause rates.
- Compare local models and US/China cloud models on identical fixtures without sharing private project source by default.
- Enforce task-specific budget ceilings, model fallback policy and local memory/thermal profiles.
- Keep observation, recommendation, approval, application and retest as distinct states.

Acceptance: benchmark results and regression evidence are attached to each Agent Engine release; no model gains new execution permissions from a score or preference profile.

## Next implementation order

1. Validate V1.8.0 against real staging/full-stack and physical Android environments (P0).
2. Mature observability SDK packs and add async propagation (P1).
3. Improve semantic website journeys with disposable auth/session, network fixtures and multi-engine runs (P1).
4. Improve Android defect reproduction from live UI hierarchies (P1).
5. Build a disposable database lab (P2).
6. Add native advisory scanners and SBOM generation one ecosystem at a time (P2).
7. Complete framework adapters and validate the OS/Node CI matrix (P2/P3).
8. Benchmark Agent Engine quality before increasing autonomy (P3).

No future release should mark a stage complete until its acceptance gate passes. Local fixture tests, browser viewport simulation, emulators and static analysis must retain their distinct evidence labels.
