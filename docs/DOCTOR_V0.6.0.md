# PAXI Doctor — V0.6.0 foundation

## Product role

PAXI Doctor is the inspection, diagnostics and improvement intelligence layer inside PAXI DevKit. It is additive: existing CLI commands and local build workflows remain the execution foundation.

## Implemented in this release

### Read-only project inspection

`paxi doctor inspect [--project <dir>] [--json]` performs a bounded local scan. It recognises the existing DevKit project families and broader technology markers including static websites, React, Next.js, Vite, Vue, Svelte, Astro, Angular, C/C++, CMake, Make, Python, Go, Rust, PHP, Java, Kotlin, Swift, Objective-C, Ruby, Elixir, Scala, Solidity, SQL, Shell and C#. It checks selected manifest and root HTML metadata, package scripts and lockfile consistency. It does not execute project scripts or compile files.

### Developer preference profile

`paxi doctor profile` manages an owner-local preference document. Available preferences cover:

- guidance style: concise, step-by-step or detailed;
- automation boundary: manual, approval-required or proactive recommendations;
- UI theme preference: preserve project, dark, light, system or custom;
- dependency policy: reuse, minimal or flexible;
- testing style: test-first, after-changes or manual;
- preferred programming languages.

Learning is explicit by default. PAXI stores only settings the developer deliberately changes. `learning off` disables profile learning. The profile can be inspected and reset.

### Device Lab plan builder

`paxi doctor lab` exposes five profiles: compact, standard, large, foldable and tablet. Six independent conditions are available: font scaling, landscape, dark/light theme, keyboard, zoom/display scaling and offline behavior. Users can combine them, save up to 30 named presets, inspect a preset and delete one with explicit confirmation.

A plan is not an executed test. The report uses `planned-not-executed`, `not-tested` and `evidenceCollected: false`. Runtime runners, screenshots, device evidence, fold posture and automated result comparison are not claimed by this initial layer.

## Design boundaries

- Existing `detectProject()` precedence and build adapters are deliberately unchanged.
- The inspection walker skips dependency and build output directories, ignores symbolic links, uses a bounded file count and reads only selected small manifest/HTML files.
- Environment file contents are never read; only filenames and `.gitignore` rules are checked.
- No source, logs or profile data are sent to a remote service by these commands.
- AI is not invoked by project inspection. Any future Codex/local model integration will need explicit data-scope and approval controls.
- No code changes, installs, compiles, tests, deployments or signing operations are performed by Doctor inspection.

## V0.6.1 additions

See [DOCTOR_V0.6.1.md](DOCTOR_V0.6.1.md) for the expanded website/Android evidence runners, C/C++ adapter, opt-in project convention learning, read-only Codex MCP interface and reviewed patch workflow.

## Planned increments

1. Browser adapter: run website builds/tests, browser console/network diagnostics and responsive screenshots.
2. React adapter: framework-aware component checks, accessibility and runtime journeys.
3. C/C++ adapter: detect compiler/CMake capabilities, compile/test under explicit user control, parse diagnostics and sanitizers.
4. Additional language adapters: Python, Java/Kotlin, Go, Rust, PHP, C# and others.
5. Device Lab runners: real devices/emulators first, browser viewport simulation where available, explicit distinction between simulated and physical evidence.
6. Adaptive intelligence: project conventions and developer work patterns with transparent opt-in, correction/reset controls and separated user/project profiles.
7. Permissioned remediation: propose patch → review → apply → retest; no automatic destructive actions.
