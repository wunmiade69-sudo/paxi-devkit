#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if [[ "${PREFIX:-}" != *com.termux* ]]; then
  echo "Run this installer inside Termux on Android."
  exit 1
fi

if [[ -z "${HOME:-}" || ! -d "$HOME" ]]; then
  echo "Termux HOME is not set to a valid directory."
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "PAXI package.json not found in source directory: $SOURCE_DIR"
  exit 1
fi
VERSION="$(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version)' "$SOURCE_DIR/package.json")"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]]; then
  echo "Invalid PAXI package version: $VERSION"
  exit 1
fi
INSTALL_DIR="$SOURCE_DIR"

# Shared storage is often exposed through ~/storage, but it is not executable.
# Resolve physical paths and relocate it before creating the global command wrapper.
case "$SOURCE_DIR/" in
  "$HOME/storage/"*|/storage/emulated/*|/sdcard/*)
    INSTALL_DIR="$HOME/.local/share/paxi-devkit/$VERSION"
    mkdir -p "$INSTALL_DIR"
    cp -R "$SOURCE_DIR/." "$INSTALL_DIR/"
    ;;
  "$HOME/"*)
    ;;
  *)
    INSTALL_DIR="$HOME/.local/share/paxi-devkit/$VERSION"
    mkdir -p "$INSTALL_DIR"
    cp -R "$SOURCE_DIR/." "$INSTALL_DIR/"
    ;;
esac

if [[ ! -f "$INSTALL_DIR/package.json" || ! -f "$INSTALL_DIR/bin/paxi.mjs" ]]; then
  echo "PAXI source is incomplete; package.json or bin/paxi.mjs is missing."
  exit 1
fi

chmod 755 "$INSTALL_DIR/bin/paxi.mjs"
cd "$INSTALL_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required. Run: pkg install nodejs-lts"
  exit 1
fi

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node.js was found but is not executable: $NODE_BIN"
  echo "Repair the Termux Node.js installation with: pkg reinstall nodejs-lts"
  exit 1
fi

# Install exactly from the local lockfile. Lifecycle scripts are disabled:
# this CLI does not need install hooks, and source packages are not executed.
"$NPM_BIN" ci --ignore-scripts --no-audit --no-fund

# npm's default bin shim points to /usr/bin/env node. Android/Termux does not
# provide the usual Linux /usr/bin/env path, which can produce ENOENT even
# though Node is installed. Create a native Android shell launcher instead.
LAUNCHER="$PREFIX/bin/paxi"
LAUNCHER_TMP="$PREFIX/bin/.paxi.$$.$RANDOM.tmp"
if [[ -L "$LAUNCHER" ]]; then
  EXISTING_TARGET="$(readlink "$LAUNCHER" 2>/dev/null || true)"
  if [[ "$EXISTING_TARGET" != *paxi.mjs* && "$EXISTING_TARGET" != *paxi-devkit* ]]; then
    echo "Refusing to replace an unrelated command symlink: $LAUNCHER -> $EXISTING_TARGET"
    exit 1
  fi
elif [[ -e "$LAUNCHER" ]]; then
  if ! grep -q 'PAXI_TERMUX_LAUNCHER' "$LAUNCHER" 2>/dev/null && ! grep -q 'paxi.mjs' "$LAUNCHER" 2>/dev/null; then
    echo "Refusing to overwrite an existing non-PAXI command: $LAUNCHER"
    exit 1
  fi
fi
shell_quote() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}
NODE_QUOTED="$(shell_quote "$NODE_BIN")"
ENTRY_QUOTED="$(shell_quote "$INSTALL_DIR/bin/paxi.mjs")"
if ! printf '#!/system/bin/sh\n# PAXI_TERMUX_LAUNCHER\nset -eu\nexec %s %s "$@"\n' "$NODE_QUOTED" "$ENTRY_QUOTED" > "$LAUNCHER_TMP"; then
  rm -f "$LAUNCHER_TMP"
  echo "Could not write the Termux launcher. Check permissions on $PREFIX/bin."
  exit 1
fi
chmod 700 "$LAUNCHER_TMP"
mv -f "$LAUNCHER_TMP" "$LAUNCHER"

hash -r 2>/dev/null || true
if [[ ! -x "$LAUNCHER" ]]; then
  echo "PAXI launcher was created but is not executable: $LAUNCHER"
  exit 1
fi

EXPECTED_VERSION="$(node -p "require('./package.json').version")"
ACTUAL_VERSION="$(sh "$LAUNCHER" version)"
if [[ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "PAXI command verification failed (expected $EXPECTED_VERSION, got $ACTUAL_VERSION)."
  exit 1
fi

printf '\nPAXI DevKit %s installed successfully.\n' "$ACTUAL_VERSION"
printf 'Installed at: %s\n' "$INSTALL_DIR"
printf 'Launcher: %s\n' "$LAUNCHER"
printf 'Next: paxi doctor\n'
