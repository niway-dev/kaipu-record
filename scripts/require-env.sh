#!/usr/bin/env bash
# Stop a local command early when the .env it reads has not been generated.
#
#   bash scripts/require-env.sh <file>...
#
# Without this, a missing file is silent: vite, wrangler, electron-vite and
# `bun --env-file` all start happily and fail later on an undefined value.
#
# CI passes through: workflows inject their own environment and never have
# these files.
set -euo pipefail

if [ -n "${CI:-}" ]; then
  exit 0
fi

missing=0
for file in "$@"; do
  if [ ! -f "$file" ]; then
    printf 'error: %s is missing.\n' "${PWD##*/}/$file" >&2
    missing=1
  fi
done

if [ "$missing" -eq 1 ]; then
  printf '       Generate it from Infisical with: bun env:pull (from the repo root)\n' >&2
  exit 1
fi
