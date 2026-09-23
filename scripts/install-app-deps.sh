#!/usr/bin/env bash
# kaipu-record's postinstall: rebuild native dependencies against Electron's ABI.
#
# Skipped on Linux CI, and only there. The reason is `uiohook-napi`: it has no
# prebuild for Electron, so `electron-builder install-app-deps` compiles libuiohook
# from source, and on Linux that needs the X11 development headers
# (`X11/keysym.h` and friends) which the GitHub runner image does not carry. The
# build fails, `bun install --frozen-lockfile` exits non-zero, and every workflow
# dies at its install step — including the web and api ones, which never touch
# Electron at all.
#
# Installing the headers would also work, but it would pay a from-source native
# build in every Linux job to produce an artifact nothing there consumes:
#
#   - the unit suites run in jsdom and never load the module;
#   - the E2E suite launches Electron on Linux, where `recording-hub.ts` only
#     reaches its lazy `require("uiohook-napi")` behind a `process.platform ===
#     "darwin"` check — so the binary is never loaded, and the require is wrapped
#     in a try/catch besides;
#   - the app ships from macOS (`release-desktop.yml`, `runs-on: macos-latest`),
#     where this script does run and the rebuild happens for real.
#
# The skip is deliberately narrow. A developer on Linux still gets the rebuild and,
# if the headers are missing, the same loud failure — which is correct: they are
# about to run the app, not just its tests.
set -euo pipefail

if [ -n "${CI:-}" ] && [ "$(uname -s)" = "Linux" ]; then
  echo "install-app-deps: skipped (Linux CI — no consumer for the native build; see this script)"
  exit 0
fi

exec bunx electron-builder install-app-deps
