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

## Evidence (spike, 2026-09-13)

Ran `packages/infra-storage/scripts/r2-ticket-spike.ts` against `kaipu-private-bucket` with a
1 MiB throwaway object under `spike/<uuid>/` (deleted at the end):

| Check                                                                     | Result                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| a. body longer than the signed `Content-Length`                           | `502` rejected, nothing stored (see note)                    |
| b. second PUT on an existing key with signed `If-None-Match: *`           | `412`                                                        |
| c. body whose sha256 differs from the signed `x-amz-checksum-sha256`      | `400` rejected                                               |
| d. HEAD returns `content-length`, `content-type`, `x-amz-checksum-sha256` | yes — `1048576`, `application/octet-stream`, non-null sha256 |
| e. Range GET                                                              | `206`, 10 bytes                                              |
| f. DELETE                                                                 | `204`                                                        |

Note on (a): R2 answered `502`, not a 4xx. It is still a rejection at write time: check (a)
used the same key as the later happy-path PUT, which carries `If-None-Match: *` and succeeded
with `200` — so the oversized body left no object behind. The server must treat any non-2xx
from the ticket PUT as "not uploaded", never assume a 4xx.

Conclusion: the presigned ticket bounds length, hash and overwrite at write time; plan 01
proceeds with presigned PUT.
