# PAXI Doctor V2.0.0 — Disposable SQL engines and supply-chain policy

V2.0.0 builds on the V1.9.0 observability, browser, SQLite and scanner capabilities. It adds local loopback PostgreSQL/MySQL/MariaDB migration replay, SBOM structural validation, configurable license policy evaluation, and scanner-version evidence.

## Database Lab

SQLite remains the default in-memory lab:

```bash
paxi doctor database lab --engine sqlite --project . --migrations migrations --confirm
```

Optional service-backed local labs:

```bash
# Configure these in the current shell/session; never commit connection strings.
export PAXI_TEST_POSTGRES_ADMIN_URL='postgresql://test_admin:password@127.0.0.1:5432/postgres'
paxi doctor database lab --engine postgres --project . --migrations migrations --confirm

export PAXI_TEST_MYSQL_ADMIN_URL='mysql://test_admin:password@127.0.0.1:3306/mysql'
paxi doctor database lab --engine mysql --project . --migrations migrations --confirm

export PAXI_TEST_MARIADB_ADMIN_URL='mariadb://test_admin:password@127.0.0.1:3306/mysql'
paxi doctor database lab --engine mariadb --project . --migrations migrations --confirm
```

The admin URL must target a local service (`localhost`, `127.0.0.1`, or `::1`) and the maintenance database (`postgres` or `mysql`). `localhost` is normalized to IPv4 loopback for MySQL account matching; IPv6 `::1` uses a matching IPv6 account host. Query parameters, fragments and remote hosts are rejected. The client binary must be installed (`psql`, `mysql`, or `mariadb`). The admin account needs permission to create and drop a database and temporary database user/role.

PAXI generates unpredictable database and user names for each run. PostgreSQL gets a `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` role and a database cloned from `template0`; MySQL/MariaDB gets a user with grants scoped to the generated database. Client credentials are written to a private temporary file, SQL is piped on stdin, client meta-commands and known external-file/server operations are rejected, and cleanup is attempted on both success and failure.

**Use a dedicated local test database service. Never configure a production administrator URL.** The report includes the generated database name and cleanup result so an incomplete cleanup can be handled. If cleanup fails, the report fails and names the generated resource for manual removal. Service-backed database adapters have mocked process integration tests in this release; live PostgreSQL/MySQL/MariaDB servers were not available in the packaging environment.

SQL Server is not supported by the disposable service lab yet. It remains a separate roadmap item.

## SBOM validation

```bash
paxi doctor security sbom-validate --file ./paxi-sbom.cdx.json
```

This performs local structural validation for CycloneDX JSON and SPDX JSON: required top-level fields, component/package arrays, names, version/document identifiers and duplicate references/IDs. It does **not** claim formal conformance to the official JSON Schemas. Use an official schema validator in release CI for a formal conformance gate.

## License policy

Start with `examples/license-policy.example.json`, customize it for the project, and review every deny/exception decision:

```bash
paxi doctor security licenses \
  --sbom ./paxi-sbom.cdx.json \
  --policy ./license-policy.json
```

Policy format:

- `schemaVersion`: must be `1`.
- `allow`: optional allow-list of SPDX identifiers. When non-empty, every identifier extracted from a component expression must be included.
- `deny`: explicit blocked SPDX identifiers.
- `unknown`: `fail` (default) or `warn` when license metadata is absent/unrecognized.
- `exceptions`: exact component `name`, optional exact `version`, and a non-empty review `reason`. Malformed, blank or oversized exception records are rejected rather than silently ignored.

The evaluator conservatively tokenizes compound SPDX expressions; it does not resolve every SPDX expression operator as a legal parser would. An expression containing `MIT OR Apache-2.0` therefore requires both identifiers on a configured allow-list. This is a screening rule, not legal advice.

## Scanner version evidence

Native advisory scan reports now record the locally reported scanner version separately from scan results. If the version command fails, the version is `unknown`; this does not prevent the scan, and it does not make coverage complete. Missing scanners, unparsed output and unknown package coverage remain non-clean states.

## Process input

`runProcess` now supports an explicit string/Buffer `stdin` option. Commands continue to use `spawn` with `shell:false`; the new database adapters use stdin to keep SQL and generated credentials out of command-line arguments.

## Verification boundary

The release test suite uses fake native database clients and does not claim live database engine compatibility. Run the three supported engines on disposable local services before using the lab on real project migrations. Real native scanner binaries, Syft, official SBOM schemas, Playwright engines, physical Android and hosted Linux/macOS/Windows CI remain environment-dependent checks. See `REMAINING_WORK_V2.0.0.md` and `TEST_RESULTS_V2.0.0.md`.
