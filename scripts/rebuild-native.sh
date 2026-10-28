#!/usr/bin/env bash
# Rebuild kaipu-record's native dependencies against Electron's ABI.
#
# This used to be `apps/kaipu-record`'s `postinstall`. It is explicit now, for the
# same reason `setup-dev.sh` checks instead of installing: a lifecycle script runs
# before you have read it, and this one invokes a C compiler. Nothing that
# compiles code on your machine should be a side effect of `bun install`.
#
# Why it has to exist at all: `uiohook-napi` is patched (see `patches/` and the
# root `package.json` `patchedDependencies`) and `bun install` patches the C
# sources, not the prebuilt binary it ships. That prebuild is a N-API module, so
# Electron loads it fine — unpatched, with the start() deadlock the patch fixes.
# `electron-builder.yml` sets `npmRebuild: false`, so packaging does not rebuild
# either. This script is the only place the patched sources get compiled.
#
# Run it when `bun run setup` tells you to. It is also called explicitly by every
# packaging path (`build:mac`, `build:win`, `build:linux`, `build:unpack`,
# `release-desktop.yml`), which must never depend on someone having remembered.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../apps/kaipu-record" && pwd)"
cd "$APP_DIR"

ELECTRON_PKG="node_modules/electron/package.json"
if [ ! -f "$ELECTRON_PKG" ]; then
  echo "rebuild-native: electron is not installed — run 'bun install' first" >&2
  exit 1
fi
ELECTRON_VERSION="$(node -p "require('./$ELECTRON_PKG').version")"

bunx electron-builder install-app-deps

# Stamp what we just built against: Electron version + hash of the dependency
# patches (scripts/native-deps-stamp.sh). `setup-dev.sh` and the release workflow
# compare the file to a fresh stamp to tell you whether a rebuild is pending —
# an Electron bump or a changed patch both show up. It lives inside node_modules
# on purpose: a fresh install wipes it, which is exactly when the rebuild is
# needed again.
STAMP="$(bash "$SCRIPT_DIR/native-deps-stamp.sh")"
printf '%s\n' "$STAMP" > node_modules/.native-deps-electron-version

echo "rebuild-native: built against Electron $ELECTRON_VERSION (stamp $STAMP)"
