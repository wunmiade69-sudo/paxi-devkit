# PAXI Doctor V2.6.0 — real project adapters and integration evidence

## Goals

V2.6.0 closes part of the V2.5.0 roadmap by adding executable CMake/CTest support, local Jest fallback for Expo/React Native, a broader deterministic diagnosis corpus, and hosted integration jobs that retain database/browser evidence.

## Project test adapters

### CMake / C++

When a top-level `CMakeLists.txt` declares `enable_testing()` or `include(CTest)`, the read-only test planner checks for both `cmake` and `ctest`. With explicit confirmation, the executor:

1. Configures the project with `BUILD_TESTING=ON` in a disposable OS temporary directory.
2. Discovers tests using `ctest --show-only` (and a JSON inventory fallback when necessary).
3. Refuses to report success when zero tests are discovered.
4. Builds with the Debug configuration and two parallel workers.
5. Runs CTest with failure output enabled.
6. Removes the temporary build directory and records cleanup status.

No generated CMake files are written into the project directory. CMake configuration/build scripts are project-controlled code, so execution requires the existing explicit `--run-tests --confirm` gate. The total timeout is shared across all stages. Truncated output, timeout, cancellation, a failed stage, no discovered tests or failed cleanup cannot produce a clean pass.

Example:

```bash
paxi doctor certify --project .
paxi doctor certify --project . --run-tests --confirm --timeout 1800 --json
```

The CMake adapter currently expects tests to be registered with CTest from the top-level CMake project. Projects that define tests only in an unreferenced subdirectory may require a top-level `add_subdirectory(...)`/CTest configuration before PAXI can discover them.

### Expo / React Native Jest

If an Expo or React Native project has no `scripts.test` but declares a Jest configuration, PAXI resolves an already-installed local Jest entry point from the project and invokes it with the current Node executable and `--runInBand`. It never uses `npx` and never downloads a missing test runner. Missing local Jest is reported as `tool-missing`.

If a package `test` script exists, the existing package-manager path is retained but the plan identifies Expo/React Native rather than labeling the project as generic Node.js.

Example:

```bash
paxi doctor certify --project .
paxi doctor certify --project . --run-tests --confirm
```

The test script remains project-controlled code. Review it before confirmation. This is unit/test-runner support, not a claim that Expo/React Native apps have been built or exercised on a physical device.

## Diagnosis benchmark

`paxi doctor benchmark diagnosis` now evaluates dataset version `1.1.0`, a 24-case synthetic fixture corpus. New signatures cover service connection refusal, disk-space exhaustion, port conflicts, syntax/parse errors, JVM bytecode version mismatches and TLS certificate verification errors. Hard-negative fixtures check that benign server startup and test names are not mislabeled as failures.

The benchmark measures deterministic text-signature classification only. It does not evaluate LLM reasoning, root-cause correctness, patch quality or real-world diagnosis. The corpus is synthetic, not an independently sourced real-incident dataset.

## Hosted integration workflows

### Database service matrix

`.github/workflows/database-matrix.yml` runs the disposable migration lab against ephemeral PostgreSQL 16, MySQL 8.4 and MariaDB 11 services. The workflow uses test-only administrator credentials, local runner loopback endpoints and the same two SQL fixture migrations. The report assertion requires migration replay success, schema comparison evidence and completed cleanup. JSON reports are uploaded as workflow artifacts even when a job fails.

SQL Server remains covered by local/mock regression fixtures until a stable hosted SQL Server service/client job is configured and run. This release does not claim SQL Server live certification.

### Browser artifacts

`.github/workflows/browser-matrix.yml` runs Chromium, Firefox and WebKit semantic/accessibility tests and uploads each browser's TAP output as a separate artifact. Workflow configuration is present, but actual hosted job results exist only after the source is pushed and GitHub Actions runs.

## Privacy and safety

- CMake build output is written to a random OS temporary directory and removed after testing.
- Jest fallback resolves an installed package locally; no remote package fetch is performed.
- Existing explicit execution confirmation remains in force.
- Test output remains bounded and secret-pattern redacted by the shared executor.
- Database workflow credentials are CI-only fixture credentials; no production database is supported by the service lab.
- Browser workflow artifacts contain test output, not browser storage-state files.

## Verification boundaries

The local release tests include a real CMake/C++ compile and CTest run on the packaging host, and mocked Expo/React Native Jest resolution/execution checks. The database integration workflow is configured but has not run in the packaging environment. Hosted PostgreSQL/MySQL/MariaDB results, Chromium/Firefox/WebKit artifacts, SQL Server live service verification, a physical Termux install, native Android framework runtime tests and Mac/Xcode builds remain external acceptance items.
