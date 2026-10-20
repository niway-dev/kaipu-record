#!/usr/bin/env bash
# Deploy one Cloudflare Worker with the pinned wrangler and its secrets file.
#
#   bash scripts/deploy-worker.sh <app-dir> [--dry-run]
#
# The release workflows and the release-candidate PR check run this same script, so a
# deploy command that cannot run fails on the pull request instead of on the tag.
#
# Why not cloudflare/wrangler-action: it resolves wrangler with `npx` inside the app
# directory, so an app with its own wrangler devDependency (server-hono pins 4.63.0)
# silently shadows the version the workflow installed. That is how api-v0.5.0 failed
# with "Unknown arguments: secrets-file" while release-web, whose app has no local
# wrangler, kept working.
#
# Expects <app-dir>/worker-secrets.json (written by the workflow). With --dry-run it
# bundles and validates every argument without credentials and without deploying.
set -euo pipefail

# One place for the version. `deploy --secrets-file` needs it; the workspace's 4.63.0
# does not have the flag.
WRANGLER_VERSION="4.148.0"

APP_DIR="${1:?usage: deploy-worker.sh <app-dir> [--dry-run]}"
shift

# Install first, look up second: `bun pm bin -g` errors on a runner where nothing has
# been installed globally yet. Re-adding the same exact version is a no-op.
bun add -g "wrangler@$WRANGLER_VERSION" >/dev/null
WRANGLER="$(bun pm bin -g)/wrangler"

installed="$("$WRANGLER" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
if [ "$installed" != "$WRANGLER_VERSION" ]; then
  echo "::error::expected wrangler $WRANGLER_VERSION at $WRANGLER, found '${installed:-none}'" >&2
  exit 1
fi
echo "Using wrangler $installed from $WRANGLER"

APP_DIR="$(cd "$APP_DIR" && pwd)"
if [ ! -f "$APP_DIR/worker-secrets.json" ]; then
  echo "::error::$APP_DIR/worker-secrets.json is missing" >&2
  exit 1
fi

extra=()
if [ "${1:-}" = "--dry-run" ]; then
  extra=(--dry-run --outdir "$(mktemp -d)")
fi

# Absolute path, never a bare `wrangler`: the app's node_modules/.bin must not win.
"$WRANGLER" deploy --cwd "$APP_DIR" --secrets-file "$APP_DIR/worker-secrets.json" ${extra[@]+"${extra[@]}"}
