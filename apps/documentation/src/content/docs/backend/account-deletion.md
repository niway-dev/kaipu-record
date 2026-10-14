---
title: Account deletion (7-day grace)
description: How a Kaipu account is deactivated, restored, and finally deleted with its cloud files.
---

# Account deletion (7-day grace)

> **Status:** 🟢 Ready to validate (prod review pending). NIW2-214, decision by Cristian on 2026-10-10.
> The account page UI comes with NIW2-220; this page covers the server.

Deleting an account is a **soft delete with a 7-day grace period**, not an immediate hard delete.
Better Auth's own `POST /api/auth/delete-user` stays disabled.

## Lifecycle

1. **Request:** `POST /api/v1/me/account-deletion`. It needs a session signed in within the last 24 hours (`FORBIDDEN`, `data.kind: "session-not-fresh"` otherwise).
   - A row goes into `kaipu_record_account_deletion` with `scheduled_at = now + 7 days`. Repeating the request keeps the first date.
   - Every session is deleted, web cookie and desktop bearer alike.
   - The email "Your account will be deleted on {date}. Sign in to cancel." is sent through infra-email (Resend). Without `RESEND_API_KEY` it is skipped and logged; the deletion goes ahead.
   - Nothing is deleted and no R2 call is made on the request.
2. **Grace period:** the user can sign in again. That session only reaches three routes:
   - `GET /api/v1/me/account-deletion` returns `{ status: "scheduled", requestedAt, scheduledAt }`, or `{ status: "active" }`.
   - `POST /api/v1/me/account-deletion/restore` cancels the deletion and returns `{ status: "active" }`.
   - `POST /api/v1/me/account-deletion` (idempotent).

   Every other authenticated route answers `FORBIDDEN` with `data: { kind: "account-deletion-scheduled", scheduledAt }`. That covers uploads, downloads, the catalog, `/me/*`, and later share links. Clients switch on `kind` to show the scheduled state and a Restore action. These three routes bypass Better Auth's 10-minute cookie cache, so a revoked session cannot restore the account.

3. **After the grace period**, the cron sweep (`*/15 * * * *`, `apps/server-hono/src/cloud/run-cloud-sweep.ts`) handles up to `ACCOUNT_DELETIONS_PER_TICK` (10) due accounts per run. For each one it:
   1. enqueues the R2 purge in `cloud_purge` and hard-deletes the user row in **one batch** (`AccountDeletionRepository.finalize`). The cascade removes sessions, cloud rows and the schedule. Both statements re-check that the deletion is still due, so a restore that lands first wins.
   2. sends "Your account was deleted" (best effort).
4. **R2 purge:** the same run drains `cloud_purge` with a budget of `PURGE_OBJECTS_PER_TICK` (200) R2 deletes per tick, shared by up to `PURGE_LIMIT` (5) jobs. An account with more objects finishes over several ticks without consuming retry attempts. Many deletions at once become a steady trickle of R2 calls rather than a burst.

Local desktop files are never touched: the server has no handle on them.

## Operations

- **Schema:** the new table `kaipu_record_account_deletion` must exist before deploy. It needs `db:push` by Cristian, or a migration generated on top of the baseline from the ops PR.
- **Events:** `cloud.sweep` now also carries `accountsDeleted`, `accountDeletionsFailed`, `purgedObjects` and `purgeUnfinished`. These are counts only.
- **Numbers are proposals** (one place, `run-cloud-sweep.ts`): 10 accounts per tick, 200 R2 deletes per tick, 5 purge jobs per tick. The 7-day grace is decided (`ACCOUNT_DELETION_GRACE_DAYS` in `@kaipu/domain/constants`).
