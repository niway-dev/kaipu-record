#!/usr/bin/env bash
# Run a command with the environment it needs — and nothing more.
#
#   bash scripts/with-env.sh --path /database -- turbo run db:push
#   bash scripts/with-env.sh --env prod --path /kaipu-record -- electron-builder
#
# Paths are REQUIRED and repeatable. There is deliberately no "fetch everything"
# mode: a desktop build has no business holding a database credential, and the
# Infisical folders exist precisely to draw that line. Passing --recursive here
# would erase it.
#
# Environment sources, in order:
#   CI set              -> pass through; the workflow already injected its own
#   SKIP_INFISICAL set  -> pass through; the caller is supplying values itself
#   CLI available       -> fetch the requested paths
#   none of the above   -> fail loudly
set -euo pipefail

ENV_SLUG="dev"
FILTER=()

while [ $# -gt 0 ]; do
  case "$1" in
    --env)  ENV_SLUG="$2"; shift 2 ;;
    # Prefer --tags: a consumer's values deliberately span folders, since
    # folders group by blast radius rather than by who reads them.
    --tags) FILTER+=("--recursive" "--tags" "$2"); shift 2 ;;
    --path) FILTER+=("--path" "$2"); shift 2 ;;
    --)     shift; break ;;
    *)      printf 'with-env: unexpected argument %q (did you forget --?)\n' "$1" >&2; exit 2 ;;
  esac
done

if [ $# -eq 0 ]; then
  printf 'usage: with-env.sh [--env <slug>] (--tags <t> | --path <p>)... -- <command>\n' >&2
  exit 2
fi

# CI supplies env through the workflow and must not need a secrets CLI: its
# builds run on placeholder values on purpose.
if [ -n "${CI:-}" ]; then
  exec "$@"
fi

# Escape hatch for an operator pointing a command somewhere other than the
# default environment. Infisical OVERRIDES variables already set in the shell,
# so `DATABASE_URL=<other> bun run plan` would silently use the Infisical value
# without this. Prefix such commands with SKIP_INFISICAL=1.
if [ -n "${SKIP_INFISICAL:-}" ]; then
  exec "$@"
fi

if ! command -v infisical >/dev/null 2>&1; then
  printf 'error: the Infisical CLI is required to supply this command'\''s environment.\n' >&2
  printf '       Run: bun run setup\n' >&2
  printf '       Or set SKIP_INFISICAL=1 to supply the values yourself.\n' >&2
  exit 1
fi

if [ ${#FILTER[@]} -eq 0 ]; then
  printf 'error: a --tags or --path filter is required. Fetching everything would\n' >&2
  printf '       hand this command credentials it does not need.\n' >&2
  exit 2
fi

exec infisical run --env="$ENV_SLUG" "${FILTER[@]}" --silent -- "$@"
