## 2.7.0 — defensive security testing edition

- Added optional Gitleaks working-tree and bounded local Git history secret scans with report-level secret redaction.
- Added Semgrep SAST using local rules offline or explicit online registry consent.
- Added Trivy filesystem scan for vulnerability, secret and misconfiguration results.
- Added single-file Slither analysis requiring local `solc`.
- Added APK manifest review and `apksigner` verification without installing or running the APK.
- Added bounded website security-header checks and paired-account GET-only API object-authorization tests.
- Added a scanner inventory command, safe report normalization, missing-tool states and security regression fixtures.

## 2.6.0 — executable framework adapters and integration certification

- Add CMake/CTest project test execution with an isolated temporary build tree, configure/test-discovery/build/test stages, a shared timeout and cleanup evidence.
- Refuse to treat a CTest project with zero discovered tests as passed; preserve stage failures, timeout/cancellation and output completeness.
- Add Expo/React Native Jest fallback by resolving the local Jest entry point and invoking it through the current Node runtime; no `npx`, implicit download or automatic package installation.
- Retain framework identity for Expo/React Native projects whose package manifest defines a test script.
- Expand deterministic diagnosis fixtures to 24 synthetic cases covering connection refusal, disk space, port conflict, syntax/parse, JVM bytecode and TLS certificate failures with hard negatives.
- Add GitHub Actions disposable PostgreSQL 16, MySQL 8.4 and MariaDB 11 migration jobs with cleanup assertions and JSON evidence artifacts.
- Upload TAP artifacts from Chromium, Firefox and WebKit browser QA jobs.
- Add CMake, Expo/React Native and diagnosis benchmark regression fixtures.

## 2.5.0 — Evidence-linked application investigation

- Extend cross-layer correlation with stable event identifiers, input SHA-256 integrity fingerprints, timestamp-normalized events and a sorted investigation timeline; absolute input paths and raw report content are not copied into the report.
- Add evidence coverage assessment for trace propagation, backend telemetry, timestamp coverage and source execution assurance (including browser simulation versus physical Android evidence).
- Add trace-ID investigation cases and explicitly weak route-only cases, with source-layer breakdown, timeline, related correlations and missing-evidence recommendations. Route matches are never described as causal proof.
- Tighten database root-cause ranking: high confidence now requires a failed database span whose parent chain reaches an HTTP span matching the failed API route/method; otherwise the candidate remains medium confidence.
- Redact sensitive strings during cross-layer extraction and retain only allowlisted database span metadata.
- Feed missing-evidence recommendations into the Agent Engine as review-required collection steps; planning remains plan-only and does not execute tests or alter files.
- Enrich website regression drafts with bounded, issue-code-derived suggested checks while requiring developers to supply selectors, expected business behavior and executable assertions.
- Reject duplicate report bytes and enforce a global 1,000-event cap; event omissions are exposed as incomplete evidence coverage.
- Add regression coverage for timestamps, input integrity fingerprints, route-only weak grouping, secret redaction, evidence gaps, Agent planning, event caps and defect-specific website drafts.

## 2.4.0 — Explicit-consent test certification

- Extend `paxi doctor certify` with optional `--run-tests --confirm` so a developer can move from a read-only capability inventory to execution of the detected conventional project test command.
- Keep certification read-only by default; reject `--run-tests` without `--confirm` and reject orphaned `--confirm`.
- Add a 1–3600 second test timeout option, bounded test output, sensitive-value redaction, process outcome/evidence completeness reporting and meaningful non-zero command exit for failed or incomplete test evidence.
- Make the project-test executor use the same injected tool-availability resolver for both planning and execution.
- Add regression tests for non-execution without consent, confirmed passing tests, failed tests, credential redaction, invalid timeouts and missing tools.

## 2.3.0 — Local certification and diagnosis quality gates

- Add `paxi doctor certify` as a read-only inventory of local toolchains, project test-plan availability, optional browser packages and CI workflow configuration; explicitly distinguish tools found from tests executed.
- Add `paxi doctor benchmark diagnosis`, an offline synthetic benchmark that reports accuracy, precision, recall, F1, false positives and false negatives for deterministic diagnostic signatures.
- Use benchmark results to narrow the generic test-failure signature so build, dependency-resolution and network failures are not mislabeled as test failures.
- Prevent native vulnerability scans with truncated output from reporting complete coverage or a clean result; expose output byte count and truncation metadata.
- Preserve test-command exit success while separately marking captured evidence incomplete when output was truncated.
- Add regression fixtures for certification states, benchmark metrics, scanner output truncation and test output truncation.

## 2.2.0 — Evidence confidence and hosted QA

- Add metadata-content schema fingerprints for service database labs so changes to column definitions, indexes, constraints, views, triggers and routines are detected even when object counts do not change.
- Report bounded child-process output size and truncation explicitly; database metadata comparisons become indeterminate when catalog output was truncated.
- Tighten accessibility result classification: axe incomplete checks, blocked requests, runtime errors and HTTP errors require review instead of a false clean pass.
- Add cross-platform Node 20/22/24 GitHub Actions and Chromium/Firefox/WebKit browser QA workflows.
- Add regression coverage for output truncation, schema-definition changes with stable object counts, indeterminate metadata capture and accessibility review reasons.

## Follow-up review and integration fixes — 2026-11-11

- Fix PostgreSQL 16 disposable database ownership/authentication, MySQL's 32-character generated-login limit, SQL Server sqlcmd batch framing/readiness, and OSV Scanner v2 package/version/severity mapping; add regression coverage.
- Verify local Chromium, Firefox, WebKit, PostgreSQL, MySQL, MariaDB and SQL Server disposable integrations; record limits in `docs/TEST_RESULTS_V2.1.1.md`.
- Add creator attribution and voluntary support details in `docs/CREDITS_AND_SUPPORT.md` and the README.

## 2.1.1 — Termux interpreter repair and Doctor assurance upgrades

- Fix Termux CLI execution by writing an Android `/system/bin/sh` launcher that invokes the active Node binary directly, avoiding `/usr/bin/env` on Android.
- Make the installer collision-safe, quote paths and verify the installed CLI version; add path quoting, symlink protection and existing-command protection tests.
- Add a parser/evaluator for SPDX `AND`, `OR`, parentheses, `WITH`, `LicenseRef` and `DocumentRef` expression semantics.
- Add optional paired SPDX License List and Exception List membership/deprecation checks with matching versions and SHA-256 pins.
- Add offline SBOM JSON Schema validation with Python `jsonschema`, local-only `$ref` support and optional schema hash pinning.
- Add axe-core website accessibility audits via local Playwright across Device Lab viewports with same-origin GET/HEAD constraints.
- Add loopback-only SQL Server disposable migration replay via `sqlcmd`, environment-only password delivery, generated scoped login/database and cleanup evidence.
- Add tests and acceptance-gate documentation distinguishing mocks, local browser/schema checks and integrations requiring real devices/services.

## 2.0.0 — Disposable SQL engines and supply-chain policy

- Add loopback-only disposable PostgreSQL, MySQL and MariaDB migration replay with random databases/users, restricted privileges, private temporary credentials, stdin SQL streaming and explicit cleanup reporting.
- Add structural CycloneDX JSON and SPDX JSON SBOM validation with bounded inputs, duplicate-ID/reference checks and artifact hashes.
- Add configurable component license policy screening with allow/deny/unknown handling and exact, reasoned exceptions.
- Record locally detected native scanner versions independently from advisory results.
- Add service-engine fake-client integration tests for success, migration failure, partial creation, blocked client directives and cleanup failure.
- Preserve explicit limits: no SQL Server adapter, no live production DB certification, no official JSON Schema conformance claim and no legal interpretation of license expressions.

## 1.9.0 — Disposable database lab, native security and real OTLP probe

- Add opt-in synthetic OTLP/HTTP trace exporter validation with loopback default, explicit remote HTTPS consent, request timeout and response-body discard.
- Add an in-memory SQLite migration replay lab with seed schema support, migration snapshots, integrity checks and restrictions against ATTACH/DETACH/PRAGMA/VACUUM/extension and external-file operations.
- Add optional native vulnerability scanner adapters for OSV-Scanner, cargo-audit, govulncheck, pip-audit, Composer audit and .NET.
- Add local Syft CycloneDX/SPDX SBOM generation with output validation and SHA-256 metadata.
- Add Playwright private storage-state loading/saving, exact same-origin JSON response mocks, basic accessible-name/image-alt/Tab assertions and Chromium/Firefox/WebKit journey matrix.
- Expand framework test planning for Swift, Ruby, PHP and Dart and report missing toolchains explicitly.
- Add integration tests for OTLP receiver behavior, SQL sandbox restrictions, security adapter output, SBOM integrity, private session storage, network mocks and browser matrix uncertainty.

## 1.8.0 — Observability packs and semantic defect reproduction

- Add opt-in OpenTelemetry setup packs for Node/Express, Python/FastAPI, Go, Java/Spring and .NET/ASP.NET Core.
- Add semantic Playwright website journeys, test-only environment inputs, same-origin navigation restrictions and W3C trace propagation.
- Add Android selector proposals from UIAutomator hierarchy with resource-ID-only evidence.

## Earlier releases

See Git history and previous release notes for V1.7.0 and earlier milestones.

## 2.1.1 - 2026-11-11

- Fixed Termux `paxi` interpreter errors by generating a native Android shell launcher that directly invokes the active Node binary.
- Added installer collision protection, absolute-path quoting, private-storage installation verification and regression tests.
- Added SPDX expression parser with AND/OR precedence, parentheses, WITH exceptions, LicenseRef and DocumentRef support.
- Added SPDX License List/Exception List snapshot membership checks, version matching and SHA-256 pins.
- Added offline SBOM JSON Schema validation using local Python `jsonschema`; external references are blocked.
- Added Playwright + axe-core website accessibility audit across responsive Device Lab profiles.
- Added release and remaining-work documentation with real-environment acceptance gates.
