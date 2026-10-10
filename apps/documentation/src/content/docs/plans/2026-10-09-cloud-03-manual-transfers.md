---
title: Cloud 03 — manual transfers (upload, download, queue)
description: Phase 3 of optional cloud — a persistent transfer queue in the desktop main process, manual upload with cancel and retry, safe download into the vault, Local only and Manual modes, quota indicators and a transfers panel.
---

# Cloud 03 — manual transfers

> **Status: 🔵 Proposed — awaiting the founder's approval.** Written 2026-10-09 for
> [NIW2-214](https://linear.app/niway/issue/NIW2-214). No desktop transfer code is written until
> this plan is approved. The open questions of the ticket are resolved here with their
> **proposed defaults**; each one is marked _(default, Qn)_ so it can be overturned in review.

**Goal:** a verified user can upload a recording or screenshot by hand, see it as "Local and
cloud", cancel or retry without ever losing the local file, and download a cloud-only item back
into the vault safely.

**Builds on:** [plan 01](/plans/2026-09-09-cloud-01-server-quotas-and-revisions/) (server — its
section "Requirements for the desktop client" is binding here), [plan 02](/plans/2026-09-09-cloud-02-local-identity-and-combined-library/)
(asset identity, combined library, catalog cache) and the [design handoff](/specs/2026-09-09-cloud-design-handoff/)
§6 (transfer states, copy and controls). Umbrella: [delivery plan, phase 3](/plans/2026-09-09-cloud-delivery/).

**Out of scope:** automatic upload (phase 5), share links and the public player (phase 4,
NIW2-216/222/223), link updates and new revisions of an already-uploaded file (phase 6), removing
the legacy `recording` vertical (NIW2-221), entitlements v2 / 250 MB trial, multipart or resumable
uploads, R2 CORS (the desktop uploads from main with Node `fetch`), syncing renames, orphan-object
scans.

## Decisions taken by this plan

| #   | Question                                                    | Decision _(proposed default)_                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Capacity when production uploads open                       | Do not wait for entitlements v2. Production ships with `cloud_control.uploads_enabled = false`; the founder turns it on for his own test only. Uploads open to everyone after plans `2026-09-15-02`/`-03` land (separate ticket).                                                                  |
| Q2  | Beta allowlist                                              | None. A verified email is the access rule; the global `cloud:uploads` switch is the only gate.                                                                                                                                                                                                     |
| Q3  | What Local only allows                                      | No Upload action in rows. The detail view offers "Upload to cloud…", which asks to switch to Manual — never silently. Downloads and catalog browsing work in every mode.                                                                                                                           |
| Q4  | Crash or quit mid-upload                                    | Reload as **Interrupted** with Retry; no silent auto-resume. Items still `queued` (never started) resume on their own.                                                                                                                                                                             |
| Q5  | Automatic retries                                           | 3 attempts, backoff 2 s → 8 s → 30 s with ±20 % jitter, then `failed` with Retry and Cancel. Offline time consumes no attempt. Copy says "Retrying restarts the upload from the beginning".                                                                                                        |
| Q6  | Concurrency                                                 | 1 upload at a time **and** 1 download in its own lane, in parallel. Further items queue.                                                                                                                                                                                                           |
| Q7  | Download destination and name                               | The current vault folder, `<sanitised cloud title>.<ext>`, ` (2)`, ` (3)`… on conflict; linked by `assetId`, never by name. If the vault folder is unavailable, show "Open folder settings" instead of picking another folder.                                                                     |
| Q8  | Re-upload after local changes (`comparison: local-changes`) | Not in phase 3. Show "Local changes not in cloud"; only **first** uploads are allowed. New revisions come with phase 6.                                                                                                                                                                            |
| Q9  | How production gets the schema                              | A committed baseline migration (`db:generate`, NIW2-214 ops PR), applied with `db:migrate` to a Neon branch of production first, then production. Never `db:push` in production. Applying it is an operator step, not part of any PR.                                                              |
| Q10 | Thumbnails                                                  | Videos upload their local thumbnail (`.kaipu/<id>.jpg`, ≤ 512 KB) and it counts toward quota as plan 01 implements today. Screenshots upload no separate thumbnail. **Flagged:** the 2026-10-08 note "derived files don't count" needs a ruling; changing it is a server change outside this plan. |
| Q11 | When deleted bytes stop counting                            | At the physical R2 delete (current code). The UI shows "Deleting cloud copy…" without an optimistic quota reduction.                                                                                                                                                                               |
| Q12 | Cron schedule, batches, grace                               | Keep plan 01's proposals: `*/15 * * * *`, 50 reservations + 50 deletes + 1 purge per run, `RESERVATION_GRACE_SECONDS = 3 h`. Recorded as proposals in `backend/cloud-storage.md` until the founder approves them.                                                                                  |

Also fixed by this plan (not open questions):

- **Automatic** stays visible in the mode picker but **disabled**, labelled "Coming soon". A device
  that already saved `automatic` behaves as **Manual** for transfers and shows the note "Automatic
  upload isn't available yet — this device uses Manual"; the stored value is not rewritten.
- The renderer never receives tokens, presigned URLs, object keys or absolute paths it did not
  already have. Main validates every IPC argument.
- The queue never writes, moves or deletes a source file. ADR 0003 (export never replaces the
  original) extends to transfers: neither direction replaces an existing local file.

## Architecture

```
renderer (observes, sends commands)
  features/transfers/ ── use-transfers ──► IPC: transfers:subscribe / enqueueUpload / enqueueDownload / cancel / retry / retryAllPending / clearFinished
main
  cloud/transfers/
    transfer-store.ts       per-account JSON in userData, schema-versioned, atomic (temp + rename)
    transfer-queue.ts       pure state machine: lanes, retries, backoff; injectable clock/fetch/fs
    cloud-assets-client.ts  intent, confirm, cancel, download-url — same error shapes as catalog-client.ts
    upload-runner.ts        stat → cap check → sha256 → intent → PUT (+thumb) → confirm
    download-runner.ts      statfs → download-url → stream .part → verify → sidecar → atomic rename
    index.ts                composition: AuthHandle, LibraryVault, net online, broadcastLibraryChanged
  library/compose-library.ts fills LibraryItem.transfer from the queue
```

### Persisted model

```ts
// main/cloud/transfers/transfer-store.ts
interface TransferFileV1 {
  version: 1;
  userId: string;
  transfers: PersistedTransfer[];
}

interface PersistedTransfer {
  transferId: string; // UUID minted by main
  direction: "upload" | "download";
  assetId: string; // sidecar assetId (upload) or catalog assetId (download)
  localId: string | null; // vault id for uploads; final id for finished downloads
  state: TransferState; // see below
  intentKey: string | null; // upload only; persisted before createUploadIntent
  revisionId: string | null; // once the intent answered
  attempts: number; // automatic attempts consumed
  bytesTotal: number | null;
  bytesDone: number | null; // not persisted mid-flight; null after reload
  error: TransferErrorKind | null;
  createdAt: number;
  updatedAt: number;
}
```

File: `userData/cloud-transfers/<userId>.json`, written via `writeFile(tmp)` + `rename`. Unknown
`version` → keep the file, start empty, log `transfers.store.unreadable` (never delete user data).

### States

`TRANSFER_STATES` (`shared/types/library-item.ts`) gains `interrupted` and `paused-auth`:

| State            | Meaning                                                          | Controls          |
| ---------------- | ---------------------------------------------------------------- | ----------------- |
| `queued`         | Waiting for its lane. No URL requested, nothing reserved.        | Cancel            |
| `preparing`      | stat, per-kind cap check, sha256, thumbnail                      | Cancel            |
| `uploading`      | PUT in flight; byte progress known                               | Cancel            |
| `verifying`      | `confirmUpload`                                                  | — (indeterminate) |
| `downloading`    | GET in flight to `.part`                                         | Cancel            |
| `paused-offline` | Network lost; resumes on `online` without using attempts         | Cancel            |
| `paused-auth`    | Server answered 401; whole queue waits for the same account      | Sign in           |
| `interrupted`    | App quit while `preparing`/`uploading`/`verifying`/`downloading` | Retry, Cancel     |
| `cancelling`     | Waiting for `cancelUpload`                                       | —                 |
| `failed`         | Attempts exhausted or a terminal error                           | Retry, Cancel     |
| done             | Removed from the active list; "Clear finished" drops the history | —                 |

## Tasks

Each task is one PR, stacked or based on `main` once the previous one merges. Every task ends with
`bun run check-types && bun run test && bun run lint` green.

### Task 1 — transfer core in main (NIW2-214 PR 4)

**Files:** create `main/cloud/transfers/{transfer-store,transfer-queue,cloud-assets-client,upload-runner,index}.ts`
with tests; modify `main/cloud/index.ts`, `shared/types/{ipc,electron-api,library-item}.ts`,
`preload/index.ts`, `main/library/compose-library.ts`.

1. `cloud-assets-client.ts`: `createIntent`, `confirm`, `cancel`, `downloadUrl` against
   `/api/v1/assets/upload-intents`, `/assets/{assetId}/revisions/{revisionId}/confirm|cancel`,
   `/assets/{assetId}/download-url`. Results are discriminated unions with the same conventions as
   `catalog-client.ts`/`storage-client.ts` (`{ kind: "unauthorized" }`, `{ kind: "not-available" }`,
   plus `quota-exceeded { missingBytes }`, `uploads-paused`, `intent-expired`, `conflict`,
   `network`).
2. `transfer-store.ts`: load/save per account, atomic write, schema version, reload rule (Q4):
   `preparing|uploading|verifying|downloading` → `interrupted`; `queued` stays.
3. `transfer-queue.ts`: pure; one upload lane + one download lane (Q6); retry policy (Q5) with an
   injected clock; `paused-offline` does not increment `attempts`; a 401 moves **every** item of
   the account to `paused-auth`.
4. `upload-runner.ts` (plan 01 client requirements, verbatim):
   - `preparing`: `fs.stat`; reject over the per-kind cap (1 GB video / 25 MB screenshot) before
     any request; `sha256FileBase64` (`main/library/content-hash.ts`); thumbnail ≤ 512 KB (Q10).
   - Pre-check against the last `/me/storage`: `sizeBytes + thumb ≤ availableBytes`,
     `cloudUploads` and `uploadsEnabled`; a miss fails fast with the right copy, no intent.
   - Mint and **persist** `intentKey` (UUID) before calling `createUploadIntent`. `status: "ready"`
     → done.
   - PUT with the ticket's headers verbatim, Node `fetch` streaming a `ReadStream`
     (`duplex: "half"`) through a counting transform for progress; then the thumbnail PUT.
   - Any non-2xx PUT is "not uploaded" (R2 answers `502` for an oversized body). `403` = URL
     expired → renew with the **same** `intentKey`.
   - Retry calls `confirm` first; only a `missing` verification re-requests a ticket (same key);
     `intent-expired` mints a new key.
   - Cancel: before an intent, drop the item; after, abort the PUT and call `cancelUpload`; show
     `cancelling` until the server answers. Never touch the source.
5. IPC: channels in `IPC_CHANNELS`; `transfers:changed` broadcast; commands validate `localId`
   (known id resolving inside the current vault), `assetId`/`transferId` (UUID). No path ever
   crosses IPC. Account isolation through `AuthHandle.getCurrentAccount`/`onAccountChanged`:
   signing out pauses the queue (not deleted); account B never loads A's file.
6. `compose-library.ts` fills `LibraryItem.transfer` from the queue; uploaded items refresh the
   catalog and become `local-and-cloud`.

**Tests (vitest, fakes):** state transitions; retry-confirm-first; same intent key on renewal;
`intent-expired` mints a new key; 403 renews; 502 is a failure; cancel calls `cancelUpload` and the
source sha256 is unchanged; restart → Interrupted; queued survives restart; account switch
isolation; 401 → `paused-auth` → resumes only for the same account; offline consumes no attempts;
pre-check blocks without an intent.

**Spike first:** a 1 GB streaming PUT with `duplex: "half"` on the shipped Electron version,
measuring memory and progress events. If it fails, fall back to `net.request` with manual chunk
writes and note it here.

### Task 2 — download runner (NIW2-214 PR 5)

**Files:** create `main/cloud/transfers/download-runner.ts` + test; modify `transfer-queue.ts`,
`library-vault.ts` (a "materialise from cloud" entry point that writes the sidecar with the given
`assetId`).

1. Offered only for `availability: "cloud"`. Vault unavailable → `failed` with
   `vault-unavailable` ("Open folder settings"), Q7.
2. `fs.statfs` on the vault volume: free ≥ `sizeBytes` + 50 MB, else `disk-full` before any byte
   moves ("Not enough space to download this video").
3. `GET /assets/{id}/download-url`; stream to `<vault>/.kaipu/tmp/<transferId>.part`; a `403`
   renews the URL and restarts the stream.
4. Verify size and sha256 against the catalog entry; mismatch deletes `.part` → `failed`.
5. Write the sidecar with the same `assetId`, then `rename` to `<sanitised title>.<ext>`; never
   overwrite — suffix ` (2)`, ` (3)`… (`link` + `unlink` or an `O_EXCL` probe, not
   check-then-rename).
6. Cancel or any failure deletes `.part`; the item never shows as local.
7. A downloaded recording opens in the editor; no edit session is transferred (`editing` comes
   from the existing probe: `exported-only`/`needs-source`).

**Tests:** disk-full; sha mismatch deletes `.part`; cancel deletes `.part`; name-conflict suffix;
atomic rename (no final file before verification); sidecar `assetId` equals the catalog's; restart
during download → `interrupted` and the stale `.part` is removed.

### Task 3 — desktop UI (NIW2-214 PR 6)

**Files:** create `renderer/src/features/transfers/` (panel, `use-transfers`, state→copy map);
modify `features/storage-cloud/upload-mode-picker.tsx` (+ test), library header, `video-card`,
`video-row`, `library-detail-page`, `dev-storage-simulator.ts`, `packages/i18n/messages/{en,es}.json`.

1. Mode picker: Automatic disabled with "Coming soon" (see decisions above).
2. Local only: no row Upload; detail "Upload to cloud…" opens a dialog that offers switching to
   Manual (Q3). Manual: Upload in rows and detail. Download in every mode.
3. Transfers panel: non-modal, opened from the library header; badge = active + failed. Per item:
   title, kind, state copy, controls per the states table, real progress only when bytes are
   known (indeterminate for `preparing`/`verifying`). "Retry pending uploads" and "Clear finished".
4. Library cards and rows keep the location label always visible; the active transfer goes on a
   second line. Detail page: Upload, Download, Cancel or Retry as applicable; "Local changes not in
   cloud" for `local-changes` (Q8).
5. Quota: compact usage bar in the library header (signed-in, verified). 50 % bar only; 75 %
   subtle notice; 90 % prominent; grouped, no toasts while recording. States: loading, stale,
   error, session-expired, not-available, uploads-paused — never "0 GB" on failure. Reuse
   `capacity-view.ts` and `format-bytes.ts` (decimal units).
6. `QuotaExceeded` → "Free up {missing} to continue" with the server's `missingBytes`. ES for
   insufficient capacity: "Capacidad insuficiente. Borra archivos o cambia de plan".
7. Dev simulator gains transfer states for dev builds.

**Tests:** panel per state; mode picker (Automatic not selectable, legacy `automatic` note); quota
thresholds; no "0 GB" on error; i18n parity.

### Task 4 — production readiness (operator, mostly non-code)

Not a code PR. The founder (or an operator session he authorises) does, in order:

1. Apply the baseline migration to a Neon branch of production, then production (`db:migrate`).
2. Seed `cloud_control` with `uploads_enabled = false` (`bun run cloud:uploads status` creates the
   row; `off` keeps it closed).
3. Verify R2 private-bucket secrets on the production Worker.
4. Verify a verification email end to end (Resend DKIM/SPF, a real inbox).
5. Create the WAF rules per `backend/cloud-storage.md`.
6. Confirm `cloud.sweep` appears in Workers logs at least once per window.
7. `cloud:uploads on` for the founder's test, upload one recording from a production build, check
   `usedBytes` and "Local and cloud"; then decide (Q1) whether to turn it back off.

## Acceptance (from NIW2-214)

- Killing the network, force-quitting, and a server `QuotaExceeded` mid-upload each leave the local
  file byte-identical (sha256 unchanged).
- Cancelling a running upload returns `reservedBytes` to its prior value; no `ready` revision and
  no object remain for that intent.
- Retry after quitting post-PUT confirms without a second reservation.
- A cancelled or sha-mismatched download leaves no file in the vault; the item stays "Cloud".
- Downloading next to a same-named file creates a suffixed copy and overwrites nothing.
- Insufficient disk shows "Not enough space to download this video" before any byte moves.
- An expired session shows "Sign in to continue"; the same account resumes; another account never
  sees the queue.
- Automatic cannot be selected. Every new string exists in en and es.
- The founder uploads one recording from a production build and sees `usedBytes` grow.

## Risks

- Production email delivery is unproven and gates every cloud account.
- Opening uploads before entitlements v2 gives every verified email 1 GB (mitigated by Q1).
- 1 GB at ~1 Mbps takes ~2 h 15 min; the 3 h grace is a proposal.
- Electron `fetch` streaming with `duplex: "half"` is unproven on the shipped version (Task 1 spike).
- Handoff deferred findings (thumbnail verified by size only, `markReady` ignores `deleted_at`,
  no orphan scan, malformed cursor → page 1) should be triaged before production uploads open.
