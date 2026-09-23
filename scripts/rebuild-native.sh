#!/usr/bin/env bash
# Rebuild kaipu-record's native dependencies against Electron's ABI.
#
# This used to be `apps/kaipu-record`'s `postinstall`. It is explicit now, for the
# same reason `setup-dev.sh` checks instead of installing: a lifecycle script runs
# before you have read it, and this one invokes a C compiler. Nothing that
# compiles code on your machine should be a side effect of `bun install`.
#
# Why it has to exist at all: `uiohook-napi` ships prebuilds for Node, not for
# Electron, and Electron embeds its own V8/Node — so a module built for the
# system Node will not load inside the app. `electron-builder.yml` sets
# `npmRebuild: false`, so packaging does not rebuild either. This script is the
# only place the rebuild happens.
#
# Run it when `bun run setup` tells you to. It is also called explicitly by the
# macOS packaging paths (`build:mac`, `release-desktop.yml`), which must never
# depend on someone having remembered.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../apps/kaipu-record" && pwd)"
cd "$APP_DIR"

ELECTRON_PKG="node_modules/electron/package.json"
if [ ! -f "$ELECTRON_PKG" ]; then
  echo "rebuild-native: electron is not installed — run 'bun install' first" >&2
  exit 1
fi
ELECTRON_VERSION="$(node -p "require('./$ELECTRON_PKG').version")"

bunx electron-builder install-app-deps

# Stamp what we just built against. `setup-dev.sh` compares this to the installed
# Electron version to tell you whether a rebuild is pending. It lives inside
# node_modules on purpose: a fresh install wipes it, which is exactly when the
# rebuild is needed again.
printf '%s\n' "$ELECTRON_VERSION" > node_modules/.native-deps-electron-version

echo "rebuild-native: built against Electron $ELECTRON_VERSION"
