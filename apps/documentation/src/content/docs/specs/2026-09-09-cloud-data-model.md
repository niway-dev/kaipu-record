---
title: Cloud — identity, revisions, and the relationship with .kaipu
description: Proposed unified library model without duplicates or false guarantees of editing recovery.
---

# Identity, revisions, and the local project

Date: 2026-09-09. Status: technical proposal for implementing the [product specification](/specs/2026-09-09-cloud-product/).

## Evidence from the current code

In `apps/kaipu-record/src/main/library/library-vault.ts`, the library discovers media in the folder and uses the filename as its ID. `.kaipu/` is an auxiliary directory, not a portable project container:

| Path relative to the vault          | Current contents                   |
| ----------------------------------- | ---------------------------------- |
| `<id>.mp4`, `<id>.webm`, `<id>.png` | Media                              |
| `.kaipu/<id>.json`                  | Optional title, duration, and date |
| `.kaipu/<id>.jpg`                   | Thumbnail                          |
| `.kaipu/<id>.edit.json`             | Video editing session              |
| `.kaipu/<id>.assets/<assetId>.png`  | Images used by the session         |

`video-edit-session.ts` persists the session and assets. `library/index.ts` currently deletes the session when deleting the local file. `use-video-export.ts` finalizes new media with a new identity on export. `LocalRecording` requires a local path, so it cannot directly model a cloud-only item.

The backend creates a new UUID for every ticket. `confirm-recording.ts` only checks existence; the R2 adapter does not validate actual length. These behaviors must evolve before exposing the following guarantees.

## Separate four concepts

1. **Item**: the stable identity visible in the library (`assetId`).
2. **Media revision**: immutable bytes, size, type, and hash (`revisionId`).
3. **Location**: availability of a revision on this device and/or in cloud.
4. **Editing project**: local instructions and dependencies used to produce a revision; not the exported MP4.

A local copy and its cloud copy of the same revision are one entry, not two videos. A new export is a distinct result in the MVP, as it is today: relate it through `derivedFromAssetId` and label it Export of … in the detail view. Do not deduplicate by title or filename; do not collapse different exports by pretending they are identical.

Proposed metadata, not an already migrated schema:

| Field                                          | Responsibility                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `assetId`                                      | Stable UUID generated when registering media; independent of the legacy filename |
| `localLocator`                                 | Validated file reference in this vault/device; never published                   |
| `localRevisionId`, `cloudRevisionId`           | Available revisions, which may differ                                            |
| `contentHash`, `sizeBytes`, `contentType`      | Verifiable byte identity; hash is not used for cross-account deduplication       |
| `cloudAccountId`, `cloudAssetId`               | Explicit association; server validates ownership                                 |
| `autoUploadExcluded`                           | Durable exclusion after cloud deletion, maintained per account on the server     |
| `derivedFromAssetId`                           | Export provenance without replacing the original                                 |
| `editorSourceRevisionId`, `editorDependencies` | Exact source and resources required by a session                                 |
| `publishedRevisionId`                          | Revision served by the link, independent of the local draft                      |
| `lastVerifiedAt`                               | Age of cloud evidence; not a substitute for querying the server                  |

Local: versioned sidecars and additive migration. Keep existing filenames and add identity without bulk renaming. Persist the catalog/transfer index per account and device independently of whether the media exists. Remote records must allow reconstructing cloud-only items after reinstalling; a local sidecar cannot be their only evidence.

Server: paginated catalog, immutable revision, and a unique constraint on account + assetId + revisionId. Use an idempotency key per upload intent. Repeating an operation retrieves the same intent and reservation rather than creating copies or additional storage charges.

## Location, transfer, and editing are separate dimensions

Do not collapse everything into a `storage` enum that loses information. For example, a file can be Local and cloud, Updating cloud, and have Local changes at the same time.

| Dimension    | Proposed states                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Availability | Local; Cloud; Local and cloud; Location unverified; Unavailable                                         |
| Transfer     | Idle; Queued; Preparing; Uploading; Verifying; Downloading; Paused offline; Canceling; Failed; Deleting |
| Comparison   | Same revision; Local changes; Comparison pending; Different versions                                    |
| Editing      | Project available; Source download required; Exported video only; Missing dependencies                  |
| Sharing      | Private; Link active; Revoking; Link revoked                                                            |

Do not mark a file Cloud only because an external drive did not respond: use Local location unavailable and retain its locator. Do not mark cloud as deleted after a timeout/401. When switching accounts, hide the previous account's catalog, links, and tasks; local files remain accessible and are not automatically reassociated with or uploaded to the new account.

## Uploading an MP4 does not back up the project

MVP: upload only the selected media revision and an allowed thumbnail, without serializing all of `.kaipu`. Downloading restores that video, not the layers, reversible cuts, slides, or originals used to produce it. The editor may start a new edit on the downloaded video; it must not reapply the original's session to an exported render.

If a local session remains whose `editorSourceRevisionId` exactly matches the downloaded source and all its resources are present, that session can reopen. On another device without those resources, show Exported video only and offer Edit as new video. Future project backup will require a versioned manifest, exact sources and complete assets, quota for all objects, and verified downloads; it is not included.

Conservative MVP proposal: block Remove local download when the media is a source for an editing project or has a linked session, until complete dependency checking is implemented. Message: This file is used by a local editing project. Keep its files to continue editing. Do not imply complete backup merely because an MP4 exists in cloud.

Remove local download preserves identity, the cloud association, and the catalog thumbnail. It does not delete `.edit.json` or `.assets/`. A separate destructive local deletion action must explain the loss of editing data and dependencies; the safer initial approach is to block deletion of sources in use and require resolving the project first.

## Downloading and editing without duplicates

Sequence: Cloud → Downloading → Verifying → Local and cloud → open editor. Download to a temporary file, check available space and length/hash, perform an atomic rename, and associate the revision with the same assetId. Do not show it as local until completion. Failure or cancellation removes the temporary file and preserves cloud.

If a different local revision already exists, do not overwrite it or download under the same filename. Offer to preserve it and download as a separate file with a provenance relationship; advanced comparison and recovery are outside the MVP. Recheck the destination before renaming to avoid overwriting concurrent changes. An external modification invalidates previously verified equality.

Cloud playback may use explicitly requested temporary access, but editing requires a local source. Playback cache does not count as Downloaded. With cached catalog data and no Internet, show Cloud · Offline; do not replace the library with an empty state.

## Updating a shared version

First phase: each export is a new item that can be shared through its own link. Later phase: explicitly select an export to update an existing link. Do not change the target while rendering or uploading is incomplete.

Reserve the full temporary space for the new revision while retaining the published one. If it does not fit, explain the temporary capacity required and preserve the previous link; do not delete the previous version to force an update. Confirm bytes, compare-and-swap the published revision, then clean up the replaced revision when it has no references. Cleanup counts against quota until complete. If two devices update from the same revision, the second receives a conflict; never use silent last-write-wins.

No unlimited history: retain only referenced revisions and those needed by an operation in progress. The server reconciles physical objects and accounting; repeated cancellations/deletions must not release capacity twice.

## Security and cost implementation constraints

Reserve quota transactionally before issuing tickets; limit the number and lifetime of pending uploads per account. Verify actual length, supported type, and integrity; prevent overwrites through reused tickets. Rejecting at confirmation does not prevent an oversized object from already consuming storage: test a real restriction during the R2 write. If presigned PUT cannot enforce the required limit with the chosen client, design an alternative compatible with Worker limits before launch, without assuming a 1 GB proxy request works.

Provide idempotent cleanup of expired pending uploads, invalid objects, and account deletions, with retries and alerts. A reservation must not expire while a valid ticket can still write unless a strategy accounts for that risk. Deletion tombstones prevent resurrection by delayed tasks. Do not persist signed URLs as identity or log them. Keep the private bucket separate from the public installer bucket.
