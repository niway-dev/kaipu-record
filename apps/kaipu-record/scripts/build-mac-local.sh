#!/usr/bin/env bash
set -euo pipefail

# electron-builder reads process.env but does NOT load .env* files itself, so we
# inject the signing/notarization vars here before building. `set -a` exports
# every assignment that follows (i.e. everything sourced from .env.signing).
set -a
# shellcheck disable=SC1091
source "$(dirname "$0")/../.env.signing"
set +a

echo "→ Identidad de firma disponible:"
security find-identity -v -p codesigning | grep "Developer ID Application" || true

# 1) build de renderer + main con electron-vite (incluye typecheck)
npm run build

# 2) empaquetar + firmar (+ notarizar + staple si están las APPLE_API_*)
npx electron-builder --mac --publish never
