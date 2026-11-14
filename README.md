# PAXI DevKit

A local-first developer terminal for Android, Windows desktop and iOS project work. PAXI gives you direct commands plus an interactive dashboard. It runs the build and test tools already installed on your device, AI is optional, and Git uses your own credentials.

PAXI is not an IDE or an SDK. It only accepts a build result when the output is fresh from the current build and passes the artifact checks. It can also draft test scripts for you to review, analyse screenshots with a multimodal model you configure, and tap only a short allowlist of navigation controls during an exploration you confirm.

## What's new

- **2.7.0:** security testing. Adapters for Gitleaks, Semgrep, Trivy and Slither, APK manifest and signature checks, website security-header review, and a paired-account API authorization test.
- **2.6.0:** CMake/CTest runs in a throwaway temp folder, local Jest runs for Expo/React Native (no `npx`, no downloads), a 24-case diagnosis test set with hard negatives, temporary PostgreSQL/MySQL/MariaDB test workflows, and saved browser-matrix results.
- **2.5.0:** application investigations that link evidence together, with stable event IDs, report hashes, timelines, evidence-coverage scores, and Agent suggestions for missing telemetry.
- **2.4.0:** optional, confirmation-gated project test runs in environment certification. Read-only is still the default.
- **2.1.1:** fixed the Android/Termux launcher path, and added SQL Server test migrations, full SPDX license rules, local SBOM schema checks and axe-core accessibility audits.

Older releases are listed in [CHANGELOG.md](CHANGELOG.md).

## Product rules

- **Local-first:** Android, Windows desktop and project test workflows run on your machine. iOS IPA builds require a Mac with Xcode and local signing configured.
- **No forced cloud build:** PAXI does not silently upload source code or switch to a hosted builder.
- **AI is optional:** choose a local model, an API model, or off. Core CLI, build, test and Git commands work with AI disabled.
- **AI key safety:** API keys can be stored in a passphrase-encrypted AES-256-GCM vault or provided through provider-specific environment variables; plaintext keys are never written to PAXI config and are removed from child-process environments.
- **Human approval:** remote AI prompts require an interactive approval or `--allow-remote`. PAXI redacts common credential patterns including common JWT/API-token/private-key and signed-URL forms first, but redaction is best-effort and is not a guarantee that all secrets will be found.
- **Plugin opt-in:** local plugins do not run until you trust them. Trust is bound to the file's SHA-256 hash; changing the code invalidates its approval.
- **No backend required:** configuration and build history stay local. No Supabase account, server, database or cloud build service is required.

## Project creator, credits and support

Created by **Adewunmi**, a developer and LASU Data Science student, on **November 11, 2026**. ChatGPT helped as the AI development team, and Manus helped with review and terminal testing. The work is offered to **Paxi Innovation Limited** to support its continued work. This is a statement of intent only. It does not change the MIT license and is not, on its own, a legal transfer of intellectual-property rights.

### Support the project

Donation details are on the company website: <https://paxitoken.netlify.app/>. You can also follow PAXI on X: <https://x.com/Pax_i_Token>. Please get payment details only from the official website.

See [the full credits and support note](docs/CREDITS_AND_SUPPORT.md) for the contribution intent and license clarification.

## Requirements

- Node.js 20, 22 or 24 (Node.js 20 or newer is the supported runtime baseline).
- Git.
- Android Gradle builds: JDK, Android SDK/build-tools, and a project Gradle wrapper (recommended) or compatible system Gradle.
- Flutter builds: Flutter/Dart SDK and the compatible Android host toolchain.
- iOS IPA builds: macOS, Xcode command-line tools, iOS platform SDKs, signing certificates and provisioning configuration.
- Windows desktop Flutter builds: Windows 10/11, Flutter, Visual Studio (not VS Code) with the Desktop development with C++ workload, and a Windows SDK. See the [official Flutter Windows setup](https://docs.flutter.dev/platform-integration/windows/setup).
- Optional AI: PAXI AI Studio supports OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Alibaba Qwen, Moonshot Kimi, Zhipu GLM, custom HTTPS gateways, and local Ollama/llama.cpp runtimes. The local model runtime is installed separately.

## Installation

### npm global installation

After `@paxi/devkit` is published to npm:

```bash
npm install --global @paxi/devkit
paxi version
paxi doctor
```

The npm package is not published as part of this source release. Until an npm release is published, install from the public GitHub source repository or the signed/checksummed release ZIP. This npm-global path is for desktop Unix/Windows hosts; Android/Termux users should use the Termux procedure below, which installs the Android-native launcher.

To install directly from a public GitHub repository before npm publication:

```bash
npm install --global "github:YOUR_GITHUB_USERNAME/YOUR_REPOSITORY"
paxi version
```

### Android / Termux ZIP installation

```bash
pkg update -y
pkg install nodejs-lts unzip
# Optional: install Python 3 for SQLite migration and SBOM schema checks
# pkg install python
termux-setup-storage

cd ~/storage/downloads
unzip -o paxi-devkit-v2.7.0.zip -d ~/projects
cd ~/projects/paxi-devkit-v2.7.0
bash scripts/install-termux.sh
```

The Termux installer relocates a shared-storage checkout into Termux's private home before creating an Android-native shell launcher at `$PREFIX/bin/paxi`. It calls the exact Node executable found in the current Termux PATH and no longer relies on npm's `/usr/bin/env node` shim. PAXI reports its version from package metadata and the installer stores versioned releases separately. Do not run `npm link` from `~/storage/downloads` because Android shared storage is mounted without normal executable permissions.

### Windows PowerShell installation

1. Install Node.js 20 or newer and Git for Windows.
2. For Android builds, install a JDK and Android SDK. For Windows desktop Flutter builds, install Visual Studio (not Visual Studio Code) and select **Desktop development with C++**, including a Windows SDK.
3. Extract the PAXI source ZIP, open PowerShell in the extracted folder, and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\install-windows.ps1
paxi version
paxi doctor --json
```

The installer uses npm to install PAXI globally from the local source folder. It does not download Flutter, Java, Android SDKs, Visual Studio or Windows SDKs. If PowerShell cannot find `paxi` immediately after installation, add the npm global prefix printed by the installer to your user PATH and open a new terminal.

### macOS installation

Install Node.js 20 or newer and Git, then install PAXI from the extracted source folder with `npm install --global .`. Install Xcode separately for iOS IPA builds; install a JDK and Android SDK separately for Android builds.

### First GitHub upload and public release

For a first-time public repository setup from Termux, follow [docs/RELEASE_RUNBOOK.md](docs/RELEASE_RUNBOOK.md). It covers source validation, secret review, SSH authentication, the first push, GitHub Actions, release assets, checksums, and installing the published source from Termux. [docs/FIRST_GITHUB_PUSH.md](docs/FIRST_GITHUB_PUSH.md) remains as the command-by-command first-push reference.

Before announcing a release, review [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [production launch checklist](docs/RELEASE_CHECKLIST.md). Never commit API keys, Android keystores, signing passwords, local configuration, or generated build output.

### Development installation

After downloading/extracting `paxi-devkit-v2.7.0.zip` into Termux-private storage or a normal desktop project folder:

```bash
cd paxi-devkit-v2.7.0
npm ci
npm test
npm run check
```

On Termux, install the command with `bash scripts/install-termux.sh`; do not run `npm link`. On Linux/macOS development hosts, `npm link` may be used when you need a global symlink for iterative local development.

Git clone instructions will be supplied with the published repository URL; no uncreated GitHub remote is embedded in this release.

For Termux prerequisites, run `bash scripts/termux-bootstrap.sh`. It installs Java 21, Gradle, AAPT2, ADB and native build tools. Install a compatible ARM64 Flutter/Android SDK toolchain separately, finish its post-install step, and check it with `flutter doctor -v`. The community-maintained Flutter-for-Termux port documents Android ARM64 APK builds, but support is specific to that toolchain, so test it on your own device. See `docs/TERMUX_ANDROID.md`.

For AI provider setup, key storage, model downloads and per-task routing, see [PAXI AI Studio V0.9.0](docs/AI_STUDIO_V0.9.0.md). For architecture maps, feedback adaptation and AI budgets, see [Agent Engine V1.2.0](docs/AGENT_ENGINE_V1.2.0.md).

## PAXI Doctor V2.1.1: Termux runtime repair and stronger QA assurance

V2.1.1 fixes the Termux global command launcher. The old npm-created command could try to execute `/usr/bin/env node`, which is not available at that path on Android. The Termux installer now creates `$PREFIX/bin/paxi` with an Android `/system/bin/sh` wrapper and calls the exact Node executable resolved from the current Termux PATH. It safely quotes the installed CLI path, refuses to overwrite unrelated commands, and checks the launcher version before reporting success. Run the installer using `bash scripts/install-termux.sh`. After installation, run `hash -r` (or open a new Termux session), then verify with `paxi version` and `paxi doctor --json`.

The database service lab now supports SQL Server through `sqlcmd` in addition to PostgreSQL, MySQL and MariaDB. SQL Server access is loopback-only; credentials are passed through `SQLCMDPASSWORD`, a temporary login is restricted to the generated database, migrations are screened for SQLCMD directives/server-level commands/external access, and cleanup is reported. Use only a disposable local SQL Server service, never a production administrator account.

The SBOM license evaluator parses SPDX `AND`, `OR`, parentheses, `WITH`, `LicenseRef` and `DocumentRef` expressions. `AND` is cumulative, `OR` is treated as a choice, and `WITH` exceptions require approval through `allowExceptions`. Optional paired SPDX License List and Exception List snapshots enable canonical membership/deprecation checks with matching versions and SHA-256 pins.

`paxi doctor security sbom-schema` runs Python `jsonschema` against a locally supplied schema snapshot. It blocks non-local `$ref` values and supports a schema SHA-256 pin. You are responsible for getting and approving the official schema snapshot and its version.

`paxi doctor website accessibility` runs axe-core with locally installed Playwright across the compact, standard, large, foldable and tablet browser viewport profiles. It requires confirmation, restricts requests to same-origin GET/HEAD and requires HTTPS and your consent for remote targets. Automated axe results are not complete WCAG certification; manual assistive-technology and physical-device checks remain necessary.

Examples:

```bash
# SQL Server: dedicated local test server only
export PAXI_TEST_SQLSERVER_ADMIN_URL='mssql://test_admin:password@127.0.0.1:1433/master'
paxi doctor database lab --engine sqlserver --project . --migrations migrations --confirm
# Only for a local disposable SQL Server using a self-signed local certificate:
# export PAXI_TEST_SQLSERVER_TRUST_SERVER_CERTIFICATE=1

# Official JSON Schema validation (install jsonschema in a Python venv first)
paxi doctor security sbom-schema --file ./paxi-sbom.cdx.json --schema ./cyclonedx.schema.json --schema-sha256 <sha256>

# SPDX policy with pinned registry snapshots
paxi doctor security licenses --sbom ./paxi-sbom.cdx.json --policy ./license-policy.json \
  --license-list ./spdx/licenses.json --exception-list ./spdx/exceptions.json \
  --license-list-sha256 <sha256> --exception-list-sha256 <sha256>

# Browser accessibility on a local staging site
paxi doctor website accessibility --url http://127.0.0.1:4173 --profiles compact,standard,tablet --browser chromium --confirm
```

See [V2.1.1 release notes](RELEASE_NOTES.md), [technical architecture](docs/DOCTOR_V2.1.1.md) and [remaining-work ledger](docs/REMAINING_WORK_V2.1.1.md).

## PAXI Doctor V1.6.0

See [Doctor V1.6.0](docs/DOCTOR_V1.6.0.md) for opt-in distributed trace context, backend log inspection, cross-layer defect correlation, regression drafting and verified-fix learning.

## PAXI Doctor V1.4.0

See [Doctor V1.4.0](docs/DOCTOR_V1.4.0.md) for OpenAPI JSON contract inspection, read-only API smoke tests and static SQL migration safety review. API calls require your confirmation; remote targets also require HTTPS and `--allow-remote`. SQL migration review never connects to a database or executes migrations.

## PAXI Doctor V1.3.0

See [Doctor V1.3.0](docs/DOCTOR_V1.3.0.md) for pixel-level visual regression, screenshot baselines, runtime health probes and cross-language static security scanning. See [Agent Engine V1.2.0](docs/AGENT_ENGINE_V1.2.0.md) for static architecture analysis, project feedback adaptation and AI budget controls.

## PAXI Doctor V1.0.0

See [Doctor V1.0.0: Adaptive diagnosis and approved repair](docs/DOCTOR_V1.0.0.md) for automatic task routing, log diagnosis, safe test command preview, AI patch draft boundaries, review and approval steps.

## PAXI Doctor V2.6.0: CMake, React Native and integration certification

V2.6.0 adds an opt-in CMake/CTest test adapter. When a `CMakeLists.txt` declares `enable_testing()` or `include(CTest)`, PAXI configures and builds the project in a disposable temporary directory, discovers tests before building, refuses to report success when zero tests are registered, runs CTest and removes temporary build output. The configure/build/test sequence shares one timeout. Run it only after reviewing the project's CMake configuration:

```bash
paxi doctor certify --project .
paxi doctor certify --project . --run-tests --confirm --timeout 1800 --json
```

Expo and React Native projects without a `scripts.test` can use a locally installed Jest package when a Jest config is present. PAXI resolves the local Jest entry point and runs it with the current Node executable; it never invokes `npx` or downloads a missing test package. A missing local Jest package is reported as `tool-missing`. Existing package test scripts continue to use the detected package manager and are labeled with their correct framework identity.

The rule-based diagnosis benchmark now uses 24 synthetic cases, including service connection, disk-space, port-conflict, parser, JVM bytecode and TLS certificate failures plus benign hard negatives. Its metrics describe only rule-based signature matching, not AI model quality or real-world incident accuracy.

New hosted workflows run disposable PostgreSQL 16, MySQL 8.4 and MariaDB 11 migration labs and retain database JSON reports after asserting migration replay and cleanup. The browser matrix uploads TAP evidence for Chromium, Firefox and WebKit. These workflows are configured but do not count as hosted passes until pushed and run on GitHub Actions. SQL Server remains a live-environment acceptance item.

See [V2.6.0 architecture](docs/DOCTOR_V2.6.0.md), [remaining-work acceptance gates](docs/REMAINING_WORK_V2.6.0.md) and [test results](docs/TEST_RESULTS_V2.6.0.md).

## PAXI Doctor V2.5.0: evidence-linked application investigation

V2.5.0 combines API, website, runtime, backend trace/span, Android, database, security and visual evidence into an investigation record. `paxi doctor correlate` adds source-report SHA-256 fingerprints, stable event IDs, timestamp timelines, evidence-coverage recommendations and grouped investigation cases. A shared W3C trace ID is a context link, not proof of causation; route-only groups are marked low-confidence because separate requests may use the same route. Sensitive strings are redacted during extraction, and reports do not include absolute input paths or raw response bodies.

The Agent Engine consumes these evidence gaps and prepares review-required steps for missing backend spans/logs, trace propagation, database spans, browser reproductions and Android feature assertions. It remains plan-only. Website regression drafts may suggest checks from known issue codes, but selectors and expected business behavior must be supplied and reviewed by the developer.

```bash
paxi doctor correlate \
  --report ./api-report.json \
  --report ./website-report.json \
  --report ./backend-spans.json \
  --output ./investigation.json

paxi doctor agent plan --project . \
  --evidence ./api-report.json \
  --evidence ./website-report.json \
  --evidence ./backend-spans.json

paxi doctor regression draft --targets api,website,android \
  --plan ./reviewed-api-plan.json \
  --evidence ./investigation.json \
  --output ./regression-draft.json
```

See [V2.5.0 technical architecture](docs/DOCTOR_V2.5.0.md) and [remaining-work acceptance gates](docs/REMAINING_WORK_V2.5.0.md).

## PAXI Doctor V2.4.0: approved test execution and certification

`paxi doctor certify --project .` inventories local tool and package availability without running project code. It distinguishes detected test commands from executed tests and reports CI workflow files as configuration only, not as successful hosted runs. `paxi doctor benchmark diagnosis` runs a small offline synthetic benchmark for rule-based log-signature classification and reports accuracy, precision, recall and F1. These scores do not measure LLM reasoning, root-cause accuracy or patch success.

Certification remains read-only by default. To execute the detected project test command, inspect the preview first, then confirm: `paxi doctor certify --project . --run-tests --confirm`. The runner reports process status separately from evidence completeness, redacts captured output, enforces a configurable timeout and returns a non-zero exit when tests fail, time out, are unavailable or evidence is incomplete. Project test scripts are project-controlled code and may perform actions available to the current OS user. See [the V2.4.0 certification guide](docs/DOCTOR_V2.4.0.md).

Test and native scanner reports now expose output truncation. A test process can exit successfully while its captured output remains incomplete; such a result is marked `passed-output-truncated` with `evidenceComplete: false`. A vulnerability scanner with truncated JSON output is always marked `incomplete-output`, never clean or complete.

## Commands

```bash
# Interactive dashboard
paxi dev

# Environment and project information
paxi doctor certify --project .
paxi doctor benchmark diagnosis
paxi doctor
paxi doctor --json
paxi setup
paxi preflight
paxi preflight --offline
paxi env --json
paxi cache status
paxi detect
paxi detect . --json

# Local Android builds (APK or AAB)
paxi build --platform android --format apk --debug
paxi build --platform android --format aab --release
paxi build --platform android --format apk --debug --install
paxi build --platform android --format apk --debug --timeout 3600
paxi build --platform android --format apk --debug --offline

# Validate output packages and list connected Android devices
paxi verify ./build/app/outputs/flutter-apk/app-debug.apk
paxi verify ./build/app/outputs/flutter-apk/app-debug.apk --strict
paxi devices

# Project tests
paxi test
paxi test --project ./path/to/project --timeout 900
paxi test --offline

# Install the most recent successful local APK, or a chosen APK
paxi install
paxi install ./build/app/outputs/flutter-apk/app-debug.apk
paxi install ./build/app/outputs/flutter-apk/app-debug.apk --device <serial>
paxi install ./build/app/outputs/flutter-apk/app-debug.apk --strict  # require signature and package metadata

# Local build history
paxi builds
paxi builds --json
paxi builds --failed
paxi builds --project ./path/to/project
paxi builds --clean  # clears history only; does not delete artifacts/logs
paxi builds --diagnose <build-id>

# Git workflows: uses your configured Git credential helper / SSH agent
paxi git status
paxi git add .
paxi git commit -m "Build feature"
paxi git push
paxi git pull

# Optional AI
paxi ai setup
paxi ai configure --mode off
paxi ai configure --mode local --url http://127.0.0.1:8080
paxi ai configure --mode api --url https://api.example.com/v1 --model model-name
paxi ai doctor
paxi ai explain "paste a build error here" --project .
paxi ai explain "paste a build error here" --no-profile

# See docs/AI_STUDIO_V0.9.0.md for provider keys, model routing and local downloads.

# Local plugins
paxi plugin list
paxi plugin trust hello-world  # type TRUST at the prompt, or add --yes after reviewing the source
paxi plugin run hello-world
paxi plugin revoke hello-world
paxi plugin disable-all
paxi plugin enable-all

# Sanitized support ZIP (review it before sharing)
paxi support-bundle

# Update check / self-update after the npm package is published
paxi update --check
```

### Test command behavior

- Flutter projects run `flutter test`.
- Android Gradle projects with an `app/` module run `testDebugUnitTest`; plain Java/Kotlin Gradle projects run `test`.
- Node.js projects run `npm test` only when `package.json` defines a test script.

Instrumentation tests that require a physical device or emulator are not automatically started by `paxi test`.

### APK installation

`paxi verify <artifact>` checks APK/AAB/IPA ZIP structure, rejects unsafe archive paths, validates compressed-entry CRCs (when `unzip` is installed), and calculates SHA-256. The report distinguishes structural validity, signing, APK installability and platform validation. Use `--strict` to require platform tools: APK requires `apksigner` plus `aapt2`; AAB requires `bundletool` validation (bundle signing is reported separately); IPA requires macOS, `codesign`, `plutil`, a valid `Payload/*.app/Info.plist`, an embedded provisioning profile, bundle identifier and minimum iOS version metadata. Without strict mode, missing optional tools are reported as warnings and are not described as full platform verification.

`paxi devices` lists authorized and unauthorized ADB devices. `paxi install` uses the most recent successful APK in local build history or a supplied APK path. With one authorized device, it installs automatically; with multiple devices, pass `--device <serial>`. Installation verifies the APK archive first, compares the most recent build's recorded SHA-256 to detect later file changes, and refuses a signature that `apksigner` reports as invalid. `paxi build ... --install` builds and installs an APK in one step. AAB files cannot be installed directly with `adb install`; they are distribution bundles.

### Build reliability, timeouts and logs

- Android build output is snapshotted before a build. PAXI only accepts newly created or changed artifacts, prefers the exact expected output path and refuses ambiguous multiple outputs. Old APK/AAB files are never silently reused as the result of a new build.
- Builds default to a 45-minute timeout; tests default to 15 minutes. Override with `--timeout <seconds>`, for example `paxi build --timeout 3600` or `paxi test --timeout 1200`. Ctrl+C is forwarded to the child process; POSIX process groups are terminated together.
- Build and test output is retained in the project-local `.paxi/logs/` directory; add `.paxi/` to your project's `.gitignore` if it uses Git. Failure output includes a recent log tail and the full log path.
- Build history includes a unique build ID, PAXI/Node/host/toolchain versions, command arguments, online/offline mode, artifact hash, verification level and log path. Use `paxi builds --diagnose <build-id>` to inspect a specific record and recent log tail. `paxi builds --clean` clears only history records; it does not remove build artifacts or logs.

## Offline builds and local caches

PAXI supports offline dependency resolution for Android builds and supported test workflows. Offline mode is only reliable after the project's exact Gradle Wrapper distribution, Gradle dependencies, Flutter SDK artifacts and Dart/Pub packages have already been cached while online. The first build may still need the network to obtain missing components.

Prepare a Flutter Android project while connected:

```bash
flutter precache --android
flutter pub get
cd android
./gradlew --version
./gradlew assembleDebug
cd ..
```

Then inspect the local state and run offline:

```bash
paxi cache status
paxi preflight --offline
paxi build --platform android --format apk --debug --offline
paxi test --offline
paxi doctor --json --offline --project .
```

For a native Gradle project, PAXI passes Gradle's `--offline` option. For Flutter, it resolves Dart packages with `flutter pub get --offline`, then builds with `--no-pub`; PAXI also supplies a temporary Gradle user-home that reuses the existing wrapper/dependency caches and sets Gradle's offline start parameter. Missing Gradle Wrapper distributions are detected before invoking the build. Gradle and Pub offline modes use local caches and fail when a required dependency is absent; they cannot fetch files that were never cached. See the [Gradle dependency cache/offline documentation](https://docs.gradle.org/current/userguide/dependency_caching.html) and [Dart Pub offline documentation](https://dart.dev/tools/pub/cmd/pub-get#offline).

Offline dependency mode is not a network sandbox: project Gradle scripts or third-party build hooks could still make their own network calls. PAXI does not promise a fully network-isolated process. Offline iOS builds are not enabled in this release. Windows release ZIPs are structurally verified but PAXI does not yet perform Authenticode verification. Windows desktop offline builds require the Pub cache and Windows engine artifacts to be prepared first with `flutter pub get` and `flutter precache --windows`.

Cache inspection and cleanup:

```bash
paxi cache status --json
paxi cache clean --gradle --confirm
paxi cache clean --flutter --confirm
paxi cache clean --project --confirm
```

Cleanup is explicit and destructive. The Gradle Wrapper distribution directories and Flutter SDK artifacts are preserved; `--gradle` removes Gradle dependency/build caches, `--flutter` removes the Pub cache, and `--project` removes generated build state for the current project. Do not clean caches when you need to remain offline.

## PAXI Doctor: adaptive project intelligence, Device Lab and security review (V1.4.0)

PAXI Doctor adds to the DevKit limited source inspection, website/browser checks, real Android device snapshots, C/C++ toolchain preflight, opt-in project-convention learning, optional Codex MCP access, reviewed Git patch application, pixel-level PNG visual regression, runtime health probes, cross-language static security review, OpenAPI contract inspection, safe API smoke tests and SQL migration safety review. The existing `paxi build`, `paxi test`, `paxi doctor`, `paxi detect`, offline build and install commands work as before.

#### V1.4.0 additions

- `paxi doctor api spec --file ./openapi.json` inspects OpenAPI 3.x or Swagger 2.0 JSON without contacting the service. It checks operations, responses, duplicate operation IDs, local references and path parameters. YAML must be converted to JSON; external references are not fetched.
- `paxi doctor api test --file ./api-tests.json --confirm` runs a limited API smoke plan with GET/HEAD only. Non-loopback targets require HTTPS and `--allow-remote`. Optional bearer credentials come from an environment-variable name in the plan; token values and response bodies are not retained. This is not load testing.
- `paxi doctor database scan --project .` reviews SQL migration files offline for destructive DDL, unbounded data changes, column/type changes and selected lock/privilege risks. It never connects to a database or executes a migration.

#### V1.3.0 additions

- `paxi doctor visual compare <baseline.png> <current.png>` compares supported PNG screenshots. The comparator does not support palette/grayscale, 16-bit or interlaced PNG files; convert them to 8-bit RGB/RGBA first.
- `paxi doctor runtime probe --url http://127.0.0.1:8080/health` performs a limited GET/HEAD health probe. Remote endpoints require HTTPS plus `--allow-remote`. It does not send authorization headers, follow redirects or retain response bodies. It can report database/cache dependencies only when the health endpoint itself exposes safe status labels.
- `paxi doctor security scan --project .` performs a read-only static pattern review across supported source languages. Findings are heuristics, not a penetration test or formal audit.
- `paxi doctor security npm-audit --project . --online --confirm` contacts the npm registry and summarizes current npm advisory metadata for a project with regular `package.json` and `package-lock.json` files.

### Inspect project families

```bash
paxi doctor inspect --project .
paxi doctor diagnose --project . --log ./build.log --ai
paxi doctor agent status
paxi doctor agent plan --project . --log ./build.log
paxi doctor agent plan --project . --screenshot ./screenshots/home.png --ai
paxi doctor agent memory remember --note "Use existing state manager; avoid new dependencies"
paxi doctor agent memory show
paxi ai recommend --task "Debug this Android Gradle build failure"
paxi doctor test --project .
paxi doctor test --project . --confirm
paxi doctor patch draft --project . --description "Fix the settings null state" --files src/settings.tsx
paxi ai ask --auto "Diagnose this Gradle compilation error"
paxi doctor inspect --project . --json
paxi doctor cpp --project . --json
paxi doctor journey example
paxi doctor journey draft --goal "tap Settings, then verify About is visible" --output ./journey.json
paxi doctor journey validate ./journey.json
paxi doctor journey run --file ./journey.json --package com.example.app --launch
```

Inspection recognises websites and React/Next.js/Vite, C/C++ and CMake, Python, Node.js, Java/Kotlin, Swift, PHP, Go, Rust, Solidity and other project markers. Detection is not a promise that every language has a builder; the C/C++ adapter adds compiler/toolchain preflight and opt-in CMake builds only.

### Plain-language journeys, Vision and safe Android exploration (V0.8.0)

```bash
# Convert a plain-language navigation goal into a journey JSON draft
paxi doctor journey draft --goal "tap Settings, then verify About is visible" --output ./journey.json
paxi doctor journey validate ./journey.json

# Review a screenshot with a configured multimodal AI model
paxi doctor vision analyze ./screenshots/home.png

# Explore only safe navigation controls from the current app screen
paxi doctor explore --package com.example.app --launch --confirm --max-actions 5
```

Journey drafting is a rule-based parser, not a claim that an LLM understood or completed the whole requirement. It generates exact accessible text selectors for simple instructions; review labels before running. It refuses goals that mention authentication, submissions, payments, wallet/transfer or destructive actions. It never generates text-entry steps.

Vision requires an OpenAI-compatible **multimodal** model. Local mode sends the screenshot only to the configured loopback server. API mode sends the unredacted screenshot image to the remote provider and requires an interactive approval or `--allow-remote`; screenshots are not redacted and may contain private account information. `--with-profile` optionally includes local developer-preference metadata; the API-mode consent prompt names that extra metadata transfer. AI visual findings are hypotheses to review, not a proof of functionality or accessibility.

Android safe exploration requires `--confirm`. It inspects the initial accessibility hierarchy and taps at most 1–8 exact allowlisted navigation labels (`Home`, `Dashboard`, `Settings`, `Profile`, `About`, `Help`, `Discover`, `Activity`, `Assets`, `Me`, `Menu`), then uses Android Back and verifies the original screen signature before continuing. It never types, taps unknown controls, grants permissions, pays, transfers, submits, deletes or changes app data. It is kept shallow on purpose and does not claim app-wide coverage. Screenshot evidence may contain private content; inspect it before sharing.

### Website / React Device Lab

Install Playwright explicitly in the project and start the website yourself. PAXI never runs the project's start script or installs browser packages automatically.

```bash
npm install --save-dev playwright
npx playwright install chromium
npm run dev -- --host 127.0.0.1  # in a separate terminal
paxi doctor lab run --project . --url http://127.0.0.1:5173 \
  --profiles compact,standard,large,foldable,tablet \
  --conditions font,landscape,dark,keyboard,zoom,offline
paxi doctor lab history
paxi doctor lab compare <before-run-id> <after-run-id>

# Save a reviewed visual baseline (only after you inspect the current website screenshots)
paxi doctor lab run --project . --url http://127.0.0.1:5173 --baseline-dir ./visual-baselines --update-baseline --confirm

# Compare current runs to the saved visual baseline
paxi doctor lab run --project . --url http://127.0.0.1:5173 --baseline-dir ./visual-baselines
paxi doctor visual compare ./visual-baselines/standard-default-portrait-light.png ./current.png

# Probe a local API/backend health endpoint (GET/HEAD only)
paxi doctor runtime probe --url http://127.0.0.1:8080/health

# API contract and backend smoke review
paxi doctor api spec --file ./openapi.json
paxi doctor api test --file ./docs/examples/api-smoke-plan.json --confirm
paxi doctor database scan --project .

# Static security review; no network or project code execution
paxi doctor security scan --project .

# Explicit online npm advisory audit (contacts the npm registry)
paxi doctor security npm-audit --project . --online --confirm
```

The browser runner checks page errors, console errors, failed transport requests, failed HTTP responses (including fetch/XHR API 4xx/5xx), horizontal overflow, title/viewport metadata, image alternative text and accessible button names. It saves screenshots and JSON evidence per case. `history` lists recent runs; `compare` reports changed cases, resolved/introduced issue codes, improved/regressed status, and pixel-level screenshot differences when evidence is available. The PNG comparator supports 8-bit RGB/RGBA non-interlaced screenshots; it reports changed-pixel percentage and bounds, not a rendered diff overlay. Baseline replacement requires both `--update-baseline` and `--confirm`; inspect screenshots before approving a baseline update. `font`, `keyboard` and `zoom` are CSS-level approximations; foldable profiles simulate cover/unfolded viewport sizes. Every run is labelled `simulated-browser-viewport`, not a real-device result.

### Android phone / emulator evidence

```bash
paxi doctor lab android-devices
paxi doctor lab android --package com.example.app --conditions font,landscape,dark,keyboard,zoom,offline
paxi doctor lab android --package com.example.app --launch --device <adb-serial>
paxi doctor lab history
paxi doctor lab compare <before-run-id> <after-run-id>
```

An authorized ADB phone or emulator is required. The runner records model, Android release/API, resolution, density, orientation, available system indicators, a screenshot and a UI hierarchy with text/content descriptions stripped. Launching an app requires `--launch`. Conditions are observational; PAXI does not change system settings. Screenshot evidence may include private information, so inspect before sharing. Foldable hinge posture is not yet tested.

### C / C++ toolchain

```bash
paxi doctor cpp --project .
paxi doctor cpp --project . --build --confirm
```

Preflight detects common compilers and CMake/Make/Meson/Ninja tools. Only CMake builds are orchestrated in this release. They run outside the source directory and require `--confirm` because project CMake configuration is executable code. CTest, Make and Meson build orchestration remain future adapters.

### Adaptive developer learning

Learning is opt-in. PAXI stores only short summaries of project conventions (not source text, credentials or keystrokes) and keeps global preferences separate from learned project conventions. AI explanations and model prompts use those local preferences and the matching learned project summary by default; no source code is included. `--no-profile` excludes that metadata. Use `--project <dir>` to select the project, or `--no-profile` to omit all adaptation metadata.

```bash
paxi doctor profile show
paxi doctor profile set guidance step-by-step
paxi doctor profile learning explicit
paxi doctor profile learn --project .
paxi doctor profile forget --project .
paxi doctor profile clear-learning --confirm
paxi doctor profile learning off
paxi ai explain "Explain this build error" --project .
paxi ai explain "Explain this build error" --no-profile
```

### Codex MCP bridge and reviewed patches

The local MCP bridge exposes read-only tools for project inspection, preferences, Device Lab plans and C++ preflight. It supports the current stateless MCP protocol and the prior initialize-based protocol. Codex CLI registration is optional:

```bash
paxi doctor codex setup
paxi doctor codex status
# Manual equivalent:
codex mcp add paxi-doctor -- paxi mcp
codex mcp list
```

AI-generated changes are not applied by the MCP bridge. A separately reviewed unified Git patch may be checked and then applied only with explicit confirmation:

```bash
paxi doctor patch review ./doctor-fix.patch --project .
paxi doctor patch apply ./doctor-fix.patch --project . --confirm --run-tests
```

The patch workflow requires a clean Git working tree, rejects binary/symlink/submodule diffs, uses `git apply --check`, and never automatically reverts a failed test. Review `git diff` after application. This is not an OS sandbox; project build/test commands can execute code with the current user's permissions.

Preferences, presets, learning summaries and report history are stored locally under `~/.config/paxi` (or `$XDG_CONFIG_HOME/paxi`) with restrictive file permissions. No Supabase service, hosted test worker or cloud source upload is required. The MCP toolset is read-only. `paxi doctor lab compare` compares browser issue/status reports and compatible browser screenshots; Android snapshot comparison remains metadata-based and does not imply cross-device pixel equivalence. Real iOS runtime tests still require macOS/Xcode or a physical iOS testing environment; Android does not emulate native iOS behavior.

## Diagnostics and readiness

```bash
paxi setup
paxi doctor --json
paxi preflight --offline --json
paxi env --json
paxi support-bundle --project .
paxi builds --diagnose <build-id>
```

`paxi setup` and `paxi doctor --fix` print step-by-step instructions; they do not silently download large SDKs or change projects. Preflight checks project detection, supported builder, Java/Flutter, Termux AAPT2, Android SDK, Gradle Wrapper/system Gradle, selected caches, storage, memory and release verification/signing indicators. A check of the Gradle dependency-cache directory cannot prove every exact module is cached; Gradle performs that final check during the offline build.

`paxi support-bundle` writes a ZIP of diagnostics, project markers, sanitized PAXI config/build history and recent logs. It excludes source files, signing keys and credential files, but automated secret removal is best-effort. Inspect the bundle yourself before sharing it.

Exit codes: `0` success, `1` general failure, `2` invalid arguments, `10` project detection/unsupported builder, `11` missing toolchain/readiness, `12` offline cache missing, `13` build/test failure, `14` artifact verification failure, `15` ADB device unavailable, `16` timeout, `17` Ctrl+C cancellation, and `18` security refusal.

Expo and React Native are detected for project guidance but remain **detection-only** in this release; PAXI does not claim to build or test them. Supported PAXI CLI hosts are Windows, macOS, Linux and Termux/Android. Android builds use Flutter or Gradle; Windows desktop bundle creation currently supports Flutter projects on a Windows host only. The Windows artifact is a ZIP app bundle, not an installer; extract it and run the application executable. It is not Authenticode-signed by PAXI. iOS IPA creation is supported only on macOS with Xcode; no iOS build is run remotely.

## Windows desktop builds

PAXI can run natively from Windows PowerShell, Command Prompt or Windows Terminal after the Node.js global install. For Flutter Windows desktop output, install Visual Studio (the full IDE or Build Tools) with the **Desktop development with C++** workload and a Windows SDK; Visual Studio Code by itself is not enough. Run `flutter doctor -v` and `paxi doctor --json` to check the host.

Generate the Windows runner in an existing Flutter project when it is absent, then review the generated files:

```powershell
flutter create --platforms=windows .
paxi preflight --platform windows --format zip --release
paxi build --platform windows --format zip --release
paxi verify .\build\paxi-distribution\<generated-file>.zip
```

The output ZIP contains the executable, Flutter runtime DLL and `data/` assets from the fresh Release output directory. Third-party plugin DLLs emitted by Flutter are included. This is an app bundle, not an MSIX/MSI installer. End-user Windows machines may also need the Microsoft Visual C++ Redistributable if the required runtime DLLs are not deployed app-locally. PAXI does not sign the executable; use Microsoft SignTool and verify the Authenticode signature before public distribution. Strict Windows signature verification is not implemented yet.

`paxi build --platform windows` is not a cross-compiler: run it on Windows. The same PAXI CLI can build Android on Windows when JDK, Android SDK and the project's Gradle/Flutter toolchain are installed. iOS is not available from Windows.

## iPhone / iOS IPA builds

An iOS app is packaged as an **IPA**, not an APK. Build commands are:

```bash
paxi build --platform ios --format ipa --release
```

For a native Xcode project/workspace:

```bash
paxi build --platform ios --format ipa --release \
  --scheme MyApp --export-options ./ExportOptions.plist
```

These commands must run on a configured Mac with Xcode and valid signing/provisioning. A standard iOS IPA cannot be built on Android/Termux or Linux. On those hosts, PAXI explains the limitation and stops; it does not contact a remote builder or upload your project. Export-options paths are resolved relative to the project directory unless an absolute path is supplied.

## PAXI AI Studio

Open the interactive provider/model hub:

```bash
paxi ai studio
```

The Studio includes cloud providers from the United States and China, local runtimes, credential management, model discovery and task-specific model routing. Region labels describe a provider's origin or default endpoint only; they do not guarantee where every request is processed or stored. Check the provider's own regional endpoint and privacy terms.

```bash
paxi ai providers
paxi ai key add deepseek
paxi ai key status
paxi ai models catalog
paxi ai models discover deepseek
paxi ai route set coding deepseek deepseek-flash
paxi ai route set vision google gemini-3.8-flash
paxi ai route show
```

Supported starter providers include OpenAI, Anthropic Claude and Google Gemini (US-oriented services); DeepSeek, Alibaba Qwen, Moonshot Kimi and Zhipu GLM (China-based providers); and Ollama or llama.cpp server (local runtimes). Qwen, DeepSeek and Kimi use OpenAI-compatible interfaces; Claude and Gemini use their native API formats. Model IDs are suggestions: use `paxi ai models discover <provider>` to ask the provider which models are available to your account.

### Encrypted API-key vault

`paxi ai key add <provider>` asks for the API key with hidden terminal input, then creates or unlocks a local vault. Keys are encrypted using AES-256-GCM with a key derived from your passphrase using scrypt. The passphrase is never saved. Use at least 10 characters; losing it means the encrypted keys cannot be recovered. The vault is stored under the private PAXI config directory with owner-only permissions. `paxi ai key status` reveals only which providers have keys, never the key values. Remove a key with `paxi ai key remove <provider>`.

PAXI also accepts provider-specific environment variables for CI or users who prefer their own secret manager: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `BAILIAN_API_KEY` (or legacy `DASHSCOPE_API_KEY`), `MOONSHOT_API_KEY`, `ZHIPUAI_API_KEY`; `PAXI_AI_API_KEY` remains as a legacy/custom endpoint fallback. Environment variables take precedence over vault entries. Never place keys in command-line arguments, shell history, project files or screenshots.

### Multiple models for different tasks

PAXI keeps separate routes for `general`, `coding`, `vision` and `journey`. Example: use a coding-specialized DeepSeek or OpenAI model for code diagnosis, Gemini or Claude for screenshot analysis, and a small local model for offline help. If a role has no route of its own, it falls back to the general route and then the legacy configuration. `paxi ai configure --mode off` disables all routes.

### Local model downloads

```bash
paxi ai models catalog
paxi ai models download qwen35-08b-q4km --confirm
paxi ai models pull qwen3.5:0.8b --confirm
paxi ai models installed
paxi ai local status
```

GGUF downloads are opt-in. PAXI obtains the exact file size and SHA-256 metadata from the Hugging Face model repository, checks free disk space, streams to a temporary file, validates the GGUF signature and exact size, verifies the checksum, and only then installs the model. The starter Qwen 3.5 0.8B Q4_K_M community quantization is approximately 580 MiB; the model licence and quantization source are shown in the catalogue. The separate Ollama pull path requires Ollama to be installed and running. PAXI does not silently install runtimes or download multi-gigabyte files.

To run a downloaded GGUF using an already installed llama.cpp server:

```bash
llama-server -m "$HOME/.local/share/paxi/models/Qwen3.5-0.8B-Q4_K_M.gguf" --host 127.0.0.1 --port 8080
paxi ai route set general llamacpp local-model
```

For a running local Ollama service:

```bash
ollama serve
paxi ai route set general ollama qwen3.5:0.8b
```

Small models use less storage but may be less capable, and runtime memory use can substantially exceed the model file size. Whether a model runs acceptably depends on RAM, CPU, context length, quantization and runtime support. Android/Termux users may need to compile or install a compatible llama.cpp build themselves; Ollama is not assumed to work on every Android device.

### Remote-data controls

Remote prompts are redacted and require an interactive approval or `--allow-remote`. Profile metadata can be excluded with `--no-profile`. Screenshot images are not redacted and require separate approval before a cloud provider receives them. Provider API calls can incur charges under your provider account. AI findings are assistance, not a substitute for tests or security review.

Legacy `paxi ai configure --mode off|local|api` remains available. The previous `PAXI_AI_API_KEY` and single endpoint configuration continue to work for backward compatibility. See [AI Studio V0.9.0](docs/AI_STUDIO_V0.9.0.md) for the complete details.

## Plugins

Place reviewed `.mjs` modules in `~/.config/paxi/plugins/`. A plugin must export `run(args, context)`:

```js
export async function run(args, context) {
  console.log('Hello from PAXI plugin', args, context.cwd);
}
```

Trust and run it:

```bash
paxi plugin trust hello-world  # type TRUST at the prompt, or add --yes after reviewing the source
paxi plugin run hello-world
paxi plugin revoke hello-world
paxi plugin disable-all
paxi plugin enable-all

# Sanitized support ZIP (review it before sharing)
paxi support-bundle
```

PAXI records the SHA-256 digest of the trusted file and imports the exact bytes that passed the trust hash check. Plugin modules should be self-contained because trusted source is loaded from verified bytes. If the file changes, run is blocked until the new code is reviewed and trusted again. This is integrity checking, **not sandboxing**: a trusted plugin executes arbitrary JavaScript with your user permissions. Older V0.2 string-only trust entries are not accepted as hash-bound approvals and must be reviewed and trusted again.

## Signing and secrets

PAXI does not create or manage release signing keys. Keep Android keystores, iOS certificates, provisioning profiles, API tokens and passwords out of Git and AI prompts. The repository `.gitignore` excludes common signing artifacts, but review every project's ignore rules before committing.

## Self-update

`paxi update --check` checks the published `@paxi/devkit` package. Registry self-update becomes available after that package is published. For a Git clone install, update with `git pull`, then run `npm install`; on Termux, rerun `bash scripts/install-termux.sh` rather than `npm link`, while on Linux/macOS use `npm link` only if you need a global development symlink.

## PAXI Doctor expanded foundation (V0.8.0)

The V0.9.0 AI Studio, encrypted key vault, provider adapters and local model manager are documented in [docs/AI_STUDIO_V0.9.0.md](docs/AI_STUDIO_V0.9.0.md). The V0.6.2 foundations are documented in [docs/DOCTOR_V0.6.2.md](docs/DOCTOR_V0.6.2.md), the V0.7.0 user-journey runner in [docs/DOCTOR_V0.7.0.md](docs/DOCTOR_V0.7.0.md), and the V0.8.0 adaptive test-planning and visual review capabilities in [docs/DOCTOR_V0.8.0.md](docs/DOCTOR_V0.8.0.md). Doctor now includes optional Playwright website viewport checks, ADB device evidence, scripted and draft Android journeys, AI-assisted screenshot review, limited safe navigation exploration, C/C++ toolchain preflight and confirmed CMake builds, opt-in local convention learning, read-only Codex MCP tools and reviewed Git patch application.

Browser checks require a user-started website and a Playwright/Chromium install you did yourself browser. Browser viewport results are simulations, not hardware test passes. Android Device Lab captures a real connected phone or emulator but only observes selected system conditions; it does not silently change device settings. Native iOS runtime testing still requires macOS/Xcode or a physical iPhone. CMake builds and package test scripts execute project-controlled code and therefore require explicit command flags.

## Known limitations

- The project invokes locally installed toolchains; it does not bundle the Android SDK, Flutter SDK, JDK, Xcode or signing credentials.
- Termux Flutter builds use ARM64-only flags and skip icon tree-shaking for the supported Termux port. AAPT2 configuration is applied by `paxi configure android`; release support must be verified with a real app and signing setup on the device.
- Windows ZIP packaging and Windows Gradle invocation have unit tests. The Windows-host integration test is run only on Windows CI; a successful local Windows desktop compile still requires a real Flutter/Visual Studio toolchain.
- iOS IPA builds have host-gating and command-flow tests, but have not been executed on a Mac in this development environment.
- Offline dependency mode requires all exact dependencies/caches to be preloaded and is not a network sandbox. iOS offline builds are not enabled in this release. Windows offline preflight checks the Flutter Pub cache and Windows x64 engine artifacts.
- `paxi test` runs framework unit-test commands; it does not orchestrate device instrumentation tests. Real Termux, Android SDK and macOS/Xcode toolchains must still be tested on their respective hosts; CI mocks external platform tools.
- Trusted plugins are hash-checked but not sandboxed. A trusted plugin runs with your full user permissions; `paxi plugin disable-all` blocks all plugin execution until explicitly re-enabled.
- The built-in ZIP verifier does not yet implement ZIP64 containers; standard Android APK/AAB and iOS IPA packages are expected. Strict IPA signature verification is available only on macOS.
- AI Studio supports provider-specific OpenAI-compatible, Anthropic Messages and Gemini generateContent request formats. Provider model discovery remains live and is preferred over static suggestions.

## Development checks

```bash
npm test
npm run check
```

## License

MIT. Third-party SDKs, build tools and AI models retain their own licences.


## V0.6.2 adaptive AI context

By default, `paxi ai explain` includes your locally saved developer preferences and, when learning is enabled, the convention summary learned for the selected project. Only metadata is included; source files and absolute paths are not. Use `--project <dir>` to select the project whose conventions should be applied, or `--no-profile` to omit all profile metadata. In remote API mode the approval notice states whether the summary will be sent, and `--allow-remote` authorizes that transfer. Set `paxi doctor profile learning off` to stop using learned project conventions; clear stored summaries with `paxi doctor profile clear-learning --confirm`.


## V0.7.0 Android journeys

`paxi doctor journey` validates and runs user-authored ADB journeys. Actions include tap, swipe, environment-variable text entry, allowlisted key presses, waits, screenshots, UI visibility assertions and foreground-app assertions. Reports retain device metadata, step evidence and limited crash/ANR signal categories. Text input values are not stored. A journey pass applies only to the script you wrote; PAXI never claims a general device certification. See [docs/DOCTOR_V0.7.0.md](docs/DOCTOR_V0.7.0.md).


## V0.8.0 adaptive test planning and visual review

`paxi doctor journey draft` turns simple navigation goals into review-required JSON journeys. `paxi doctor vision analyze` sends screenshots to a configured multimodal model for visual QA; local mode is loopback-only, while API mode requires your consent because screenshots are not redacted. `paxi doctor explore` taps only exact allowlisted navigation controls and requires `--confirm`; it records hashed UI state and screenshots, then verifies the app returns to its original state. All three are limited helpers, not autonomous app certification. See [docs/DOCTOR_V0.8.0.md](docs/DOCTOR_V0.8.0.md).


## V1.6.0 trace, regression and verified-fix intelligence

Create one W3C trace ID and reuse it across API and browser test runs:

```bash
paxi doctor trace create
paxi doctor api test --file ./api-smoke.generated.json --confirm --trace-id <32-hex-trace-id> --save-report ./evidence/api-report.json
paxi doctor lab run --url http://127.0.0.1:4173 --trace-id <32-hex-trace-id> --output ./evidence/website
paxi doctor trace inspect --log ./logs/api.log --trace-id <32-hex-trace-id> --output ./evidence/backend-trace.json
paxi doctor correlate --report ./evidence/api-report.json --report ./evidence/website/report.json --report ./evidence/backend-trace.json --output ./evidence/correlation.json
```

Tracing is opt-in. Browser `traceparent` headers are added only to XHR/fetch requests and may trigger CORS preflight; configure a test server to accept them. Backend services must record W3C trace context themselves. PAXI reads local logs only, with a limited size and redacted excerpts. Correlation links shared trace contexts but does not prove causation.

Draft post-fix API regression checks from defects in a cross-layer report and an already reviewed API plan:

```bash
paxi doctor regression draft --plan ./api-smoke.generated.json --evidence ./evidence/correlation.json --output ./api-regression-after-fix.json
paxi doctor api test --file ./api-regression-after-fix.json --confirm --save-report ./evidence/regression-result.json
```

Only matching static GET/HEAD cases are selected. Draft generation never calls the network and never invents an expected status. To save verified regression knowledge after every case passes:

```bash
paxi doctor agent memory learn-verified --evidence ./evidence/regression-result.json --summary "Profile endpoint regression corrected" --file src/api/profile.ts --confirm
paxi doctor agent memory verified
paxi doctor agent plan --project .
```

The ledger is local-only, stores report hashes and selected file fingerprints, and marks a record stale when tracked source files change. The first version accepts fully passing PAXI API smoke reports only. See [docs/DOCTOR_V1.6.0.md](docs/DOCTOR_V1.6.0.md) for limitations and complete usage.

## V1.5.0 API regression generation and cross-layer evidence

Generate a reviewable smoke-test plan from a JSON OpenAPI 3.x / Swagger 2.0 specification:

```bash
paxi doctor api generate-tests --file ./openapi.json --output ./api-smoke.generated.json
```

The generator includes only static, non-deprecated `GET` and `HEAD` operations, skips dynamic path templates and all mutating methods, and derives expected success status codes plus required JSON response fields when those are declared in a local schema. It never sends requests. Review the base URL and generated plan before executing:

```bash
paxi doctor api test --file ./api-smoke.generated.json --confirm
```

Remote execution still requires HTTPS and `--allow-remote`. Generated plans are not automatically trusted, and the existing read-only request, timeout and response-redaction safeguards still apply.

Correlate saved reports from separate Doctor runs:

```bash
paxi doctor correlate \
  --report ./api-report.json \
  --report ./website-device-lab/report.json \
  --report ./runtime-probe.json \
  --report ./android-journey/journey-report.json --json
```

Use valid file paths for each `--report` value. Supported report families include API smoke tests, runtime probes, Playwright website labs, Android device-lab captures and user journeys, project diagnosis, visual comparison, static security, SQL migration review and confirmed npm audit. The correlator stores only limited metadata: it omits response bodies, headers, bearer tokens, screenshot bytes and absolute evidence paths. Candidate matches are labeled with confidence and are not root-cause proof.

The Agent Engine can include those same reports when preparing a plan:

```bash
paxi doctor agent plan --project . \
  --evidence ./api-report.json \
  --evidence ./website-report.json \
  --evidence ./runtime-probe.json --json
```

This remains a plan-only workflow: reports are inspected, not rerun; source code is not changed.
See [docs/DOCTOR_V1.5.0.md](docs/DOCTOR_V1.5.0.md).

## PAXI Doctor V1.7.0

Before planning new features, review [Remaining Work and Build Gates](docs/REMAINING_WORK_V1.7.0.md). It distinguishes complete, partial and not-yet-built capabilities and defines the acceptance criteria for the next milestones.


See [Doctor V1.7.0](docs/DOCTOR_V1.7.0.md) for read-only OpenTelemetry span import (including app-state attributes), ranked trace hypotheses, same-origin website route regressions, multi-platform regression drafts, verified-fix learning from API/browser/physical Android evidence and static dependency inventory across 11 ecosystems. Root-cause candidates are hypotheses only; physical-device and simulated-browser evidence remain distinct.

## PAXI Doctor V1.8.0: observability, semantic web journeys and Android selectors

V1.8.0 adds five opt-in OpenTelemetry setup packs: `node-express`, `python-fastapi`, `go-http`, `java-spring` and `dotnet-aspnet`. List them with `paxi doctor observe packs`, inspect one with `paxi doctor observe pack show node-express`, and generate its templates into a project with `paxi doctor observe pack install node-express --project . --confirm`. These are starter templates only. They do not install packages, edit application code, or configure a collector; the developer reviews and integrates each example manually.

Semantic browser journeys are separate from viewport checks. Generate an example with `paxi doctor website journey example --output ./website-journey.json`, validate it, then run it against a local site with `paxi doctor website journey run --file ./website-journey.json --url http://127.0.0.1:4173 --confirm`. Remote execution also requires HTTPS and `--allow-remote`. Journeys support named accessible locators, test-ID/label/text/placeholder locators, click, form fill/select using `PAXI_TEST_*` environment variables, keyboard actions, assertions, same-origin navigation and screenshots. Arbitrary CSS/XPath and page-evaluation steps are not accepted. Input values are not stored in reports or passed to the browser subprocess. Browser results are simulations, not physical Android/iOS tests. Semantic journey runs are archived in the Device Lab history and can be compared with `paxi doctor lab compare <before-run-id> <after-run-id>`.

For Android UIAutomator selector proposals, export/copy a local hierarchy XML and run `paxi doctor journey selectors --hierarchy ./ui-hierarchy.xml`. The proposal report retains resource IDs and bounds but not visible text or content descriptions. Generate a starter assertion only after reviewing the selected candidate: `paxi doctor journey from-hierarchy --hierarchy ./ui-hierarchy.xml --package com.example.app --candidate 1 --output ./journey.json --confirm`. The generated journey asserts only that a resource ID is visible on the current screen; add the setup/navigation and defect-specific assertions manually before replay.

See [docs/DOCTOR_V1.8.0.md](docs/DOCTOR_V1.8.0.md) and [docs/REMAINING_WORK_V1.8.0.md](docs/REMAINING_WORK_V1.8.0.md) for capability boundaries and the next acceptance gates.

## PAXI Doctor V1.9.0: real probes, database lab and supply-chain checks

V1.9.0 adds a synthetic OTLP exporter validation command, an in-memory SQLite migration lab, optional native advisory-scanner adapters, local Syft SBOM generation, private Playwright session state, static same-origin API mocks, basic accessibility/keyboard assertions and multi-browser journey matrices.

```bash
# Confirm the local OTLP collector accepts one synthetic span
paxi doctor observe validate --endpoint http://127.0.0.1:4318/v1/traces --confirm
# Authenticated remote collector: set PAXI_OTEL_AUTHORIZATION in your private shell, then add --allow-remote --auth-env PAXI_OTEL_AUTHORIZATION

# Review SQL statically, then replay SQLite-compatible migrations in memory
paxi doctor database scan --project .
paxi doctor database lab --project . --migrations supabase/migrations --confirm

# See which native security tools are installed; run one only with explicit online consent
paxi doctor security tools
paxi doctor security audit --scanner osv-scanner --project . --online --confirm

# Generate a local CycloneDX SBOM with Syft installed
paxi doctor security sbom --project . --format cyclonedx-json --output ./paxi-sbom.cdx.json --confirm

# Run a browser journey against a local/staging target
paxi doctor website journey run --file ./website-journey.json --url http://127.0.0.1:4173 --confirm
paxi doctor website journey matrix --file ./website-journey.json --url http://127.0.0.1:4173 --browsers chromium,firefox,webkit --confirm
# If the staging frontend uses a separate API origin, allow that exact HTTPS origin explicitly:
paxi doctor website journey run --file ./website-journey.json --url https://app.example.test --allow-api-origin https://api.example.test --confirm
```

The database lab requires Python 3 and is SQLite-only. Native scanners and Syft are optional external tools; PAXI does not install them. Website session state must be kept outside the project tree with private permissions. Browser matrices are simulations, not physical mobile tests. See [docs/DOCTOR_V1.9.0.md](docs/DOCTOR_V1.9.0.md) and [docs/REMAINING_WORK_V1.9.0.md](docs/REMAINING_WORK_V1.9.0.md) for exact boundaries and required real-environment gates.

For the V1.9.0 local test record and the exact items still requiring real environments, see [docs/TEST_RESULTS_V1.9.0.md](docs/TEST_RESULTS_V1.9.0.md) and [docs/REMAINING_WORK_V1.9.0.md](docs/REMAINING_WORK_V1.9.0.md).


## V2.2.0: Evidence confidence, schema fingerprints and hosted QA
V2.2.0 also records when process output is cut off, fingerprints full supported database schema metadata in memory, and prevents incomplete accessibility evidence from being labelled as a clean pass. See [the V2.2.0 technical guide](docs/DOCTOR_V2.2.0.md), [remaining-work gates](docs/REMAINING_WORK_V2.2.0.md) and [verification record](docs/TEST_RESULTS_V2.2.0.md). The uploaded GitHub Actions workflows are configured but remain pending until the repository is pushed and those hosted jobs run.


- `paxi doctor database lab` now compares metadata-content fingerprints for columns, indexes, constraints, views, triggers and routines in PostgreSQL, MySQL/MariaDB and SQL Server. Raw catalog definitions are hashed in memory and are not written to reports. When the metadata output limit is exceeded, schema comparison is `indeterminate` instead of incorrectly reporting no change.
- Child-process reports now expose `outputBytes` and `outputTruncated`; limited output can no longer be mistaken for complete diagnostic evidence.
- Website accessibility results require review when axe-core reports incomplete checks, requests were blocked, browser runtime errors occurred, or HTTP errors were observed. This prevents incomplete evidence from being shown as a clean pass.
- Added GitHub Actions cross-platform Node 20/22/24 checks and a real Chromium/Firefox/WebKit semantic + accessibility matrix. Hosted results remain pending until the repository runs these workflows.

## V2.1.1: Termux interpreter fix and evidence-led QA

V2.1.1 fixes the Android/Termux global command launcher. The previous npm-linked `paxi` executable pointed at `#!/usr/bin/env node`, a path that is not present on standard Android/Termux. The installer now creates an executable `paxi` wrapper using Android's `/system/bin/sh` and the exact Node executable discovered from the active Termux PATH. It invokes the installed CLI by absolute path, handles spaces and apostrophes safely, validates the version after installation, and refuses to overwrite an unrelated existing command. Always run the installer using `bash scripts/install-termux.sh` from the extracted source folder.

### Termux installation repair

If an older `paxi` command reports `bad interpreter`, `interpreter file not found` or `/usr/bin/env: No such file or directory`, extract this release into a new directory and reinstall:

```bash
pkg update -y
pkg install nodejs-lts unzip
cd ~/storage/downloads
unzip -o paxi-devkit-v2.7.0.zip -d ~/projects
cd ~/projects/paxi-devkit-v2.7.0
bash scripts/install-termux.sh
paxi version
paxi doctor --json
```

The installer writes the wrapper under `$PREFIX/bin/paxi`; it does not depend on an npm-created symlink. If an unrelated regular file or symlink already occupies that path, the installer stops rather than replacing it.

### SPDX-aware license policy

The license evaluator parses `AND`, `OR`, parentheses, `WITH`, `LicenseRef` and `DocumentRef` identifiers. `AND` requires every branch to satisfy policy; `OR` succeeds when at least one permitted branch is available. `WITH` exceptions require approval in `allowExceptions`; unapproved exceptions and deprecated IDs require review. For official identifier membership/deprecation checks, provide both a matching-version SPDX License List snapshot and Exception List snapshot. Hash pins are supported:

```bash
paxi doctor security licenses --sbom ./paxi-sbom.cdx.json --policy ./license-policy.json \
  --license-list ./spdx/licenses.json --exception-list ./spdx/exceptions.json \
  --license-list-sha256 <sha256> --exception-list-sha256 <sha256>
```

Without registry snapshots, PAXI parses syntax and evaluates the configured policy but reports that canonical membership was not checked. This is compliance screening, not legal advice.

### Official SBOM JSON Schema validation

Supply a locally obtained, reviewed, self-contained official CycloneDX or SPDX JSON Schema. Remote `$ref` values are blocked. Python 3 and `jsonschema` are optional requirements; PAXI does not install them automatically.

```bash
python3 -m venv .paxi-schema-venv
. .paxi-schema-venv/bin/activate
python -m pip install jsonschema
paxi doctor security sbom-schema --file ./paxi-sbom.cdx.json --schema ./spdx-or-cyclonedx.schema.json --schema-sha256 <sha256>
```

The schema pin is recommended for repeatable CI. Validation proves conformance only to the exact supplied snapshot, not that the SBOM contains every dependency.

### Website accessibility audit

Install `playwright` and `axe-core` in the target web project, install the selected browser, start the staging app yourself, then run:

```bash
npm install --save-dev playwright axe-core
npx playwright install chromium
paxi doctor website accessibility --url http://127.0.0.1:4173 --profiles compact,standard,tablet --browser chromium --confirm --output ./paxi-accessibility.json
```

Remote HTTPS websites require `--allow-remote`. The runner blocks cross-origin requests and non-GET/HEAD requests; this can affect pages that depend on external assets. axe-core provides automated WCAG-related checks, not full certification or a replacement for manual screen-reader testing. Browser viewports are simulations, not physical-device evidence.

### Verified boundaries

A passing suite is not production certification. Disposable database labs, browser/semantic checks and optional security-tool checks are environment-dependent; hosted GitHub Actions, physical Android devices, official pinned SBOM-schema validation and several platform-specific gates still require their corresponding host or service. See the versioned verification records in `docs/TEST_RESULTS_V2.7.0.md` and `docs/REMAINING_WORK_V2.7.0.md`.


## PAXI Doctor V2.7.0: defensive security testing

V2.7.0 extends the V2.6.0 test adapters with optional local security tools and limited safe checks. It adds: Gitleaks secret scanning (including a developer-selected limited local Git history range), Semgrep SAST using a local rules file or an online registry configuration you approve, Trivy filesystem scanning for vulnerabilities/secrets/misconfiguration, single-file Slither analysis requiring a locally installed `solc`, Android APK manifest and signature inspection using `apkanalyzer` and `apksigner`, website security-header inspection, and paired test-account GET-only API object authorization checks.

Every native scanner is optional. A missing binary is reported as `not-run`, never as a clean scan. Scanner report adapters discard secret values and code snippets. Remote Semgrep/Trivy database use requires `--online --confirm`; remote website/API checks require HTTPS, `--allow-remote` and `--confirm`. API authorization checks require two distinct test tokens via `PAXI_TEST_OWNER_TOKEN` and `PAXI_TEST_OTHER_TOKEN` by default. They only make the GET requests you list, do not retain response bodies or credentials, and treat a non-owner 2xx response as a failure. APK inspection does not install or execute the APK. Slither is restricted to one `.sol` file and a locally installed compiler.

## v2.7.0 launch readiness

The source has passed the AI regression suite and every production check that can run locally. The latest basic-environment run completed with 312 passing tests, 0 failures, and 3 host/optional-tool skips; an earlier optional-tool run completed with 314 passing tests, 0 failures, and 1 Windows-host skip. The remaining Windows Flutter check must run on the real Windows CI runner. Read this as release-candidate evidence. It does not mean every third-party Android, Flutter, iOS, Windows, database, browser or scanner toolchain will work on every host.

Before making the repository public, follow [the release runbook](docs/RELEASE_RUNBOOK.md) and [the production checklist](docs/RELEASE_CHECKLIST.md). The public repository should be created only after reviewing staged files, enabling least-privilege Actions permissions, waiting for CI, tagging the CI-approved commit, and publishing a checksummed archive. Termux users can then install from the verified GitHub Release ZIP or clone the public repository and run `bash scripts/install-termux.sh`.

Examples:

```bash
paxi doctor security advanced-tools
paxi doctor security secrets --project . --confirm
paxi doctor security secrets --project . --history --history-limit 100 --confirm
paxi doctor security sast --project . --rules ./semgrep.yml --confirm
paxi doctor security trivy --project . --online --confirm
paxi doctor security contracts --file ./contracts/Token.sol --confirm
paxi doctor security apk --file ./build/app-release.apk --confirm
paxi doctor security web --url http://127.0.0.1:8080 --confirm
paxi doctor security api-authz --plan ./api-authz-plan.json --confirm
```

See [security testing architecture](docs/SECURITY_TESTING_V2.7.0.md), [remaining work](docs/REMAINING_WORK_V2.7.0.md), and [test results](docs/TEST_RESULTS_V2.7.0.md). Static heuristics and third-party scanners are aids, not guarantees of security. An authenticated production system should only be tested under written authorization and on a staging environment.
