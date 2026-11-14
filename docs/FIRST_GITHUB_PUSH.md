# First GitHub push from Termux — PAXI DevKit v2.7.0

This guide assumes the source tree is ready and that no public GitHub repository has been created yet. Replace `YOUR_GITHUB_USERNAME`, `YOUR_REPOSITORY`, `YOUR_GITHUB_EMAIL`, and `YOUR NAME` before running commands. Use `paxi-devkit` as the repository name unless you have deliberately chosen another name.

For the complete CI, release-asset, checksum, rollback, and optional npm-publication process, also read [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## 1. Prepare Termux

```bash
pkg update -y
pkg install -y git nodejs-lts unzip openssh coreutils
termux-setup-storage
mkdir -p "$HOME/projects"
node --version
npm --version
git --version
```

PAXI requires Node.js 20 or newer. Keep the checkout under `$HOME/projects` rather than `~/storage/downloads`; Android shared storage does not provide reliable executable permissions for Node tooling.

If using the release ZIP, extract it into Termux private storage:

```bash
cd "$HOME/storage/downloads"
sha256sum -c paxi-devkit-v2.7.0.zip.sha256
unzip -q paxi-devkit-v2.7.0.zip -d "$HOME/projects"
cd "$HOME/projects/paxi-devkit-v2.7.0"
```

## 2. Validate the source

```bash
npm ci
npm run check
npm test
node bin/paxi.mjs version
```

Do not continue if a required command fails. A host-specific Windows Flutter integration test may be skipped on Termux; Windows Flutter support still needs the real Windows CI runner.

## 3. Configure GitHub SSH authentication

Create a dedicated key if needed:

```bash
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
ssh-keygen -t ed25519 -C "YOUR_GITHUB_EMAIL" -f "$HOME/.ssh/id_ed25519_github"
cat "$HOME/.ssh/id_ed25519_github.pub"
```

Add only the public-key output to GitHub under **Settings → SSH and GPG keys**. Never share `$HOME/.ssh/id_ed25519_github`. Then test:

```bash
eval "$(ssh-agent -s)"
ssh-add "$HOME/.ssh/id_ed25519_github"
ssh -T git@github.com
```

GitHub may report successful authentication without providing shell access; that response is normal.

## 4. Create an empty public repository

On GitHub, choose **New repository**, use the final repository name, select **Public**, and do not initialize it with a README, `.gitignore`, or license. The source tree already provides these files. Enable Issues and Actions, and plan to require passing CI before merging pull requests.

## 5. Initialize and review the first commit

From the PAXI source directory:

```bash
git init -b main
git config user.name "YOUR NAME"
git config user.email "YOUR_GITHUB_EMAIL"
git remote add origin git@github.com:YOUR_GITHUB_USERNAME/YOUR_REPOSITORY.git
git add .
git diff --cached --check
git status --short
```

Review the entire staged list. Stop if you see API keys, tokens, SSH private keys, Android keystores, passwords, `.env` files, personal data, `node_modules`, build outputs, or local logs. The `.gitignore` is helpful but is not a substitute for manual review.

When the staged content is correct:

```bash
git commit -m "PAXI DevKit v2.7.0 release"
git push -u origin main
```

Never put a GitHub password or token into the remote URL, and do not force-push the initial public history.

## 6. Wait for CI before tagging

Open the repository's **Actions** tab and wait for the Ubuntu, macOS, Windows, browser, and database workflows that apply to the repository. Fix failures before creating a release tag. A local Termux pass does not prove Windows, macOS, browser-engine, or disposable-database support.

## 7. Tag and publish the release

After the default branch is green:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git tag -a v2.7.0 -m "PAXI DevKit v2.7.0"
git push origin v2.7.0
```

Create a GitHub Release from `v2.7.0`. Attach the exact release ZIP and its SHA-256 file, and copy the release notes from `RELEASE_NOTES.md`. Verify the downloaded public asset from a clean Termux session with:

```bash
sha256sum -c paxi-devkit-v2.7.0.zip.sha256
```

## 8. Install the public release in Termux

From the verified extracted release directory:

```bash
bash scripts/install-termux.sh
paxi version
paxi doctor --json
```

For Android builds, install the separate device-specific toolchain and follow [TERMUX_ANDROID.md](TERMUX_ANDROID.md). PAXI does not include Flutter, the Android SDK, signing keys, or a cloud builder.

## 9. Later updates

```bash
git status --short
git pull --ff-only origin main
npm ci
npm run check
npm test
git add .
git diff --cached --check
git commit -m "Describe the update"
git push
```

Use a new semantic-version tag for a release. Do not move an existing public release tag.
