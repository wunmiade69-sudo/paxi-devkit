# PAXI DevKit V1.8.0 — PAXI Doctor

## Release goal

V1.8.0 improves the evidence collection and reproduction layers. It adds reusable OpenTelemetry instrumentation templates, semantic browser journeys and privacy-conscious Android selector proposals. All modules are additive; the existing V1.7 trace correlation, Device Lab, Android journeys, AI Studio, approved patch workflow and local build pipeline remain in place.

## Architecture additions

```text
PAXI Doctor
├── Observability packs
│   ├── Node.js / Express
│   ├── Python / FastAPI
│   ├── Go / net/http
│   ├── Java / Spring Boot
│   └── .NET / ASP.NET Core
├── Website semantic journey
│   ├── schema validator
│   ├── semantic locator resolver
│   ├── bounded Playwright runner
│   ├── same-origin navigation guard
│   └── redacted evidence report
├── Android selector proposals
│   ├── local UIAutomator XML parser
│   ├── resource-ID candidate ranking
│   └── reviewed starter journey generation
└── Evidence integration
    ├── cross-layer correlation
    └── verified-fix memory with browser-simulation assurance
```

## 1. Observability setup packs

List packs:

```bash
paxi doctor observe packs
paxi doctor observe pack show node-express
```

Generate into a new project-local folder:

```bash
paxi doctor observe pack install node-express --project . --confirm
```

Available pack IDs:

- `node-express`
- `python-fastapi`
- `go-http`
- `java-spring`
- `dotnet-aspnet`

The generator writes starter files below `paxi-observability/<pack-id>` unless `--output` selects another project-relative directory. Existing files are never overwritten. No dependency is installed, no project manifest or source file is edited, and no collector is configured. The developer must review dependency versions, initialization order, exporter endpoint, sampling and data-capture policy before integration.

All examples are staging/test oriented. Do not attach authorization headers, cookies, request bodies, SQL parameter values, personally identifying values or other secrets to spans. Configure the service's instrumentation SDK before importing instrumented modules where the framework requires it. Export OTLP JSON from a collector and import it with `paxi doctor trace spans`.

## 2. Semantic website journeys

Generate, validate and run a journey:

```bash
paxi doctor website journey example --output ./website-journey.json
paxi doctor website journey validate --file ./website-journey.json

# Dedicated local/staging application only
export PAXI_TEST_EMAIL='qa@example.test'
export PAXI_TEST_PASSWORD='use-a-dedicated-test-secret'
paxi doctor website journey run \
  --file ./website-journey.json \
  --url http://127.0.0.1:4173 \
  --confirm
```

Remote targets require HTTPS and explicit `--allow-remote`. The runner requires Playwright to be installed by the user in the selected project and the selected browser binary to be installed. PAXI does not install browser dependencies automatically.

Supported actions:

- `goto` and `assertUrl` using same-origin path-only URLs.
- `click` using an accessible role/name, label, text, test ID or placeholder locator.
- `fill` and `selectOption`, sourced only from `PAXI_TEST_*` environment variables.
- `check`, `uncheck` and an allowlisted `press` key.
- `assertVisible`, `assertHidden` and `assertText`.
- `screenshot` and bounded `wait`.

Arbitrary CSS/XPath selectors and page-evaluation JavaScript are not supported. The runner blocks cross-origin top-level navigation and closes unexpected popup pages. It applies a minimal allowlisted environment to the browser process, excluding test variables and arbitrary shell secrets. Reports do not store entered values or actual visible page text. URLs have query strings and fragments removed before being recorded.

A complete example journey is available at `examples/website-semantic-journey.json`. A pass means only that the steps and explicit assertions in that journey passed. At least one assertion is required for `journeyPassClaim`. Browser reports are `simulated-browser-semantic-journey`, never physical-device tests.

## 3. Android UI selector proposals

First capture a hierarchy using the existing Android Device Lab or journey workflow. Then inspect a local UIAutomator XML dump:

```bash
paxi doctor journey selectors --hierarchy ./ui-hierarchy.xml
```

To generate a starter journey from one reviewed candidate:

```bash
paxi doctor journey from-hierarchy \
  --hierarchy ./ui-hierarchy.xml \
  --package com.example.app \
  --candidate 1 \
  --output ./android-selector-journey.json \
  --confirm

paxi doctor journey validate ./android-selector-journey.json
```

A safe example hierarchy is available at `examples/android-ui-hierarchy.xml`. The parser prefers resource IDs and ranks unique visible resource IDs higher than duplicates. Saved proposals do not retain raw `text` or `content-desc` values. Nodes without resource IDs are listed as manual candidates with class and bounds evidence only. It does not turn coordinates into executable taps.

The generated journey contains one `assertVisible` step for the selected resource ID. This verifies only the current visible screen. A developer must add setup/navigation steps and an assertion that actually reproduces the original defect before running it on an authorized test device.

## 4. Evidence integration

Semantic browser journey reports are recognized by cross-layer correlation. When the report has a shared W3C trace ID and matching API request metadata, PAXI can associate it with API/backend evidence. A shared trace ID is an investigation link, not proof of cause.

Semantic browser journey runs are archived in the shared Device Lab history and can be compared by step IDs/status. Verified-fix memory accepts a fully completed semantic journey only if every step passes, at least one explicit assertion passes, and no error-level runtime issue exists. The record is labeled `simulated-semantic-browser-journey-only`. It does not certify native Android/iOS behavior.

## 5. Safety model

- Observability pack generation requires `--confirm`, creates new files only, and never modifies app code or dependency manifests.
- Browser execution requires `--confirm`; remote targets require HTTPS and `--allow-remote`.
- Test inputs are environment-only; values are not stored in reports or passed into the browser subprocess.
- Top-level cross-origin navigation is blocked; journey locators are restricted to semantic APIs.
- Android hierarchy proposals omit visible text/content descriptions from saved results by default.
- Selector-based Android journey generation requires explicit confirmation and never taps based solely on inferred coordinates.
- No database migration, purchase, message dispatch, production deployment, signing or destructive action is performed by these new modules.

## 6. Verification performed for this release

The V1.8.0 source suite includes tests for observability pack discovery/installation, semantic journey schema and execution, confirmation boundaries, environment secret handling, cross-origin navigation blocking, Android selector redaction, cross-layer matching and verified-fix assurance labeling.

The packaging host completed 216 passing tests, zero failures and one Windows-only skipped test; targeted V1.8 tests passed 9/9. JavaScript syntax checks passed for 77 files and Termux shell checks passed. CLI smoke checks exercised pack listing/installation, journey example/validation and Android selector generation. A clean extracted ZIP regression run is performed as a separate release gate. Host test results do not replace physical-device, real collector or live browser tests.

## 7. Known limitations

- Instrumentation packs are starter templates; they are not automatically installed, inserted or validated inside a real application.
- No live OpenTelemetry collector or service has been configured by this release.
- Semantic journey execution has test fixtures, but a real Playwright/browser installation and real local/staging application must be tested by the developer.
- Firefox/WebKit are selectable only if installed Playwright builds and browsers are available; the current regression fixtures do not certify all engines.
- Android selector proposals are resource-ID based. Text-only, Compose semantics, Flutter semantics, custom canvas views and dynamic accessibility trees may require framework-specific adapters.
- The generated Android journey asserts one current-screen element; it does not yet reconstruct a multi-screen navigation path or a defect-specific fail-before/fix-after scenario.
- Native iOS runtime testing still requires macOS/Xcode or a physical iOS test runner.
