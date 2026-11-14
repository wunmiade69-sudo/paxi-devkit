# PAXI DevKit production launch checklist

Use this checklist before making a release public.

## Source and metadata

- [ ] `package.json` version, `CHANGELOG.md`, `RELEASE_NOTES.md`, and documentation agree.
- [ ] `npm pack --dry-run` contains only intended files.
- [ ] `npm ci`, `npm run check`, and `npm test` pass.
- [ ] The supported Node.js baseline is documented.
- [ ] The MIT license is present and the author/credits are accurate.
- [ ] No stale version names or old repository URLs remain in active installation instructions.

## Security and privacy

- [ ] No API keys, SSH private keys, Android keystores, signing passwords, `.env` files, tokens, or personal data are staged.
- [ ] `git diff --cached --check` passes.
- [ ] The root `SECURITY.md` explains private vulnerability reporting and supported versions.
- [ ] Secret scanning is enabled in GitHub where available.
- [ ] GitHub Actions permissions are least-privilege and workflows do not print secrets.
- [ ] Release archives and checksums are generated from the exact tagged commit.
- [ ] AI provider data boundaries and remote-image approval behavior are documented.

## GitHub repository

- [ ] Repository name and owner are correct.
- [ ] Public visibility is intentional.
- [ ] Issues and Actions are enabled.
- [ ] `main` is the default branch.
- [ ] Pull requests require passing CI before merge.
- [ ] Release tags matching `v*` are protected after initial setup.
- [ ] Dependabot alerts and security updates are enabled where available.
- [ ] Issue templates and the pull-request template are present.

## CI evidence

- [ ] Ubuntu CI passes.
- [ ] macOS CI passes.
- [ ] Windows CI passes.
- [ ] Browser matrix passes for the configured browser engines.
- [ ] Database matrix passes when container services are available.
- [ ] Any remaining skip is explicitly host-bound and documented.

## Termux release smoke test

- [ ] Install from the public release archive, not the local working directory.
- [ ] Verify the SHA-256 checksum before extraction.
- [ ] Keep the source under `$HOME/projects`, not shared storage.
- [ ] `bash scripts/install-termux.sh` succeeds.
- [ ] `paxi version`, `paxi detect . --json`, and `paxi doctor --json` work.
- [ ] Android builds are tested only after the device-specific Flutter/Android toolchain is installed.
- [ ] ADB installation is tested with an authorized device before claiming device-install support.

## Release and rollback

- [ ] Annotated tag points to the CI-approved commit.
- [ ] GitHub Release notes identify known platform boundaries.
- [ ] ZIP and checksum assets download successfully from a clean session.
- [ ] A rollback/correction plan exists before announcement.
- [ ] npm publication is either intentionally deferred or completed through an approved trusted-publishing process.
