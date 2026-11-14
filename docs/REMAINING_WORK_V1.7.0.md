# PAXI Doctor — Remaining Work and Build Gates after V1.7.0

This document is the anti-blind-building checklist. V1.7.0 is a tested software increment, not proof that every platform or runtime is production-ready. Future work should be pulled from this list only after the current stage passes its acceptance gates.

## Current capability status

| Capability | Current status | Evidence / boundary |
|---|---|---|
| OTLP traces | Implemented: local OTLP JSON import, span ancestry, HTTP/database/custom app-state fields | Requires the developer to export traces; no automatic instrumentation or live collector connection |
| Root-cause analysis | Implemented as ranked hypotheses | Shared trace/span ancestry improves ranking, but PAXI never proves causation |
| Website route regression | Implemented: same-origin GET routes × viewport profiles | Playwright viewport simulation; no semantic user journey or real mobile browser certification |
| API regression generation | Implemented for reviewed static GET/HEAD cases | Expected assertions are copied from the reviewed plan, not invented |
| Android regression generation | Partial: produces a safe foreground/screenshot starter journey | Developer must add a selector-specific assertion; actual device run is still required |
| Verified-fix learning | Implemented for all-passing API, browser-viewport and physical Android journey reports | Local record keeps report hashes and selected file fingerprints; it is not a full Git/project snapshot or proof of causal repair |
| Dependency inventory | Implemented static manifest/lockfile estimates for 11 ecosystems | Counts are heuristic; they do not resolve the dependency graph or query advisories |
| Security scan | Static source-pattern checks across supported source file types; existing explicit npm audit | Not a formal SAST, penetration test or complete ecosystem vulnerability scan |
| Agent planning | Uses project architecture, explicit memory, verified-fix memory and supplied cross-layer reports | Planning is advisory; it does not autonomously run a full test matrix or change the project |
| AI Studio | Provider key vault/model routing and local runtime configuration already exist | Live API authentication, local model performance, device memory/thermal and provider spend must be verified by the user in their environment |

## Prioritized roadmap

### P0 — Validate the V1.7 foundation in real projects

**Goal:** prove the new integration works outside the fixture suite before adding more autonomous behavior.

Tasks:
- Run `doctor trace spans` on a sanitized OTLP JSON export from a real staging service.
- Ensure one trace contains a frontend/API request span, backend server span and database client span with valid parent IDs.
- Run a website route regression against a local or staging website with the exact routes generated from a report.
- Run the Android starter journey on an authorized physical test phone after adding at least one feature-specific UI assertion.
- Save a passing API + browser + physical Android evidence set in verified-fix memory, then change one selected source file and confirm the memory becomes stale.
- Compare PAXI's ranked hypotheses with a human-confirmed defect. Record false positives and missing evidence.

Acceptance gate:
- At least one sample full-stack application has matching trace IDs across browser, API, backend and database spans.
- A reproduced defect has a saved failing report, a reviewed correction, and a passing regression report after correction.
- Physical Android evidence is reported as physical Android; browser viewport evidence remains simulation.
- No production credentials, customer data, private response bodies or secrets are copied into reports.

### P1 — Real observability instrumentation packs

**Goal:** make trace collection repeatable without pretending PAXI can infer uninstrumented behavior.

Build opt-in example packs, validated in isolated sample services, for:
- Node.js / Express / Fastify
- Python / FastAPI / Django
- Go / net/http / common routers
- Java / Spring Boot
- .NET / ASP.NET Core

Required pieces:
- W3C `traceparent` propagation from browser/API client to service boundaries.
- OpenTelemetry server and database spans using supported semantic conventions.
- Structured logs containing trace and span IDs.
- Async job/message propagation examples.
- Explicit test-only sampling and CORS notes.

Acceptance gate: sample service tests demonstrate a parent-child trace from incoming HTTP request to database call and structured log, and PAXI imports/correlates the sanitized export without leaking payloads.

### P1 — Semantic website journeys

**Goal:** test user behavior, not only route availability and layout.

Build:
- Reviewable journey files with role/name/test-id locators.
- Click, fill, select, keyboard, navigation and assertion steps.
- Explicit expected URL, visible state, response status and accessibility assertions.
- Dedicated test-account/session storage support with secrets supplied only through `PAXI_TEST_*` environment variables.
- Network request mocking/fixtures and deterministic cleanup.
- Chromium, Firefox and WebKit adapters where browser binaries are available.

Acceptance gate: tests run against a local fixture site, replay a known defect, fail before correction, pass after correction and save redacted evidence. No real purchase, production message or destructive workflow is allowed by default.

### P1 — Defect-specific Android reproduction

**Goal:** turn screenshots/UI hierarchy and failed steps into useful draft journeys.

Build:
- Selector proposals from sanitized UIAutomator hierarchy and screenshots.
- Human review of selector confidence and target app package.
- Assertions for visible text/resource IDs, foreground activity, screen transition and app state.
- Journey replay and screenshot checkpoints with run-to-run evidence comparison.
- Real-device capability metadata for API level, resolution, density, keyboard, font scale, theme and fold posture where supported.

Acceptance gate: a developer can approve a generated selector, replay a named defect on a physical Android test device, demonstrate fail-before/fix/pass-after, and preserve emulator vs physical classification.

### P2 — Disposable database lab

**Goal:** validate migrations and application state without risking a live database.

Build:
- Explicitly selected local disposable database profiles (e.g. PostgreSQL, SQLite, MySQL where tooling exists).
- Schema snapshots and before/after diffs.
- Migration dry-run/replay against a disposable database only.
- Rollback or disposable-container teardown.
- Read-only data invariant queries and transaction checks.

Acceptance gate: all mutation is isolated to a clearly identified disposable test database; target identity is printed; production-like endpoints are refused by default; snapshots and cleanup outcomes are recorded. Never auto-connect to a production DB.

### P2 — Native dependency advisory and SBOM adapters

**Goal:** separate static inventory from real vulnerability evidence.

Implement one adapter at a time, with version detection and normalized results:
- Rust: `cargo audit` / OSV
- Go: `govulncheck` / OSV
- Python: `pip-audit`
- Composer/PHP: `composer audit`
- Java/Maven/Gradle: OWASP Dependency-Check or OSV
- Ruby: `bundler-audit`
- Swift/Dart/.NET: suitable native or OSV-compatible scanners

Also add CycloneDX/SPDX SBOM export and optional license policy checks.

Acceptance gate: fixture projects with known test advisories return expected severities and fixed-version information. Network access must be explicit, results include scanner/database timestamp and tool version, and no remediation is auto-applied.

### P2 — Cross-language project adapters

**Goal:** convert technology detection into real framework-aware diagnostics and test execution.

For each language/framework adapter, define:
- Supported project versions and entrypoint detection.
- Build/test/lint/type-check commands.
- Required local tools and offline behavior.
- Report schema and failure mapping.
- Safe timeout, output size, working directory and no-shell process policy.
- A fixture project with expected results.

Priority candidates: Flutter/Dart, Java/Kotlin/Gradle, React/Next/Vite, Python, Go, Rust, CMake/C++, PHP/Laravel, .NET, Swift/iOS and Solidity/Foundry.

Acceptance gate: each adapter has positive, negative, missing-tool, timeout and unsafe-project tests. Detection alone must not be advertised as full language support.

### P2 — Native iOS and multi-OS execution

**Goal:** add true iOS runtime coverage and complete cross-device claims.

Requires a Mac/Xcode runner or user-controlled Mac bridge for iOS builds, simulator and physical iPhone/iPad journeys, code signing and archive verification. Add CI runners for Linux, macOS and Windows. Android/Termux static inspection must never be described as full iOS runtime testing.

### P3 — Agent quality and autonomy gates

**Goal:** earn more autonomy with measurable evidence.

Build a benchmark corpus of known bugs, screenshots, traces, expected diagnoses, safe patches and regression outcomes. Measure:
- Root-cause hypothesis precision/recall.
- False-positive rate for static findings.
- Correct regression selection.
- Patch acceptance rate and regression pass rate.
- AI model latency, token use and local RAM/thermal pressure.

Do not give the agent new write permissions until it demonstrates dependable performance on the benchmark. Any patch remains a reviewable diff; tests, installs, migrations, deployments, signing, payments and destructive actions remain separately authorized.

### P3 — CI, release provenance and update governance

Build GitHub Actions/GitLab/Azure/Jenkins adapters; reproducible package builds; artifact hashes and provenance; signed release process; dependency update PRs; migration/release checklists; regression artifacts retained by run ID; and update/rollback guidance.

Acceptance gate: release bundles can be rebuilt from a clean checkout on the supported CI matrix, test reports are attached, checksums match, and signing material stays outside logs and source archives.

## Definition of done for every future feature

A feature is not complete until all are true:

1. A clear user problem and supported project/platform boundary are documented.
2. Input schema, output schema, limits, timeout and failure states are specified.
3. Sensitive values are excluded or redacted; local-only/remote behavior is explicit.
4. At least one positive fixture, negative fixture and boundary/safety test exist.
5. Existing CLI commands and V1.x workflows pass regression tests.
6. A clean ZIP/package install passes `npm ci`, `npm test` and `npm run check`.
7. Hardware-dependent features are tested on actual required hardware or clearly labeled unverified.
8. The report distinguishes confirmed defects, probable issues, subjective recommendations and environment limitations.
9. Any code change has a reviewable diff and an independently passing regression test.
10. Release notes say exactly what was implemented and what remains partial.

## Anti-blind-building rule

Do not jump from feature idea straight to implementation. Use this sequence:

**Problem → supported environment → data/evidence contract → threat/safety boundary → fixture → implementation → regression test → real integration test → limitations → release.**

A feature that has only unit tests is implemented at the unit-test level, not yet proven in the user's real project. A simulated device/browser run is never a physical device pass. A correlation is never a root-cause fact. A dependency inventory is never a vulnerability audit.
