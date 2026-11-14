#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if [[ "${PREFIX:-}" != *com.termux* ]]; then
  echo "Run this script inside Termux on Android."
  exit 1
fi

pkg update -y
packages=(git openjdk-21 gradle aapt2 android-tools cmake ninja clang curl wget unzip)
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  packages+=(nodejs-lts)
fi
pkg install -y x11-repo
pkg install -y "${packages[@]}"

node --version
npm --version
java --version

cat <<'MSG'

PAXI DevKit Termux base and Android Gradle prerequisites installed.

Next (from the extracted PAXI DevKit directory):
  bash scripts/install-termux.sh
  paxi doctor

The installer relocates ZIP-extracted source from shared storage into Termux's private home before linking the command. Do not run npm link directly from ~/storage/downloads.

Flutter and its Android SDK/NDK are a separate, device-specific installation. For the ARM64 Flutter port, complete its post-install step and verify with flutter doctor -v.
MSG
