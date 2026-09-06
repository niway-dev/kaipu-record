---
title: Desktop ↔ cloud sync — the missing client and the model gap
description: The cloud recordings API is complete and unused. Nothing in the desktop app calls it, and the local vault model cannot be mapped onto the cloud model. What is missing, and the two data-model decisions that block writing the client.
---

# Desktop ↔ cloud sync — the missing client and the model gap

> **Status: 🔵 Proposed.** The backend is done; the client does not exist. Discovered
> 2026-09-05 while cleaning the template leftovers out of the backend and applying the
> schema to the database for the first time (`db:push`, prefix `kaipu_record_`). This doc
> records the gap so it is not re-investigated. Effort: Medium — but blocked on two
> data-model decisions, below.

## The gap in one sentence

[Cloud recordings — accounts + R2 upload](./cloud-recordings-upload) shipped a complete,
tested backend vertical, and **no code in the desktop app calls any of it**.

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

## The model gap — two decisions that block the client

The local and cloud models are not mappable onto each other as they stand. Both need a
decision before the client is worth writing, because both change the schema.

### 1. There is no link between a local recording and its cloud row

`LocalRecording.id` and `recordingTable.id` are independently generated. Nothing records
that local recording `X` was uploaded as cloud row `Y`.

Without that link the client cannot answer the questions it has to answer on every launch:
which recordings are already uploaded, which upload was interrupted and should be retried,
and which retry would create a duplicate. A pure "upload everything" button is possible
without it; anything resumable or idempotent is not.

Shape to decide: a nullable `local_id` column on the recording table (unique per user), or
a local sidecar that stores the cloud id next to the file, or both. A server-side unique
constraint is the only one of those that makes a retry genuinely idempotent, because the
sidecar is lost when the vault folder is moved or the machine is replaced.

### 2. Thumbnails have nowhere to live in the cloud

`LocalRecording` carries `thumbnailUrl`; `recordingTable` has no thumbnail column and R2
holds only the recording itself. The web `/recordings` list is therefore text-only today.

Options: upload the thumbnail as a second R2 object under a derived key (a `thumbs/` prefix
mirroring the existing split) and store nothing new in Postgres; or add a `thumbnail_key`
column; or generate thumbnails on demand in the browser from a ranged read. The first keeps
the schema still and follows the existing key layout.

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
