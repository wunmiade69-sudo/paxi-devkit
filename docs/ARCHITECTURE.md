# Architecture

PAXI DevKit is a Node.js CLI with an interactive terminal dashboard. Command modules are separated from shared process, config, path, storage and project-detection utilities.

- `src/cli.mjs`: command routing and argument validation.
- `src/commands/build.mjs`: local Flutter/Gradle Android builds, Flutter Windows desktop app ZIPs, and Flutter/Xcode iOS IPA builds; verifies fresh output and writes local history.
- `src/commands/tasks.mjs`: Flutter, Android Gradle, Java/Kotlin Gradle and Node.js test commands; explicit local APK installation through `adb`.
- `src/commands/doctor.mjs`: host, JDK, SDK, device and optional AI diagnostics.
- `src/commands/doctor-intelligence.mjs`: additive Doctor profile, project-inspection, website/Android Device Lab, C/C++, Codex and reviewed-patch CLI routes.
- `src/doctor/project-inspect.mjs`: bounded read-only technology inventory and static hygiene findings for websites, React, C/C++, Solidity and other project families. Recognition does not imply a dedicated build adapter.
- `src/doctor/website-lab.mjs`: optional Playwright website viewport testing, screenshots, browser/console/network diagnostics and accessibility/layout hints. Browser viewports are explicitly simulations, not physical devices.
- `src/doctor/android-lab.mjs`: ADB-backed Android emulator/physical-device snapshot evidence including metadata, screenshots and sanitized UI hierarchy. System conditions are observed, not changed.
- `src/doctor/android-journey.mjs`: validated user-authored Android journeys with taps, swipes, environment-backed text input, assertions, screenshots, foreground checks, bounded crash/ANR signals and protected reports.
- `src/doctor/cpp-toolchain.mjs`: C/C++ compiler/build-tool detection and explicitly confirmed CMake builds.
- `src/doctor/profile.mjs`, `src/doctor/learning.mjs` and `src/doctor/adaptive-context.mjs`: local preferences, explicit project convention learning and metadata-only context used by AI explanations.
- `src/doctor/device-lab.mjs`: five reusable device profiles and six test conditions shared by plans and runners.
- `src/doctor/lab-history.mjs`: protected local report history and issue/status comparisons.
- `src/doctor/api-contract.mjs`: read-only JSON OpenAPI/Swagger inspection, bounded explicitly confirmed GET/HEAD smoke tests, and generation of reviewable regression plans from static operations and declared response schemas. Dynamic routes and mutating methods are excluded.
- `src/doctor/cross-layer-correlation.mjs`: bounded evidence ingestion and cautious route/status/host correlation across API, browser, runtime, Android, visual, diagnosis, security, SQL and dependency reports. It copies no response bodies, headers, tokens or screenshots and never claims causation.
- `src/doctor/database-migrations.mjs`: offline static SQL migration risk-pattern review; does not connect to or modify a database.
- `src/doctor/mcp-server.mjs`: read-only MCP tools for Codex; it does not expose shell execution, writes, builds, deployments or signing.
- `src/doctor/patch-workflow.mjs`: clean-Git-tree patch review and explicitly confirmed application with optional test rerun.
- `src/commands/git.mjs`: narrow Git command allowlist; delegates to the user's Git installation and credential helper.
- `src/commands/ai.mjs`: local/API/off mode and OpenAI-compatible Chat Completions adapter. AI explanations can receive the selected project's learned convention summary and developer preferences, with `--no-profile` to exclude them.
- `src/lib/redact.mjs`: best-effort credential-pattern masking for remote AI error prompts.
- `src/commands/plugins.mjs`: explicitly trusted local `.mjs` extension modules with SHA-256-bound approval.
- `src/commands/update.mjs`: npm registry check/self-update.
- `src/lib/process.mjs`: child-process execution with argument arrays and `shell: false`; Windows `.bat`/`.cmd` launchers are invoked through a quoted PowerShell `-EncodedCommand`, and timeout/cancel handling terminates the process tree.
- `src/lib/safe-store.mjs`: atomic local JSON storage with restrictive owner-only permissions and symlink rejection for reads.

## Build execution

Android builds call `flutter` or a project-local Gradle wrapper/system Gradle. PAXI reports success only after it locates a non-empty APK/AAB under the project's build outputs. Flavored and nested Gradle modules are searched under build output directories.

Windows Flutter desktop builds are gated to Windows and require the Flutter Windows runner, Visual Studio C++ workload and Windows SDK. PAXI accepts only fresh Release/Debug app bundles and creates a ZIP containing the executable, Flutter runtime and data directory. It does not create an MSIX/MSI installer or Authenticode-sign the executable.

iOS IPA builds are gated to macOS with Xcode. Flutter uses `flutter build ipa --release`; native Xcode projects use `xcodebuild archive` followed by `xcodebuild -exportArchive` using a user-provided ExportOptions.plist. PAXI does not manage certificates or provisioning profiles.

## Tests and installation

`paxi test` delegates to the framework's unit-test task. Android app modules use `testDebugUnitTest`; pure JVM Gradle projects use `test`; Flutter projects use `flutter test`; Node projects use their configured `npm test` script. `paxi install` installs a selected or most recently built APK using `adb` after checking that an authorized device is attached.

## PAXI Doctor architecture (V0.8.0)

The Doctor subsystem is modular and additive. The project inventory is intentionally separate from the existing build detector: recognizing a language or framework never silently enables a build command.

- `src/commands/doctor-intelligence.mjs`: routes profile, inspect, website/Android lab, C++, Codex and reviewed-patch commands.
- `src/doctor/project-inspect.mjs`: bounded read-only inventory and static hygiene findings across web, React, C/C++, Solidity and additional project families.
- `src/doctor/website-lab.mjs`: optional Playwright responsive viewport runner; captures screenshots, console/page/network errors and layout/accessibility indicators. Marks evidence as simulated browser viewport.
- `src/doctor/android-lab.mjs`: ADB physical-device/emulator snapshot, system metadata, screenshot and sanitized UI hierarchy; selected OS conditions are observed, not changed.
- `src/doctor/android-explore.mjs`: bounded allowlisted Android navigation exploration with hashed UI state and screenshots.
- `src/doctor/journey-draft.mjs`: deterministic, review-required journey drafting from simple plain-language goals.
- `src/doctor/vision.mjs`: multimodal screenshot analysis through configured local or explicitly approved remote models.
- `src/doctor/cpp-toolchain.mjs`: compiler/build tool preflight and explicitly confirmed CMake debug build.
- `src/doctor/profile.mjs` and `src/doctor/learning.mjs`: validated developer settings and explicit per-project convention summaries; never silently record keystrokes or source files.
- `src/doctor/device-lab.mjs`: five profiles, six conditions and reusable plans/presets shared by browser and Android runners.
- `src/doctor/mcp-server.mjs`: read-only stdio MCP tools for Codex; supports stateless `2026-07-28` discovery/per-request metadata and legacy `2025-11-25` initialization.
- `src/doctor/patch-workflow.mjs`: clean-tree unified patch review and explicitly confirmed application with optional explicit test rerun.
- `src/doctor/lab-history.mjs`: protected report archives, 30-run history, status/issue comparison and pixel-level PNG screenshot comparison for compatible browser cases. Android snapshots remain metadata-comparison only.

The website runner tests viewport behavior in a browser and uses CSS approximations for font enlargement, keyboard focus and zoom. Android testing captures a real connected device or emulator, but observes rather than changes system font scale, orientation, dark mode, keyboard, display scaling or network state. Both report types explicitly identify the execution environment; neither claims unsupported conditions passed. Android does not provide native iOS runtime testing.

Project learning is opt-in and explicit. It stores compact convention summaries rather than source code. Global preferences are separate from project-specific conventions. MCP exposes read-only operations only; builds, patch application, deployment, signing and destructive actions are not exposed as AI tools. The patch command itself requires a clean Git tree and explicit `--confirm`, and a failed test does not trigger an automatic rollback.

See [DOCTOR_V0.6.0.md](DOCTOR_V0.6.0.md), [DOCTOR_V0.6.1.md](DOCTOR_V0.6.1.md), [DOCTOR_V0.6.2.md](DOCTOR_V0.6.2.md), [DOCTOR_V0.7.0.md](DOCTOR_V0.7.0.md), and [DOCTOR_V0.8.0.md](DOCTOR_V0.8.0.md) for release-by-release architecture and limitations.

## Storage

Local settings and build history live under `~/.config/paxi` (or `$XDG_CONFIG_HOME/paxi`). API keys are not stored there. Writes use restrictive file permissions and an atomic temporary file rename.

## Extension trust

The SHA-256 of each trusted plugin file is stored locally. A content change invalidates that approval. Plugins still execute in-process with the user's permissions; hash checking is integrity protection, not a sandbox.

## State-machine contracts

See [STATE_MACHINES.md](STATE_MACHINES.md) for the audited state inventory and transition contracts. `src/lib/state-machine.mjs` provides a small validation primitive; build history and process results expose lifecycle snapshots so the CLI, CI and agent tooling can distinguish preflight, execution, verification, timeout, cancellation and success without scraping terminal text.


## PAXI Doctor V1.5.0 — API regression generation and cross-layer diagnosis

The API contract module can now turn OpenAPI 3.x / Swagger 2.0 JSON into a reviewable smoke-test plan. Only static non-deprecated GET/HEAD routes are included; dynamic path parameters and mutating methods are excluded. The generator derives declared successful status codes and bounded required JSON paths from local response schemas, writes a new owner-only plan file, and performs no network I/O. The existing API runner still requires `--confirm`, and remote execution additionally requires HTTPS plus `--allow-remote`.

The cross-layer correlator consumes saved reports selected by the developer. It extracts bounded metadata and creates candidate associations between browser/API route and status evidence, runtime health and same-host failures, and API failures plus database migration risks. Confidence is intentionally conservative, and the report states that correlation is not causation. The Agent Engine can add these reports to its planning context with repeated `--evidence` arguments. Evidence ingestion is read-only and does not rerun tests, change source code or promote simulated browser evidence into a physical-device pass. See [DOCTOR_V1.5.0.md](DOCTOR_V1.5.0.md).


## PAXI Doctor V1.6.0 — Distributed trace and verified regression memory

V1.6.0 introduces optional W3C trace-context propagation for API smoke tests and browser XHR/fetch traffic. Developers can reuse a shared trace ID, scan a local backend log for matching trace context, and pass the API, website and backend-log reports into the existing correlator. Browser tracing is opt-in because a non-simple trace header can trigger CORS preflight; PAXI does not modify backend instrumentation. The correlator treats a shared trace ID as a link to a distributed trace context, not proof of causation.

A defect-to-regression draft generator maps failed API/browser events to matching cases in an already reviewed API smoke plan. It only selects static GET/HEAD cases, makes no network calls and does not invent expected statuses. A separate project-scoped verified-fix ledger accepts only fully passing saved PAXI API smoke reports plus explicit developer approval and selected source-file hashes. The Agent Engine can reuse non-stale records as advisory context; changed files mark records stale, and no memory record authorizes automatic code edits or execution. See [DOCTOR_V1.6.0.md](DOCTOR_V1.6.0.md).


## PAXI Doctor V1.7.0 — multi-platform regression and trace analysis

V1.7.0 can import local OTLP JSON span exports (bounded, allowlisted attributes), derive parent-span relationships and rank database/error spans as investigation hypotheses alongside failed API requests. The website Device Lab can execute same-origin route × viewport checks. The regression drafter can produce reviewed API cases, website routes and an Android starter journey from confirmed cross-layer report events. Verified-fix memory can link passing API smoke, simulated browser viewport and physical Android scripted journey reports, preserving each assurance class and rejecting emulator evidence as physical proof. The Agent Engine adds evidence-aware follow-up steps. See [DOCTOR_V1.7.0.md](DOCTOR_V1.7.0.md).


## PAXI Doctor V1.8.0 — evidence collection and user-journey adapters

V1.8 introduces three additive adapters. `src/doctor/observability-packs.mjs` writes opt-in framework templates into a new project-local folder without editing source or manifests. `src/doctor/website-journey.mjs` executes reviewable semantic Playwright journeys with scoped test-only environment values, same-origin navigation and explicit execution consent. `src/doctor/android-selector-proposals.mjs` derives resource-ID selector candidates from a local UIAutomator XML dump and avoids retaining visible labels/content descriptions.

Semantic browser journey reports can be correlated with API/backend evidence and saved as verified-fix evidence only when the explicit assertions pass; the assurance remains simulated-browser. Android selector drafts remain human-reviewed; the generated starter assertion covers only one visible resource ID and does not claim to reproduce a full defect.


## PAXI Doctor V1.9.0 — operational validation and supply-chain evidence

V1.9.0 adds an opt-in synthetic OTLP/HTTP exporter probe; an isolated in-memory SQLite migration replay lab; optional native advisory scanners and Syft SBOM generation; and stronger semantic website journey controls including private external storage-state files, same-origin mocks, explicitly allowlisted API origins, heuristic accessibility/keyboard assertions and independent Chromium/Firefox/WebKit runs. Additional Swift, Ruby, PHP and Dart test plans are detected. These features remain evidence-scoped: synthetic collector acceptance is not trace persistence, SQLite execution is not vendor database validation, SBOM generation is not a vulnerability verdict, and browser simulation is not physical-device certification. See `DOCTOR_V1.9.0.md` and `REMAINING_WORK_V1.9.0.md`.
## PAXI Doctor V2.0.0 — disposable SQL engines and supply-chain policy

V2.0.0 extends the local QA architecture with a disposable service-database adapter for PostgreSQL and MySQL/MariaDB, while retaining the in-memory SQLite lab. Service runs are opt-in, require explicit confirmation, accept only loopback administrator endpoints and use random per-run database/user names. Test users receive database-scoped privileges; SQL is streamed through stdin; credentials are kept in private temporary files; generated resources are cleaned up and cleanup failure is visible in the report. The adapters are tested with fake native clients in the local suite but require real service-version validation before production use.

The supply-chain path now includes structural CycloneDX/SPDX SBOM checks, a local component license policy evaluator and scanner-version evidence. Structural checks are not official JSON Schema conformance. License screening is intentionally conservative and is not legal advice. Native scanner presence/version is not proof of scan completeness.



## PAXI Doctor V2.1.1 — Termux launcher, SPDX and advanced QA

The Android install path uses a generated `$PREFIX/bin/paxi` wrapper with `/system/bin/sh` and the absolute Node executable path rather than depending on the `/usr/bin/env` layout. The package's `bin/paxi.mjs` retains the portable Node shebang for standard Linux/macOS/npm hosts.

The database service adapter supports PostgreSQL, MySQL, MariaDB and SQL Server. SQL Server uses `sqlcmd`, loopback-only `mssql://` or `sqlserver://` administrator URLs, `SQLCMDPASSWORD` for credentials, randomly named database/login resources, scoped test-database membership, conservative SQL screening and cleanup evidence. These safeguards reduce risk but do not make arbitrary project migrations safe; only disposable local databases are supported.

The SBOM policy engine parses SPDX expression precedence and exception syntax, optionally cross-checking identifiers against paired local SPDX License List/Exception List snapshots. A separate Python `jsonschema` adapter validates SBOMs against operator-supplied local schema files, rejects external references and records hashes. Website accessibility testing runs axe-core inside a locally installed Playwright browser at Device Lab viewport profiles while blocking cross-origin and mutating requests.

All new integrations remain environment-gated. Missing Python packages, Playwright, axe-core, browser binaries, sqlcmd or live database services are `tool-missing`/not-run states—not passing checks. Browser viewport evidence is simulated; physical device, manual assistive technology and hosted CI results require separate verification.
