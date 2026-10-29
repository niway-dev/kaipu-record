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
#
# Everything is computed in one `node` call with cwd-relative paths: node is
# required anyway, and it avoids `shasum` (not guaranteed on Git Bash) and MSYS
# path conversion of absolute paths inside a JS string on Windows runners.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f apps/kaipu-record/node_modules/electron/package.json ]; then
  echo "native-deps-stamp: electron is not installed — run 'bun install' first" >&2
  exit 1
fi

node -e '
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const electron = require("./apps/kaipu-record/node_modules/electron/package.json").version;
const dir = "patches";
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith(".patch")).sort()
  : [];
const hash = crypto.createHash("sha256");
for (const f of files) hash.update(fs.readFileSync(path.join(dir, f)));
const patches = files.length === 0 ? "none" : hash.digest("hex").slice(0, 12);
process.stdout.write(`${electron}+patches-${patches}\n`);
'
