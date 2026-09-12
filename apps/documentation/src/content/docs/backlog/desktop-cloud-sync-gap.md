---
title: Desktop ↔ cloud sync — the missing client and the model gap
description: The cloud recordings API is complete and unused. Nothing in the desktop app calls it, and the local vault model cannot be mapped onto the cloud model. What is missing, and the two data-model decisions that block writing the client.
---

# Desktop ↔ cloud sync — the missing client and the model gap

> **Status: 🟢 Ready to validate.** The model decisions have been decided and implemented in
> plan 02 (cloud 02 — local identity and combined library). The desktop client architecture
> is settled: `assetId` is the stable identity link (minted on first read, stored in the sidecar);
> thumbnails are per-revision auxiliary objects in R2 (no schema change). The upload/download
> **transfers and the transfer panel are plan 03** — not included in this batch. This doc records
> the data-model decisions so they are not re-investigated. Effort: Medium.

## The gap in one sentence

[Cloud recordings — accounts + R2 upload](./cloud-recordings-upload) shipped a complete,
tested backend vertical. Plan 02 adds the desktop client foundation (stable asset identity,
catalog cache, remove-local-download operation, combined library with five axes). The upload
and download flows are plan 03.

## What exists

The server side is whole, in proper hexagonal layers:

| Endpoint                                   | Behaviour                                                      |
| ------------------------------------------ | -------------------------------------------------------------- |
| `GET /api/v1/recordings`                   | The signed-in user's recordings, newest first                  |
| `POST /api/v1/recordings`                  | Inserts a `pending` row, returns it plus a presigned PUT to R2 |
| `POST /api/v1/recordings/{id}/confirm`     | Verifies the object actually landed in R2, flips to `ready`    |
| `GET /api/v1/recordings/{id}/download-url` | Presigned GET                                                  |
| `DELETE /api/v1/recordings/{id}`           | Deletes the row and the object                                 |

Backed by `IRecordingRepository` + the `IStorageService` port, `RecordingRepository`
(Drizzle), `createR2Storage` (aws4fetch), and `buildStorageKey` laying objects out as
`videos/<userId>/<id>.<ext>` and `img/<userId>/<id>.<ext>`. All of it is behind
`authMiddleware`, and desktop authentication (bearer token, `auth-store`, `auth-client`)
already works against the same API.

The **web** app now consumes these endpoints — the `/recordings` route lists, opens and
deletes. That is the only consumer.

## What is missing

**A cloud client in the desktop app.** `apps/kaipu-record/` has no oRPC client, no upload
flow, no sync state. The library is purely local: `LocalRecording`
(`src/shared/types/library-storage.ts`) over a folder on disk, read by `library-vault.ts`.
There is no "upload this recording" action anywhere in main or renderer.

## Data-model decisions (settled, implemented in plan 02)

Two data-model questions had to be decided before the client was worth writing. Both are now
settled and implemented.

### 1. Link between local and cloud: the `assetId` in the sidecar

**Decision:** The sidecar v2 (`.kaipu/<id>.json`) carries an `assetId` field — a stable UUID
minted on first read and persisted best-effort. This is the link between a local recording and
its cloud copy.

**Why this shape:** The sidecar is the source of truth when the vault is transferred between
machines or the drive is mounted on a different computer. A server-side `local_id` column would
be lost the moment the vault is copied; a sidecar-only identity persists. The unique constraint
on the server prevents accidental duplicates when uploads are retried.

**Implementation:** `LibraryVault.ensureIdentity()` mints a UUID and persists it. If the vault
is read-only, the id lives in memory for that process only — we do not fail to list, because
failing reads as data loss. Subsequent reads return the persisted id.

See [Library Vault — Identity and sidecar v2](/desktop/library-vault/#identity-and-sidecar-v2).

### 2. Thumbnails: per-revision R2 objects

**Decision:** Thumbnails are uploaded to R2 as second objects under a `thumbs/` prefix, mirroring
the existing `videos/` layout. No schema change; no `thumbnail_key` column.

**Why this shape:** It follows the existing R2 key layout, keeps the schema stable, and allows
the web UI and desktop to fetch thumbnails alongside recordings without a database round-trip.
Presigned GET URLs make them as efficient as a database-backed thumbnail.

## Smaller gaps, not blocking

- **`GET /recordings` is unpaginated.** It returns every row for the user. Fine at current
  volumes; revisit before a user has hundreds of recordings. `paginationQuerySchema` already
  exists in the domain layer.
- **No storage quota or plan entitlement.** Any signed-in account can upload up to the
  2 GiB per-object cap, without limit on the number of objects. The plan concept now exists — see
  [Plans and entitlements](./plans-and-entitlements); a storage quota would be a second key in
  its `features` map.
- **No sync status in the local library UI.** Once uploads exist, a recording needs a
  visible local/cloud/uploading state, which `LocalRecording` has no field for.

## Why it was not built now

The backend was written first, deliberately, to have a real model to shape the layers
against. The client is a separate, larger piece of work, and writing it before deciding
the two model questions above would bake in a schema that has to be migrated immediately.

## Related

- [Cloud recordings — accounts + R2 upload](./cloud-recordings-upload) — the backend this gap sits on top of
- [R2 storage architecture](./r2-storage-architecture) — the private-bucket / presigned-URL decision
- [Desktop authentication and R2 CORS](./desktop-auth-and-r2-cors) — the security work the desktop upload path depends on
- [Cloud recording lifecycle and account deletion](./cloud-data-lifecycle)
