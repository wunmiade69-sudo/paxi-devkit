# PAXI DevKit v2.7.0 public release runbook

This runbook covers a first public GitHub release from a Termux terminal. Replace every `YOUR_GITHUB_USERNAME` and `YOUR_REPOSITORY` placeholder before running commands. The recommended repository name is `paxi-devkit`.

## Release model

PAXI is a Node.js CLI. GitHub is the source-of-truth distribution until an npm package is deliberately published. A public GitHub release should contain the source tree, CI workflows, documentation, the MIT license, and a checksummed release archive. Do not publish API keys, Android signing material, personal configuration, build outputs, or private test data.

The release is public only after you confirm all of the following:

- The GitHub repository owner and repository name are correct.
- The repository visibility is intentionally **Public**.
- The staged file list contains no secrets or private files.
- GitHub Actions succeeds on the supported matrix.
- The release tag and attached archive refer to the same commit.

## 1. Prepare Termux

Install the base packages and keep the working tree in Termux private storage. Do not build or run `npm link` from shared Android storage.

```bash
pkg update -y
pkg install -y git nodejs-lts unzip openssh coreutils
termux-setup-storage
mkdir -p "$HOME/projects"
node --version
npm --version
git --version
```

PAXI requires Node.js 20 or newer. If Termux provides an older Node.js version, update the Termux packages before continuing.

## 2. Put the release source in Termux

### Option A: from a downloaded release ZIP

Download the release ZIP and its checksum from the GitHub Releases page into Android Downloads. Then verify it before extraction:

```bash
cd "$HOME/storage/downloads"
sha256sum -c paxi-devkit-v2.7.0.zip.sha256
unzip -q paxi-devkit-v2.7.0.zip -d "$HOME/projects"
cd "$HOME/projects/paxi-devkit-v2.7.0"
```

The checksum file must contain the SHA-256 of the exact ZIP asset. Do not skip checksum verification when distributing a release archive.

### Option B: clone the public GitHub repository

Use SSH after configuring a GitHub SSH key:

```bash
cd "$HOME/projects"
git clone git@github.com:YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git paxi-devkit
cd paxi-devkit
```

For a public repository, HTTPS cloning is also possible:

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git "$HOME/projects/paxi-devkit"
cd "$HOME/projects/paxi-devkit"
```

## 3. Validate before installation

Run the checks from the project root. Do not install or publish if any required check fails.

```bash
npm ci
npm run check
npm test
node bin/paxi.mjs version
node bin/paxi.mjs detect . --json
node bin/paxi.mjs env --json
```

The full test suite may skip host-specific integrations. A skipped Windows Flutter test is expected on Termux; it must pass on the Windows GitHub Actions runner before claiming Windows Flutter support.

## 4. Install the PAXI launcher in Termux

Run the repository installer from Termux private storage:

```bash
bash scripts/install-termux.sh
paxi version
paxi doctor --json
paxi env --json
```

The installer creates a launcher at `$PREFIX/bin/paxi`, uses the exact Node executable in the current Termux environment, and keeps release copies separated. It does not install Flutter, the Android SDK, signing keys, or cloud build services.

If `paxi` is not found after installation, start a new Termux session or check:

```bash
echo "$PREFIX/bin"
command -v paxi
ls -l "$PREFIX/bin/paxi"
```

## 5. Optional Android/Termux toolchain

For Android builds, install and verify the separate local toolchain:

```bash
bash scripts/termux-bootstrap.sh
java --version
gradle --version
adb version
paxi doctor --json
```

Install a compatible ARM64 Flutter-for-Termux distribution separately if Flutter builds are required. Follow its current upstream release instructions and verify its own checksums. Then run:

```bash
flutter --version
dart --version
flutter doctor -v
```

PAXI does not silently download large SDKs or send source code to a remote builder.

## 6. Create the public GitHub repository

Create an empty repository on GitHub with the final name. Do not initialize it with a README, license, or `.gitignore`; this source tree already contains them.

Recommended settings:

- Visibility: **Public**, only after reviewing the staged content.
- Features: Issues enabled; Discussions optional.
- Actions: enabled for the repository.
- Branch: `main`.
- Tag protection/ruleset: protect `v*` tags after the first release.
- Branch protection: require CI before merging pull requests.
- Security: enable Dependabot alerts and secret scanning where available.

## 7. Configure SSH from Termux

Create a dedicated key if Termux does not already have one:

```bash
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
ssh-keygen -t ed25519 -C "YOUR_GITHUB_EMAIL" -f "$HOME/.ssh/id_ed25519_github"
cat "$HOME/.ssh/id_ed25519_github.pub"
```

Add only the `.pub` contents to GitHub under **Settings → SSH and GPG keys**. Never upload or paste the private key.

Then test the connection:

```bash
eval "$(ssh-agent -s)"
ssh-add "$HOME/.ssh/id_ed25519_github"
ssh -T git@github.com
```

## 8. Initialize, review, and push

From the clean release source directory:

```bash
git init -b main
git config user.name "YOUR NAME"
git config user.email "YOUR_GITHUB_EMAIL"
git remote add origin git@github.com:YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git
git add .
git diff --cached --check
git status --short
```

Review the complete staged list. Stop if you see `.env`, private keys, keystores, passwords, tokens, personal data, `node_modules`, build directories, or local logs.

After review:

```bash
git commit -m "PAXI DevKit v2.7.0 release"
git push -u origin main
```

Do not put a GitHub token or password in the remote URL. Do not use `git push --force` for the first release.

## 9. Verify GitHub Actions

Open the repository's **Actions** tab and wait for the required workflows to finish:

- Cross-platform Node matrix on Ubuntu, macOS, and Windows.
- Browser matrix for Chromium, Firefox, and WebKit.
- Database disposable-lab matrix when the required container services are available.

Fix CI failures before tagging. A local Termux pass cannot replace Windows, macOS, browser-engine, or disposable-database CI evidence.

## 10. Create and verify the release tag

Only tag the commit that passed CI:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git tag -a v2.7.0 -m "PAXI DevKit v2.7.0"
git push origin v2.7.0
```

Create a GitHub Release from tag `v2.7.0`. Attach:

- `paxi-devkit-v2.7.0.zip`
- `paxi-devkit-v2.7.0.zip.sha256`
- Release notes from `RELEASE_NOTES.md`

Generate the checksum on the exact release asset:

```bash
sha256sum paxi-devkit-v2.7.0.zip > paxi-devkit-v2.7.0.zip.sha256
```

After downloading the public asset again, verify:

```bash
sha256sum -c paxi-devkit-v2.7.0.zip.sha256
```

## 11. Optional npm publication

Do not publish to npm until the package name, ownership, provenance, and release process are confirmed. If publishing later, use a protected release workflow and verify the package contents first:

```bash
npm pack --dry-run
npm publish --access public
npm view @paxi/devkit version
```

Never place an npm token in Git, shell history, README files, or a command-line argument. Prefer npm trusted publishing/OIDC from GitHub Actions when the package and organization are configured for it.

## 12. Post-launch checks

From a clean Termux session, test the public release rather than the local working tree:

```bash
cd "$HOME/projects"
rm -rf paxi-public-smoke
mkdir paxi-public-smoke
cd paxi-public-smoke
unzip -q "$HOME/storage/downloads/paxi-devkit-v2.7.0.zip"
cd paxi-devkit-v2.7.0
npm ci
bash scripts/install-termux.sh
paxi version
paxi detect . --json
paxi doctor --json
```

Record the tag, commit SHA, archive SHA-256, Node version, Termux version, and the final test result in the release notes or internal release record.

## Rollback

If a release is defective:

1. Mark the GitHub Release as a draft or add a visible warning.
2. Do not silently replace an already-published archive.
3. Publish a corrected patch version and checksum.
4. If npm was published, deprecate the defective version using the approved package-owner process.
5. Keep the Git tag history auditable; do not force-move a public release tag.
