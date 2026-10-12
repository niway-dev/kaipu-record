---
title: "Close API upload abuse paths"
description: "Design spec for NIW2-323: hold quota and objects until a presigned upload ticket can no longer write, remove the legacy recordings upload flow, and validate the asset-list cursor at the API boundary."
---

# Close API upload abuse paths

Ticket: NIW2-323 (parent NIW2-322, security audit 2026-10-12). Findings F-1, F-2 and F-9 of
the API audit. The audit ran on `main` at `49b1780`; every claim below was re-checked against
the branch `feature/niw2-323-close-api-upload-abuse-paths` at `f34df72` (`origin/main` +
one WIP commit) on 2026-10-12.

## Summary (one minute)

Three independent defects in the API's upload surface. **F-1 (high):** cancelling a cloud
upload or deleting a cloud copy released the account's quota and deleted the object while the
presigned PUT ticket for that object could still write, so a client could store objects that
no revision accounts for. **F-2 (high):** the legacy `POST /api/v1/recordings` upload flow
had none of the v2 controls (quota, entitlement, verified email, kill switch, content-type
allowlist, size binding on the ticket) and no client calls it. **F-9 (low):** the asset-list
pagination cursor reached the database unvalidated and could produce a driver error instead
of a 400.

The fix keeps the accounting invariant the cloud data model already states ("a reservation
must not expire while a valid ticket can still write"): **nothing is released or deleted
until the ticket window has closed**; the scheduled jobs (NIW2-328) settle what was deferred.
The legacy upload routes are removed outright (the read and delete routes stay because the
web `/recordings` page uses them). The cursor is validated by a zod schema at the contract and
defensively in the repository.

| #   | Decision                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                         | ADR  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | `cancelUpload` and `deleteCloudCopy` defer the release/physical delete while the ticket window is open (`ticketExpiresAt + RESERVATION_GRACE_SECONDS`). The existing sweep and retry jobs settle them once it closes.                                | A presigned URL cannot be revoked; the only way to make a late write harmless is to keep the reservation (and the object, which makes `if-none-match: *` refuse the write) until the URL can no longer start a request. Applies an invariant already accepted in the cloud data model spec. | none |
| 2   | One shared predicate, `ticketWindowClosed`, is the single definition of "the ticket can no longer write", used by cancel, delete, the retry job and (indirectly) the sweep.                                                                          | Two independent definitions of the window would drift; the sweep's `before = now - grace` and the predicate must agree or a revision could be released by one and still writable by the other's definition.                                                                                 | none |
| 3   | A new `sweepOrphanObjects` use case reconciles storage against revisions per account; NIW2-328 schedules it. It is defence in depth, not the fix.                                                                                                    | Decision 1 closes the known path; a reconciliation pass is what catches any path not yet known (a crash between claim and delete, a future bug) and bounds the cost of a stray object to one sweep interval.                                                                                | none |
| 4   | Remove the legacy upload routes (`createUpload`, `confirm`) and their use cases, schemas and tests. Keep `list`, `downloadUrl`, `delete` for the web page until cloud-01 Task 12 migrates it.                                                        | No client creates rows through the legacy flow; routing it through the v2 ticket path would mean maintaining two contracts for one capability. Task 12 already plans the remaining deletion, so the read/delete routes are not re-decided here.                                             | none |
| 5   | Validate the cursor at the contract with `assetCursorSchema` (400 on anything but the shape the repository encodes) and keep the repository's `decodeCursor` defensive. Move encode/decode into the domain so there is one definition of the format. | Contract validation turns a malformed cursor into a client error instead of a 500 or a silent restart from page one; the repository check protects any future caller that bypasses the contract. One definition stops the schema and the encoder drifting.                                  | none |
| 6   | Deferred cancels/deletes are observable through two new structured events, `cloud.cancel.deferred` and `cloud.delete.deferred`; the API response shape does not change.                                                                              | Operators need to see that a deferral happened and when it settles; no shipped client consumes `cancelUpload` yet, so widening the response buys nothing today.                                                                                                                             | none |

No ADR is created: each decision applies an invariant or a plan the docs already hold (cloud
data model spec, cloud-01 plan Task 12), and none is cross-cutting or hard to reverse.

**Open questions**

1. **Pending-slot lockout during the window.** A deferred cancel keeps the revision `reserved`,
   so it still counts toward `MAX_PENDING_UPLOADS_PER_ACCOUNT` (3) for up to 3 h 05 min
   (ticket TTL + grace). Three cancels in a row block a fourth upload until the sweep runs.
   Accept this for the first release, or add a `cancelled` revision status that holds bytes but
   not a pending slot (see F-1 alternatives)? `RESERVATION_GRACE_SECONDS` is still marked
   "PROPOSAL — not approved" in `cloud-limits.ts:30`; approving a shorter grace changes the
   size of this problem.
2. **Ship order with NIW2-328.** Until the scheduled handler exists, a deferred cancel never
   releases and a deferred delete keeps counting as used. This branch is safe to merge first
   (the rows simply wait), but it should not reach a production release without the cron.
   Confirm the order: merge 323, merge 328, release once.
3. **Orphan sweep ownership and legacy keys.** The ticket says the orphan-key sweep use case
   belongs here and NIW2-328 schedules it. Confirm, and confirm that keys of the legacy
   `recording` table (`videos/<userId>/<id>.<ext>`, same prefix as v2 keys) are treated as
   backed, not orphaned, until Task 12 drops that table.
4. **Legacy read/delete routes.** Remove them now (breaking the web `/recordings` page) or at
   Task 12 as planned? This spec assumes Task 12.

**Out of scope**

- Every other audit finding (F-3 to F-8, F-10 to F-16): rate limiting, IP trust, email
  verification at sign-in, the scheduled handler itself, CSRF, cookie cache, secrets, workers.dev
  exposure. They have their own tickets.
- Wiring the cron (`scheduled` export, `triggers.crons`), purge on account deletion, committed
  migrations — NIW2-328.
- Dropping the `recording` table, repository, mapper, remaining routes and the web page —
  cloud-01 Task 12.
- A desktop cloud client (none exists; `apps/kaipu-record` makes no call to the assets API).
- Tuning `UPLOAD_TICKET_TTL_SECONDS` or approving `RESERVATION_GRACE_SECONDS`.

## Current behavior

Paths are repo-relative. "main" means `origin/main` (`400c80e`); "branch" means `f34df72`.

### F-1: quota released while the ticket is still valid

- A ticket is a presigned PUT signed over content type, content length, sha256 and
  `if-none-match: *`, valid for `UPLOAD_TICKET_TTL_SECONDS` (5 min) from issue
  (`packages/infra-storage/src/r2-storage.ts:102-124`, `packages/domain/src/constants/cloud-limits.ts:25`).
  R2 checks expiry when the request starts, so a write that starts at minute 4:59 may run for
  hours; `RESERVATION_GRACE_SECONDS` (3 h, `cloud-limits.ts:30`) exists for exactly that.
- `createUploadIntent` reserves bytes and a pending slot atomically before signing
  (`packages/application/src/cloud/create-upload-intent.ts:82-101`), and re-issuing the same
  intent key extends the ticket (`:152-158`).
- On main, `cancelUpload` released the reservation and deleted the object immediately
  (main `packages/application/src/cloud/cancel-upload.ts:29-36`), and `deleteCloudCopy`
  flipped the revision to `deleting` and deleted the object immediately
  (main `packages/application/src/cloud/delete-cloud-copy.ts:21-29`). After either call the
  key was empty, so `if-none-match: *` no longer protected it, and the still-valid ticket
  could write an object that no `reserved`/`ready`/`deleting` revision accounted for. The
  sweep only lists `reserved` revisions (`sweep-expired-reservations.ts:22-23`), so nothing
  ever removed such an object; only the account purge lists a prefix.
- Consequence: a client could store objects outside its quota, repeatedly, and the bytes were
  never cleaned up. Verified on main: the audit's description of both use cases matches the
  code.

### F-2: legacy recordings upload flow

- On main, `POST /recordings` and `POST /recordings/{id}/confirm` existed
  (main `apps/server-hono/src/modules/recording/recording.router.ts:28-61`). The use case
  checked only a 2 GiB per-file cap (main `create-recording-upload.ts:34-36`), signed a PUT
  bound to content type only (`r2-storage.ts:74-81`, no length, no checksum, no
  `if-none-match`), and confirm checked only that an object existed (main
  `confirm-recording.ts:22-23`). No quota, no `cloudUploads` entitlement, no verified-email
  gate, no `uploadsEnabled` switch, no content-type allowlist (unknown types fall back to a
  `.bin` key, `packages/domain/src/schemas/recording.ts:41-45`).
- Callers: none. `apps/kaipu-record/src`, `apps/console/src` and `apps/web-hono/src` contain no
  call to `createUpload`/`confirm`. The web page `routes/_authenticated/recordings/index.tsx`
  uses only `recording.list`, `recording.delete` and `recording.downloadUrl`
  (`apps/web-hono/src/hooks/use-recordings.ts:10,20,34`). Verified: the audit's "no client
  calls it" holds.
- The `IStorageService` methods behind the legacy flow, `createUploadUrl` and `objectExists`,
  are already marked `@deprecated removed in Task 12`
  (`packages/domain/src/services/storage.service.ts:43-50`).

### F-9: unvalidated cursor

- On main the contract accepted `cursor: z.string().optional()`
  (main `apps/server-hono/src/contract/cloud.contract.ts:43`) and the repository decoded it
  with a `Number.isFinite` check only (main
  `packages/infra-db/src/repositories/cloud-asset.repository.ts:99-106`): an out-of-range
  millisecond value became an invalid `Date`, and the id part was any string, both reaching a
  parameterized query. Verified. A malformed-but-decodable cursor returned `null` from
  `decodeCursor` and silently listed from the first page.

### Scheduled jobs

`apps/server-hono/src/index.ts` exports only the Hono app (`:43`); `wrangler.jsonc` has no
`triggers.crons`. `sweepExpiredReservations`, `retryPendingDeletes` and `purgeAccountObjects`
exist but never run. This is NIW2-328's scope and the dependency named below.

## Target behavior

1. A cancel or delete request inside the ticket window records the intent and returns, without
   releasing bytes or touching storage. The object key stays occupied (or stays reservable), so a
   late write is either refused by `if-none-match: *` or lands under a revision that still counts
   it. Once the window closes, the sweep (`reserved`) or the retry job (`deleting`) performs the
   release/delete it would have performed anyway.
2. A cancel or delete outside the window behaves as on main (immediate release/delete).
3. A per-account orphan sweep lists the account's prefixes and deletes keys that no live revision
   backs, bounded per run, idempotent, and ordered so it cannot race a fresh reservation.
4. The legacy upload routes no longer exist; the OpenAPI surface under `/api/v1/recordings` is
   `GET /recordings`, `GET /recordings/{id}/download-url`, `DELETE /recordings/{id}` only.
5. A cursor that is not base64url of `<createdAtMillis>:<assetId uuid>` is rejected with 400 at
   the contract; the repository never builds an invalid `Date` or an arbitrary id into a query.

## Design

### F-1: hold until the window closes

**Predicate.** `ticketWindowClosed(ticketExpiresAt, now)` is true when
`ticketExpiresAt + RESERVATION_GRACE_SECONDS <= now` (`packages/application/src/cloud/ticket-window.ts:9-11`).
It is the same boundary the sweep uses (`before = now - grace`, compared with `<`), so a
revision the sweep would release is one the predicate calls closed, and vice versa.

**cancelUpload** (`cancel-upload.ts:36-38`): after the ownership and `reserved` checks, if the
window is open, return `{ released: false }` and change nothing. The revision stays `reserved`
with its original `ticketExpiresAt`; the account keeps the bytes and the pending slot. The
sweep lists it once the window closes and releases it, deleting a landed object if any.
Re-issuing the intent (same `intentKey`) still resumes and extends the ticket; that is
correct, since the bytes remain accounted for.

**deleteCloudCopy** (`delete-cloud-copy.ts:29-31`): `beginDelete` still runs first (the asset
is hidden and excluded from auto-upload immediately, which is the user-visible part), then if
the window is open the physical delete is skipped and `{ deleted: true, physicallyRemoved: false }`
is returned. The revision stays `deleting` and keeps counting as used. A ready revision only
has an open window if it was confirmed within 5 minutes of its last ticket, so this branch is
rare in practice.

**retryPendingDeletes** (`retry-pending-deletes.ts:21`): skips `deleting` revisions whose
window is still open; a later run finishes them. **sweepExpiredReservations** is unchanged:
its listing boundary already is the window.

**Observability (remaining).** Add `cloud.cancel.deferred { userId, revisionId, settlesAt }`
and `cloud.delete.deferred { userId, assetId, settlesAt }` to `CloudEvent`
(`apps/server-hono/src/lib/events.ts:8-31`) and emit them from the router when the use case
reports a deferral. The use-case return types stay as they are; the router can detect the
deferral from `released: false` plus the revision status, or the use cases can return a
discriminated reason. Prefer the latter (`{ released: false, reason: "deferred" | "not-reserved" }`)
kept internal to the application layer; the contract still exposes `{ released: boolean }`.

**Alternatives considered**

- _Consume the ticket server-side._ Not possible: a SigV4 presigned URL is valid until expiry;
  revoking it means rotating the R2 credentials. Rejected.
- _Shorter ticket TTL._ Narrows the window, does not close it, and the grace for slow uploads
  still dominates. Rejected as a fix; remains a tuning option.
- _Release accounting immediately, keep the object._ The bytes a late write can land are
  bounded by the signed content length, but each new intent reserves within quota and then
  releases, so the unaccounted total is unbounded across cycles. Rejected.
- _A `cancelled` revision status_ that holds `reserved_bytes` but not a pending slot, cannot
  be resumed, and is released by the sweep. Cleaner semantics and no lockout, at the cost of a
  status-enum extension, a change to the `reserve` CTE's pending accounting, `reconcile`'s
  sums, a new sweep listing and a `release` guard that accepts two source states. Deferred:
  open question 1. The reopen condition is a report of a user blocked by three deferred
  cancels.

**Strongest argument against the chosen design.** It trades a security hole for a
liveness cost paid by honest users: a cancelled upload holds its bytes and a pending slot for
up to 3 h 05 min, and until NIW2-328 ships, for ever. The spec accepts the first (bounded,
rare, visible in `/me/storage`) and names the second as a release dependency, not a code
dependency.

### F-1, defence in depth: `sweepOrphanObjects` (remaining)

New use case in `packages/application/src/cloud/sweep-orphan-objects.ts`:

- Input: `{ assets, storage, now, accountLimit, since }`. Candidates come from
  `assets.listAccountsTouchedSince(since, accountLimit)` (`cloud-asset.repository.ts:544-551`),
  so a quiet account costs nothing.
- For each account: list every key under `accountPrefixes(userId)` via
  `storage.listObjectKeys`, then fetch the revisions those keys could belong to with a new
  repository query `findRevisionsByStorageKeys(userId, keys)` matching `storage_key` or
  `thumbnail_key`. **Order matters:** list storage first, revisions second. A revision row is
  inserted before its ticket is signed (`create-upload-intent.ts:82-127`), so any object that
  exists at listing time already has its row at lookup time; the reverse order could call a
  fresh reservation's object an orphan.
- A key is an orphan when it has no revision, or its revision is `expired`/`deleted` and the
  revision's window is closed. A key whose revision is `reserved`, `ready` or `deleting` is
  never touched; a key whose tombstoned revision still has an open window is left for the next
  run (the same rule as cancel).
- Legacy keys (`videos/<userId>/<id>.<ext>`, no asset segment) are skipped until Task 12 drops
  the `recording` table (open question 3). Distinguish them by shape: a v2 key has three path
  segments after the prefix.
- Output: `{ accounts, deleted, skipped }`; one `cloud.sweep.orphans` event. Bounded by
  `accountLimit` and by R2's 1000-key page; a prefix larger than one run's budget resumes next
  run because candidates are re-listed by `updated_at`.
- NIW2-328 adds the call to its `scheduled` handler with the other jobs; this ticket does not
  wire it.

### F-2: remove the legacy upload routes

Done in the WIP commit: `createUpload` and `confirm` removed from the contract and router,
`createRecordingUpload`/`confirmRecording` and their tests removed from the application
package, `createRecordingUploadSchema`, `MAX_UPLOAD_BYTES`, `isWithinUploadLimit`,
`UploadLimitExceededError` and `RecordingNotUploadedError` removed from the domain (they had no
other caller). `recordingStatusSchema` keeps `pending` because existing rows may hold it.

**Alternatives considered**

- _Route the legacy flow through the v2 ticket path._ Keeps a second contract alive for a
  capability nobody uses, and the v2 flow needs an `assetId`/`intentKey`/sha256 the legacy
  input does not carry. Rejected.
- _Remove the whole recording module now._ Breaks the web `/recordings` page, which is
  Task 12's migration. Rejected here; open question 4.

**Strongest argument against removal.** The legacy flow was the only end-to-end upload
validated against real R2 (`backlog/cloud-recordings-upload.md`), and the v2 flow has no
shipped client yet, so for a while no client can upload at all. Accepted: an unused upload
path with no quota is worse than no path, and the v2 path is tested at the application and
repository layers.

**Remaining:** mark `createUploadUrl` and `objectExists` as having no production caller (the
R2 implementation stays until Task 12, since the port still declares them), and update
`backlog/cloud-recordings-upload.md` to state that the upload routes were removed on
2026-10-12 and the page lists historical rows only.

### F-9: validate the cursor

Done in the WIP commit: `assetCursorSchema` in `packages/domain/src/schemas/cloud-asset.ts:271-294`
(base64url charset, max 256 chars, decodes to `<1..15 digits>:<uuid>`, a finite millisecond
value that yields a valid `Date`), used by the contract
(`apps/server-hono/src/contract/cloud.contract.ts:47`); `decodeCursor` in the repository also
rejects an invalid `Date` and a non-uuid id (`cloud-asset.repository.ts:99-108`).

**Remaining:** move `encodeAssetCursor`/`decodeAssetCursor` next to the schema in the domain and
have the repository and the schema's refine use them, so the domain test stops re-implementing
the encoding with `btoa` and a change to the format cannot pass the schema test while breaking
the repository (or the reverse).

**Alternative considered:** repository-only validation (return `null`, list from page one).
Silent and indistinguishable from "no cursor"; rejected. A signed cursor is unnecessary: the
cursor only ever narrows the caller's own rows.

## Data and state changes

- No schema migration. No new tables or columns.
- Semantics: a `reserved` revision may now persist after a cancel request (until the sweep); a
  `deleting` revision may be deferred for a reason other than a storage failure. `reconcile`'s
  sums (`cloud-asset.repository.ts:500-502`) already treat both states correctly.
- `cancelUpload` returns `{ released: false }` for two reasons (not reserved, deferred); the
  contract does not distinguish them (decision 6).
- Removed public API: `POST /api/v1/recordings`, `POST /api/v1/recordings/{id}/confirm`.
- New structured events: `cloud.cancel.deferred`, `cloud.delete.deferred`, `cloud.sweep.orphans`.

## Interaction with NIW2-328 (scheduled jobs)

- This ticket makes the settlement of deferred cancels/deletes depend on `sweepExpiredReservations`
  and `retryPendingDeletes` actually running. NIW2-328 wires both plus `purgeAccountObjects`
  into a `scheduled` handler. Until then, deferred rows wait: no data is lost and no quota is
  bypassed, but a user sees bytes held and may hit the pending cap (open questions 1 and 2).
- `sweepOrphanObjects` is designed here and scheduled there. Its `now` parameter must be the
  handler's single `now`, the same one passed to the other jobs, so the window predicate agrees
  across jobs within a run.
- NIW2-328's ticket states its WIP was pushed; at the time of writing `origin` holds no
  `feature/niw2-328-*` branch, so nothing from it was read. The names used here
  (`apps/server-hono/src/jobs/`) come from the ticket text only.

## Test plan

**Unit (application, `packages/application/src/cloud/cloud.test.ts`)**

Present in the WIP (`:657-754`): cancel inside the window keeps the reservation and the
object and the sweep settles it after the window; cancel after the window releases and deletes;
delete inside the window hides the asset, defers the object delete, keeps the bytes as used,
`retryPendingDeletes` skips it inside the window and finishes it after.

Remaining:

- The pre-existing cancel test (`:579-612`) calls `cancelUpload` without `now`, so it passes
  only because the wall clock is more than 3 h 05 min after the fixture date `NOW`. Pass an
  explicit `now` after the window so the test states its assumption.
- A cancel deferred, then the same intent resumed and confirmed: the revision becomes `ready`
  and the sweep never touches it (the "confirm wins" ordering still holds through a deferral).
- A cancel deferred, then the sweep runs once before the window closes: nothing changes.
- The boundary: `now === ticketExpiresAt + grace` is closed; one millisecond earlier is open
  (unit test on `ticketWindowClosed`, and the sweep's `before` agreeing at that boundary).
- `sweepOrphanObjects`: deletes a key with no revision; keeps keys of `reserved`/`ready`/`deleting`
  revisions; keeps an `expired` revision's key while its window is open and deletes it after;
  skips legacy-shaped keys; the fake storage must let a test insert an object between the
  listing and the revision lookup to pin the ordering rule.

**Unit (domain, `packages/domain/src/schemas/cloud-asset.test.ts`)**

Present: accepts a well-formed cursor; rejects non-base64url, non-matching shape, non-numeric
and out-of-range timestamps, non-uuid ids, over-long input. Remaining: round-trip through the
shared encoder once it moves into the domain.

**Integration (`packages/infra-db/src/integration/cloud-asset.repository.integration.test.ts`)**

Remaining: `listAssets` with a cursor whose id is a valid uuid for another user returns that
user's page unchanged (owner scope still applies); `findRevisionsByStorageKeys` returns rows by
either key column. These need a database and are run by a person, not an agent.

**Contract (`apps/server-hono`)**

Remaining: a request to `GET /api/v1/assets?cursor=<garbage>` through `OpenAPIHandler` returns
400, and `POST /api/v1/recordings` returns 404. The routers construct a database client at
import time, so this test either stubs `env`/`createDatabaseClient` or asserts on the contract
objects directly (`cloudContract.list` input schema, absence of `recordingContract.createUpload`).

## Acceptance criteria

1. With a revision inside its ticket window, cancel and delete requests leave the object and the
   accounting unchanged; after the window, the sweep/retry settle them and `/me/storage` reflects
   it. No code path releases bytes or deletes an object while `ticketWindowClosed` is false.
2. `POST /api/v1/recordings` and `POST /api/v1/recordings/{id}/confirm` return 404; the web
   `/recordings` page still lists, opens and deletes rows.
3. `GET /api/v1/assets?cursor=…` returns 400 for any cursor the repository would not encode, and
   the existing keyset pagination test passes unchanged.
4. `sweepOrphanObjects` exists, is exported from `@kaipu/application`, has the unit cases above,
   and is referenced by NIW2-328's handler (or NIW2-328's spec names it).
5. `bun run verify` is green and the two deferral events appear in `CloudEvent`.

## Rollout and backout

- Rollout: merge this branch, then NIW2-328, then one API release; confirm in Workers logs that
  `cloud.sweep` runs and that any `cloud.cancel.deferred` is followed by a sweep release within
  one interval after its `settlesAt`.
- Backout: revert the branch. Reverting re-opens F-1 and F-2; deferred rows left behind are
  ordinary `reserved`/`deleting` rows the old code handles. No data migration either way.
- Operator check after rollout: `reconcile(userId)` for any account whose `/me/storage` looks
  wrong; it recomputes from revision rows and is already exposed as a repository method.

## Implementation status

Branch `feature/niw2-323-close-api-upload-abuse-paths` = `origin/main` (`400c80e`) +
`f34df72` "chore(api): save unverified partial work for NIW2-323". That commit's message says
`bun run verify` was not run; it was run on 2026-10-12 in a clean worktree at `f34df72` and
exited 0 (build, types, lint, format, all unit suites). The code is therefore verified as
green; "unverified" in the commit message is stale.

**Done in `f34df72`**

- F-1: `ticket-window.ts` (new); deferral in `cancel-upload.ts:36-38`, `delete-cloud-copy.ts:29-31`,
  `retry-pending-deletes.ts:21`; `now?: Date` added to those three use cases; three unit tests
  (`cloud.test.ts:657-754`).
- F-2: `createUpload`/`confirm` removed from `recording.contract.ts` and `recording.router.ts`;
  `create-recording-upload.ts`, `confirm-recording.ts` deleted; `recordings/index.ts` barrel,
  `recordings.test.ts` (now seeds ready rows directly), `schemas/recording.ts` (upload schema,
  cap, two errors removed) and `schemas/index.ts` updated; `recording.test.ts` trimmed.
- F-9: `assetCursorSchema` + test in the domain; contract uses it; `decodeCursor` hardened.

**Remaining, in order (each a resumable task with its own commit)**

1. Pass an explicit post-window `now` in the pre-existing cancel test (`cloud.test.ts:579-612`);
   add the boundary test for `ticketWindowClosed` and the "deferred then confirmed" and
   "sweep before window" cases. Pin the boundary: the sweep lists `ticketExpiresAt < now - grace`
   (strict) while the predicate is `ticketExpiresAt + grace <= now`, so at the exact instant
   the predicate says closed and the sweep does not list yet; one millisecond later both agree.
   That is safe (neither side releases before the window), and the test should document it
   rather than change it.
2. Internal deferral reason in the use cases; `cloud.cancel.deferred` / `cloud.delete.deferred`
   events emitted from `cloud.router.ts`; router passes no `now` (default `new Date()` stays).
3. Move cursor encode/decode into the domain next to `assetCursorSchema`; repository and schema
   use the shared functions; round-trip test.
4. `findRevisionsByStorageKeys` on `ICloudAssetRepository` + Drizzle implementation + integration
   test (run by a person).
5. `sweepOrphanObjects` use case, fakes support for "object inserted after listing", unit tests,
   export from `@kaipu/application`, `cloud.sweep.orphans` event type. Coordinate the call site
   with NIW2-328.
6. Docs: update `backlog/cloud-recordings-upload.md` (upload routes removed, page is read-only
   over historical rows); add a line to `backlog/cloud-data-lifecycle.md` pointing at this spec
   for the deferral rule.
7. Contract-level test for the 400 cursor and the 404 legacy routes (choice of stubbing in the
   test plan).
8. Resolve open questions 1 to 4 with the owner; if question 1 chooses the `cancelled` status,
   it becomes a follow-up ticket, not part of this one.

## References

- `apps/documentation/src/content/docs/specs/2026-09-09-cloud-data-model.md` — the reservation
  and ticket invariants this spec applies (lines on expired reservations and valid tickets).
- `apps/documentation/src/content/docs/plans/2026-09-09-cloud-01-server-quotas-and-revisions.md`
  — Task 12, the planned removal of the legacy recording module.
- `apps/documentation/src/content/docs/backlog/cloud-data-lifecycle.md` — sweep, retry and
  purge requirements; Cron Triggers as the job runner.
- `apps/documentation/src/content/docs/backlog/cloud-recordings-upload.md` — the legacy flow
  this spec removes the upload half of.
- Linear NIW2-323, NIW2-328 (parent NIW2-322). The audit reports live outside the repository.
