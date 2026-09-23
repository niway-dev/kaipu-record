#!/usr/bin/env bash
set -euo pipefail

# Builds and signs a distributable locally.
#
# Signing and notarization credentials come from Infisical `prod/kaipu-record`
# (they used to live in a local .env.signing). electron-builder reads process.env
# and loads no files itself, so everything must be exported before it runs.
#
# `prod` is deliberate: a signed artifact is a production artifact. Running the
# build under the dev environment would bake development endpoints into
# something distributable — the failure mode this script exists to avoid.
#
# The env vars the renderer inlines (MAIN_VITE_* / VITE_*) are NOT fetched here.
# Supply them yourself for the target you are building, e.g.
#
#   MAIN_VITE_SERVER_URL=https://kaipu-api.example.workers.dev bun run build:mac
#
# They are not in Infisical `prod` yet; the release workflow passes them from
# GitHub Variables. Until that is migrated, an unset value means the build fails
# its own startup guard rather than shipping a wrong endpoint silently.

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "→ Signing identities available:"
security find-identity -v -p codesigning | grep "Developer ID Application" || true

# Fetch signing credentials for the packaging step only, then run both steps
# inside that environment. `--path` is scoped: this needs the signing material
# and nothing else.
# Native deps are no longer rebuilt by a postinstall (see scripts/rebuild-native.sh).
# `electron-builder.yml` sets `npmRebuild: false`, so packaging will not do it either:
# without this line the .dmg ships a uiohook-napi built for the wrong ABI, which fails
# silently on the user's machine rather than here.
bash "$ROOT/scripts/rebuild-native.sh"

exec bash "$ROOT/scripts/with-env.sh" --env prod --path /kaipu-record -- bash -c '
  set -euo pipefail
  # 1) build renderer + main with electron-vite (includes typecheck)
  npm run build
  # 2) package + sign (+ notarize + staple when the APPLE_API_* vars are set)
  npx electron-builder --mac --publish never
'
