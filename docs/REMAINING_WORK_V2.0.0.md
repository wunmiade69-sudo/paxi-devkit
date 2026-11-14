# PAXI Doctor remaining work after V2.0.0

This ledger distinguishes source implementation from live environment certification.

| Area | V2.0.0 source status | Remaining acceptance gate |
|---|---|---|
| SQLite migration lab | Implemented; local Python/sqlite3 integration tested | Validate real project migration directories and seed schemas |
| PostgreSQL lab | Native psql adapter, generated restricted role/database, cleanup logic | Run against supported local PostgreSQL versions; verify role grants, schema diff, rollback-by-disposal and cleanup on interruption |
| MySQL/MariaDB lab | Native mysql/mariadb adapter, scoped database grants, private client option files | Run against current supported MySQL 8.x and MariaDB versions; verify account host matching, migrations, schema counts and cleanup |
| SQL Server lab | Not implemented | Design a separate sqlcmd adapter and isolated database/login lifecycle; confirm SQL Server container support on suitable hosts |
| Migration schema diff | SQLite object snapshot and service-engine table/index counts | Add vendor-aware normalized schema objects, constraints, routines and permissions |
| Migration rollback | Disposable database teardown | Add explicit migration rollback scripts where projects provide them and compare forward/backward schema state |
| SBOM structural validation | CycloneDX/SPDX top-level/component structural checks | Official JSON Schema validation using pinned schemas and a compatible validator |
| License policy | Allow/deny/unknown/exception evaluation | Full SPDX expression parser, license text verification, policy fixture set and legal review workflow |
| Native scanners | OSV, cargo-audit, govulncheck, pip-audit, Composer and .NET adapters; scanner version recorded | Live native binary matrix, fixture advisories, transitive coverage and advisory database freshness metadata |
| SBOM generation | Syft adapter with artifact hash | Run Syft on each supported OS and compare catalog completeness for sample ecosystems |
| OpenTelemetry | OTLP validation and framework starter packs | Live collector plus tracing backend queryability; database driver, queue and background-job instrumentation |
| Website | Semantic journey, session state, mocks, browser matrix and heuristics | Real Chromium/Firefox/WebKit hosted results; axe-core/pa11y, contrast and assistive technology validation |
| Android | Selector proposals, scripted journeys and evidence | Physical-device and emulator defect reproduction, framework-specific selectors and multi-screen assertions |
| iOS | Project recognition/static checks | Mac/Xcode bridge, simulator and physical iPhone validation |
| Framework adapters | Framework-specific test command planning | Real build/test execution matrices for Swift, Ruby, PHP, Dart, Go, Rust, Java/Kotlin, C/C++, .NET and Python |
| Agent quality | Evidence-based project memory and diagnosis | Labeled diagnosis benchmark, false-positive/false-negative metrics and verified-fix regression study |
| Cross-platform CI | Linux/macOS/Windows workflow configured | Push repository and capture successful hosted workflow runs |

## V2.1 suggested implementation order

1. Live DB service validation for PostgreSQL, MySQL and MariaDB; add interrupt cleanup and schema detail comparison.
2. Official CycloneDX and SPDX JSON Schema validation with pinned versions; extend license expression parsing.
3. Live scanner fixture runs and SBOM catalog comparison on supported hosts.
4. axe-core WCAG automation, contrast calculations and browser matrix runs on hosted CI.
5. Android Compose/Flutter/React Native selector adapters and physical-device defect-specific journeys.
6. OpenTelemetry DB-driver, queue and worker instrumentation packs.
7. Agent diagnosis benchmark with labeled fixtures and documented accuracy metrics.
8. SQL Server adapter design and Mac/Xcode bridge after host availability is established.

## Definition of done

- Tests for positive, negative, timeout, missing-tool, partial-create and cleanup-failure paths.
- A report that never describes simulated evidence as physical device evidence.
- The source ZIP extracts and passes tests independently.
- Real engine/scanner/browser/device runs are attached to the ledger before a production-readiness claim.
