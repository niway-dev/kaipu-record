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
