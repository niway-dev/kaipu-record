#!/usr/bin/env bash
# Write a dotenv file containing exactly one consumer's secrets.
#
#   bash scripts/pull-env.sh <tag> <output-file> [env-slug]
#
# Only Cloudflare Workers need this. `wrangler` populates Worker bindings from a
# file, not from the parent process, so injecting with `infisical run` never
# reaches the Worker. Everything else should use with-env.sh instead.
#
# One folder per call because `infisical export` has no --recursive — unlike
# `infisical run`, which does. The tag filter is what keeps each file down to
# the consumer's own values; the folder list is only working around that gap.
set -euo pipefail

TAG="${1:?usage: pull-env.sh <tag> <output-file> [env-slug]}"
OUT="${2:?usage: pull-env.sh <tag> <output-file> [env-slug]}"
ENV_SLUG="${3:-dev}"

# Every folder that can hold a consumer's values. Adding a folder in Infisical
# means adding it here, or its secrets go missing from generated files without
# any error — the tag filter yields nothing rather than failing.
FOLDERS=(/public /database /cloudflare /auth /email /signing)

# Build in a temp file so a failure part-way through cannot leave the app with a
# half-written environment that looks valid.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

for path in "${FOLDERS[@]}"; do
  infisical export --env="$ENV_SLUG" --path="$path" --tags "$TAG" --silent >> "$TMP"
done

if ! grep -q '=' "$TMP"; then
  printf 'error: no secrets matched tag %q in env %q.\n' "$TAG" "$ENV_SLUG" >&2
  printf '       Check the tag exists and is applied — an untagged secret is\n' >&2
  printf '       silently absent rather than an error.\n' >&2
  exit 1
fi

# Readable only by the owner: this file holds plaintext credentials.
install -m 600 "$TMP" "$OUT"
