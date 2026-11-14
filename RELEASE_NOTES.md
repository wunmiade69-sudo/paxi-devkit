# PAXI DevKit V2.7.0 — Security Edition

V2.7.0 is reconstructed from the available V2.6.0 source archive and extends it with the defensive security capabilities described in the PAXI Doctor roadmap. The Termux-native launcher and previous build, AI, Agent, database, browser and C++ features are preserved from that baseline.

## Security capabilities

- Local Gitleaks secret scan for working tree and a bounded Git history window (maximum 1,000 commits). Reports retain rule, file, line and fingerprint only; secret values and matched source are discarded.
- Semgrep SAST with user-supplied local rules in offline mode. Registry/`auto` rules require explicit `--online --confirm`.
- Trivy filesystem scan for vulnerabilities, infrastructure misconfiguration and secrets. Online database updates require explicit consent. Secret values/snippets are not retained.
- Slither static analysis on one selected `.sol` file, requiring local `slither` and `solc`; no project build scripts are invoked.
- Android APK manifest and signature inspection using `apkanalyzer`/`apksigner`; does not install or execute APKs.
- Website security-header review for CSP, HSTS, framing, nosniff, referrer policy, cookie attributes and wildcard credentialed CORS.
- Paired-account API object authorization testing: developer-authored GET-only plan, distinct owner and non-owner test tokens, expected owner 2xx and non-owner 403/404; no response bodies or tokens retained.
- `paxi doctor security advanced-tools` shows native scanner availability. Missing tools are `not-run`, never green.

## Main commands

```bash
paxi doctor security advanced-tools
paxi doctor security secrets --project . --confirm
paxi doctor security sast --project . --rules ./semgrep.yml --confirm
paxi doctor security trivy --project . --online --confirm
paxi doctor security contracts --file ./contracts/Token.sol --confirm
paxi doctor security apk --file ./app-release.apk --confirm
paxi doctor security web --url http://127.0.0.1:8080 --confirm
paxi doctor security api-authz --plan ./api-authz-plan.json --confirm
```

## Security and scope boundaries

- Scanning only targets a local project/artifact path supplied by the developer.
- Online scanner database/rule retrieval requires `--online --confirm`.
- Remote web/API targets require HTTPS and `--allow-remote --confirm`; redirects are not followed.
- API authorization tests send only listed GET requests and require two different test identities. Use a staging system and accounts you control.
- No brute force, credential guessing, destructive HTTP verbs, exploit payload spraying, or production mutation is implemented.
- Static findings are hypotheses until reproduced; scanner clean status does not prove the system is secure.

## Verification boundary

Automated tests cover adapters, consent gates, report sanitization, incomplete/tool-missing states, API authorization logic and loopback HTTP integration. Native Gitleaks, Semgrep, Trivy, Slither, `solc`, Android SDK tools, live remote targets and physical-device checks require separate local verification.
