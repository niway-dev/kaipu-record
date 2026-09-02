---
title: R2 upload integrity and immutable tickets
description: Prevent replayed presigned PUTs from overwriting ready recordings and verify the object promoted to ready.
---

# R2 upload integrity and immutable tickets

> **Status: 🔵 Proposed.** Blocking production rollout of cloud recordings.

## Problem

An R2 presigned URL is a bearer capability and can be reused until expiry. The current ticket is
valid for 15 minutes and targets a stable object key. After a recording becomes `ready`, a holder
of the still-valid URL could overwrite its bytes; `confirm` currently checks only that an object
exists.

## Required behaviour

- A ticket writes exactly one object for its generated key; a successful upload cannot be replaced
  through the same ticket.
- `confirm` promotes a row only when the stored object has the declared byte length and content
  type, plus an integrity value selected by this workstream.
- URLs are short-lived and never emitted in logs, analytics, errors, or telemetry.
- The API accepts only supported recording/image MIME types rather than arbitrary private blobs.

## Design direction

Sign an `If-None-Match: *` precondition with the initial PUT so R2 rejects an overwrite after the
object exists. R2 supports conditional object operations. Require the client to send the signed
headers exactly. Extend the storage port from `objectExists` to a metadata read that can expose
content length, content type, and the chosen checksum/ETag. The application layer compares that
metadata with the pending row before `markReady`.

## Acceptance criteria

- A second PUT using the same valid upload URL cannot replace a successful object.
- `confirm` rejects absent, wrong-sized, wrong-type, and integrity-mismatched objects while leaving
  their row pending.
- A valid object is promoted exactly once; repeated confirmation is explicitly idempotent or
  explicitly rejected and documented.
- Unit tests cover signature headers and application tests cover every failed confirmation branch.
- A real-R2 test proves the overwrite attempt receives `412 PreconditionFailed`.

## Related

- [Cloud recordings backend](./cloud-recordings-upload)
- [R2 storage architecture](./r2-storage-architecture)
