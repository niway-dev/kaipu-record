#!/usr/bin/env bash
# Prints the stamp the desktop app's native build must carry to be current:
# the installed Electron version plus a hash of every dependency patch in
# `patches/`. `scripts/rebuild-native.sh` writes it after compiling,
# `scripts/setup-dev.sh` and `release-desktop.yml` compare against it.
#
# Why the patch hash: `uiohook-napi` is patched (root `package.json`
# `patchedDependencies`). `bun install` patches the C sources; only the rebuild
# compiles them. An Electron-version-only stamp would call a binary compiled
# from the unpatched sources "current" after the patch lands, and the app would
# run the deadlock the patch fixes. Any change to a patch invalidates the stamp.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_PKG="$ROOT/apps/kaipu-record/node_modules/electron/package.json"
if [ ! -f "$ELECTRON_PKG" ]; then
  echo "native-deps-stamp: electron is not installed — run 'bun install' first" >&2
  exit 1
fi
ELECTRON_VERSION="$(node -p "require('$ELECTRON_PKG').version")"

# Content hash of the patches, in a fixed order, independent of file names'
# location on disk. `shasum` exists on macOS, Linux and Git Bash on Windows.
PATCH_HASH="$(cd "$ROOT" && cat $(ls patches/*.patch 2>/dev/null | sort) 2>/dev/null | shasum -a 256 | cut -c1-12)"

printf '%s+patches-%s\n' "$ELECTRON_VERSION" "$PATCH_HASH"
