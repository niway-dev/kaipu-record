#!/bin/bash
# usage (on the Mac mini, from apps/kaipu-record): verify/filmstrip-no-cdp/run.sh <take.mp4> [modes]
# Bundles the probe and the driver, then runs a bare Electron window once per CDP mode.
set -euo pipefail
export PATH="$HOME/.local/share/mise/installs/node/24/bin:$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
unset ELECTRON_RUN_AS_NODE
here=$(cd "$(dirname "$0")" && pwd)
out=${KAIPU_NO_CDP_OUT:-$HOME/kaipu-evidence/niw2-844/no-cdp}
mkdir -p "$out"
bun build "$here/../filmstrip-probe/entry.ts" --target=browser --format=esm --outfile "$out/probe.js" >/dev/null
bun build "$here/driver.ts" --target=browser --format=esm --outfile "$out/driver.js" >/dev/null
electron=$(ls -d ../../node_modules/.bun/electron@*/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron | head -1)
for mode in ${2:-none network}; do
  for decoder in ${DECODERS:-hardware}; do
    CDP_MODE=$mode DECODER=$decoder TAKE="$1" PROBE_BUNDLE="$out/probe.js" DRIVER_BUNDLE="$out/driver.js" \
      "$electron" "$here/main.cjs" --user-data-dir="$out/ud-$mode-$decoder" 2>&1 | grep "^\[$mode/" | tee -a "$out/$mode-$decoder.txt"
  done
done
