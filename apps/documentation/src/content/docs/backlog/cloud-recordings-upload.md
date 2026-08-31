---
title: Cloud recordings — accounts + R2 upload (backend)
description: Backend for signing in and uploading local recordings to the user's private cloud vault on R2 via presigned URLs, with each object attached to the account. Implements the presigned-URL path from the R2 storage architecture.
---

# Cloud recordings — accounts + R2 upload (backend)

> **Status: 🟢 Ready to validate (backend).** Full backend vertical implemented and tested
> (domain + application + infra + API), 18 new unit tests green, `check-types` green across the
> monorepo. Realizes the **presigned-URL path** from
> [R2 storage architecture](./r2-storage-architecture) (private bucket, read/write through code).
> Remaining before it works end-to-end: create the private R2 bucket + API token, set the Worker
> secrets, run `db:push`, then build the desktop upload UI. Effort: Medium.

## What this delivers

Two things, per the ask: **upload with presigned URLs**, and **attach the video to the account**.

- **Accounts** already existed (Better Auth + Drizzle + Hono). This feature adds the
  **recordings** that belong to a user.
- **Upload** is a presigned **PUT** straight to R2 (the bytes never pass through the Worker), then
  a **confirm** call flips the row to `ready`.
- Every recording row is **owned by `userId`**; all reads/writes are account-scoped.

## Architecture (layers)

```
domain        recording schema + pure rules (buildStorageKey, size limit, ext)
              IRecordingRepository + IStorageService ports
application   createRecordingUpload / confirm / list / getDownloadUrl / delete
infra-db      recordingTable (Drizzle) + RecordingRepository
infra-storage createR2Storage → presigned PUT/GET (aws4fetch, S3-compatible)
server-hono   oRPC /api/v1/recordings/* behind authMiddleware
```

The application layer depends only on the **ports**, so R2 and Postgres are swappable and the use
cases are unit-tested with in-memory fakes.

## Data model

`recording` table (prefixed via `createTable`):

| Column                    | Notes                                              |
| ------------------------- | -------------------------------------------------- |
| `id`                      | uuid, app-generated so the key exists before insert |
| `user_id`                 | FK → user (cascade); the account it belongs to     |
| `kind`                    | `recording` \| `screenshot`                        |
| `title`                   |                                                    |
| `storage_key`             | unique — `videos/<userId>/<id>.<ext>` or `img/…`   |
| `content_type`            |                                                    |
| `size_bytes`              | bigint (a video can exceed 32-bit)                 |
| `duration_seconds`        |                                                    |
| `status`                  | `pending` → `ready` after confirm                  |
| `created_at`/`updated_at` |                                                    |

Storage key layout matches [R2 storage architecture](./r2-storage-architecture): the **private**
bucket, split `videos/` vs `img/`, namespaced by user.

## API (all auth-gated, `/api/v1`)

| Method | Path                             | Purpose                                              |
| ------ | -------------------------------- | ---------------------------------------------------- |
| `POST` | `/recordings`                    | Create a pending recording + return a presigned PUT  |
| `POST` | `/recordings/{id}/confirm`       | Mark it `ready` once the upload finished             |
| `GET`  | `/recordings`                    | List the caller's recordings (newest first)          |
| `GET`  | `/recordings/{id}/download-url`  | Presigned GET to download                            |
| `DELETE`| `/recordings/{id}`              | Delete the row and its R2 object                     |

## Upload flow

1. Desktop calls `POST /recordings` with `{ title, kind, contentType, sizeBytes, durationSeconds }`.
2. API attaches a `pending` row, returns `{ recording, uploadUrl }`.
3. Desktop `PUT`s the file bytes to `uploadUrl` (direct to R2).
4. Desktop calls `POST /recordings/{id}/confirm` → `ready`.
5. `GET /recordings` shows the cloud vault; `download-url` fetches a file back.

## Config (what Cristian sets)

The API reads optional Worker secrets — the API still boots without them, and the recording
endpoints report "Cloud storage is not configured" until they're present:

- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  (`R2_BUCKET` = the **private** bucket, e.g. `kaipu-private-bucket`, Public Access **off**, no
  custom domain — per the architecture doc's hard rule).

Then apply the schema with `bun run db:push` (the repo has no versioned migrations).

## How to test

- **Unit (green now, in CI):** `bun run test --filter='@kaipu/*'` — 18 tests: domain key/size rules,
  the R2 presigner (real SigV4 URL shape), and the use cases over in-memory fakes.
- **Manual (after secrets + db:push):** hit the endpoints with a session cookie:
  `createUpload` → `PUT` a small file to the returned URL → `confirm` → `list` shows it `ready` →
  `download-url` fetches it back → `delete` removes row + object. A second user must not see or
  fetch it.

## Not in this slice

- **Desktop UI**: sign-in screen (token in OS keychain via `safeStorage`) and an "upload / synced"
  affordance in the library — next PR.
- **Worker-proxy reads** (the alternative to presigned GET) and public/marketing assets — out of
  scope here.
