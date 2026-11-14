# PAXI DevKit V1.9.0 — local verification record

Run on the current Linux development host with Node.js and Python 3 available.

| Check | Result |
|---|---|
| `npm ci` | Passed; 1 package audited, 0 reported vulnerabilities |
| `npm run check` | Passed; 80 JavaScript files and Termux shell scripts syntax-checked |
| PAXI Doctor `test --project . --confirm --json` | 235 tests total; 234 passed, 0 failed, 1 Windows-host-only test skipped; files run serially to avoid process-environment cross-test interference |
| SQLite lab integration | Passed against Python 3 standard-library SQLite in-memory runner |
| OTLP exporter probe | Passed against a local Node HTTP receiver; positive and negative response behavior tested |
| Website journey policy | Passed using controlled Playwright mocks for session privacy, same-origin mocks, cross-origin API allowlisting, keyboard/a11y assertions and unavailable-engine labeling |
| Security scanner/SBOM adapters | Unit tests use fake executables/output; no native scanner or Syft binary was installed for a live scan here |
| Actual browser engine | Real Playwright Chromium semantic journey passed against a local fixture with request mocking, keyboard/a11y assertions and screenshot capture |
| CMake integration build | Passed against an explicitly confirmed local C++ fixture; unsafe symlink build-path rejection also passed |
| CLI smoke checks | `paxi version` and `paxi --help` passed; `paxi doctor --json` emitted valid JSON and reported missing host toolchains (exit 11, expected on this host) |
| Physical Android/iOS | Not run in this environment |
| Hosted Linux/macOS/Windows CI | Workflow configured, but no hosted result is claimed until GitHub Actions executes it |

The one skipped test on this host is the Windows-host-only integration test. Enabling Chromium and CMake integration exposed and led to fixes for primary-page closure by the popup guard and asynchronous semantic text assertions; both integrations now pass. The CI workflow installs Python 3 for the OS matrix and installs each Playwright browser in its own Ubuntu job.

A green unit suite does not certify real collector persistence, vendor database migration behavior, online scanner coverage, real browser binaries on all hosts, physical Android behavior or native iOS behavior. See `REMAINING_WORK_V1.9.0.md` for these release gates.
