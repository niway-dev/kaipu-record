#!/usr/bin/env bash
# The release gate of one component (ADR 0052, which amends ADR 0027 and ADR 0004).
#
# `bun run verify` checks the whole workspace, so a web tag waited on the desktop suite and
# a flaky desktop test could block a web release. A release verifies the component it ships
# plus that component's workspace dependencies, nothing else, the same scope as the release
# pull request (`Classify the change` in .github/workflows/pr-checks.yml).
#
# Usage: bash scripts/verify-release.sh <web|api|desktop>
#
# The desktop run is unsharded: the tag workflow has one Linux runner, not three.
set -euo pipefail

component="${1:-}"
case "$component" in
  web) app="web-hono" ;;
  api) app="server-hono" ;;
  desktop) app="kaipu-record" ;;
  *)
    echo "usage: verify-release.sh <web|api|desktop> (got: '${component}')" >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")/.."

echo "== Verifying the ${component} release (turbo package: ${app})"

# Repo-wide, as in the release pull request: seconds, and they guard shared config.
bun run check-workflows
bun run lint
bunx oxfmt --check .

# The packages the app imports, built; the app itself is built where it ships.
bun run build --filter="${app}^..."

# The app plus its workspace dependencies.
bun run check-types --filter="${app}..."
bun run test --filter="${app}..."
