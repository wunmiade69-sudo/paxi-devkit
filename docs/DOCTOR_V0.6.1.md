# PAXI Doctor — V0.6.1 expanded foundation

PAXI Doctor remains a subsystem of PAXI DevKit. It combines deterministic local tools with optional AI/MCP assistance. New adapters are additive; they do not replace the existing Flutter, Gradle, Android, Windows, iOS-host-gated, Git or offline workflows.

## Website and React QA

A project may be identified with `paxi doctor inspect`. For runtime browser checks, start the website yourself (for example `npm run dev -- --host 127.0.0.1`) and install Playwright explicitly in that project:

```bash
npm install --save-dev playwright
npx playwright install chromium
paxi doctor lab run --project . --url http://127.0.0.1:5173 \
  --profiles compact,standard,large,foldable,tablet \
  --conditions font,landscape,dark,keyboard,zoom,offline
paxi doctor lab history
paxi doctor lab compare <before-run-id> <after-run-id>
```

PAXI does not install browser binaries or start project scripts automatically. The user starts the site and provides the target URL. Browser tests save a screenshot per generated case and a `report.json`; reports are stored under the local PAXI configuration directory by default.

The runner checks document overflow, title and viewport metadata, image alternative text, button names, uncaught browser errors, console errors, failed requests, keyboard-focus behavior and offline reload behavior. Foldable profiles generate cover and unfolded viewport dimensions. `dark` generates light and dark runs; `landscape` generates portrait and landscape runs.

The `font`, `keyboard` and `zoom` web conditions are approximations: CSS font scaling, form focus and CSS zoom. They are not system font scaling, a native software keyboard or OS display scaling. Fold posture is not tested in a browser. Every case is labelled `browser-viewport-simulation`; none is described as a physical-device pass.

## Android Device Lab evidence

Connect an authorized Android phone or emulator with ADB. Multiple devices require an explicit serial. An application is only launched when `--launch` is present:

```bash
paxi doctor lab android-devices
paxi doctor lab android --package com.example.app
paxi doctor lab android --package com.example.app --launch --conditions font,landscape,dark,keyboard,zoom,offline
paxi doctor lab history
```

The runner records the selected device/emulator, Android release/API, model, resolution, density, a screenshot, and a UI hierarchy with text and content-description attributes removed. The screenshot can still show personal information; review it before sharing. `paxi doctor lab compare <before-run-id> <after-run-id>` compares same-runner browser statuses and issue codes or Android snapshot metadata. It does not calculate pixel-level image differences.

Android conditions are observational. PAXI reads available system indicators but does not change orientation, font scale, theme, keyboard, display scaling or network radios. Change the condition manually in Android settings and rerun to capture that state. Foldable hinge/posture testing is not yet available. Physical devices and emulators are labelled separately.

## C/C++ adapter

`paxi doctor cpp --project .` checks for C/C++ compilers and common build/test tools, and detects CMake, Make, Meson and Ninja markers without executing project build scripts.

For a CMake project only, after reviewing `CMakeLists.txt` and included build configuration, a developer may explicitly authorize a local debug build:

```bash
paxi doctor cpp --project . --build --confirm
```

The default generated build directory is outside the source tree under the PAXI configuration directory. `--build-dir` can override it, but PAXI rejects a build directory inside the project. CMake configuration and compilation execute project-controlled commands; `--confirm` is mandatory. Automatic CTest execution is not enabled in this increment.

## Adaptive project learning

Learning is opt-in and explicit. `paxi doctor profile learn --project .` inspects a bounded set of local source files and stores summaries such as package manager, formatter, test/UI tooling, quote style, indentation and semicolon conventions. It does not save source text, credentials, absolute project paths or runtime keystrokes.

```bash
paxi doctor profile show
paxi doctor profile learning off
paxi doctor profile learning explicit
paxi doctor profile learn --project .
paxi doctor profile forget --project .
paxi doctor profile clear-learning --confirm
```

The global developer preference profile remains separate from per-project convention summaries. `learning off` prevents new learning operations. Users can forget one project or clear all learned project summaries.

## Codex MCP connection

PAXI provides a local stdio MCP server supporting stateless MCP `2026-07-28` (`server/discover` and per-request `_meta`) and legacy initialize-based `2025-11-25`. It exposes only read-only tools: inspect a project, read local Doctor preferences, create a Device Lab plan, and check C++ toolchain availability. It does not expose arbitrary shell execution, file writes, builds, patch application, deployment or signing.

```bash
paxi doctor codex
paxi doctor codex setup
paxi doctor codex status
```

Setup registers the local server using Codex CLI's MCP support. The equivalent manual registration is:

```bash
codex mcp add paxi-doctor -- paxi mcp
codex mcp list
```

The Codex CLI must already be installed and signed in. MCP tools remain limited to the capabilities listed above. Read-only tool exposure is not a substitute for reviewing the assistant's recommendations.

## Approved patch workflow

Codex or another tool may prepare a unified Git patch for human review. PAXI validates the patch against a clean repository before application:

```bash
paxi doctor patch review ./doctor-fix.patch --project .
paxi doctor patch apply ./doctor-fix.patch --project . --confirm
paxi doctor patch apply ./doctor-fix.patch --project . --confirm --run-tests
```

The working tree must be clean, the patch must pass `git apply --check`, and symlink, submodule and binary patches are rejected. `--confirm` is required to change files. `--run-tests` explicitly runs the detected package-manager test script after application; project tests are executable project-controlled code. A failed test does not trigger an automatic revert: inspect `git diff` and decide whether to keep or reverse the patch. PAXI does not generate AI patches automatically in this increment.

## Evidence and limitations

- Browser viewport, Android emulator and physical Android evidence are distinct.
- Device Lab run history stores a protected local JSON archive for the most recent 30 runs; comparison requires matching runner and execution type.
- No iPhone runtime testing is available from Android/Termux; native iOS runtime and simulator testing still require macOS/Xcode or a physical iPhone environment.
- C/C++ CMake build is opt-in; Make/Meson/Ninja build orchestration is not yet enabled.
- React is tested in a browser, but this is not a complete React component test harness or visual design critic.
- The MCP tools are deliberately read-only. A future approved code-fix workflow can use the patch review commands but is not automatically exposed as a Codex tool.
- The current project-learning command infers only project conventions; it does not record user behavior or continuously monitor the workspace.
- Website reports may contain target URLs and diagnostic text. Keep report directories private, especially when testing authenticated pages.


Protocol references: [MCP 2026-07-28 discovery schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/discover.mdx) and [Codex CLI MCP command reference](https://learn.chatgpt.com/docs/cli/reference#codex-mcp).
