# PAXI DevKit state-machine audit

This document records the build/workflow state machines carried forward from v0.5.5 and the additive Doctor foundation introduced in v0.6.0 and expanded in v0.6.1/v0.6.2 and the contracts used to make them observable. The goal is to give the CLI, developers and coding agents the same description of what PAXI is doing, what it is waiting for, and what it can safely do next.

## Design decision

PAXI should not become one giant workflow engine. Its workflows have different security and recovery rules. Instead:

1. Use explicit transition contracts for long-running or destructive operations.
2. Keep capability/readiness results separate for each target platform.
3. Keep terminal outcomes machine-readable while retaining existing human-readable messages and exit codes.
4. Persist only useful build lifecycle summaries; do not persist AI prompt contents, API keys, plugin source, or unnecessary process output in state records.
5. Treat uncertain/partial states as partial, never as success.

The shared transition primitive lives in `src/lib/state-machine.mjs`. It is deliberately small, side-effect free, and rejects invalid transitions. The process runner and build-history flow use it without changing their existing command arguments or success/failure exit-code behaviour.

## State-machine inventory

| Workflow | States / transitions | Current owner | Important edge cases |
|---|---|---|---|
| CLI command | raw args → parsed → validated → dispatched → completed / rejected | `src/cli.mjs` | Parsing failures happen before a workflow starts; they should not create build history. |
| Project detection | unknown markers → detected framework + confidence → supported / detection-only / unsupported | `src/lib/project-detect.mjs` | Detection uses precedence (Flutter, Gradle, Xcode, Expo, React Native, JavaScript); overlapping markers must remain visible in `markers`. A detected project is not automatically a supported build target. |
| Host/toolchain readiness | unknown → inspected → ready / partial / blocked | `src/commands/diagnostics.mjs`, `src/lib/windows.mjs` | Readiness is target-specific: Android, Windows desktop and iOS have different prerequisites. General `doctor.ready` is not proof every target can build. |
| Setup/configuration | unconfigured → inspected → configured → user-reviewed | `src/commands/diagnostics.mjs`, `src/lib/termux.mjs` | Setup does not silently install SDKs. Termux project edits must be reviewed and remain local to the selected project. |
| Build | created → preflight → building → verifying → succeeded; preflight/building/verifying may end failed; building may end timed_out/cancelled | `src/commands/build.mjs` | Platform checks and cache checks remain in preflight; the building transition occurs only after target-specific preflight succeeds. A successful compiler exit is not success until a fresh artifact exists and passes the configured verification level. Build history retains the legacy `status` field and adds `outcome` plus transition history. |
| Child process | created → starting → running → exited; running → terminating → cancelled/timed_out; spawn or non-zero exit → failed | `src/lib/process.mjs` | Timeout and Ctrl+C must terminate the process tree; process results now include a lifecycle snapshot. |
| Test command | detected → dependencies_ready → running → passed / failed / timed_out / cancelled | `src/commands/tasks.mjs`, `src/lib/process.mjs` | Test execution is delegated to framework tooling; the process lifecycle records the actual subprocess outcome. Dependency-resolution failure occurs before the test command starts and must not be reported as a test failure from the runner itself. |
| Offline readiness | uncached → warmed online → cached → preflight-ready → offline execution; missing cache → blocked with next action | `src/lib/offline.mjs`, `src/commands/diagnostics.mjs` | Flutter offline builds need Pub, Flutter engine artifacts, Gradle wrapper distribution and dependency caches. Windows Flutter builds must also set Gradle's actual offline StartParameter, not only Pub's offline flag. iOS offline builds remain explicitly unsupported. |
| Artifact | candidate → fresh → structurally valid → platform-verified / partially verified / rejected | `src/lib/artifacts.mjs`, `src/commands/build.mjs` | Stale artifacts are never accepted. A ZIP layout check is not the same as signature verification. `artifactVerified` now means platform verification; partial checks have a separate state. |
| Android installation | selected APK → inspected → device discovered → authorized → installing → installed / rejected | `src/commands/tasks.mjs` | Missing/unauthorized/multiple devices, changed SHA-256, invalid signature and non-APK inputs must block installation. The ADB install operation is the side-effect boundary. |
| AI configuration/request | off / local / API; API request → redacted → consented → sent → response validated / failed / cancelled | `src/commands/ai.mjs`, `src/lib/config.mjs` | API consent is per request; no source files are sent; keys remain environment-only. Related AI settings are now committed atomically so the active mode cannot be left half-configured. Environment variables override persisted settings. |
| Plugin trust/execution | installed → untrusted → reviewed+hash-trusted → unchanged → execution; changed/revoked/disabled → blocked | `src/commands/plugins.mjs` | Hash trust detects code changes but is not a sandbox. Plugins run in-process with user permissions and cannot be safely force-stopped like child processes. Execution re-reads the latest disable/trust settings before importing the approved bytes. |
| Config persistence | read → lock acquired → validate/merge → atomic temp write → replace → unlock; malformed main file → backup recovery | `src/lib/safe-store.mjs` | Lock timeout/stale-lock handling, symlinks and malformed files are explicit failure/recovery paths. |
| Cache cleanup | scope selected → confirmation required → target validated → deleted / refused | `src/commands/cache.mjs` | Destructive cleanup requires `--confirm`; Gradle wrapper distributions and Flutter SDK artifacts are preserved. |
| Update | current version → registry check → newer/current/unavailable → install / no-op / failed | `src/commands/update.mjs` | Update checks are separate from builds; an install/update must never be implied just because a newer version exists. |
| Interactive menu | menu displayed → one action selected → action runs → command returns | `src/commands/dev.mjs` | `paxi dev` is currently a single-action menu, not a persistent dashboard loop. Non-interactive terminals must use explicit commands. |

## Build lifecycle contract

The persisted build record keeps the existing `status: succeeded|failed` field for compatibility and adds:

- `outcome`: `succeeded`, `failed`, `cancelled`, or `timed_out`.
- `lifecycle.state`: final explicit state.
- `lifecycle.history`: timestamped transitions with non-sensitive context.
- `artifactVerificationState`: `not_checked`, `structurally_valid_only`, or `platform_verified`.

Consumers that only read the old `status` field continue to work. Consumers that need precise UX or agent actions should use `outcome`, `lifecycle.state`, and `artifactVerificationState`. The `paxi builds --failed` filter includes legacy failures plus the newer `cancelled` and `timed_out` outcomes; the human-readable view distinguishes them and continues showing hashes for structurally checked artifacts without claiming platform verification.

## Windows offline contract

A Windows Flutter offline build is allowed only when the Windows runner/toolchain, Pub cache, Windows Flutter engine, Android Gradle Wrapper distribution and Gradle dependency cache are present. PAXI runs `flutter pub get --offline`, then launches Flutter with a temporary `GRADLE_USER_HOME` that links the existing wrapper/dependency caches and provides an init script setting `gradle.startParameter.offline = true`. The temporary directory is removed after the build. No cloud builder or upload fallback is permitted.

## Doctor foundation state contracts (v0.6.0)

| Workflow | States / transitions | Important boundaries |
|---|---|---|
| Developer preference profile | defaults → explicitly edited → off / reset | Values are schema-validated and stored locally through atomic restricted JSON writes. No passive behavioral profiling runs in this version. |
| Project inspection | selected directory → bounded inventory → technology markers → heuristic findings → report | Read-only; symlinks and dependency/build output directories are skipped; project scripts are never executed. Detection does not imply build/runtime support. |
| Device Lab preset | profile/condition selection → validated plan → optionally saved preset → plan displayed | Plan status is `planned-not-executed`; pass status is `not-tested`; evidence is false until a future runner actually collects it. |

## Follow-up candidates (not silently enabled)

- Add a structured `paxi tasks --json` / `paxi status --json` surface for test/install workflows.
- Add bounded, cooperative cancellation for plugins only after introducing a versioned plugin API that supports `AbortSignal`; current in-process plugins are not safely interruptible.
- Make project detection optionally report ambiguous multi-framework roots and support explicit monorepo subproject selection.
- Add persistent update/install transaction history only if update functionality grows beyond the current small command.
- Add native Windows installer formats (MSIX/MSI) and Authenticode verification as separate opt-in features; current Windows output is a runnable ZIP bundle.

These candidates are deliberately not part of the current refactor because implementing them would expand scope or alter existing product behaviour.
