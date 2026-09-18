#!/usr/bin/env bash
# Run a command with the environment it needs, however that environment arrives.
#
#   bash scripts/with-env.sh <command> [args...]
#
# Locally that means fetching from Infisical. In CI it means using what the
# workflow already injected — CI builds with placeholder values on purpose and
# must not need a secrets CLI or real credentials to do it.
#
# The point of the split: a build should consume whatever env it is given and
# stay indifferent to who supplied it. Wiring `infisical run` directly into a
# build script couples the two and breaks every consumer that legitimately
# supplies its own.
set -euo pipefail

if [ -n "${CI:-}" ]; then
  # CI injects env through the workflow. Pass straight through.
  exec "$@"
fi

if command -v infisical >/dev/null 2>&1; then
  exec infisical run --env=dev --recursive --silent -- "$@"
fi

# Locally, a missing CLI must fail loudly. Falling through would build with
# undefined values and produce a subtly broken artifact instead of an error —
# the failure mode that is hardest to trace back here.
printf 'error: the Infisical CLI is required to supply this command'\''s environment.\n' >&2
printf '       Run: bun run setup\n' >&2
exit 1
