---
title: Optional cloud — product, quotas, and file safety
description: Proposed specification for manual and automatic uploads, file locations, and share links.
---

# Optional cloud for Kaipu

Date: 2026-09-09. Status: implementation specification; this does not describe shipped functionality. It captures decisions from the founder conversation. Additional implementation proposals are stated explicitly in this document.

## Documents and reading order

1. This document: product behavior and scope.
2. [Identity, revisions, and .kaipu](/specs/2026-09-09-cloud-data-model/): technical contract and editing recovery.
3. [Claude Design brief](/specs/2026-09-09-cloud-design-handoff/): screens, labels, states, and copy; ready to hand to the designer.
4. [Implementation plan](/plans/2026-09-09-cloud-delivery/): phases, dependencies, and acceptance criteria.

These specifications make the cloud backlog concrete; they do not mark its pending work as completed. They do not include enabling payments or deploying changes. Documentation and product copy are always written in English; the language of the founder conversation does not change that convention.

## Product promise

Kaipu supports local recording, editing, and export without an account. Cloud is an optional capability for keeping a playable copy and sharing a link. It is not a virtual drive, a collaborative editor, or a complete backup of the editing project.

The library shows one entry per logical file, even when copies exist in two locations. Users can always tell which copy they have, which version they are sharing, and what they need to download to edit. The application derives these states from disk and server evidence; AI is not required.

## Upload modes

The preference belongs to a device and account; signing in on another device does not silently change it. Without an account, the effective behavior is Local only. When enabling cloud, the recommended mode is Manual upload; signing up never grants permission to upload automatically.

| Mode             | Newly finalized files                               | Existing library           | Downloads              |
| ---------------- | --------------------------------------------------- | -------------------------- | ---------------------- |
| Local only       | Stay local                                          | Not uploaded               | Explicit requests only |
| Manual upload    | Stay local                                          | Upload to cloud button     | Explicit requests only |
| Automatic upload | Saved locally first, then copied privately to cloud | Not uploaded retroactively | Explicit requests only |

Local only does not initiate automatic media transfers, including remote previews. It may display a cached catalog and fetch account metadata; it does not disconnect the entire application from the Internet. The Upload action explains how to enable Manual upload. Viewing or downloading a remote file remains an explicit action.

Automatic upload covers new recordings, screenshots, and exports finalized inside Kaipu. It does not watch or automatically import files placed in the folder externally. It never uploads temporary files, editing sessions, or files still being written. It does not publish links automatically.

Switching to manual/local stops new automatic tasks and cancels queued automatic tasks. An active automatic transfer is safely canceled and cleaned up on the server; an already confirmed copy is not deleted. Manually requested transfers offer an explicit choice to continue or cancel when switching to Local only. Changing modes does not delete copies, revoke links, or upload the existing library.

## Capacity and restrictions

Initial proposal: Free includes 1 GB total; a future plan includes 25 GB total, without enabling charges now. Maximum video size: 1 GB. Proposed screenshot limit: 25 MB per image. Use decimal commercial units: 1 GB = 1,000,000,000 bytes; display MB/GB consistently and always calculate in integer bytes. This limit will replace the backend's current declared-size limit of 2 GiB.

The quota includes persisted media and thumbnails. The per-file limit is independent of the quota: the server communicates the full required size, including auxiliary objects, before reserving capacity. Do not promise that a file exactly equal to the quota fits if its auxiliary objects also consume space.

Capacity means occupied space, not a monthly replenishing allowance. The backend is authoritative: used bytes + pending reservations + the new reservation cannot exceed the limit. Modifying the client, using two devices, or issuing simultaneous requests must not bypass the quota.

Illustrative example without thumbnails: four 200 MB videos occupy 800 MB; a 550 MB video requires freeing another 350 MB. Deleting two 200 MB cloud copies allows the upload and leaves 950 MB occupied. Actual calculations include the bytes of every object.

The UI shows used, reserved, and available capacity without presenting an estimate as confirmation. If the quota request fails, show Last available data and do not independently authorize uploads. The server still checks every operation.

| Threshold                  | Presentation                                                 |
| -------------------------- | ------------------------------------------------------------ |
| 50%                        | Subtle indicator, no toast                                   |
| 75%                        | Nonblocking notice once when crossing upward                 |
| 90%                        | Prominent notice and Manage storage                          |
| The next file does not fit | Per-file message with missing capacity, even below 90% usage |

Use committed capacity (used + reserved) to anticipate insufficient space. If an upload crosses several thresholds, show only the highest. Persist notices per account/device and rearm them after usage falls at least five percentage points below the threshold to avoid repeated notifications.

The beta starts with controlled access and configurable global capacity; 100 accounts with 1 GB each is an initial proposal, not an unlimited public launch. The global switch stops new tickets, preserves reads/deletions, and accounts for reservations already issued. Billing alerts do not replace this control. Existing storage continues to cost money even when new uploads stop.

## Sharing

Uploading creates a private copy. Sharing requires separate consent and creates a link accessible to anyone who has it, without requiring the viewer to have an account. State this in the dialog. Offer copying and revocation; never claim that a copy already downloaded by a viewer can be retrieved or revoked.

The link points to a published, playable revision, not the editor draft. Editing does not change the link. Update shared version is an explicit action that updates the stable link's target only after confirming the new file. On failure, the previous version remains available. Revocation stops new access; already issued read URLs have a short validity window that must be defined and communicated without promising absolute instantaneous revocation.

The public page exposes only the published media and selected minimal metadata. Never expose local paths, private originals, sessions, .kaipu resources, owner email, or storage keys. No public listing or intentional indexing. Server transcoding is outside the MVP; validate playback of supported formats.

## Deletion, space recovery, and restoration

| Action                | Local                                                              | Cloud                      | Link                   |
| --------------------- | ------------------------------------------------------------------ | -------------------------- | ---------------------- |
| Delete cloud copy     | Preserved                                                          | Deleted after confirmation | Stops serving the file |
| Remove local download | Only a recoverable replica without editing dependencies is removed | Preserved                  | Preserved              |
| Download to edit      | Downloaded and verified                                            | Preserved                  | Preserved              |
| Revoke link           | Preserved                                                          | Preserved                  | Revoked                |

Do not offer Delete from both in the MVP. For a local-only file, Delete local file is destructive and warns that no cloud copy exists. For a cloud-only file, Delete cloud copy warns that it deletes the last known copy. Do not confuse these actions with Remove local download.

Remove local download is allowed only when a verified cloud copy contains exactly the same bytes and the action cannot make local dependencies unrecoverable. Do not reuse the current deletion operation, which also removes sessions and resources. The [data specification](/specs/2026-09-09-cloud-data-model/) defines editing-project restrictions.

Deleting from cloud excludes the file from automatic upload for that account, including other devices. Only Upload again removes that exclusion. Releasing quota requires confirmed physical deletion; failures remain Deletion pending and are retried. Downloading does not consume additional cloud quota, but it requires disk space.

Do not automatically retry deletion of the last copy without retaining the user's explicit intent. Coordinate active downloads/editing with deletion: block deletion that would invalidate the operation and explain how to close or cancel it.

## Phased scope

First: Local only, Manual upload, combined catalog, safe downloads, independent deletion, and links. Later: automatic queue and explicit shared-version updates. Designs may represent the complete destination; each screen must identify functionality belonging to a later phase.

Outside the MVP: .kaipu project backup, bidirectional editing sync, merging changes across devices, shared folders, unlimited history, active payments, and automatic deletion to recover quota. Future plans do not justify promising recovery that does not exist today.
