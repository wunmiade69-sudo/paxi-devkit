# PAXI DevKit V1.9.0 — PAXI Doctor

V1.9.0 closes several development gaps from the V1.8 capability ledger. It adds an active but synthetic OTLP/HTTP export probe, a disposable in-memory SQLite migration lab, native advisory-scanner adapters and local SBOM generation, private Playwright session-state handling, exact same-origin response mocks, basic accessibility/keyboard assertions, a browser-engine matrix runner, and additional Swift/Ruby/PHP/Dart framework test planning.

## 1. OTLP collector validation

List and install an instrumentation template as before:

```bash
paxi doctor observe packs
paxi doctor observe pack install node-express --project . --confirm
```

Validate that an OTLP/HTTP traces endpoint accepts a single synthetic span:

```bash
paxi doctor observe validate \
  --endpoint http://127.0.0.1:4318/v1/traces \
  --confirm
```

Remote targets require HTTPS plus `--allow-remote`. For an authenticated collector, set `PAXI_OTEL_AUTHORIZATION` in your private shell environment and pass `--auth-env PAXI_OTEL_AUTHORIZATION`; the value is sent only as the Authorization header and is not written to output or reports. The probe uses a synthetic span named `paxi.doctor.synthetic_export_probe`; it sends no source code, credentials, request bodies or project traces. Redirects are disabled and response bodies are discarded. A 2xx result proves endpoint acceptance only. It does not prove collector persistence, indexing or queryability; verify the trace in the collector/backend UI or API.

## 2. Disposable SQLite migration lab

The lab executes migration SQL only inside a new in-memory SQLite database. It never opens a user database file, network database URL or production connection. Python 3 and its standard-library `sqlite3` module are required.

```bash
paxi doctor database scan --project .
paxi doctor database lab --project . --migrations supabase/migrations --confirm --json
```

An optional seed schema can create the pre-migration state in the same disposable database:

```bash
paxi doctor database lab \
  --project . \
  --migrations migrations \
  --seed-sql test/fixtures/schema.sql \
  --confirm
```

The lab applies migrations in deterministic path order and reports schema-object changes and migration success/failure. It does not report table row contents. `ATTACH`, `DETACH`, `PRAGMA`, virtual tables, extension/file helper functions and `VACUUM`/`VACUUM INTO` are denied. It is intentionally SQLite-only; PostgreSQL, MySQL/MariaDB and SQL Server migrations need vendor-specific disposable adapters and are not validated by this feature.

## 3. Native dependency vulnerability scanners

Inspect locally available tools:

```bash
paxi doctor security tools
```

Run one selected scanner only after reviewing the project and permitting advisory-service network access:

```bash
paxi doctor security audit --scanner osv-scanner --project . --online --confirm
paxi doctor security audit --scanner cargo-audit --project . --online --confirm
paxi doctor security audit --scanner govulncheck --project . --online --confirm
paxi doctor security audit --scanner pip-audit --project . --online --confirm
paxi doctor security audit --scanner composer-audit --project . --online --confirm
paxi doctor security audit --scanner dotnet-audit --project . --online --confirm
```

Adapters depend on the selected ecosystem's conventional lock/manifests and the scanner installed on PATH. They do not install tools or fix packages. If machine-readable output cannot be parsed, the report is incomplete and is not labeled clean. The existing `paxi doctor security npm-audit --online --confirm` remains available.

Official tool references:

- OSV-Scanner source scan: https://github.com/google/osv-scanner/blob/main/docs/scan-source.md
- Syft CLI reference: https://oss.anchore.com/docs/reference/syft/cli/
- Syft SBOM formats: https://oss.anchore.com/docs/guides/sbom/formats/

## 4. SBOM generation

Syft is optional and must be installed deliberately. PAXI does not download it or enable online enrichment.

```bash
paxi doctor security sbom \
  --project . \
  --format cyclonedx-json \
  --output ./paxi-sbom.cdx.json \
  --confirm
```

`--format` accepts `cyclonedx-json` or `spdx-json`. Existing files are not overwritten unless `--overwrite` is supplied. The report includes component count, license-metadata coverage, output size and SHA-256. This is a local component inventory, not a vulnerability verdict or license-compliance certification.

## 5. Semantic website journey upgrades

The journey schema now supports:

- `mocks`: exact same-origin HTTP method/path JSON responses for fetch/XHR, without running user-provided code.
- `assertAccessible`: bounded checks for images missing `alt` and controls with no detected accessible name.
- `assertKeyboard`: checks that Tab results in a focused element.
- `--storage-state`: load private Playwright cookies/local storage from a file outside the project tree, with exact target host/origin checks.
- `--save-storage-state`: save a new private session file outside the project tree only after every journey step passes.
- `matrix`: run one journey independently in Chromium, Firefox and/or WebKit and report unavailable engines separately.

Example:

```bash
paxi doctor website journey example --output ./website-journey.json
paxi doctor website journey validate --file ./website-journey.json
paxi doctor website journey run \
  --file ./website-journey.json \
  --url http://127.0.0.1:4173 \
  --confirm \
  --allow-api-origin https://api.staging.example.test \
  --save-storage-state ../paxi-test-session.json
paxi doctor website journey matrix \
  --file ./website-journey.json \
  --url http://127.0.0.1:4173 \
  --browsers chromium,firefox,webkit \
  --confirm
```

Storage-state files must be private (`0600` on POSIX), new when saving, outside the project and scoped to the exact target origin plus any explicitly allowed API origins. The session contents are never written into reports. Browser network requests are constrained; external navigation, scripts, fetch/XHR and websocket requests are blocked by default, while static cross-origin image/style/font resources may still load. Use a local or dedicated staging site and a disposable account.

The accessibility assertion is a heuristic, not a WCAG conformance scan. It does not calculate color contrast, perform screen-reader verification or replace axe-core/manual testing. Browser-engine runs are simulations, never physical Android/iOS passes.

## 6. Framework test planning

The test command planner now identifies additional projects even when the host toolchain is missing:

- Swift Package Manager: `swift test`
- Ruby/Rake: `bundle exec rake test`
- Ruby/RSpec: `bundle exec rspec`
- PHP/PHPUnit: `phpunit`
- Dart packages: `dart test` when Flutter is not selected
- existing .NET, Maven, Gradle, Go, Rust, Python, Flutter, Composer, CMake/CTest, Node and Foundry plans remain

`paxi doctor test --project .` only previews the detected command. Running it still requires `--confirm` because test scripts are project-controlled code. PAXI does not install missing toolchains.

## 7. Safety and evidence boundaries

| Capability | What a pass means | What it does not mean |
|---|---|---|
| OTLP probe | Collector endpoint accepted one synthetic trace request | Span stored/indexed/queryable |
| SQLite migration lab | SQLite-compatible migrations applied to the in-memory schema | PostgreSQL/MySQL/production migration safety |
| Native scanner | Selected scanner completed and returned parseable output | All packages/paths are covered or exploitable |
| SBOM | Syft generated a validated CycloneDX/SPDX document | No vulnerable or unlicensed components |
| Accessibility assertion | Fixed heuristics found no checked issues | WCAG conformance or contrast pass |
| Browser matrix | Each available engine ran the reviewed journey | Real-device/mobile/iOS certification |
| Framework test plan | A conventional command was identified | Toolchain exists or test suite passes |

See [REMAINING_WORK_V1.9.0.md](REMAINING_WORK_V1.9.0.md) for outstanding environment and architecture gates.
