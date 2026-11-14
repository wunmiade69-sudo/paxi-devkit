# Security policy

PAXI DevKit is a local-first developer CLI. Security reports may involve credential handling, command execution, project mutation, AI data transfer, build artifacts, or supply-chain behavior.

## Supported versions

The latest tagged release on the default branch receives security fixes. Older releases may be unsupported. Check the latest GitHub Release and `CHANGELOG.md` before reporting an issue against an old version.

## Private reporting

Do not open a public issue for an undisclosed vulnerability. Use GitHub's private security advisory reporting for the repository once enabled by the maintainer. If private advisories are unavailable, contact the maintainer through the private contact listed in the repository's GitHub security settings.

Do not include secrets in reports. Redact API keys, access tokens, SSH keys, keystores, passwords, signing files, private URLs, customer data, and unredacted screenshots.

## Report contents

Include:

- affected PAXI version and commit/tag;
- operating system, terminal environment, Node.js version, and relevant toolchain versions;
- the smallest safe reproduction that does not contain credentials or private data;
- expected and actual behavior;
- impact and whether the issue is local-only, network-facing, or supply-chain related;
- logs or support bundles only after reviewing and redacting them.

PAXI support bundles are sanitized on a best-effort basis. Review every generated bundle before sharing it.

## Security design boundaries

PAXI is not a sandbox for arbitrary project code. Builds, trusted plugins, project tests, and some diagnostics can execute local project commands with the user's permissions. Review commands and project diffs before confirming them.

PAXI does not claim that a missing security scanner is a clean result. Native scanner availability, SBOM completeness, license obligations, cloud-provider behavior, and platform signing remain operator responsibilities.
