---
title: Cloud storage (server)
description: How the API stores recordings and screenshots in R2 — model, quota, upload tickets, confirm, cleanup cron, account purge, operator actions, WAF runbook and the production checklist.
---

# Cloud storage (server)

Operational reference for the optional cloud on the API Worker (`apps/server-hono`, Worker
`kaipu-api`). It describes what the code on `main` does; design history lives in
[plan 01](/plans/2026-09-09-cloud-01-server-quotas-and-revisions/) and the
[handoff](/backlog/optional-cloud-handoff/). Bytes are **decimal** everywhere (1 GB =
1 000 000 000 bytes).

> The cron sweep, account purge and `cloud:uploads` command (plan 01 Task 11) arrive with the
> NIW2-214 server PR (#268). Until it merges, the sections that mention them describe the
> intended behaviour, not `main`.

## Model

Three tables carry the state (`packages/infra-db/src/schema/cloud.ts`, prefix `kaipu_record_`):

| Table                   | One row per                     | Holds                                                                                                     |
| ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `cloud_asset`           | logical file (client `assetId`) | owner, kind (`recording`/`screenshot`), title, current revision pointer, auto-upload exclusion, tombstone |
| `cloud_revision`        | upload attempt / version        | intent key, storage + thumbnail keys, declared size/type/sha256, reserved bytes, ticket expiry, status    |
| `cloud_storage_account` | user                            | `used_bytes`, `reserved_bytes`, `pending_uploads` — the accounting row                                    |

Two more support operations: `cloud_control` (one `global` row: `uploads_enabled`) and
`cloud_purge` (account purge queue, no FK so it survives the user row).

Revision status:

| Status     | Meaning                                                                     | Counts as                |
| ---------- | --------------------------------------------------------------------------- | ------------------------ |
| `reserved` | Intent accepted, ticket issued, bytes reserved; object may or may not exist | `reserved_bytes`         |
| `ready`    | Confirm verified the object; the asset points at it                         | `used_bytes`             |
| `expired`  | Reservation released by cancel or the sweep                                 | nothing                  |
| `deleting` | Delete intent persisted; physical R2 delete pending                         | `used_bytes` (see below) |
| `deleted`  | Object removed                                                              | nothing                  |

Storage keys: `videos/<userId>/<assetId>/<revisionId>.<ext>` and `img/<userId>/…` (thumbnails
and screenshots). `accountPrefixes(userId)` lists every prefix an account owns.

## Quota enforcement

- Capacity comes from entitlements: **1 GB** for a verified email (Cloud Free), 25 GB for Pro.
  Entitlements v2 (250 MB trial + approval, plans `2026-09-15-02`/`-03`) is **not** on `main`.
- Per-file caps: 1 GB per video, 25 MB per screenshot, 512 KB per thumbnail. At most **3**
  pending uploads per account across devices.
- `reserve` is **one SQL statement** (data-modifying CTE): a conditional `UPDATE` on the
  accounting row succeeds only when `used + reserved + new ≤ capacity` and `pending < 3`, then
  inserts the revision. There is no transaction because the Neon HTTP driver autocommits each
  statement — one statement is the atomic unit. Two devices can never both get the last bytes.
- Confirm moves bytes reserved → used exactly once; cancel, repeated confirm and retries never
  double-count or go negative.
- `reconcile(userId)` recomputes the accounting row from revisions inside a `db.batch` that
  locks the account row `FOR UPDATE`. The sweep runs it for accounts touched in the last hour.

## Tickets

`POST /api/v1/assets/upload-intents` returns a presigned R2 PUT valid for **5 minutes**
(`UPLOAD_TICKET_TTL_SECONDS`). The client must send these signed headers verbatim:

| Header                  | Blocks                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `content-length`        | Lying about size: R2 rejects a different body length (it may answer `502`, not 4xx) |
| `content-type`          | Uploading a different type than declared                                            |
| `x-amz-checksum-sha256` | Uploading different bytes than declared                                             |
| `if-none-match: *`      | Overwriting an existing object with a replayed ticket                               |

Expiry is checked when a request **starts**: a running PUT is not cut at 5 minutes. A `403` on a
new PUT means "URL expired — renew it" (same intent key, no new reservation). The reservation
itself survives `ticketExpiresAt + RESERVATION_GRACE_SECONDS` (3 h, **proposal**) so a 1 GB upload
on a slow link can finish. Download URLs last 10 minutes and are reusable until then.

## Confirm verification

`POST /assets/{assetId}/revisions/{revisionId}/confirm` HEADs the object and promotes the revision
to `ready` only if size, base content type and `x-amz-checksum-sha256` all match the declaration.
A HEAD without a checksum is rejected (the object did not come through a ticket). The thumbnail is
checked by **size only** (known gap). Confirm is idempotent: a `ready` revision is returned without
touching accounting. Errors map to `CONFLICT` with `data.reason` = `missing` | `size` |
`content-type` | `checksum` | `thumbnail`.

## Lifecycle and sweep (cron)

Remote cleanup must not depend on any device being online (Task 0 #6). A Cloudflare Cron Trigger
on `kaipu-api` calls the Worker's `scheduled` export (`src/scheduled.ts` →
`src/cloud/run-cloud-sweep.ts`). Each run, in order, every step idempotent and bounded:

1. **Release expired reservations** — revisions still `reserved` whose ticket expired more than
   the grace ago: claim (`release`) first, then delete any object that landed without a confirm.
   A revision confirm won the race on is left alone.
2. **Retry pending deletes** — revisions in `deleting`: delete object + thumbnail, then
   `finishDelete` (quota stops counting here).
3. **Drain the purge queue** — for each pending `cloud_purge` job whose user row is gone, list and
   delete every key under `accountPrefixes(userId)`; mark done, or count an attempt with the error.
   Jobs at `maxAttempts` stay pending for an operator.
4. **Reconcile** accounts touched in the last hour.

| Setting                | Value              | Status                |
| ---------------------- | ------------------ | --------------------- |
| Schedule               | `*/15 * * * *`     | **Proposal** (Task 0) |
| Reservations per run   | 50                 | **Proposal**          |
| Deletes per run        | 50                 | **Proposal**          |
| Account purges per run | 1                  | **Proposal**          |
| Purge `maxAttempts`    | 10                 | **Proposal**          |
| Reservation grace      | 3 h                | **Proposal**          |
| Reconcile window       | 1 h, ≤ 50 accounts | **Proposal**          |

The run emits `cloud.sweep` (counts) or `cloud.sweep.failed` (error name).

**How to verify it runs**

- Locally: `bun run dev:server-hono` (the `dev` script passes `--test-scheduled`), then
  `curl "http://localhost:3000/__scheduled?cron=*/15+*+*+*+*"` — one `cloud.sweep` JSON line
  appears in the wrangler output.
- Production: Workers → `kaipu-api` → Logs, filter `cloud.sweep`; expect one line per window.
  Settings → Triggers lists the cron.
- Alerting: create a dashboard notification on log lines containing `cloud.sweep.failed`. This is a
  dashboard setting, not code.

## Account deletion

Better Auth `user.deleteUser` is enabled (`POST /api/auth/delete-user`, password or a fresh
session). `beforeDelete` enqueues a `cloud_purge` job **before** the user row is deleted; the FK
cascade then removes every cloud row, and the cron removes the objects. If the enqueue fails the
user is not deleted. If the delete fails after the enqueue, the job is not handed out while the
user row exists, so a live account is never purged.

## Cloud access

- A **verified email** grants Cloud Free automatically. There is no allowlist and no manual grant
  (Task 0 #8).
- Verification emails are sent through Resend (`apps/server-hono/src/lib/auth.ts`). Production
  delivery (domain DKIM/SPF, a real inbox) must be proven before opening uploads — without it no
  account gets cloud access.
- Proposed launch rule (NIW2-214 Q1): keep the global switch **off** in production until
  entitlements v2 lands, turning it on only for the founder's test.

## Decisions and open proposals

Approved (plan 01 Task 0, 2026-09-13): 25 MB per screenshot, 1 GB per video; 3 pending uploads
per account; 5-minute upload URLs requested only when the file's turn comes; atomic reservation;
10-minute download URLs; device-independent cleanup; delete intent first then physical delete with
cron retries; Cloud Free 1 GB for a verified email; a global upload switch managed by command;
Cloudflare rate limiting in addition to app limits.

Open — shipped as proposals, **not approved**:

| Value                            | Proposal in code                                                              |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `RESERVATION_GRACE_SECONDS`      | 3 h after ticket expiry                                                       |
| Cron schedule                    | `*/15 * * * *`                                                                |
| Sweep batch sizes                | 50 reservations + 50 deletes + 1 account purge per run                        |
| When deleted bytes stop counting | at the physical R2 delete (`finishDelete`); alternative: at the delete intent |
| Rate-limit thresholds            | none fixed — see the WAF runbook                                              |

## Operator actions

**Global upload switch** (from the repo root; goes through `scripts/with-env.sh`, so it targets
the **dev** database unless `DATABASE_URL` is supplied):

```bash
bun run cloud:uploads status   # read
bun run cloud:uploads off      # pause new uploads
bun run cloud:uploads on       # resume
```

Off: `POST /assets/upload-intents` answers `SERVICE_UNAVAILABLE`, `/me/storage` reports
`uploadsEnabled: false`, the desktop shows "Uploads paused". It does **not** stop downloads,
deletes, PUTs already running or URLs already issued. A **missing row means enabled**, so a new
database is open until someone runs `off` once.

**Stuck purges** (read-only):

```sql
SELECT * FROM kaipu_record_cloud_purge WHERE done_at IS NULL AND attempts >= 10;
```

## Rate limiting (WAF runbook)

App-level limits (quota, 3 pending uploads, per-file caps, MIME allowlist, paginated listing) fail
closed even if the WAF is misconfigured. The WAF adds protection against scripts and replayed
requests. **Thresholds are open** and must allow legitimate use, including restoring a whole
library from another device.

1. **First record the plan's limits.** Cloudflare dashboard → the zone serving `kaipu-api` →
   Security → WAF → Rate limiting rules: note how many rules the plan allows, which counting
   characteristics are available (IP only, or headers/cookies), and the allowed periods. Write
   them here before creating rules.
2. **Create one rule per route family**, within those limits:

| Route                                  | Method   | Count by                                          |
| -------------------------------------- | -------- | ------------------------------------------------- |
| `/api/v1/assets/upload-intents`        | `POST`   | `Authorization` header (desktop bearer), else IP  |
| `/api/v1/assets/*/revisions/*/confirm` | `POST`   | `Authorization` header, else IP                   |
| `/api/v1/assets/*/download-url`        | `GET`    | `Authorization` header or session cookie, else IP |
| `/api/v1/assets/*/cloud`               | `DELETE` | `Authorization` header or session cookie, else IP |
| `/api/auth/sign-in/email`              | `POST`   | IP                                                |
| `/api/auth/sign-up/email`              | `POST`   | IP                                                |

If the plan only counts by IP, use IP everywhere and set thresholds high enough for a shared
office NAT. 3. Action: **Block** with a short mitigation timeout, or **Managed challenge** for the auth
routes. Start in **Log** mode for a few days, read the matches, then enforce. 4. Remember: limiting `download-url` issuance does **not** limit downloads — a URL is reusable
until it expires (10 minutes).

## Events

One JSON line per event (`apps/server-hono/src/lib/events.ts`), captured by Workers
observability. Ids, counts, bytes and error names only — never a presigned URL, token, storage
key or user title.

| Event                   | Fields                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `cloud.intent.created`  | `userId`, `assetId`, `revisionId`, `reservedBytes`                                                      |
| `cloud.intent.rejected` | `userId`, `reason`, `missingBytes?`                                                                     |
| `cloud.confirm.ok`      | `userId`, `revisionId`, `sizeBytes`                                                                     |
| `cloud.confirm.failed`  | `userId`, `revisionId`, `reason`                                                                        |
| `cloud.delete.ok`       | `userId`, `assetId`                                                                                     |
| `cloud.delete.failed`   | `userId`, `assetId`, `error`                                                                            |
| `cloud.sweep`           | `released`, `deletedObjects`, `finishedDeletes`, `failedDeletes`, `purged`, `purgeFailed`, `reconciled` |
| `cloud.sweep.failed`    | `error`                                                                                                 |

## Schema and migrations

The schema lives in `packages/infra-db/src/schema/`; `drizzle-kit` writes migrations to
`packages/infra-db/src/migrations/`. Until 2026-10-09 no migration was tracked — databases were
built with `db:push`. The committed baseline `0000_baseline.sql` is the full current schema
(including the legacy `recording` table, which NIW2-221 removes in its own migration).

- **Empty database** (a fresh Neon branch, a new environment): `bun run db:migrate` applies it.
- **Database built with `db:push`** (dev, and production if it was pushed): running `0000` would
  fail on existing tables. Instead, check the live schema matches the baseline (run `drizzle-kit pull` into a
  scratch folder and diff it against `src/schema/`) and then **record the baseline as applied** in `drizzle.__drizzle_migrations`
  (hash + `created_at` of the journal entry) so later migrations start from `0001`. Do this on a
  Neon branch of production first.
- Never `db:push` against production. Applying migrations to a remote database is an operator
  step, never part of a PR.

## Integration tests in CI

`bun run test:integration` (`packages/infra-db/src/integration/`) runs against a real Postgres
and **creates and deletes rows**. The `CI` workflow (on demand, from the Actions tab) runs it only
when the repository secret `TEST_DATABASE_URL` exists, and prints a notice otherwise. Point the
secret at a **dedicated throwaway Neon branch**, never at dev or production. Adding the secret is
a repository-settings action for the founder.

## Production checklist

See also [Production cloud security](/backlog/production-cloud-security/).

1. Apply the schema: baseline migration per "Schema and migrations" (Neon branch first).
2. Seed the switch closed: `bun run cloud:uploads off` against production.
3. Set the R2 secrets on the Worker (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET` = the private bucket); confirm the bucket has no public access.
4. Prove a verification email end to end (Resend DKIM/SPF, a real inbox).
5. Create the WAF rules (runbook above) and the `cloud.sweep.failed` alert.
6. Confirm one `cloud.sweep` line in Workers logs after deploy.
7. Triage the known gaps below before opening uploads to everyone.

## Known gaps

- `AssetConflictError` and `UploadIntentExpiredError` are not mapped in
  `modules/cloud/errors.ts`, so a tombstoned asset, a duplicate intent race or an expired intent
  answers `500` instead of `CONFLICT` / an `intent-expired` kind. The desktop (phase 3) needs the
  `intent-expired` answer.
- Thumbnail verification is size-only.
- `markReady` moves the asset pointer without checking `deleted_at`.
- A malformed list cursor returns the first page instead of `400`.
- No orphan-object scan: an object whose claim succeeded but delete failed is untracked.
