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
  cat >&2 <<'MSG'

       This file is generated from Infisical and gitignored; it is never
       committed or hand-written. It is usually missing because:

         - this is a fresh clone or a new machine, and the pull never ran;
         - a merge added a new consumer to scripts/env-pull.sh (a new app or
           package), so the pull must run again to create its file;
         - the file was deleted or the repo folder was moved.

       Fix: from the repo root run

         bun env:pull

       If that fails with an auth error, run `infisical login` first.
       If it says Infisical did not respond, retry; the pull is all or
       nothing and leaves existing files untouched.
MSG
  exit 1
fi
