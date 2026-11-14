# PAXI Doctor V1.4.0 — API Contracts and Database Migration Safety

V1.4.0 extends the backend portion of PAXI Doctor. It can inspect API contracts, run a small set of explicitly confirmed read-only API checks, and review SQL migration files for risky patterns. It does not connect to a database, run migrations, perform load testing or call mutating HTTP endpoints.

## 1. OpenAPI / Swagger JSON inspection

Run a structural inspection without contacting the API:

```bash
paxi doctor api spec --file ./openapi.json
paxi doctor api spec --file ./openapi.json --json
```

The inspector supports OpenAPI 3.x and Swagger 2.0 JSON. It reports missing API metadata and paths, invalid operations, missing responses, duplicate `operationId` values, unresolved local `$ref` references, undeclared path parameters, incorrectly optional path parameters, and non-HTTPS remote server definitions.

The inspection is read-only. It does not fetch external `$ref` values or prove that the live service matches the contract. Convert YAML files to JSON before inspection in this release. A malformed/unsupported spec is not reported as valid.

## 2. Read-only API smoke tests

Create a JSON plan such as `docs/examples/api-smoke-plan.json`, change the local base URL and paths to match your own test service, then review it:

```bash
paxi doctor api test --file ./docs/examples/api-smoke-plan.json
```

The command above is not enough to send requests; `--confirm` is mandatory:

```bash
paxi doctor api test --file ./docs/examples/api-smoke-plan.json --confirm
```

For a non-loopback remote target, use HTTPS and explicit remote consent:

```bash
paxi doctor api test --file ./api-tests.json --confirm --allow-remote
```

The plan schema is deliberately small:

```json
{
  "schemaVersion": 1,
  "name": "Local API smoke tests",
  "baseUrl": "http://127.0.0.1:8080/api",
  "bearerTokenEnv": "PAXI_TEST_API_TOKEN",
  "cases": [
    {
      "id": "health",
      "method": "GET",
      "path": "/health",
      "expectedStatus": [200],
      "contentTypeIncludes": "application/json",
      "jsonPathsExist": ["status", "dependencies.database.status"]
    },
    {
      "id": "missing-route",
      "method": "GET",
      "path": "/route-that-should-not-exist",
      "expectedStatus": [404]
    }
  ]
}
```

Supported safeguards and limits:

- Only GET and HEAD are accepted. POST, PUT, PATCH, DELETE, OPTIONS and TRACE are rejected.
- Every run requires `--confirm`, including loopback checks. Non-loopback targets additionally require HTTPS and `--allow-remote`.
- Base URLs cannot contain embedded credentials, query strings or fragments. Per-case paths cannot contain query strings, fragments, control characters, backslashes or dot segments.
- At most 25 cases are accepted; each request has a 0.5–30 second timeout.
- `bearerTokenEnv` names an environment variable. The token is read at execution time, never written to the plan/report/config, and is not included in console or JSON results.
- JSON response assertions are bounded to 64 KiB and evaluated in memory. Response bodies are never included in the report. Only status, duration, content type, case IDs, paths and assertion outcomes are retained.
- Redirects are not followed. Configure the test against the intended final URL.
- Choose a non-production test service and least-privilege test token. GET requests can still have side effects in poorly designed APIs; `--confirm` is an explicit acknowledgement of the target and plan.

The runner is a small API smoke/contract check. It is not load testing, exhaustive schema validation, authorization testing or proof of data correctness.

## 3. SQL migration safety review

Run an offline static scan:

```bash
paxi doctor database scan --project .
paxi doctor database scan --project . --json
```

It looks for high-risk patterns including:

- `DROP TABLE`, `DROP SCHEMA`, `DROP DATABASE`, `TRUNCATE` and column removal.
- `DELETE` or `UPDATE` statements without a `WHERE` clause.
- Adding a `NOT NULL` column without an explicit default/backfill in the same statement.
- Column type changes that may rewrite data or take locks.
- PostgreSQL index creation without `CONCURRENTLY` as a review hint.
- Broad `GRANT ALL` permissions and extension creation.

Line comments, block comments and quoted string contents are masked before pattern matching to reduce false positives. Symlinks and common generated/vendor directories are not followed. File sizes and scan totals are bounded.

This is heuristic static review. It cannot parse every SQL dialect, infer table sizes, validate application compatibility, prove rollback safety, predict exact lock behavior or guarantee that a migration is safe. It never connects to a database or changes a file. Review every result with the target database engine and migration framework in mind.

## 4. Suggested backend workflow

1. Inspect the API definition with `doctor api spec`.
2. Start the application locally using your normal development workflow.
3. Review the smoke-test JSON plan and use a dedicated test environment.
4. Run confirmed GET/HEAD API tests and inspect the structured results.
5. Run `doctor database scan` on migration files before any separate, manually controlled migration workflow.
6. Run the existing website Device Lab and project test commands.
7. Record physical-device, browser-simulation and live-service evidence distinctly; do not promote simulated results to physical-device passes.

## Verification boundaries

Automated tests use mocked HTTP responses and temporary SQL fixtures. A real API run requires a developer-selected service; remote requests require explicit consent. Database migrations are never executed by this feature. YAML conversion, external `$ref` resolution, live OpenAPI conformance, full SQL parsing, migration execution and database integration testing are not included in V1.4.0.
