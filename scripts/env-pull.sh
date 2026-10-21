#!/usr/bin/env bash
# Generate every local .env file from Infisical's dev environment.
#
#   bun env:pull
#
# This is the only point where local development talks to Infisical. `bun dev`
# and the db:* scripts read the files written here and never call Infisical, so
# an Infisical outage blocks a refresh, never a dev session.
#
# All or nothing: every file is fetched into a temp directory first, and the
# real .env files are replaced only after every fetch succeeded. A failure
# leaves all of them exactly as they were.
#
# Never print a value from here: the output lands in terminals and CI logs.
set -euo pipefail

ENV_SLUG="dev"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# <output file, relative to the repo root>:<Infisical tag naming its consumer>
TARGETS=(
  "apps/server-hono/.env:server-hono"
  "apps/web-hono/.env:web-hono"
  "apps/console/.env:console"
  "apps/kaipu-record/.env:kaipu-record"
  "packages/infra-db/.env:db-scripts"
)

# Every folder that can hold a consumer's values. `infisical export` has no
# --recursive, so each folder is a separate call. Adding a folder in Infisical
# means adding it here, or its secrets go missing from generated files without
# any error — the tag filter yields nothing rather than failing.
FOLDERS=(/public /database /cloudflare /auth /email /signing)

fail() {
  printf '\nerror: %s\n' "$1" >&2
  printf '       Your current .env files were left untouched.\n' >&2
  exit 1
}

if ! command -v infisical >/dev/null 2>&1; then
  printf 'error: the Infisical CLI is not installed. Run: bun run setup\n' >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Infisical drops requests intermittently, so a failed call is retried with
# backoff (1, 2, 4, 8 s) before the whole pull is abandoned. stdin is closed so
# a missing session fails instead of waiting on an interactive prompt.
#
# --expand=false skips server-side reference expansion. No secret uses ${...}
# references, and that code path has failed on its own: on 2026-10-19 /public
# returned EOF on every attempt with expansion on and succeeded with it off. A
# reference added later would land in the file literally.
export_folder() {
  local tag="$1" path="$2" out="$3" attempt
  for attempt in 1 2 3 4 5; do
    if infisical export --env="$ENV_SLUG" --path="$path" --tags "$tag" --expand=false --silent \
      </dev/null >>"$out.part" 2>/dev/null; then
      cat "$out.part" >>"$out"
      rm -f "$out.part"
      return 0
    fi
    rm -f "$out.part"
    [ "$attempt" -lt 5 ] && sleep $((1 << (attempt - 1)))
  done
  return 1
}

for target in "${TARGETS[@]}"; do
  file="${target%%:*}"
  tag="${target##*:}"
  staged="$STAGE/$(printf '%s' "$file" | tr '/' '_')"
  : >"$staged"
  printf '  %-28s' "$file"

  for path in "${FOLDERS[@]}"; do
    export_folder "$tag" "$path" "$staged" ||
      fail "Infisical did not respond for $path (tag $tag). Check 'infisical login' and retry."
  done

  if ! grep -q '=' "$staged"; then
    fail "no secrets matched tag '$tag' in env '$ENV_SLUG'. An untagged secret is silently absent rather than an error."
  fi
  printf '%s variables\n' "$(grep -c '=' "$staged")"
done

# Every fetch succeeded: only now replace the real files. Readable only by the
# owner, since they hold plaintext credentials.
for target in "${TARGETS[@]}"; do
  file="${target%%:*}"
  install -m 600 "$STAGE/$(printf '%s' "$file" | tr '/' '_')" "$ROOT/$file"
done

printf '\nWrote %d .env files from Infisical (%s).\n' "${#TARGETS[@]}" "$ENV_SLUG"
