---
title: Cloud recordings — accounts + R2 upload (backend)
description: Backend for signing in and uploading local recordings to the user's private cloud vault on R2 via presigned URLs, with each object attached to the account. Implements the presigned-URL path from the R2 storage architecture.
---

# Cloud recordings — accounts + R2 upload (backend)

> **Status: 🟢 Validated end-to-end locally (2026-09-02).** Full backend vertical implemented and
> tested (domain + application + infra + API), unit tests + `check-types` green across the
> monorepo. Realizes the **presigned-URL path** from
> [R2 storage architecture](./r2-storage-architecture) (private bucket, read/write through code).
> The private bucket (`kaipu-private-bucket`) is provisioned, the schema is applied (`db:push`),
> and the full cycle — sign up → session → `createUpload` → `PUT` to R2 → `confirm` → `list` →
> `download-url` → `delete` — was run against real R2 + Postgres. A code review also fixed 7
> correctness/quality issues (orphaned-row rollback, presigned `Content-Type` binding, confirm
> verifying the object actually landed, delete ordering, shared error handling). Not yet done:
> setting the **production** Worker secrets and the **desktop upload UI** (see
> [Before integrating with Desktop](#before-integrating-with-desktop) below). Effort: Medium.

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

| Column                    | Notes                                               |
| ------------------------- | --------------------------------------------------- |
| `id`                      | uuid, app-generated so the key exists before insert |
| `user_id`                 | FK → user (cascade); the account it belongs to      |
| `kind`                    | `recording` \| `screenshot`                         |
| `title`                   |                                                     |
| `storage_key`             | unique — `videos/<userId>/<id>.<ext>` or `img/…`    |
| `content_type`            |                                                     |
| `size_bytes`              | bigint (a video can exceed 32-bit)                  |
| `duration_seconds`        |                                                     |
| `status`                  | `pending` → `ready` after confirm                   |
| `created_at`/`updated_at` |                                                     |

Storage key layout matches [R2 storage architecture](./r2-storage-architecture): the **private**
bucket, split `videos/` vs `img/`, namespaced by user.

## API (all auth-gated, `/api/v1`)

| Method   | Path                            | Purpose                                             |
| -------- | ------------------------------- | --------------------------------------------------- |
| `POST`   | `/recordings`                   | Create a pending recording + return a presigned PUT |
| `POST`   | `/recordings/{id}/confirm`      | Mark it `ready` once the upload finished            |
| `GET`    | `/recordings`                   | List the caller's recordings (newest first)         |
| `GET`    | `/recordings/{id}/download-url` | Presigned GET to download                           |
| `DELETE` | `/recordings/{id}`              | Delete the row and its R2 object                    |

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
  (`R2_BUCKET` = the **private** bucket, `kaipu-private-bucket` — **provisioned**, Public Access
  **off**, no custom domain, per the architecture doc's hard rule).

Apply the schema with `bun run db:push` (the repo has no versioned migrations) — **done** on the
local/dev database. Still pending: setting all four vars for the production Worker — via the release workflow, not `wrangler secret put`, on the
**production** Worker (`apps/server-hono`).

## How to test

- **Unit (in CI):** `bun run test --filter='@kaipu/*'` — domain key/size rules, the R2 presigner
  (real SigV4 URL shape, including the `Content-Type` binding), and the use cases over in-memory
  fakes.
- **Manual (validated 2026-09-02, local):** `sign-up` → session cookie → `createUpload` → `PUT`
  the file to the returned URL → `confirm` → `list` shows it `ready` → `download-url` fetches it
  back → `delete` removes row + object → `list` empty again. Ran against the real
  `kaipu-private-bucket` and a real Postgres (Neon) — all steps returned the expected
  status/payload. A second user still must not see or fetch another user's recording (unit-tested,
  not yet re-verified manually against real R2).

## Before integrating with Desktop

From a code review of the backend (2026-09-02). The vertical itself is solid — it keeps the
domain → application → infra → app dependency rule, treats the cloud as an optional capability
on top of the local-first product, and the full ticket → upload → confirm → list → download →
delete cycle works. These five items are what's left before it's ready to wire into Desktop:

1. **R2 CORS + the Electron origin.** The presigned PUT binds an exact `Content-Type`
   (`packages/infra-storage/src/r2-storage.ts`), so a fetch from the renderer triggers a CORS
   preflight against R2's S3-compatible endpoint. Need to decide
   whether the upload runs in the **main process** (plain Node `fetch`, no browser origin
   checks — no CORS involved) or the **renderer** (needs the private bucket's CORS policy
   configured for the app's actual origin), then configure the bucket accordingly.
2. **Stronger confirm.** `confirmRecording` today only checks that the object _exists_
   (`objectExists` → `HEAD` 200/404). It should compare the `HEAD` response's
   `Content-Length`/`Content-Type` against what the client declared before flipping the row to
   `ready` — otherwise the 2 GiB cap and the declared `contentType` are only a client-side
   promise, never actually enforced server-side.
3. **`pending` row lifecycle.** If the app closes, the network drops, or the presigned URL
   expires (15 min default) mid-upload, the row is stuck `pending` with no cleanup path. Need a
   policy: re-issue a fresh upload URL for the same row, an explicit cancel endpoint, and/or a
   scheduled sweep of expired `pending` rows.
4. **Electron authentication.** The API is already session-gated via Better Auth, but Desktop
   has no login flow yet, and no session/token custody plan (`safeStorage`, refresh, sign-out).
   This is the next piece to build, and it decides how Desktop actually calls these endpoints.
5. **Quotas and abuse.** The 2 GiB per-file cap exists; still need a per-user storage quota and
   a rate limit on presigned-URL issuance before this opens to real accounts.

**Recommendation:** tackle #1 and #4 together — deciding "upload from main vs. renderer" is
what determines the CORS policy, the auth/session surface, and where credentials live.

## Security hardening follow-up

The production-readiness work from the security review is split into independently trackable
documents under [Backend security hardening](./backend-security-hardening). That hub is the source
of truth for the release gate and links dependency remediation, ticket integrity, production
configuration, Desktop auth/CORS, abuse controls, Electron hardening, and cloud data lifecycle.

## Not in this slice

- **Desktop UI**: sign-in screen (token in OS keychain via `safeStorage`) and an "upload / synced"
  affordance in the library — next PR.
- **Worker-proxy reads** (the alternative to presigned GET) and public/marketing assets — out of
  scope here.
