# PAXI Doctor V1.7.0 — OpenTelemetry, Multiplatform Regression and Verified Evidence

V1.7.0 advances the V1.6.0 trace/agent architecture. It imports local OpenTelemetry OTLP JSON exports, adds same-origin route execution to the browser Device Lab, generates API/website/Android regression material from supplied cross-layer defect evidence, and widens verified-fix memory to accept explicitly approved passing reports from three distinct evidence classes.

## 1. Import OpenTelemetry spans

Export spans from your own test/staging observability collector in OTLP JSON format, then inspect them locally:

```bash
paxi doctor trace spans \
  --spans ./evidence/otel-traces.json \
  --slow-database-ms 500 \
  --output ./evidence/otel-span-report.json
```

Filter one W3C trace:

```bash
paxi doctor trace spans \
  --spans ./evidence/otel-traces.json \
  --trace-id <32-hex-trace-id> \
  --json
```

The importer supports OTLP JSON `resourceSpans/scopeSpans/spans` and a normalized `spans` array for local fixtures/conversion workflows. It also understands opt-in custom `app.state.name`, `app.state.from`, `app.state.to` and `app.state.transition` attributes so application loading/error/retry transitions can be reviewed when your service emits them. It caps files at 5 MiB and spans at 2,000; it retains only an allowlist of service, HTTP, database, application-state and exception attributes. Custom `app.state.*` attributes can expose transitions such as `loading → error`; these must be instrumented by your own application. It does not connect to an OTLP collector, ingest protobuf/gRPC, fetch traces from a vendor or follow arbitrary references.

Then correlate the span report with API, website, runtime and backend-log evidence:

```bash
paxi doctor correlate \
  --report ./evidence/api-report.json \
  --report ./evidence/website/report.json \
  --report ./evidence/backend-trace.json \
  --report ./evidence/otel-span-report.json \
  --output ./evidence/correlation.json
```

The report now includes ranked `rootCauseCandidates`. A database error span in the same trace and parent chain as a failed API request receives a higher investigation priority than a simple route match. This remains a hypothesis: retries, async work, sampling, missing parent spans, exporter conventions and incomplete instrumentation can make the trace misleading. PAXI never labels a candidate as proven root cause.

## 2. Website route regressions

The website Device Lab accepts repeated same-origin path arguments:

```bash
paxi doctor lab run \
  --url https://staging.example.test \
  --route /settings \
  --route /profile \
  --profiles compact,standard,tablet \
  --conditions font,dark,keyboard \
  --output ./evidence/site-routes
```

Routes must be relative paths beginning with one `/`; cross-origin paths, query strings, fragments, backslashes and dot traversal are rejected. The browser creates route × viewport cases and reports each visited URL. These remain Playwright viewport simulations, not native mobile or physical-device results.

## 3. Draft API, website and Android regressions

Use cross-layer evidence from `paxi doctor correlate`:

```bash
paxi doctor regression draft \
  --targets all \
  --plan ./api-smoke.generated.json \
  --evidence ./evidence/correlation.json \
  --output ./evidence/regression-draft.json \
  --android-output ./evidence/android-regression-starter.json
```

`--targets` supports `api`, `website`, `android` or `all`.

- **API:** selects matching static GET/HEAD tests from an already reviewed API smoke plan. Existing expected assertions are preserved; PAXI does not invent expected business outcomes.
- **Website:** emits same-origin routes from failed browser page evidence. Execute them with `doctor lab run --url <origin> --route <path>`. Browser runs are simulations.
- **Android:** emits a valid starter journey for a single app package with an `assertForeground` assertion and screenshot. It is not defect-specific yet. Inspect the original report, add a selector-specific `assertVisible` or `assertNotVisible` assertion and validate it before claiming the original defect is covered.

Drafting is offline and does not execute tests, call a service or modify project code. Generated files use exclusive creation and owner-only permissions.

## 4. Verified-fix evidence across layers

After independently reviewing and obtaining complete passing reports, store a local memory record:

```bash
paxi doctor agent memory learn-verified \
  --evidence ./evidence/api-regression.json \
  --evidence ./evidence/website-regression/report.json \
  --evidence ./evidence/android-physical-journey/journey-report.json \
  --summary "Profile flow regression verified across test layers" \
  --file src/profile/service.ts \
  --file src/profile/route.ts \
  --confirm
```

Accepted evidence:

| Evidence | Acceptance rule | Assurance label |
|---|---|---|
| PAXI API smoke | Every GET/HEAD case passed | Confirmed read-only API smoke |
| PAXI website lab | Every viewport case passed with no review findings | Simulated browser viewport only |
| PAXI Android journey | Physical Android device, `journeyPassClaim`, assertions, crash scan available and no issues | Scripted journey on physical Android; not device certification |

Emulator Android journeys are rejected as physical evidence. Browser simulations can be saved as browser evidence but must not be represented as actual Android/iOS testing. Reports are stored as hashes and safe metadata, not copied response bodies or screenshots. Selected source-file hashes mark a record stale when those files change; they do not fingerprint the whole repository or prove that a fix caused the passing result.

Inspect or clear:

```bash
paxi doctor agent memory verified
paxi doctor agent memory clear-verified --confirm
```

## 5. Evidence-aware Agent planning

Supply reports directly to the Agent Engine:

```bash
paxi doctor agent plan \
  --project . \
  --evidence ./evidence/api-report.json \
  --evidence ./evidence/website/report.json \
  --evidence ./evidence/otel-span-report.json \
  --json
```

The plan adds ranked investigation steps and platform-specific regression recommendations. It does not execute tests, run migrations, instrument services, change source code or certify root cause.

## 6. New and extended commands

- `paxi doctor trace spans --spans <otlp-json> [--trace-id <id>] [--slow-database-ms 500]`
- `paxi doctor lab run ... --route <same-origin-path> [--route <path> ...]`
- `paxi doctor regression draft --targets api,website,android|all --evidence <correlation.json> [--plan <api-plan>] [--android-output <journey.json>]`
- `paxi doctor agent memory learn-verified --evidence <report> [--evidence <report> ...] ... --confirm`

## 7. Multi-ecosystem dependency inventory

The offline security review now estimates declared dependencies and the presence/count of lockfile entries for npm, Cargo, Go modules, Python requirements/pyproject, Composer, Maven, Gradle/version catalogs, Ruby Bundler, Swift Package Manager, Dart/Flutter and .NET project files. Example:

```bash
paxi doctor security scan --project . --json
```

Inspect `dependencies.ecosystems` for the ecosystem, manifest paths, lockfiles, estimated direct dependency count and estimated locked-entry count. These are best-effort manifest heuristics, not a resolved dependency graph. The scanner does not claim a dependency is vulnerable or clean, and this inventory does not contact an advisory database. The existing confirmed online npm audit remains specific to npm; other ecosystems require their native audit tools to be installed and invoked deliberately.

## 8. Readiness matrix and remaining work

| Area | V1.7.0 status | What is still required for production-grade coverage |
|---|---|---|
| OTLP spans | Local OTLP JSON import, allowlisted attributes, span ancestry and DB/app-state candidates | Automatic SDK instrumentation, OTLP protobuf/gRPC, live collector integrations, async span links and sampling diagnostics |
| Root-cause reasoning | Ranked hypotheses using shared trace IDs and parent-child spans | Complete instrumentation, timing/clock quality, span status semantics and repeatable reproduction; conclusions still require engineering review |
| Website regressions | Same-origin GET route × viewport runs | Semantic click/form journeys, auth/session fixtures, expected-state assertions, network mocking and multi-engine Chromium/Firefox/WebKit runs |
| Android regressions | Generated starter journey and physical-device evidence acceptance | Defect-specific selector/assertion generation, navigation replay, permissions/notifications/deep links and broader physical-device matrix |
| Verified-fix memory | API, browser-simulation and physical Android reports; selected source-file hashes | Git commit/branch linkage, full project snapshot, build-variant linkage, test environment fingerprint and support for other test runners |
| Database | Static SQL migration review plus DB span observations | Disposable database integration, schema diff, transaction/rollback testing, migration replay and state assertions; never default to production DB |
| Dependency security | Offline manifest/lock inventory across 11 ecosystems; confirmed npm audit | Native advisory scanners for Cargo/Go/Python/Composer/Maven/Gradle/Ruby/Swift/Dart/.NET, SBOM generation, license policy and transitive reachability |
| Cross-language analysis | Existing static patterns and test-command detection for supported projects | Dedicated parser/type-aware analyzers and test adapters per language/framework, with version-specific fixtures and CI coverage |
| iOS | Static project inspection and planning from Android/Termux host | Mac/Xcode bridge or physical iOS runner for builds, simulator/device journeys, signing and App Store release checks |
| AI agent | Evidence-aware planning and approved patch workflow | Benchmark suite for model quality, true local resource profiling under load, budget/cost calibration, provider failover tests and safe task-boundary evaluation |
| CI/release | Local CLI, deterministic test reports and package checks | GitHub Actions/GitLab/Azure adapters, artifact provenance, signed releases, matrix OS tests and reproducible builds |

### Recommended implementation order after V1.7.0

1. **Real observability setup packs:** opt-in instrumentation guides/templates for Node/Express, Python/FastAPI, Go, Java/Spring and .NET, with test-only W3C propagation and examples. Validate these in sample services before touching user projects.
2. **Semantic web journeys:** browser journeys with reviewable selectors, role/name assertions, controlled test accounts and request mocking. Route navigation alone is not enough.
3. **Android reproduction generation:** inspect hierarchy and captured screenshots, propose selectors, create draft assertions and require the user to review selectors before any run.
4. **Disposable database lab:** provision only a developer-selected local/test DB, snapshot it, replay migrations in a rollback-capable sandbox and compare schema/state. Never auto-run on production.
5. **Native advisory/SBOM adapters:** one ecosystem at a time, with tool version checks, explicit network consent, normalized reports and test fixtures.
6. **Cross-platform validation matrix:** Linux/macOS/Windows CI, real Android devices, and a Mac/Xcode bridge for true iOS execution.
7. **Agent quality gates:** evaluate planning and patch quality against known failures, measure false positives and require passing regression evidence before calling a fix verified.

The full capability ledger, ranked backlog and definition of done are maintained in [REMAINING_WORK_V1.7.0.md](REMAINING_WORK_V1.7.0.md).

This roadmap is deliberately evidence-led. Do not add another feature merely because it sounds intelligent; each adapter should have a fixture, a real integration test, a failure mode, a confidence label and a documented environment requirement before it is advertised as supported.

## 9. Remaining limitations

- Backend spans must already be exported by the developer's service. PAXI does not automatically inject OpenTelemetry SDKs or configure database instrumentation.
- OTLP protobuf, gRPC, live collectors and vendor tracing APIs are not supported by this local JSON importer.
- Root-cause output is ranked hypothesis, not proof. Full causal analysis requires complete trace/span coverage, parent relationships, timing and service semantics.
- Website regressions currently replay same-origin GET navigation through viewport simulations. They do not auto-create semantic assertions for a failed UI interaction or test real device browser engines.
- Android regression generation is a starter journey only. A developer must add the feature-specific UI selector/assertion and run it on a physical device.
- Verified-fix learning is evidence-linked but still scope-limited. It does not know every build variant, test suite or project source file; selected file hashes are not a complete project snapshot.
- Database analysis remains static SQL review plus observability evidence. PAXI does not connect to a database, compare live schemas, apply/rollback migrations or prove transaction correctness.
- Real iOS runtime/simulator tests require macOS/Xcode or a suitable physical iOS test environment. Android/Termux can only perform static/project-level iOS inspection.
