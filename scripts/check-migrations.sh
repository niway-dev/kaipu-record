#!/usr/bin/env bash
# Fail when the Drizzle schema and the committed migrations disagree (ADR 0011).
#
# `drizzle-kit generate` diffs the schema files against the last migration snapshot — it reads
# no database and needs no DATABASE_URL. If it writes anything, someone changed the schema
# without committing the matching migration.
set -euo pipefail

cd "$(dirname "$0")/../packages/infra-db"
MIGRATIONS="src/migrations"

env -u DATABASE_URL bunx drizzle-kit generate

if [ -n "$(git status --porcelain -- "$MIGRATIONS")" ]; then
  echo
  echo "The schema has changes with no committed migration:"
  git status --short -- "$MIGRATIONS"
  echo
  echo "Run 'bun run db:generate', review the SQL, and commit the generated files."
  exit 1
fi
echo "Schema and committed migrations agree."
