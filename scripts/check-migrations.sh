#!/usr/bin/env bash
# Fail when the Drizzle schema and the committed migrations disagree (ADR 0029).
#
# `drizzle-kit generate` diffs the schema files against the last migration snapshot — it reads
# no database and needs no DATABASE_URL. If it writes anything, someone changed the schema
# without committing the matching migration.
set -euo pipefail

cd "$(dirname "$0")/../packages/infra-db"
MIGRATIONS="src/migrations"

# The pinned binary, never bunx: the version must match the one that wrote the snapshots.
env -u DATABASE_URL ./node_modules/.bin/drizzle-kit generate

# Only what generate just wrote counts: unstaged edits and new files. A migration that is
# staged but not committed yet is the developer's own, not drift.
if ! git diff --quiet -- "$MIGRATIONS" || [ -n "$(git ls-files --others --exclude-standard -- "$MIGRATIONS")" ]; then
  echo
  echo "The schema has changes with no committed migration:"
  git status --short -- "$MIGRATIONS"
  echo
  echo "Run 'bun run db:generate', review the SQL, and commit the generated files."
  exit 1
fi
echo "Schema and committed migrations agree."
