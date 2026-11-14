# PAXI Doctor V2.7.0 — Security Testing Architecture

## Goal

Make defensive security checks a first-class Doctor capability: find likely weaknesses early, retain useful evidence without copying secret material, and distinguish a scanner pass from incomplete or unavailable coverage.

## Scanner layers

| Layer | Adapter | Evidence | Boundaries |
|---|---|---|---|
| Source heuristics | Existing `security-scan.mjs` | File/line/rule | Read-only heuristic; confidence varies |
| Secret detection | Gitleaks | Rule ID, file, line, fingerprint | Values/snippets removed; Git history capped at 1,000 commits |
| SAST | Semgrep | Rule, severity, file, line, message | Local rules offline; registry rules require online consent |
| Dependency/IaC/secrets | Trivy | CVE/misconfig/rule metadata | Local filesystem scan; DB update requires online consent |
| Smart contracts | Slither + solc | Detector, impact, affected elements | One selected Solidity file; no framework build command |
| Android package | apkanalyzer + apksigner | Manifest flags, exported component warnings, signer digest | APK is not installed or executed |
| Website surface | Native bounded GET | Response security headers/cookie attributes | Loopback by default; remote HTTPS requires allow-remote and confirmation |
| API authorization | Paired test identities | Owner/non-owner status pair | GET only, 1–25 explicit URLs, distinct tokens, no bodies retained |

## CLI

```bash
paxi doctor security advanced-tools [--json]
paxi doctor security secrets --project <dir> --confirm [--history --history-limit 1000] [--json]
paxi doctor security sast --project <dir> --rules <local.yml> --confirm [--json]
paxi doctor security sast --project <dir> --online --confirm [--json]
paxi doctor security trivy --project <dir> --confirm [--online] [--json]
paxi doctor security contracts --file <single.sol> --confirm [--json]
paxi doctor security apk --file <app.apk> --confirm [--json]
paxi doctor security web --url <url> --confirm [--allow-remote] [--timeout 8] [--json]
paxi doctor security api-authz --plan <plan.json> --confirm [--allow-remote] [--owner-token-env NAME] [--other-token-env NAME] [--json]
```

## API authorization plan format

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

Set `PAXI_TEST_OWNER_TOKEN` and `PAXI_TEST_OTHER_TOKEN` in the current shell. They must be distinct. Never use production customer credentials. The tool does not store tokens or response bodies. A 2xx result for the non-owner is always treated as a finding.

## Report semantics

- `clean`: scanner completed and produced no findings in its covered scope. It is not a security guarantee.
- `findings`: one or more findings. Review severity and reproduce safely.
- `incomplete` / `not-run`: missing tool, timeout, cancellation, truncated or invalid output. Never treat these as clean.
- Finding confidence is scanner/heuristic-specific; do not convert a static result into a confirmed exploitable vulnerability without reproduction.

## Sensitive-data handling

Gitleaks and Trivy secret values are discarded. Semgrep metavariables/source lines are omitted. API authorization tokens and response bodies are never written to reports. Reports retain only metadata required to investigate: rule, file, line, package, status codes and bounded messages.

## Safety model

All scans require `--confirm`. Remote scanner rule/DB downloads require `--online --confirm`. Remote web/API requests require HTTPS, `--allow-remote` and `--confirm`; redirect following is disabled. API authorization is limited to explicit GET URLs and paired test identities. APK analysis is static and non-executing. Solidity analysis is one file with local tools only.

## Known limitations

- Gitleaks, Semgrep, Trivy and Slither must be installed by the developer. This release does not fetch native binaries.
- Rule quality and database freshness depend on the installed scanner and local/remote configuration.
- The website header check is one GET response, not an app-wide DAST scan.
- The APK manifest parser is heuristic and does not cover runtime behavior, all binary resources, intent abuse or deep links.
- Slither single-file mode may not resolve complex imports or project remappings; use reviewed local tooling for full project analysis.
- API BOLA checks only the routes explicitly listed. They do not enumerate IDs or test mutation flows.
- No automated tool guarantees absence of vulnerabilities. Manual threat modeling, secure code review and penetration testing remain necessary for high-risk systems.
