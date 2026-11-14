# PAXI Doctor V2.2.0 — Evidence confidence and hosted QA

V2.2.0 strengthens three parts of the V2.1.1 Doctor system: subprocess evidence integrity, database schema comparison, and accessibility result confidence. It also adds repeatable hosted CI workflows.

## 1. Process output integrity

`runProcess()` now returns:

- `outputBytes`: total bytes observed across captured stdout and stderr.
- `outputTruncated`: `true` when the configured combined capture limit omitted bytes.

The cap still applies to captured output; the process is not terminated merely because output exceeds the capture limit. Full log-file streaming, when explicitly requested by a caller, remains separate from bounded in-memory capture. Consumers that need complete output must check `outputTruncated`.

## 2. Database schema content fingerprints

The service database lab continues to capture object counts, and now also queries metadata for:

- Columns, types, nullability and defaults.
- Index definitions and column ordering.
- Constraints and key-column associations.
- Views and their definitions.
- Triggers and action definitions.
- Stored routines/modules where the engine exposes them.

Supported query adapters:

- PostgreSQL
- MySQL
- MariaDB
- SQL Server

PAXI hashes the returned catalog metadata in memory and records only the SHA-256 fingerprint, byte count and availability. Raw catalog definitions are not persisted in the report. The metadata capture is bounded at 2 MiB. If the query fails, times out, is cancelled or exceeds that limit, the report marks detailed comparison unavailable.

The report now contains `schemaComparison`:

- `changed`: content fingerprints differ, or object counts differ when detailed metadata could not be captured.
- `unchanged`: both detailed metadata fingerprints match.
- `indeterminate`: detailed metadata is unavailable and object counts are unchanged. PAXI does not claim the schema is unchanged.

`schemaChanged` remains for compatibility: `true`, `false`, or `null` when indeterminate.

This is a disposable migration replay, not a full production migration rehearsal. The SQL catalog queries should still be validated against each real supported engine/version in the operator's environment.

## 3. Accessibility confidence policy

The website accessibility runner already uses Playwright and axe-core. V2.2.0 tightens its case classification:

- axe-core violations -> `review`.
- axe-core incomplete checks -> `review` (manual review required).
- Blocked requests -> `review` because missing assets or APIs may change page rendering.
- Browser runtime errors -> `review`.
- HTTP response errors -> `review`.
- `passed` is used only when all these evidence groups are empty.

The report includes `reviewReasons` per case and summary counts for incomplete checks, blocked requests, runtime errors, HTTP errors and cases needing review. A browser audit remains a WCAG-related automated assessment, not a full accessibility certification.

## 4. Hosted verification workflows

Two GitHub Actions workflows are included:

- `.github/workflows/ci.yml`: Node 20, 22 and 24 across Ubuntu, macOS and Windows, including syntax checks, Python helper validation, the full test suite, CLI smoke tests and npm package dry-run.
- `.github/workflows/browser-matrix.yml`: real semantic journey and axe-core accessibility fixtures in Chromium, Firefox and WebKit.

The workflows are configuration only until the project is pushed to GitHub and the jobs actually run. Their presence is not evidence of a green hosted run.

## 5. Termux install and interpreter repair

The V2.1.1 Termux-native launcher remains in place. On Termux, run the installer using Bash from the extracted source directory:

```bash
pkg install nodejs-lts unzip
cd ~/storage/downloads
unzip -o paxi-devkit-v2.2.0.zip -d ~/projects
cd ~/projects/paxi-devkit-v2.2.0
bash scripts/install-termux.sh
hash -r
paxi version
paxi doctor --json
```

The extraction folder is versioned as `paxi-devkit-v2.2.0` in the release archive. Use that path in the `cd` command. The installer relocates a shared-storage copy into Termux private storage and writes `$PREFIX/bin/paxi` with `/system/bin/sh`, an exact Node executable path and an absolute CLI entry path. Do not use `npm link` on Termux.

If the old command remains in the current shell, run `hash -r` or open a fresh Termux session.

## 6. Safety and privacy

- Schema metadata is hashed in memory; raw schema definitions are not placed in reports.
- Process output remains bounded and truncation is explicit.
- Database service labs remain loopback-only and require explicit confirmation.
- Website checks require `--confirm`; remote testing still requires HTTPS and explicit `--allow-remote`.
- Accessibility checks continue to block cross-origin and mutating requests.
- No AI patch is applied by these upgrades.
