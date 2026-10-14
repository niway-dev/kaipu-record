---
title: Optional cloud — handoff (state and how to continue)
description: Where the optional cloud work stands on 2026-09-13, what is merged, what is open, every decision and deferred finding, and the exact steps to resume it on another machine.
---

# Optional cloud — handoff

> **Status: 🟡 In progress.** Snapshot written 2026-09-13 so the work can resume on another
> machine without the original session. It records repository state, not intentions: anything
> not listed as merged or implemented is not done. The epic tracker is
> [Optional cloud (epic)](/backlog/optional-cloud/); the binding decisions live in
> [plan 01, Task 0](/plans/2026-09-09-cloud-01-server-quotas-and-revisions/).

## 0. Refresh — state of `origin/main` on 2026-10-09 (NIW2-214)

Sections 1–7 below are the 2026-09-13 snapshot and are kept for their rulings and findings. Where
they disagree with this section, **this section wins**. Verified against `origin/main` at
`400c80e`.

| Plan 01 task                                                       | State on `main`                    | Evidence                                                                                                                                                                                |
| ------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–9 (decisions, spikes, domain, tickets, tables, repos, use cases) | ✅ Merged (#92, brought in by #96) | `packages/application/src/cloud/*`, `packages/infra-db/src/repositories/cloud-*.ts`, `packages/infra-db/src/schema/cloud.ts`                                                            |
| 10 (contract, `/assets*`, `/me/storage`, error mapping, events)    | ✅ Merged (#97)                    | `apps/server-hono/src/contract/cloud.contract.ts`, `modules/cloud/`, `modules/me/me.router.ts`, `lib/events.ts`, `lib/storage.ts`                                                       |
| 11 (cron sweep, purge on account delete, `cloud:uploads`)          | 🟡 NIW2-214, server PR             | Before it: no `scheduled` export, no `triggers` in `wrangler.jsonc`, no `deleteUser`; `CloudAccessRepository.setUploadsEnabled` and `CloudPurgeRepository` exist but nothing calls them |
| 12 (remove the legacy `recording` vertical)                        | ⬜ Moved to **NIW2-221**           | `contract/recording.contract.ts`, `modules/recording/`, `infra-db/src/schema/recording.ts` still exist                                                                                  |
| 13 (`backend/cloud-storage.md`, WAF runbook, statuses, CI)         | 🟡 NIW2-214, ops/CI PR             | Before it: no `backend/cloud-storage.md`; root `test:integration` exists but no workflow runs it                                                                                        |

Other facts that changed or were found since the snapshot:

- **Cloud HTTP routes are served** (Task 10). The desktop Cloud page reads real `/me/storage`.
- **Email verification is wired** (#107 transactional email, #111, #118, #120):
  `apps/server-hono/src/lib/auth.ts` sends verification and reset emails through Resend. Whether it
  delivers in production (domain DKIM/SPF, a real inbox) is **not verified**.
- **No migration SQL is tracked.** `packages/infra-db/drizzle.config.ts` writes to `./src/migrations`,
  but that folder is not in the repository, so the "`0000`/`0001` applied with `db:migrate`" in
  section 2 cannot be reproduced from `main`. The baseline is NIW2-214's ops PR.
- **Entitlements v2 / access states are not on `main`.** Every verified email gets 1 GB
  automatically (`deriveEntitlements` → `FREE_CLOUD_CAPACITY_BYTES`); the 250 MB trial and approval
  (plans `2026-09-15-02`/`-03`) are separate work. Proposed default (NIW2-214 Q1): keep
  `cloud_control.uploads_enabled = false` in production until those land.
- **The desktop is still inert for transfers.** `main/cloud/{catalog-client,storage-client,storage-usage-service}.ts`
  read the server, but nothing uploads or downloads; `LibraryItem.transfer` is always `idle`. The
  upload-mode picker still lets a verified user choose **Automatic**, which nothing implements —
  phase 3 disables it.
- **Phase 3 has a plan:** [Cloud 03 — manual transfers](/plans/2026-10-09-cloud-03-manual-transfers/)
  (awaiting the founder's approval before desktop work starts).
- Sharing (phase 4) has its own design (NIW2-216); see the note at the top of this page once it
  merges.

## 1. Where things stand

### Pull requests (merge in this order)

| PR  | Branch                         | Base                          | Content                                                                                 | State when written                     |
| --- | ------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------- |
| #90 | `feat/cloud-02-local-identity` | `main`                        | Plan 02 — stable asset identity, combined local + cloud library                         | ✅ Merged                              |
| #91 | `feat/settings-storage-cloud`  | `main`                        | Settings split into pages; Cloud rail section (save mode, capacity card, dev simulator) | Open, CI green                         |
| #92 | `feat/cloud-01-server-quotas`  | `feat/settings-storage-cloud` | Plan 01 Tasks 0–9 — server domain, R2 tickets, DB tables, repositories, use cases       | Open, no CI yet (runs once #91 merges) |
| —   | `docs/cloud-handoff`           | `feat/cloud-01-server-quotas` | This page                                                                               | Open                                   |

After #91 merges, GitHub retargets #92 to `main`; after #92 merges, this page's PR follows.

### What works today

- **Desktop (plan 02, merged):** sidecar v2 identity (`assetId`), combined library joined by
  `assetId`, per-account cloud catalog cache, "Remove local download" policy. All cloud paths are
  wired and tested but **inert**: the server routes they call do not exist yet.
- **Desktop (#91):** `AppSettings.uploadMode` persisted per device (`local-only` default). The
  Cloud page queries `GET /api/v1/me/storage`; against today's server that answers 404 and the
  card shows "Cloud storage isn't available yet" (state `not-available`), never "0 GB".
- **Server (#92):** everything below the HTTP layer for cloud storage. See section 3.

### What does not work yet

_(2026-09-13 snapshot — superseded by section 0: routes are served and verification emails are
sent since then.)_

- No cloud HTTP route is served (`/api/v1/assets*`, `/api/v1/me/storage`) — plan 01 Task 10.
- No upload, download or share from the desktop — plans 03–05.
- **No account can use Cloud Free:** access requires `user.email_verified = true`, and the server
  sends no verification emails.

## 2. Continue on another machine

### Setup

```bash
git clone git@github-csdev:niway-dev/kaipu-record.git
cd kaipu-record-monorepo
gh auth switch --user csdev19          # the remote uses the github-personal SSH host
bun install
git switch feat/cloud-01-server-quotas # or main, once #91 and #92 are merged
```

> **Env setup note (added after this snapshot):** the steps below describe manually creating and
> reading `apps/server-hono/.env`, which was accurate on 2026-09-13. The project has since moved
> to Infisical (landed ~2026-09-18) — there are no hand-maintained `.env` files anymore; see
> [Environment Variables](/backend/environment-variables/). Prefer `bash scripts/with-env.sh
--tags db-scripts -- <command>` over the `dotenvx`/manual-`.env` commands quoted here.

Create `apps/server-hono/.env` from `.env.example`. Values are not in the repository; copy them
from the original machine or the secret store. Keys used by this work:

| Key                                                                      | Used for                                                                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                           | **Development** Neon database. The founder authorized applying this work's migrations there. Never print it.          |
| `TEST_DATABASE_URL`                                                      | Optional; the infra-db integration suite reads it. Locally it is set to the same dev URL at run time (command below). |
| `BETTER_AUTH_SECRET`, `CORS_ORIGIN`                                      | Server auth.                                                                                                          |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Private bucket `kaipu-private-bucket`. Needed by the spikes and, from Task 10, by the routes.                         |

`.env` contains an unquoted `&` in `DATABASE_URL`, so `source .env` fails in zsh. Use `dotenvx`
(the root `db:*` scripts already do) or export single keys with `grep`.

### Database state

The dev database already has both migrations applied (`0000` guarded baseline, `0001` five
`kaipu_record_cloud_*` tables) and `drizzle.__drizzle_migrations` lists two rows. On a fresh
database, or on production, run:

```bash
bun run db:migrate   # from the monorepo root
```

`0000` is a no-op on a database built earlier with `db:push`, and creates the tables on an empty
one. Its guards hide drift: it does not prove existing tables match the schema.

### Verify the checkout before changing anything

```bash
bun run check-types && bun run test && bun run check        # expect exit 0 for each
cd packages/infra-db && \
  bunx dotenvx run -f ../../apps/server-hono/.env -- \
  sh -c 'TEST_DATABASE_URL="$DATABASE_URL" bun run test:integration'   # expect 10 passed
```

Real-R2 evidence can be re-run (both scripts delete what they create):

```bash
for k in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  export $k="$(grep "^$k=" apps/server-hono/.env | cut -d= -f2- | tr -d '"')"
done
bun packages/infra-storage/scripts/r2-ticket-spike.ts
bun packages/infra-storage/scripts/r2-expiry-spike.ts
```

### Desktop

```bash
cd apps/kaipu-record && bun dev
```

Settings → Developer → **Cloud simulator** forces the account state and every capacity state with
fake numbers (dev builds only), so the Cloud page can be checked without a server.

### How the work was executed (keep the same process)

- Plans are executed task by task with superpowers **subagent-driven development**: one
  implementer per task, then an independent task review, then a scoped re-review after each fix
  round. The progress ledger lives in `.superpowers/sdd/<plan>/`, which is **git-ignored and does
  not travel** — section 4 of this page carries everything from it that matters.
- Model policy (the founder's rule): design work on Opus 5 or Fable, the founder chooses; execution
  on Sonnet by default, Opus 5 when the task genuinely needs more reasoning (concurrency and
  quota logic were reviewed on Opus); never execution subagents on Fable. Name the model when
  announcing a dispatch.
- Everything that lands in the repository is English; chat may be Spanish.
- Large batches go into stacked branches and PRs, not one long branch.

To resume in a new Claude session, a good opening message is:

> Read `apps/documentation/src/content/docs/backlog/optional-cloud-handoff.md` and plan 01
> (`plans/2026-09-09-cloud-01-server-quotas-and-revisions.md`). Continue plan 01 at Task 10 with
> subagent-driven development on a branch stacked on the latest cloud branch. Apply the carried
> rulings in section 4 of the handoff.

## 3. Plan 01 progress (server)

| Task | What                                                                                     | State                                                                          |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 0    | Founder decisions recorded                                                               | ✅ `137cee9` (five values still open — section 5)                              |
| 1    | Real-R2 spike: length, hash, overwrite, HEAD, Range                                      | ✅ `ef41478`                                                                   |
| 1b   | Real-R2 spike: URL expiry during a transfer                                              | ✅ `3b62cc8`                                                                   |
| 2    | Decimal-byte limits (`packages/domain/src/constants/cloud-limits.ts`)                    | ✅ `7ac1865`                                                                   |
| 3    | Asset, revision, intent schemas, quota rules, domain errors                              | ✅ `6bfd13c`                                                                   |
| 4    | Entitlements: `cloudUploads` = verified email, capacity 1 GB / 25 GB                     | ✅ `56bd84a`                                                                   |
| 5    | Ports: `ICloudAssetRepository`, `ICloudPurgeRepository`, storage ticket/HEAD/list        | ✅ `6cb568d`                                                                   |
| 6    | R2: signed-header tickets, HEAD metadata, prefix listing                                 | ✅ `98053a1`                                                                   |
| 7    | Five cloud tables + migrations `0000` (guarded baseline) / `0001`                        | ✅ `9b66b41`, fix `e1a1e4f`                                                    |
| 8    | Postgres repositories; single-statement atomic writes; locked `reconcile`; real-DB tests | ✅ `54aeff8`, fixes `4434426`, `443d990`, `b8ec3fc`                            |
| 9    | Application use cases over in-memory fakes                                               | ✅ `af03654`, fix `a3a3e27` (**last fix round not independently re-reviewed**) |
| —    | `me.router` composes cloud access so the server type-checks                              | ✅ `82dc682` (small piece of Task 10's wiring)                                 |
| 10   | Server contract, `/assets*` and `/me/storage` routes, error mapping, structured events   | ✅ #97 (updated 2026-10-09)                                                    |
| 11   | Cron sweep, account purge on delete, `cloud:uploads status\|on\|off` admin command       | 🟡 NIW2-214 (updated 2026-10-09)                                               |
| 12   | Remove the legacy recording vertical; migrate the web consumer                           | ⬜ Moved to NIW2-221 (updated 2026-10-09)                                      |
| 13   | `backend/cloud-storage.md`, WAF runbook, backlog statuses, CI integration step           | 🟡 NIW2-214 (updated 2026-10-09)                                               |

## 4. Carried rulings and findings (from the execution ledger)

These were decided during execution and are **not** all visible in the plan text. Apply them.

### Behaviour the remaining tasks must respect

- **Every counter-affecting repository write is one SQL statement** (data-modifying CTEs) because
  the Neon HTTP driver autocommits each statement. `reconcile` runs as a `db.batch` transaction
  that locks the account row `FOR UPDATE` first. Do not reintroduce multi-statement writes.
- **`reserve` throws `AssetConflictError`** on a tombstoned asset (nothing written) and on a
  duplicate intent key (the repository maps Postgres `23505` on `cloud_revision_user_intent_idx`).
  `createUploadIntent` catches it, re-reads `findByIntentKey`, resumes when found, rethrows
  otherwise. **Task 10 must map `AssetConflictError` to `CONFLICT`** (the plan's error mapper
  already lists it).
- **Claim before delete:** `cancelUpload` and `sweepExpiredReservations` call `release` first and
  delete objects only when the claim succeeded. A failed delete leaves a stray object — accepted
  over a `ready` revision without its object.
- **`confirmUpload` rejects a HEAD without a checksum** (`UploadVerificationError("checksum")`):
  tickets always sign `x-amz-checksum-sha256`.
- **`extendTicket` returns `boolean`**; resuming an intent the sweep already expired throws
  `UploadIntentExpiredError`.
- **`deleteCloudCopy` returns `{ deleted, physicallyRemoved }`** and never throws on an R2
  failure; the cron finishes the physical delete. Quota currently stops counting at physical
  removal (`finishDelete`) — that timing is an **open decision** (section 5).
- **R2 behaviour (measured, not assumed):** expiry is checked when a request starts. A ticket
  PUT can return `502` (not 4xx) for an oversized body — treat any non-2xx as "not uploaded". A
  `403` on a new PUT, retry, reconnect or Range/seek means "URL expired, renew it".
- **Storage port has no `deleteObjects`** (named once in the plan, never used).
- **Task 13 CI:** the integration step must run only when the `TEST_DATABASE_URL` secret exists;
  adding that GitHub secret is a repository-settings action for the founder.

### Deferred findings (triage before production)

- Task 9's final fix round (`a3a3e27`) was verified by tests and a diff read, not by an
  independent reviewer — include it in the final whole-branch review.
- **Stray objects:** a claimed-but-undeleted object has nothing tracking it; an orphan scan (list
  prefixes vs revisions) does not exist.
- Thumbnail verification on confirm checks size only (no type or sha256).
- `markReady` moves the asset pointer without checking `deleted_at` (nothing sets `deleted_at` yet).
- A malformed list cursor silently returns the first page instead of a 400.
- The reconcile-during-reserve integration test does not control timing (valid, not guaranteed
  to interleave).
- `@kaipu/domain` is a runtime import of `@kaipu/infra-db` but listed under `devDependencies`;
  `packages/infra-db` has no `check-types` script.
- `main`'s `bun.lock` is stale: a plain `bun install` prunes ~130 unrelated lines. Commit that on
  its own.
- Minor code notes: storage-key kind prefix inlined three times in `cloud-asset.ts`;
  `listObjectKeys` parses XML with regular expressions; `MAX_THUMBNAIL_BYTES` has no dedicated test.

## 5. Open decisions (proposals shipped, not approved)

Never describe these as decided. In code they carry `// PROPOSAL (Task 0) — not approved`.

| Value                            | Shipped proposal                                                         |
| -------------------------------- | ------------------------------------------------------------------------ |
| Reservation grace                | 3 h after ticket expiry (covers 1 GB at ~1 Mbps)                         |
| Cron schedule                    | every 15 minutes                                                         |
| Sweep batch sizes                | 50 reservations + 50 deletes + 1 account purge per run                   |
| When deleted bytes stop counting | at physical R2 removal (alternative: at the delete intent)               |
| Rate-limit thresholds            | none; check the Cloudflare plan's rate-limiting allowance first          |
| Free capacity long term          | 1 GB approved; any future reduction needs a policy for accounts above it |

## 6. Dependencies outside plan 01

- **Email verification sending** — without it no account gets Cloud Free (founder decision #8).
- **Automated sign-up protection** and **cloud consumption tracking** — required alongside Cloud Free.
- Cloudflare WAF rules for the upload, confirm, download-URL, delete and auth routes.
- Production: apply `bun run db:migrate`, set R2 secrets, create WAF rules, verify one cron run.

## 7. After plan 01

- **Plan 03 (desktop manual upload and download)** — written 2026-10-09 as
  [Cloud 03 — manual transfers](/plans/2026-10-09-cloud-03-manual-transfers/). Requirements already fixed by the
  founder: a local queue uploads one file at a time and queued files reserve nothing; interrupted
  or unconfirmed uploads show **Retry**, which calls `confirm` first and only re-requests a URL with
  the same intent key when the object is missing; `intent-expired` starts a new intent; a `403`
  renews the URL; insufficient capacity does not start the transfer and shows "Not enough
  capacity. Delete files or change your plan" (ES: "Capacidad insuficiente. Borra archivos o
  cambia de plan").
- Plans 04 (share links, deletion dialogs, Manage storage), 05 (automatic upload) and 06 (link
  updates) — not written.

### Desktop follow-ups noted during review

- The Cloud card's `beta-unavailable` copy ("isn't available for your account yet") should say
  the email needs verifying, now that access = verified email.
- Library cards show a hover state that suggests they are clickable where they are not.
- Spanish copy mixes "Nube" and "Cloud"; the design brief asks for "Cloud" consistently. Unused
  i18n keys `cloudOffline` and `uploadCloud` remain.
- The flaky renderer test `video-editor-page.test.tsx` › "blocks a normal (non-export) navigation
  while dirty" failed once in CI and passed on re-run.
