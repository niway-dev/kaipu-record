---
title: Cloud recording lifecycle and account deletion
description: Define recovery, expiration, cleanup, and privacy guarantees for pending and deleted cloud recordings.
---

# Cloud recording lifecycle and account deletion

> **Status: 🔵 Proposed.** Blocking production rollout of cloud recordings.

## Problem

`pending` rows can outlive an expired URL or failed client. More importantly, database-level user
cascade deletion can remove recording metadata while private R2 objects remain, leaving storage
that is unreachable but not deleted.

## Required lifecycle

- Record an explicit pending-ticket expiry and expose a safe cancel/retry path.
- Reissue a ticket only under documented ownership, expiry, and object-state rules; never create an
  unbounded number of rows or valid URLs for one local recording.
- Sweep expired pending rows and their objects where applicable. Make the sweep idempotent,
  observable, and retryable.
- Define deletion sequencing for an individual recording and an entire account, including failures
  between R2 and Postgres operations.
- Preserve a privacy deletion guarantee: account deletion must schedule, retry, and eventually prove
  removal of every private object belonging to that account.

## Design direction

The API is a Cloudflare Worker with no existing background-job infrastructure. Cloudflare
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) run a
Worker on a schedule without adding new infra (Durable Objects, an external queue, or a
separate service) and are the natural fit here — one triggered handler for the expired-pending
sweep, another for account-deletion cleanup retries. Confirm the batch size and execution-time
limits fit a single invocation, or split the sweep into resumable pages if the private bucket
grows large.

## Deferral rule (NIW2-323)

A cancel or a cloud-copy delete never releases quota or deletes an object while the revision's
presigned PUT ticket can still write (ticket expiry + `RESERVATION_GRACE_SECONDS`). It records the
intent and leaves the settlement to the expired-reservation sweep and the pending-delete retry job.
Those jobs therefore have to run for deferred cancels and deletes to settle: until the scheduled
handler (NIW2-328) ships, deferred rows wait, holding their bytes and, for a cancel, a pending slot.
An orphan-object sweep (`sweepOrphanObjects`) reconciles storage against revisions as defence in
depth. Design and rationale:
[Close API upload abuse paths](/specs/2026-10-12-api-upload-abuse/).

## Acceptance criteria

- An interrupted upload becomes recoverable or is removed without manual database access.
- Expired tickets cannot become ready accidentally and do not accumulate indefinitely.
- Deleting an account removes its R2 prefixes/objects even if database cascade happens first.
- Cleanup jobs are idempotent and emit alerts after bounded repeated failure.
- Tests and a real-R2 smoke test cover failed uploads, delete races, cancellation, and account
  deletion.

## Related

- [R2 upload integrity](./r2-upload-integrity)
- [Production cloud security](./production-cloud-security)
