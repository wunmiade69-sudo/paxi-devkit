# PAXI Doctor V2.1.1 — Runtime repair and QA assurance

## Termux launcher architecture

On Linux/macOS the package manager may use the `bin/paxi.mjs` Node shebang. On Android/Termux, the previous npm global-link path depended on `/usr/bin/env`, which is a standard Unix layout but is not present at that location on standard Android. The installer now writes a small launcher to `$PREFIX/bin/paxi`:

- Shebang: `/system/bin/sh` (Android system shell).
- Node executable: resolved once from the active Termux PATH and safely quoted.
- Entry file: absolute path to the versioned private-HOME `bin/paxi.mjs`.
- Arguments: forwarded unchanged as `"$@"`.
- Launcher replacement: an unrelated regular file is never overwritten; a previous generated PAXI launcher or symlink can be replaced.
- Verification: the installer runs the generated launcher with `version` and compares it with package metadata.

Run `bash scripts/install-termux.sh` from the extracted source directory. If an older command remains cached in the current shell, run `hash -r` or open a new Termux session.

## SPDX policy engine

`src/doctor/spdx-expression.mjs` implements the SPDX expression grammar used here:

- `AND` has higher precedence than `OR`.
- Parentheses override precedence.
- `WITH` applies to one license identifier.
- `LicenseRef-*` and `DocumentRef-*:LicenseRef-*` forms are recognized syntactically.

Policy evaluation is conservative and explicit:

- `A AND B`: both branches must pass.
- `A OR B`: at least one branch must pass.
- `A WITH Exception`: the license must pass and the exception must be in `allowExceptions`; explicit `denyExceptions` takes priority.
- Unknown registry identifiers and deprecated entries require review or follow the configured unknown policy.
- Separate CycloneDX license entries are treated as alternative declared expressions.

Optional official SPDX snapshots must be provided as a pair. The evaluator verifies the internal arrays, checks matching `licenseListVersion` values when present, and supports SHA-256 pins. The software does not download registry files.

## SQL Server disposable migration lab

`paxi doctor database lab --engine sqlserver` uses the `sqlcmd` executable and a loopback-only `mssql://` or `sqlserver://` administrator URL ending in `/master`. It creates a random login and database, maps the login into that database and grants `db_owner` only inside that temporary database. The random password is passed to the client with `SQLCMDPASSWORD`, never as an argument or report field. Migrations are screened for SQLCMD directives, extended stored procedures, external row sources, server-level DDL, database administration, `DBCC`, and `USE` context switches. The database is switched to single-user and dropped; the login is then removed. Cleanup failures are reported for manual handling.

This is defense-in-depth rather than a SQL sandbox: dynamic SQL, stored procedures and dialect-specific obfuscation can make static screening incomplete. Use only a disposable local SQL Server instance. For a local self-signed certificate, `PAXI_TEST_SQLSERVER_TRUST_SERVER_CERTIFICATE=1` explicitly adds sqlcmd's trust-server-certificate option; do not use it with an ordinary remote service.

## SBOM JSON Schema validation

`paxi doctor security sbom-schema` runs the local Python helper with `jsonschema`. It blocks all `$ref` values except local JSON Pointer references beginning `#/`, checks the schema itself, limits the number of reported errors, bounds input sizes, and records document/schema hashes. Supply a self-contained official schema snapshot; schema authenticity is the operator's responsibility.

## Website accessibility audit

`paxi doctor website accessibility` runs axe-core inside a locally installed Playwright browser against one or more Device Lab viewport profiles. It requires `--confirm`; remote targets require HTTPS and `--allow-remote`. Only same-origin GET/HEAD requests are allowed. The report records violations, incomplete checks, pass counts, blocked requests and browser errors. Browser viewports are simulations. Manual screen-reader, touch, and native accessibility verification remains required.

## Security and privacy

- No source edits are performed by launcher repair, SPDX checks, schema validation or accessibility scans.
- SBOM/schema/registry data is read locally.
- No provider API keys or database credentials are requested by these new commands.
- Accessibility reports record bounded snippets/selectors; review reports before sharing them because page structure can still reveal application details.
- Browser tests can execute same-origin page scripts as normal browser navigation; use a disposable staging target and account, never a production user session.
