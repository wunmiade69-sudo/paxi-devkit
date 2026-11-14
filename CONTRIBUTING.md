# Contributing to PAXI DevKit

Thank you for helping improve PAXI DevKit. Contributions should preserve its local-first behavior, explicit-consent boundaries, and cross-platform safety claims.

## Before opening an issue or pull request

- Read `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and the relevant platform guide.
- Search existing issues and pull requests.
- Never include API keys, private logs, customer data, signing material, or unredacted screenshots in an issue.

## Local development

Requirements: Node.js 20 or newer and Git.

```bash
npm ci
npm run check
npm test
```

For Termux development, keep the checkout in private storage such as `$HOME/projects`; do not use `npm link` from shared Android storage.

## Pull requests

A good pull request should:

1. Explain the user-facing problem and the chosen behavior.
2. Include focused tests for changed behavior and safety boundaries.
3. Update documentation, release notes, or examples when the command surface changes.
4. Preserve explicit confirmation for network access, destructive actions, spending, project mutation, and remote-data transfer.
5. Avoid unrelated formatting or generated-file changes.

Before committing:

```bash
npm run check
npm test
git diff --check
git status --short
```

## Security-sensitive changes

Do not add silent downloads, shell interpolation, credential persistence, remote builders, destructive HTTP verbs, or automatic retries of billable AI generation requests. Discuss security-sensitive changes privately using the process in `SECURITY.md` before opening a public issue.

## Commit and release conventions

Use concise imperative commit messages. Release tags use semantic versioning such as `v2.7.0`. Only maintainers create public release tags and release assets. Follow `docs/RELEASE_RUNBOOK.md` and `docs/RELEASE_CHECKLIST.md` for public launches.

## License

By contributing, you agree that your contribution is provided under the repository's MIT license.
