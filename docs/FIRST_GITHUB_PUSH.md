# First GitHub upload — PAXI DevKit v0.9.0

This guide is for the first upload of this source tree. It assumes no GitHub repository has been created and no Git push has happened yet.

## 1. Create an empty GitHub repository

1. Sign in to GitHub and choose **New repository**.
2. Name it `paxi-devkit` (or choose another name and use that name in the remote URL below).
3. Choose Public or Private according to your release plan.
4. Do **not** initialise it with a README, `.gitignore`, or licence. This source package already contains those files.
5. Create the repository and keep the page open so you can copy the repository URL.

## 2. Prepare Termux

Download `paxi-devkit-v0.9.0-ai-studio.zip` to the Android Downloads folder. In Termux, run:

```bash
termux-setup-storage
pkg update -y
pkg install -y git nodejs-lts unzip openssh
mkdir -p "$HOME/projects"
cd "$HOME/storage/downloads"
ls -lh paxi-devkit-v0.9.0-ai-studio.zip
unzip -q paxi-devkit-v0.9.0-ai-studio.zip -d "$HOME/projects"
cd "$HOME/projects/paxi-devkit-v0.9.0"
```

If the ZIP is in a different folder, change the `cd` path to its actual location. Keep the project in Termux private storage (`$HOME/projects`), not under shared Downloads, so Node tools and executable scripts work normally.

## 3. Validate before creating the first commit

```bash
node --version
npm --version
npm ci
npm test
npm run check
node bin/paxi.mjs version
```

Run the current test suite and retain its actual result. One Windows-only integration test is skipped when run on a non-Windows host. Windows-specific compilation still needs to run in Windows CI or on a Windows PC; iOS IPA creation still needs macOS and Xcode.

Do not continue to Git staging if any command fails. Fix the failure or share the complete error output first.

## 4. Set your Git author information

Use the name and email you want associated with your commits:

```bash
git config --global user.name "YOUR NAME"
git config --global user.email "YOUR_EMAIL_ADDRESS"
```

These values identify commits; they are not your GitHub password.

## 5. Set up GitHub authentication using SSH

Create a dedicated SSH key in Termux:

```bash
ssh-keygen -t ed25519 -C "YOUR_EMAIL_ADDRESS" -f "$HOME/.ssh/id_ed25519_github"
```

Choose a passphrase when prompted. Start the agent and add the key:

```bash
eval "$(ssh-agent -s)"
ssh-add "$HOME/.ssh/id_ed25519_github"
```

Display **only the public key**:

```bash
cat "$HOME/.ssh/id_ed25519_github.pub"
```

On GitHub, open **Settings → SSH and GPG keys → New SSH key**, paste the public key, and save it. Never share or upload the private key file `~/.ssh/id_ed25519_github`.

Test authentication:

```bash
ssh -T git@github.com
```

GitHub may say that it authenticated successfully but does not provide shell access; that is normal.

## 6. Initialise the repository and make the first commit

Run these commands from `~/projects/paxi-devkit-v0.9.0`:

```bash
git init -b main
git add .
git diff --cached --check
git status --short
```

Review the staged file list. Confirm that no API keys, passwords, signing keys, local environment files, personal data, build outputs, or other private files are staged. The included `.gitignore` excludes common secrets and generated build artifacts, but you must still review the list yourself.

If the staged files look correct, commit:

```bash
git commit -m "PAXI DevKit v0.9.0: Doctor foundation and adaptive project intelligence"
```

## 7. Connect the empty GitHub repository and push

Replace `YOUR_GITHUB_USERNAME` with your GitHub username. If you chose a repository name other than `paxi-devkit`, replace that too.

```bash
git remote add origin git@github.com:YOUR_GITHUB_USERNAME/paxi-devkit.git
git remote -v
git push -u origin main
```

Do not put a personal access token or password into the remote URL. SSH authentication is preferred for this Termux setup.

## 8. Check GitHub Actions, then tag the release

Open the repository on GitHub and check the **Actions** tab. The workflow tests Ubuntu, macOS, and Windows-host command/package paths. The Windows integration workflow runs on a real Windows runner; this is separate from the local Termux test run.

After the `main` workflow succeeds, create and push the release tag:

```bash
git tag -a v0.9.0 -m "PAXI DevKit v0.9.0"
git push origin v0.9.0
```

Then create a GitHub Release from tag `v0.9.0` and attach the complete source ZIP and SHA-256 file if you want to distribute downloadable release assets.

## 9. Later updates

After the first push, future updates normally use:

```bash
git status --short
git add .
git diff --cached --check
git commit -m "Describe the update"
git push
```

Always review the changed files before committing. Do not force-push or overwrite the remote history as part of a normal update.

## Important platform boundaries

- Android APK/AAB builds run locally using the Android/Flutter/Gradle toolchain installed on the host.
- Windows desktop Flutter builds run on Windows and currently produce a ZIP app bundle, not an MSIX/MSI installer.
- iOS IPA builds run on macOS with Xcode and valid signing/provisioning setup. An Android phone cannot compile a native iOS IPA.
- PAXI does not upload source code to a remote build server or silently fall back to a cloud builder.
