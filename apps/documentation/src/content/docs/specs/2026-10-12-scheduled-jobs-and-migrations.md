---
title: "Scheduled jobs, R2 purge on account deletion, and committed migrations"
description: "Design spec for NIW2-328: a cron-driven scheduled handler that runs the existing sweep, retry and purge use cases; a purge enqueue that fires before the user cascade; the first integrity migration; and the move from db:push to committed Drizzle migrations with a baseline, a CI no-diff check and an owner procedure for production."
---

# Scheduled jobs, R2 purge on account deletion, and committed migrations

> **Status: 🟡 Proposed · 2026-10-12.** Linear [NIW2-328](https://linear.app/niway/issue/NIW2-328).
> Source findings: the private security audit of 2026-10-12 (`audit-5-db.md`, `audit-2-api.md`
> F-6), run on `main` at `49b1780`, an ancestor of today's `main` (48 commits behind it). Every
> finding below was re-checked against the current branch; none has been fixed on `main` since.
>
> A WIP commit on this ticket's branch (`chore(db): save unverified partial work for NIW2-328`)
> already holds most of the code this spec describes. The [implementation status](#implementation-status)
> section says exactly what it contains, what has been verified, and what remains. Nothing in
> this document was run against a database.

## Summary (one minute)

Three use cases that keep the cloud storage honest exist and are tested, but nothing calls
them: abandoned upload reservations never release (an account with three of them is locked
out of uploads for good), R2 deletes that failed mid-way are never retried, and the objects
of a deleted account are never purged because nothing ever enqueues the purge. Separately,
the database schema ships by a human running `drizzle-kit push` against production: no
migration files, no review artifact, no history.

This spec wires a Cloudflare Cron Trigger to a `scheduled()` handler that runs the three jobs
every 15 minutes with bounded batches and per-job failure isolation; enqueues the purge from
Better Auth while the user row still exists; adds the foreign keys the cloud tables lack; and
replaces `db:push` with committed Drizzle migrations: a baseline that describes production as
it is, one delta, a CI check that fails when the schema and the migrations disagree, and an
owner-run procedure to mark the baseline as applied without re-running it.

| #   | Decision                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                             | ADR                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | One Cron Trigger (`*/15 * * * *`) calls one `scheduled()` export that runs the sweep, the pending-delete retry and the account purge in sequence, each with its own bounded batch and its own `try/catch`                                                                                               | The use cases are already idempotent; a cron needs no new infrastructure; one trigger keeps the account well inside Cloudflare's Cron Trigger limits; sequential runs keep the subrequest count predictable                                     | none                                                                                       |
| 2   | The purge is enqueued from Better Auth **before** the user row is deleted, through `databaseHooks.user.delete.before`; the enqueue is idempotent per user and a failure aborts the deletion                                                                                                             | After the cascade, the `cloud_purge` row is the only memory that the account owned objects. The adapter-level hook fires for every path that deletes a user through Better Auth, not only the self-service endpoint                             | none                                                                                       |
| 3   | The purge job only drains jobs whose user row is **gone** (`NOT EXISTS` on `user`)                                                                                                                                                                                                                      | The HTTP driver cannot wrap the enqueue and the delete in one transaction. If the delete fails after the enqueue, a live account must never have its objects purged                                                                             | none                                                                                       |
| 4   | Schema integrity: FK `cloud_revision(user_id, asset_id) → cloud_asset` (cascade), FK `cloud_asset.current_revision_id → cloud_revision` (set null), drop `subscription_userId_idx`, `DEFAULT now()` on `session.updated_at` and `account.updated_at`. `derived_from_asset_id` stays unconstrained       | Orphan revisions are possible today and the code is the only guard. The dropped index duplicates the unique constraint on the same column. `derived_from_asset_id` cannot get a composite `SET NULL` that Drizzle can express; recorded as debt | none                                                                                       |
| 5   | Schema changes ship as **committed Drizzle migrations**: `0000_baseline` (production as it is on `main`) plus `0001_integrity`; `db:push` is demoted to throwaway development databases; CI fails when `drizzle-kit generate` would write anything; CODEOWNERS names the owner on schema and migrations | Reviewable SQL in order, repeatable on any database, and a gate before a third party can change the schema. The drift check needs no database and no secret                                                                                     | [0029](/architecture/decisions/0029-committed-migrations-instead-of-push/) (new, Proposed) |
| 6   | Applying a migration to production stays an **owner-run** step for now; the first run is preceded by a one-time journal insert that marks the baseline as applied; a `migrate` job in `release-api.yml` is designed here but not built                                                                  | Production was built with `push`, so the baseline's tables already exist and must be recorded, not executed. Giving CI a production credential and an automatic schema step is a separate decision the ADR's reopen conditions cover            | 0029                                                                                       |
| 7   | Debt recorded, not fixed: timestamps without time zone, free-text status columns without CHECK, session IP/UA retention, the console reading every user                                                                                                                                                 | Each needs a data migration or a product decision; a baseline-and-integrity change should not carry them                                                                                                                                        | none (ledger entries)                                                                      |

**Open questions** (each changes a number or a step below, none blocks the code):

1. **Which Workers plan is `kaipu-api` on?** The Free plan allows 50 subrequests per
   invocation and 10 ms CPU per Cron Trigger; Paid allows 10,000 and 30 s. Every Neon HTTP
   query and every R2 call is a subrequest, so the batch sizes in this spec (100 / 100 / 5)
   assume Paid. On Free they must drop to roughly 10 / 10 / 1 and the purge must be bounded by
   objects per run. Not visible from the repository.
2. **Is self-service account deletion wanted now?** Better Auth's `/delete-user` endpoint is
   disabled (`user.deleteUser.enabled` is not set anywhere). Until a deletion path exists the
   hook is dormant and no purge job will ever be enqueued. The spec recommends an operator
   command first and the self-service endpoint as a later product decision.
3. **Does the `main` ruleset require code-owner review?** CODEOWNERS only makes the owner a
   requested reviewer; the ruleset turns it into a gate. Repository settings are not in git.
4. **Does production contain any orphan rows** (a revision with no asset, an asset whose
   `current_revision_id` points nowhere)? Both would make `0001_integrity` fail. The owner
   pre-check in the ADR answers it; an agent must not.
5. **ADR number.** Resolved 2026-10-21: `main` now skips from `0010` to `0020`, and other
   specs reserve numbers in that gap, so this ADR takes `0029`, the next free number on `main`.

**Out of scope:** the orphan-R2-key sweep (its use case belongs to
[NIW2-323](https://linear.app/niway/issue/NIW2-323); this spec leaves a named hook point for
it); a Cloudflare Queue, Workflow or Durable Object; per-PR Neon branches in CI (designed as an
option, not built); applying migrations from the release workflow (designed, not built);
down-migrations; converting timestamps to `timestamptz`; CHECK constraints on status columns;
any retention policy for session IP and user agent; the console's data access; a kill switch
for individual jobs; alerting infrastructure beyond the structured log lines.

## Current state

Paths are relative to the repository root. Line numbers are from `main` at `400c80e` unless
marked _(branch)_, which means the WIP commit on this ticket's branch.

### Jobs that nothing runs

| Fact                                                                                                                                                                                             | Where                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `sweepExpiredReservations` claims each expired reservation first (`release` succeeds only while `reserved`), then deletes its objects; bounded by `limit`; a storage failure never fails the run | `packages/application/src/cloud/sweep-expired-reservations.ts:16-43`                                                              |
| `retryPendingDeletes` finishes deletes whose storage call failed; accounting settles only on success                                                                                             | `packages/application/src/cloud/retry-pending-deletes.ts:5-23`                                                                    |
| `purgeAccountObjects` lists and deletes every key under the account's prefixes, marks the job done, or records the attempt; jobs past `maxAttempts` stay pending for an operator                 | `packages/application/src/cloud/purge-account-objects.ts:10-39`; prefixes in `packages/domain/src/schemas/cloud-asset.ts:173-175` |
| The Worker exports only the Hono app; no `scheduled` handler                                                                                                                                     | `apps/server-hono/src/index.ts:43`                                                                                                |
| `wrangler.jsonc` has no `triggers`                                                                                                                                                               | `apps/server-hono/wrangler.jsonc`                                                                                                 |
| `tryGetStorage()` already exists "for the scheduled handler, which has no oRPC context"                                                                                                          | `apps/server-hono/src/lib/storage.ts:25-32`                                                                                       |
| The `cloud.sweep` / `cloud.sweep.failed` event shapes already exist                                                                                                                              | `apps/server-hono/src/lib/events.ts:21-31`                                                                                        |
| The port already describes the purge queue as "filled by the auth `beforeDelete` hook and drained by the sweep"                                                                                  | `packages/domain/src/repositories/cloud-asset.repository.ts:91-102`                                                               |
| `RESERVATION_GRACE_SECONDS = 3 h` is marked "PROPOSAL — not approved"; `MAX_PENDING_UPLOADS_PER_ACCOUNT = 3`; ticket TTL 5 min                                                                   | `packages/domain/src/constants/cloud-limits.ts:20-30`                                                                             |

Consequence today: after three abandoned intents an account's `pending_uploads` reaches the
cap and every new intent gets a 429 until someone runs `reconcile` by hand; objects of a
deleted account stay in the private bucket for ever.

### Account deletion

- Better Auth 1.4.18 (`package.json` catalog). `user.deleteUser` is not configured in
  `packages/infra-auth/src/config/base-config.ts` or `apps/server-hono/src/lib/auth.ts`, so the
  `/delete-user` endpoint is off. No other code path deletes a `user` row (the integration test
  does, deliberately, in `packages/infra-db/src/integration/cloud-asset.repository.integration.test.ts:77`).
- Every app table references `user.id` with `ON DELETE CASCADE`, so a user delete removes
  recordings, subscription, cloud assets, revisions and the accounting row in one statement.
- `CloudPurgeRepository.enqueue` inserts unconditionally; `nextPending` lists every row with
  `done_at IS NULL` (`packages/infra-db/src/repositories/cloud-purge.repository.ts:10-21`).

### Schema and migrations

- `packages/infra-db/drizzle.config.ts` points `out` at `./src/migrations`, which does not exist;
  `schema` lists `./src/schema/enums`, which does not exist either.
- Integrity gaps (audit 1.4): no FK from `cloud_revision(user_id, asset_id)` to `cloud_asset`
  (`packages/infra-db/src/schema/cloud.ts:50-81`); `current_revision_id` and
  `derived_from_asset_id` are plain text; `subscription_userId_idx` duplicates the unique
  constraint on `user_id` (`schema/subscription.ts:21,35`); `session.updated_at` and
  `account.updated_at` have no default (`schema/auth.ts:27-29,56-58`).
- Postgres does not index foreign-key columns on its own. `cloud_revision_user_asset_idx` on
  `(user_id, asset_id)` already exists, so the cascade from `cloud_asset` is indexed.
- Driver: `drizzle-orm/neon-http` (`packages/infra-db/src/client/index.ts`). One HTTP request
  per statement; `db.batch` and single-statement CTEs are the only atomic units
  (`cloud-asset.repository.ts:132-170` is one such statement).
- `db:*` scripts run through `scripts/with-env.sh` (Infisical, or pass-through when `CI` or
  `SKIP_INFISICAL` is set). `turbo.json` declares `db:generate` and `db:migrate` with
  `env: ["DATABASE_URL"]`.
- `release-api.yml` passes `DATABASE_URL` to the Worker as a secret and runs no schema step.
- `.github/CODEOWNERS` has one line: `* @csdev19`.

## Job design

### Shape

One `scheduled()` export, one runner, three jobs. The runner builds the real adapters
(`createDatabaseClient(env.DATABASE_URL)`, `CloudAssetRepository`, `CloudPurgeRepository`,
`tryGetStorage()`) and hands them to a pure function `runScheduledJobs(deps)` that unit tests
drive with fakes. `index.ts` exports `{ fetch: app.fetch, scheduled }`.

```ts
// Shape only — the branch holds the implementation in apps/server-hono/src/jobs/.
export async function runScheduledJobs(deps: ScheduledJobDeps): Promise<void> {
  // for each job: try { await job(storage) } catch { logEvent({ name: "cloud.sweep.failed", job, error }) }
  // then: logEvent({ name: "cloud.sweep", ...counts })
}
```

The handler should `await runScheduledJobs(...)` rather than hand it to `ctx.waitUntil`.
Cloudflare's docs say a single asynchronous task does not need `waitUntil`, and awaiting ties
the invocation's recorded outcome to the run. The WIP uses `waitUntil`; the change is one line
and is listed as a task.

### Schedule

| Setting   | Value                                     | Why                                                                                                                                                                                                                                         |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron      | `*/15 * * * *` (UTC)                      | Reservations expire 5 min after the ticket plus a 3 h grace, so a 15 min cadence adds at most 5 % latency to the release. Pending deletes and purges are retries, not user-facing. Fewer runs keep every job inside one invocation's budget |
| Triggers  | 1 per Worker                              | Cloudflare counts Cron Triggers per account: 5 on Free, 250 on Paid. One trigger leaves room for the web Worker and future previews                                                                                                         |
| Wall time | 15 min max per invocation (both plans)    | A run that lists 100 + 100 rows and deletes up to a few hundred objects finishes in seconds; the limit is not the constraint, the subrequest count is                                                                                       |
| CPU       | 10 ms (Free) / 30 s (Paid, <1 h interval) | XML parsing of R2 listings and JSON of Neon responses is the only CPU work; I/O wait does not count. On Free this is tight and must be measured on the first runs (open question 1)                                                         |

### Batch sizes

| Job                          | Batch (per run)                                                              | Subrequests, worst case on this batch                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `sweep-expired-reservations` | `SWEEP_BATCH = 100` revisions                                                | 1 list + per revision: 1 `release` + up to 2 HEAD + 2 DELETE → ≤ 501                          |
| `retry-pending-deletes`      | `RETRY_DELETES_BATCH = 100` revisions                                        | 1 list + per revision: up to 2 DELETE + 1 `finishDelete` → ≤ 301                              |
| `purge-account-objects`      | `PURGE_BATCH = 5` jobs, `PURGE_MAX_ATTEMPTS = 5`, `PURGE_MAX_OBJECTS = 1000` | 1 list + per job: 2 prefixes × (1 LIST per 1,000 keys + 1 DELETE per key) + 1 mark → ≤ ~1,015 |
| `sweep-orphan-objects`       | `ORPHAN_ACCOUNT_BATCH = 10` accounts touched in the last 24 h                | 1 list + per account: 2 prefixes × (1 LIST per page + 1 revision lookup + DELETEs of orphans) |

Two consequences to act on:

- On the Paid plan (10,000 subrequests per invocation) the sweep and retry batches are safe.
  On Free (50) they are not: a single run with a real backlog would hit the limit and the
  remaining work would fail with an error the runner logs as `cloud.sweep.failed`. Confirm the
  plan before the first deploy; if Free, ship `10 / 10 / 1`.
- The purge is bounded by jobs, not by objects. An account with 2,000 objects costs ~2,004
  subrequests in one run, which Paid absorbs and Free does not. The fix is a per-run object
  budget inside `purgeAccountObjects` (`maxObjects`): delete up to the budget, return
  `exhausted: true` without touching `attempts`, and let the next run continue; `markDone` only
  when a full listing returns no keys. `attempts` then counts errors only, which is what the
  `maxAttempts` guard was written for. This is a task below, not in the WIP.

A backlog drains over several runs by design: 100 reservations per 15 min is 9,600 a day,
far above anything the product produces.

### Idempotency and overlap

Cloudflare documents no exclusivity between invocations of the same cron, so the design
assumes two runs can overlap. Every job is safe under that:

- The sweep claims with a conditional state transition (`release` only succeeds while
  `reserved`); a lost race leaves the revision and its object untouched.
- `finishDelete` only succeeds from `deleting`; deleting an R2 key that is already gone is a
  success at the storage layer.
- The purge's `markDone` is idempotent; two runs deleting the same prefix do redundant work and
  no harm.
- `enqueue` is idempotent per user (no second row while one is pending), so a retried deletion
  does not stack jobs.

### Failure isolation

Each job runs inside its own `try/catch`. A failing job logs `cloud.sweep.failed` with the job
name and the error **name** (never the message, which can carry a key) and the runner moves to
the next job. When storage is not configured (`tryGetStorage()` returns null) every job reports
a failure and nothing is touched. The runner itself never throws; a run always ends with one
`cloud.sweep` summary line.

### Observability

- One `cloud.sweep` JSON line per run with `released`, `deletedObjects`, `finishedDeletes`,
  `failedDeletes`, `purged`, `purgeFailed`, `reconciled` (the last stays 0 until a reconcile
  job exists); one `cloud.sweep.failed` line per failed job. Workers observability captures
  stdout (`observability.enabled` in `wrangler.jsonc`).
- Cloudflare's Cron Trigger "Past Events" table records each invocation; with `await` the
  recorded status reflects the run.
- Operator checks worth writing down in [Commands](/commands/) once the cron is live:
  `SELECT count(*) FROM kaipu_record_cloud_purge WHERE done_at IS NULL AND attempts >= 5`
  (jobs that need a human) and a log query for `cloud.sweep.failed` over the last day. Alerting
  on either is out of scope.

### Local test

`wrangler dev` exposes the scheduled handler at `/cdn-cgi/local/scheduled`;
`curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*"` runs it against the
development database and bucket. With `?format=json` the response carries the outcome.

## Deletion and purge sequence

Better Auth's `/delete-user` endpoint (when enabled) runs, in order:
`user.deleteUser.beforeDelete` → `internalAdapter.deleteUser` (deletes **sessions**, then
**accounts**, then the **user**, each through the adapter's hook wrapper) → `deleteSessions` →
cookie cleared → `user.deleteUser.afterDelete`. Verified in the installed package
(`better-auth/dist/api/routes/update-user.mjs`, `db/internal-adapter.mjs`,
`db/with-hooks.mjs`). The wrapper calls `databaseHooks.<model>.delete.before` before each
adapter delete; returning `false` aborts that delete, a thrown error propagates.

The designed sequence for one account:

1. **Hook** `databaseHooks.user.delete.before` runs with the user row still present. It calls
   `enqueueAccountPurge({ purge, userId })`, which inserts a `cloud_purge` row unless one is
   pending. On failure it throws; Better Auth aborts the user delete and returns an error.
2. **Adapter delete** removes the user row; Postgres cascades every app table.
3. **Next cron run**: `nextPending` returns only jobs whose `user_id` has no row in
   `kaipu_record_user` (`NOT EXISTS`), oldest first, up to `PURGE_BATCH`. The purge lists both
   prefixes (`videos/<userId>/`, `img/<userId>/`), deletes every key, and calls `markDone`.
4. On a storage error the job's `attempts` increments and `last_error` records the error
   message; after `PURGE_MAX_ATTEMPTS` the job stays listed as pending and is excluded from
   runs — it needs an operator.

Why the adapter-level hook and not only `user.deleteUser.beforeDelete`: the API-level callback
fires only for the self-service endpoint; the adapter-level hook fires for any path that
deletes a user through Better Auth (the admin plugin, a future operator endpoint). Both can be
registered; the enqueue is idempotent, so double registration is harmless. One honest
consequence of the adapter-level choice: sessions and accounts are already deleted when the
user hook runs, so an abort there leaves a user row without credentials. That is acceptable
because the only cause of an enqueue failure is the database being unreachable, in which case
the earlier deletes most likely failed too; it is noted so nobody mistakes it for a clean
rollback.

Why the `NOT EXISTS` guard (decision 3): the HTTP driver cannot span the enqueue and the
delete in one transaction. A job whose user still exists is a deletion that did not complete;
purging it would destroy a live account's data. Such a row is harmless (it is skipped) and
becomes active the moment the user is really deleted. A small operator query can clear stale
ones; not automated here.

Deletion paths that bypass Better Auth (a hand-run `DELETE FROM kaipu_record_user`, the
integration test) do not enqueue anything. The documented rule is: **a user is deleted through
Better Auth or through an operator command that calls `enqueueAccountPurge` first**. The
operator command is recommended as the first deletion path (open question 2): a `bun run
account delete <email>` script next to `plan.ts` that enqueues, then deletes the user through
the same database client, so the owner can delete test accounts before any self-service UI
exists. It is a task, not in the WIP.

## Schema changes and the migrations they produce

### `0000_baseline.sql` — production as it is

Generated by `drizzle-kit generate` from the schema on `main` **before** any integrity change.
It creates the 11 `kaipu_record_*` tables, their unique constraints, the six `user_id` foreign
keys with `ON DELETE cascade`, and nine indexes, including `subscription_userId_idx`. It is
never run against production (its tables exist); it is recorded as applied (see the owner
procedure) and it is what a fresh development database runs first.

Baseline integrity is defined as "the schema in the repository", not "whatever production
holds" (ADR 0029 rejects `drizzle-kit pull` for this reason). The owner pre-check finds any
difference; a difference is a bug to fix in the schema, not a fact to bless.

### `0001_integrity.sql` — the delta this ticket adds

| Statement                                                                                                                                    | Schema change                                           | Effect and risk                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DROP INDEX "subscription_userId_idx"`                                                                                                       | `index(...)` removed from `subscription.ts`             | The unique constraint on `user_id` keeps its own index; the planner loses nothing                                                                                                                                                                                                                                   |
| `ALTER TABLE account/session ALTER COLUMN updated_at SET DEFAULT now()`                                                                      | `.defaultNow()` added in `auth.ts`                      | Additive; Better Auth already always sets the column                                                                                                                                                                                                                                                                |
| `ADD CONSTRAINT cloud_asset_current_revision_fk FOREIGN KEY (current_revision_id) REFERENCES cloud_revision(revision_id) ON DELETE set null` | `foreignKey(...)` in `cloud.ts` on `cloudAssetTable`    | Nullable column, so the circular reference is legal. Fails if any asset points at a missing revision (owner pre-check). No index on `current_revision_id`: revisions are never hard-deleted today (tombstones), so `SET NULL` never runs; add the index the day they are                                            |
| `ADD CONSTRAINT cloud_revision_asset_fk FOREIGN KEY (user_id, asset_id) REFERENCES cloud_asset(user_id, asset_id) ON DELETE cascade`         | `foreignKey(...)` in `cloud.ts` on `cloudRevisionTable` | Fails if any revision has no asset (owner pre-check). `reserve` inserts the asset and the revision in one statement (`cloud-asset.repository.ts:132-170`); Postgres checks foreign keys at the end of the statement, so the sibling CTE's row is visible. The integration suite on a migrated database is the proof |

Each `ADD CONSTRAINT` takes a brief exclusive lock and scans the table once. At today's row
counts that is sub-second; the `NOT VALID` + `VALIDATE` split is unnecessary and was not
generated. A statement that fails leaves the earlier statements of the same file applied when
run through the HTTP migrator and rolled back when run through `drizzle-kit migrate` (see the
workflow section); the owner procedure uses the latter.

`derived_from_asset_id` stays unconstrained and `current_revision_id` does not prove the
revision belongs to the same user and asset; both are in the technical-debt ledger with their
closing conditions.

## Migration workflow

### Tooling facts the workflow relies on

- Drizzle keeps a journal in `src/migrations/meta/_journal.json` (one entry per migration with
  a `when` timestamp and a `tag`) and a snapshot per migration. `drizzle-kit generate` diffs the
  schema files against the last snapshot; it reads no database. ([Drizzle, Migrations](https://orm.drizzle.team/docs/migrations))
- Applied migrations are recorded in `drizzle.__drizzle_migrations (id, hash, created_at)`;
  the table and schema are configurable, the defaults are kept. ([Drizzle, `drizzle-kit migrate`](https://orm.drizzle.team/docs/drizzle-kit-migrate))
- `migrate` selects the row with the greatest `created_at` and applies every migration whose
  journal `when` is greater; `hash` is the SHA-256 of the `.sql` file's content. A migration is
  therefore "applied" to Drizzle when a row with its timestamp exists, whatever the hash says.
  ([drizzle-orm `pg-core/dialect.ts`](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/dialect.ts), `migrator.ts`; verified in the installed `drizzle-orm@0.45.1`)
- `drizzle-kit migrate` (installed `0.31.8`) with `@neondatabase/serverless` present opens a
  WebSocket `Pool` and uses `drizzle-orm/neon-serverless/migrator`, which runs each migration
  inside a transaction. The HTTP migrator (`drizzle-orm/neon-http/migrator`) runs statements
  one by one with no transaction and its own source warns that a failure mid-file leaves no
  rollback. Neon's driver guidance: HTTP for single or non-interactive batched queries,
  WebSockets "only if you need interactive transactions". ([Neon serverless driver](https://neon.com/docs/serverless/serverless-driver), [Drizzle, Neon](https://orm.drizzle.team/docs/connect-neon))
- Cloudflare Cron Trigger limits: 5 triggers per account on Free, 250 on Paid; 15 min wall
  time; 10 ms CPU (Free) / 30 s (Paid) per invocation for intervals under an hour; 50 / 10,000
  subrequests per invocation. ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/))
- Neon offers GitHub Actions to create, reset, diff and delete branches
  (`neondatabase/create-branch-action@v6` outputs `db_url`, `db_url_pooled`, `branch_id`).
  ([Neon, branching with GitHub Actions](https://neon.com/docs/guides/branching-github-actions), [create-branch-action](https://github.com/neondatabase/create-branch-action))

### Generate

1. Edit `packages/infra-db/src/schema/`.
2. `bun run db:generate` from the repository root (Infisical supplies the environment even
   though `generate` reads no database; the root script is the convention).
3. Rename the generated file to a meaningful tag if drizzle-kit's random name is unhelpful
   (`drizzle-kit generate --name integrity` does it at generation time). Never rename after
   commit: the journal `tag` and the file name must agree.
4. Read the SQL. Commit the `.sql`, the snapshot and the journal with the schema change.

### Review gate

- CODEOWNERS lists `/packages/infra-db/src/schema/`, `/packages/infra-db/src/migrations/` and
  `/packages/infra-db/drizzle.config.ts` under `@csdev19` explicitly, so the rule survives a
  change to the wildcard line. The `main` ruleset must require code-owner review for this to be
  a gate (open question 3).
- The reviewer reads the SQL, not only the TypeScript diff: Drizzle migrations are forward-only.
- A destructive statement (`DROP TABLE`, `DROP COLUMN`, a changed `ON DELETE`) needs its
  pre-check and its backout written in the PR body. Not enforced by tooling at this size.

### CI check (no database)

`scripts/check-migrations.sh` runs `drizzle-kit generate` with `DATABASE_URL` unset inside
`packages/infra-db` and fails if `git status --porcelain -- src/migrations` is non-empty. It
runs as a step of the `lint` job in `pr-checks.yml` (`bun run db:check`). Verified in the
worktree: with the WIP's files it prints "No schema changes, nothing to migrate" and exits 0.

Two guards worth adding when the branch is finished: `timeout-minutes` on the step, because
`drizzle-kit generate` prompts interactively when it suspects a rename and a prompt in CI
hangs; and a one-line note in `deployment/pr-checks.md` listing the step.

### Apply

- **Development (fresh database):** `bun run db:migrate` applies `0000` then `0001`. `db:push`
  remains available for a throwaway database and is documented as never-production.
- **Production, first time:** the owner procedure below.
- **Production, afterwards:** `SKIP_INFISICAL=1 DATABASE_URL=<prod> bun run db:migrate` by the
  owner, after the PR merges and before the API release that needs the change. Until the
  release workflow applies migrations, every migration must be **backward compatible with the
  Worker version currently deployed** (expand first, contract in a later migration), because
  the schema step and the deploy are separate human actions.

### Owner procedure: mark the baseline as applied on production

Done once, by the owner, never by an agent. Rehearse on a Neon branch first: a branch is a
copy-on-write snapshot of production, so the same steps run there with zero risk and prove the
pre-checks and `0001` before production sees them.

1. **Create a Neon branch** of the production database (console or API). Use its connection
   string for steps 2-5, then repeat 2-5 against production.
2. **Compare the live schema with the baseline** without writing anything:
   `SKIP_INFISICAL=1 DATABASE_URL=<url> bunx drizzle-kit push --strict --verbose` from
   `packages/infra-db` prints the statements it would run and asks for confirmation; answer
   **no**. The expected list is exactly the statements of `0001_integrity.sql` and nothing else.
   Anything else is drift between production and the repository: stop, fix the schema on a PR,
   regenerate `0001` from the corrected baseline, and start over. (`--strict` is what makes this
   safe: without it `push` applies non-destructive statements immediately.)
3. **Check for orphan rows** with the two `SELECT`s in ADR 0029. Both must return nothing.
4. **Record the baseline** in the journal table with the `INSERT` in ADR 0029. The hash is
   `shasum -a 256 packages/infra-db/src/migrations/0000_baseline.sql`
   (`a020c8d2c44757eea1ef404a4719e9b2f3d46df3a55d5f014a3586efc259a9fe` for the file on the
   branch) and `created_at` is the `when` of the `0000_baseline` journal entry
   (`1791782508821`). Do not regenerate the baseline afterwards.
5. **Apply `0001`:** `SKIP_INFISICAL=1 DATABASE_URL=<url> bun run db:migrate`. Then
   `SELECT count(*) FROM drizzle.__drizzle_migrations` returns 2, and `push --strict` from step
   2 reports no changes.
6. **Run the integration suite** against the branch:
   `TEST_DATABASE_URL=<branch url> bun run test:integration`. It exercises `reserve`,
   `markReady`, `release` and the deletes on the new foreign keys.
7. Delete the Neon branch. Repeat 2-5 on production.

### Rollback

- Drizzle migrations are forward-only. Undoing `0001` is a new migration `0002` that drops the
  two constraints and re-adds the index; the defaults can stay. Keep the SQL ready in the PR
  body of the first production run.
- If step 5 fails on production, `drizzle-kit migrate` rolled the file back (transactional
  path); the journal row for `0001` was not written; fix and rerun.
- A deployed Worker version can be rolled back with `wrangler rollback`; it does not undo the
  schema. This is why migrations stay backward compatible with the previous Worker.

### Later: a `migrate` job in `release-api.yml`

Designed, not built. A `migrate` job between `verify` and `release-api`, on the `production`
environment, running `bun run db:migrate` with `DATABASE_URL` from the environment's secrets
(`with-env.sh` passes through when `CI` is set). `release-api` gains `needs: [verify, migrate]`.
The job uses the WebSocket path through `drizzle-kit migrate`, so each migration is
transactional. Preconditions: the baseline is marked on production, one migration has been
applied by hand successfully, and the owner has decided whether the environment's protection
rules are the approval step. ADR 0029 names this as a reopen condition.

Optional, separately: a Neon branch per pull request that touches `packages/infra-db/`, with
`create-branch-action` → `db:migrate` → `test:integration` → `delete-branch-action`. It needs
`NEON_API_KEY` and `NEON_PROJECT_ID` in a GitHub environment that pull requests may use, which
the `testing` environment is designed for. Not part of this ticket.

## Test plan

| Level                   | What                                                                                                                                                                                                                                                                                 | Status                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Unit, runner            | `runScheduledJobs`: calls the three jobs with the documented batch sizes and logs one summary; a throwing job does not stop the others and is named in `cloud.sweep.failed`; unconfigured storage reports three failures and touches nothing                                         | In the WIP (`apps/server-hono/src/jobs/run-scheduled-jobs.test.ts`); 3 tests pass in the worktree |
| Unit, hook              | `enqueuePurgeBeforeUserDelete`: enqueues for the user id; propagates an enqueue failure                                                                                                                                                                                              | In the WIP (`apps/server-hono/src/lib/account-deletion.test.ts`); 2 tests pass                    |
| Unit, application       | `enqueueAccountPurge` twice for one user yields one job; the purge then removes only that account's objects                                                                                                                                                                          | In the WIP (`packages/application/src/cloud/cloud.test.ts`); 27 tests in the file pass            |
| Unit, application       | Purge object budget: a job with more keys than `maxObjects` returns `exhausted`, keeps `attempts` unchanged and is finished by a later run                                                                                                                                           | To write with the budget task                                                                     |
| Unit, repository fake   | `makeFakePurge.nextPending` ignores jobs whose user still exists (today the fake has no notion of users; add one so the guard is tested at the application level too)                                                                                                                | To write                                                                                          |
| Integration (owner-run) | `bun run test:integration` against a Neon branch migrated with `0000` + `0001`: `reserve` on a fresh asset, on a tombstoned asset, `markReady` setting `current_revision_id`, cascade on user delete; plus a new case: inserting a revision with no asset fails with an FK violation | Needs `TEST_DATABASE_URL`; never run by an agent                                                  |
| Integration (owner-run) | `CloudPurgeRepository`: enqueue twice → one pending row; `nextPending` excludes a job whose user exists and includes it once the user row is deleted                                                                                                                                 | To write, same suite                                                                              |
| Local cron              | `wrangler dev` + `curl /cdn-cgi/local/scheduled?cron=*/15+*+*+*+*` against the development database and bucket; expect one `cloud.sweep` line                                                                                                                                        | Owner, before the first deploy                                                                    |
| Migration rehearsal     | Owner procedure steps 1-7 on a Neon branch                                                                                                                                                                                                                                           | Owner                                                                                             |
| Static                  | `bun run db:check`; `tsc -b` in `apps/server-hono`; `tsc --noEmit` in `packages/infra-db`                                                                                                                                                                                            | All three clean in the worktree on the WIP commit. Full `bun run verify` not yet run              |

## Acceptance criteria

1. `wrangler deploy` of `apps/server-hono` registers one Cron Trigger (`*/15 * * * *`) and the
   Worker's Past Events show successful invocations with a `cloud.sweep` log line each.
2. A reservation whose ticket expired more than `RESERVATION_GRACE_SECONDS` ago is `expired`
   within two runs, its reserved bytes and `pending_uploads` released, and its landed objects
   deleted. An account at the pending cap recovers without an operator.
3. A revision in `deleting` whose storage delete failed reaches `deleted` within two runs once
   storage is reachable.
4. Deleting a user through Better Auth (once a path exists) leaves one `cloud_purge` row; within
   two runs every key under `videos/<id>/` and `img/<id>/` is gone and the row has `done_at`.
   Deleting the same user twice (a retry) does not create a second row.
5. A `cloud_purge` row whose user still exists is never worked.
6. A failing job (storage down) produces a `cloud.sweep.failed` line naming it and does not
   prevent the other two jobs from running in the same invocation.
7. `packages/infra-db/src/migrations/` holds `0000_baseline.sql`, `0001_integrity.sql`, their
   snapshots and the journal; `bun run db:check` passes on `main`; a fresh database migrated
   with `db:migrate` matches the schema (`push --strict` reports no changes).
8. On production, `drizzle.__drizzle_migrations` holds two rows and the four integrity
   statements are in effect; the integration suite passes against a branch of it.
9. `db:push` is documented as development-only in `commands.md`, `CLAUDE.md` and the README;
   CODEOWNERS names the owner on the schema and migration paths; ADR 0029 is in the index.
10. The technical-debt ledger carries the four deferred schema debts with closing conditions.

## Rollout and backout

**Order.** (1) Merge the branch: code, migrations, CI check, docs. The cron is inert until the
API is released. (2) Owner procedure: mark the baseline and apply `0001` on production. The
Worker running today does not depend on `0001`, so this is safe in isolation. (3) Release the
API (`api-v*` tag). The new Worker registers the cron; the first run happens within 15 minutes.
(4) Watch three runs: Past Events, the `cloud.sweep` counts, and `cloud.sweep.failed` lines.
(5) Enable a deletion path (operator command first), delete a test account, confirm the purge.

**Backout, jobs.** Remove `triggers` from `wrangler.jsonc` and deploy, or roll back to the
previous Worker version with `wrangler rollback`; either stops the cron. The use cases make no
irreversible change the code did not already consider final (expired reservations, deletes
already requested, accounts already deleted).

**Backout, schema.** A `0002` migration that drops the two constraints and recreates the
index. The old Worker never depended on the constraints, so a Worker rollback needs no schema
change.

**Backout, process.** Reverting to `db:push` is a documentation change; the migration files
can stay. ADR 0029 would move to Superseded.

## Owner steps

Everything an agent must not or cannot do:

1. Push the branch and open the PR (the branch changes a workflow file; the available token
   lacks the `workflow` scope). Run `bun run verify` locally first or let `pr-checks.yml` do it.
2. Confirm the Workers plan of the Cloudflare account and, if Free, lower the batch sizes
   before merging (open question 1).
3. Check that the `main` ruleset requires code-owner review; enable it if the CODEOWNERS entry
   is meant as a gate (open question 3).
4. Run the migration rehearsal on a Neon branch, then the owner procedure on production.
5. Release the API, watch the first cron runs, and record the operator queries in
   [Commands](/commands/).
6. Decide the deletion path (operator command now, self-service endpoint later or never) and
   test one real deletion end to end.
7. Later: add the `migrate` job to `release-api.yml` once one manual migration has succeeded,
   and update ADR 0029's status.

## Implementation status

Updated 2026-10-21, after `main` was merged into the branch. "Verified" means run in the
worktree without a database: `bun run db:check`, `check-types`, `build` and `test` for
`@kaipu/domain`, `@kaipu/application`, `@kaipu/infra-db` and `server-hono`, plus the
pre-commit lint and format hooks. The integration suite was written but **not run**: it needs a
throwaway database, and no agent connects to one. Nothing has touched any database.

| #   | Task                                                                                                                                                       | Status                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `jobs/run-scheduled-jobs.ts` + test; `jobs/scheduled.ts`; `index.ts` exports `{ fetch, scheduled }`; `wrangler.jsonc` cron; `job` on `cloud.sweep.failed`  | done, unit tests verified                                                 |
| 2   | `enqueue-account-purge.ts` + export + test; `fakes.ts` idempotent enqueue                                                                                  | done, tests verified                                                      |
| 3   | `lib/account-deletion.ts` + test; `databaseHooks.user.delete.before` merged with `main`'s `accountLinkingHooks` in `lib/auth.ts`                           | done, tests verified; dormant until a deletion path exists                |
| 4   | `CloudPurgeRepository`: idempotent `enqueue`, `nextPending` with `NOT EXISTS` on `user`                                                                    | done, types verified; integration test written, not run                   |
| 5   | Schema: composite FK, `current_revision_id` FK, index drop, `updated_at` defaults; `drizzle.config.ts` schema path fixed                                   | done                                                                      |
| 6   | `0000_baseline.sql`, `0001_integrity.sql`; `0002_account_provider_unique.sql` for the NIW2-219 index `main` added after the baseline (`IF NOT EXISTS`)     | done, `db:check` verified                                                 |
| 7   | `scripts/check-migrations.sh` (pinned `drizzle-kit`, ignores staged files), root `db:check`, `pr-checks.yml` step with a timeout, CODEOWNERS entries       | done, script verified locally; the step runs on release candidates (0027) |
| 8   | ADR renumbered **0029**, ADR index row, `commands.md`, `CLAUDE.md`, `README.md`, `deployment/pr-checks.md`, ledger entries                                 | done; ADR status kept **Proposed**                                        |
| 9   | `scheduled.ts`: `await runScheduledJobs(...)` instead of `ctx.waitUntil`                                                                                   | done                                                                      |
| 10  | `purgeAccountObjects`: per-run object budget (`maxObjects`, `exhausted`, `attempts` only on error); done only after an empty listing; runner summary field | done, unit tests verified (`PURGE_MAX_OBJECTS = 1000`)                    |
| 11  | `makeFakePurge` models "user exists" (`liveUsers`), so the `nextPending` guard is tested at the application level                                          | done, test verified                                                       |
| 12  | Integration tests for the new foreign keys and for `CloudPurgeRepository` (`cloud-purge.repository.integration.test.ts`)                                   | written and type-checked; **owner runs** `bun run test:integration`       |
| 13  | `timeout-minutes` on the `db:check` step; `deployment/pr-checks.md` lists it; README's `db:push` line                                                      | done                                                                      |
| 14  | Fourth job: `sweepOrphanObjects` (NIW2-323) wired with `ORPHAN_ACCOUNT_BATCH = 10` over a 24 h lookback, one `cloud.sweep.orphans` line per run            | done, unit test verified                                                  |
| 15  | Operator command `account delete <email>` next to `scripts/plan.ts`, with a `bun run account` root script                                                  | to do, after open question 2                                              |
| 16  | Owner procedure on a Neon branch, then production; ADR 0029 status → Accepted with the date                                                                | owner                                                                     |
| 17  | `migrate` job in `release-api.yml`                                                                                                                         | later, per ADR 0029 reopen conditions                                     |

## References

- [ADR 0029: Committed Drizzle migrations replace `db:push`](/architecture/decisions/0029-committed-migrations-instead-of-push/) (Proposed)
- [ADR 0002: Plan entitlements kept separate from auth](/architecture/decisions/0002-plan-entitlements-separate-from-auth/) — the per-feature table pattern the integrity changes keep
- [ADR 0010: Checks run in Actions on every pull request](/architecture/decisions/0010-checks-run-in-actions-on-every-pr/) — where the `db:check` step lives
- [Cloud recording lifecycle and account deletion (backlog)](/backlog/cloud-data-lifecycle/) — the acceptance criteria this spec implements
- [Technical debt ledger](/backlog/technical-debt/) — the four deferred schema debts
- [Commands](/commands/) — `db:*` scripts and the inline `DATABASE_URL` convention
- Cloudflare: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/), [Limits](https://developers.cloudflare.com/workers/platform/limits/)
- Neon: [Serverless driver (HTTP vs WebSockets)](https://neon.com/docs/serverless/serverless-driver), [Branching with GitHub Actions](https://neon.com/docs/guides/branching-github-actions), [create-branch-action](https://github.com/neondatabase/create-branch-action)
- Drizzle: [Migrations](https://orm.drizzle.team/docs/migrations), [`drizzle-kit migrate`](https://orm.drizzle.team/docs/drizzle-kit-migrate), [Neon connection](https://orm.drizzle.team/docs/connect-neon), [`pg-core/dialect.ts` migrate](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/dialect.ts), [`neon-http/migrator.ts`](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/neon-http/migrator.ts)
- Better Auth: [Database hooks](https://www.better-auth.com/docs/concepts/database), [Users and accounts: delete user](https://www.better-auth.com/docs/concepts/users-accounts)
