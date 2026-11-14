# PAXI DevKit V2.0.0 test record

## Environment and baseline

- Node.js runtime: packaging container; package engine baseline remains Node.js 20 or newer.
- Python 3: available and used by the SQLite migration lab integration.
- Native PostgreSQL (`psql`), MySQL and MariaDB clients: not installed.
- Docker/Podman: not installed.
- Syft, OSV-Scanner and other native advisory scanners: not installed.
- Playwright and browser binaries: not installed.

## Verified locally

- Full regression suite: 248 tests total; 246 passed, 0 failed, 2 skipped. The skips are the Windows-host integration test and optional real Chromium Playwright test.
- V2.0 targeted suite: 12 passed, 0 failed. Includes service database preflight, fake PostgreSQL/MySQL/MariaDB execution and cleanup, IPv6 loopback host matching, failure/cleanup-failure handling, blocked client directives, SBOM structural checks, license-policy allow/deny/unknown/exception handling and scanner-version reporting.
- `npm run check`: 82 JavaScript files plus Termux shell scripts passed syntax checks.
- `npm ci`: passed; there are no runtime dependencies in the package.
- `npm pack --dry-run`: package contents enumerated successfully.
- CLI version metadata and V2.0 database/SBOM commands exercised with local fixtures.

## Not verified in this environment

- Live PostgreSQL, MySQL 8.x or MariaDB service compatibility; service adapters use fake native-client integration tests here.
- SQL Server adapter (not implemented).
- Official CycloneDX/SPDX JSON Schema conformance; current validator is structural.
- Full SPDX license-expression semantics; compound expressions are conservatively screened.
- Real Syft SBOM generation and native advisory scanner runs.
- Hosted GitHub Actions Linux/macOS/Windows matrix.
- Real Chromium/Firefox/WebKit browser execution, physical Android device, iOS simulator or iPhone.

Mocked native-client tests prove command construction, stdin handling, restricted account/database statements, report parsing and cleanup control flow. They do not certify actual database engine compatibility. Never point service database environment variables at production. See `REMAINING_WORK_V2.0.0.md` for the release gates.
