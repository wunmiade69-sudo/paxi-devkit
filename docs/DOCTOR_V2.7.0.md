# PAXI Doctor V2.7.0 — Defensive security testing

V2.7.0 promotes security testing to a first-class PAXI Doctor area. It builds on the available V2.6.0 source and preserves its Termux launcher, AI Studio, Agent Engine, build adapters, database lab, cross-layer evidence, and QA workflows.

## Security command map

| Command | Purpose | External tool |
|---|---|---|
| `doctor security scan` | Existing local source/config heuristic scan | None |
| `doctor security secrets` | Working-tree or bounded Git-history secret scanning | Gitleaks |
| `doctor security sast` | Static application security testing | Semgrep |
| `doctor security trivy` | Dependency vulnerabilities, IaC misconfiguration and secrets | Trivy |
| `doctor security contracts` | Single-file Solidity static analysis | Slither + solc |
| `doctor security apk` | Android manifest review and APK signature verification | apkanalyzer + apksigner |
| `doctor security web` | HTTP security header and cookie policy review | Bounded native GET |
| `doctor security api-authz` | Owner/non-owner object authorization check | Bounded native GET |
| `doctor security advanced-tools` | Native tool availability inventory | None |

## Quick start

```bash
paxi doctor security advanced-tools
paxi doctor security scan --project .
paxi doctor security secrets --project . --confirm
paxi doctor security sast --project . --rules ./semgrep.yml --confirm
paxi doctor security trivy --project . --online --confirm
paxi doctor security contracts --file ./contracts/Token.sol --confirm
paxi doctor security apk --file ./app-release.apk --confirm
paxi doctor security web --url http://127.0.0.1:8080 --confirm
```

API authorization plan example:

```json
{
  "cases": [
    {
      "id": "profile-owner-boundary",
      "method": "GET",
      "url": "https://staging.example.test/api/profiles/123",
      "ownerExpected": [200],
      "nonOwnerExpected": [403, 404]
    }
  ]
}
```

Set two different test credentials through environment variables, then run:

```bash
export PAXI_TEST_OWNER_TOKEN='owner-test-token'
export PAXI_TEST_OTHER_TOKEN='other-test-token'
paxi doctor security api-authz --plan ./api-authz-plan.json --confirm --allow-remote
```

Do this only against an authorized staging environment. The runner sends the exact listed GET requests, does not follow redirects, discards response bodies, and never records tokens. It rejects non-owner expected success statuses.

## Report states

- `clean`: the selected scanner completed and returned no findings within the scanned scope. This is not proof of security.
- `findings`: one or more findings require review.
- `not-run` / `incomplete`: scanner unavailable, failed, timed out, cancelled or produced incomplete/invalid evidence. These are never clean.

Severity and confidence are retained separately. Findings from static heuristics are leads, not confirmed vulnerabilities.

## Security controls

- All native security scans require `--confirm`.
- Semgrep registry configuration and Trivy vulnerability DB updates require `--online --confirm`.
- Remote website/API targets require HTTPS, `--allow-remote` and confirmation.
- Gitleaks and Trivy secret values are removed from normalized reports; Semgrep source snippets/metavariables are discarded.
- APK analysis is static; no install or launch occurs.
- Solidity analysis is restricted to one selected `.sol` file and local compiler; project build scripts are not invoked.
- API authorization tests are GET-only, limited to 25 developer-defined routes and two distinct test identities.

## Operational requirements

Native scanners are installed independently by the developer. PAXI does not download scanner executables. For Android APK analysis, add the Android SDK `cmdline-tools` and build-tools directories to PATH. On Termux, continue using `bash scripts/install-termux.sh`; do not use `npm link`.

## Known gaps

See `SECURITY_TESTING_V2.7.0.md` and `REMAINING_WORK_V2.7.0.md` for live scanner verification, full project-level Solidity analysis, APK runtime checks, application-wide DAST, authenticated API role/tenant coverage, iOS static/runtime review, and AI diagnosis benchmarks.
