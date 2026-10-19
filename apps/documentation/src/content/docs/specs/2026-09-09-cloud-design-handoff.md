---
title: Claude Design — cloud, sharing, and video locations
description: Ready-to-use design brief with surfaces, states, messages, and prototype scenarios.
---

> **Historical plan numbers.** Capacities in this document are as of its date. Current values: [Plans — Free and Pro](/features/plans/).

# Claude Design brief

Date: 2026-09-09. Design a proposal and prototype; these features are not implemented. This document is self-contained for design. For binding details, consult [product](/specs/2026-09-09-cloud-product/) and [data and editing](/specs/2026-09-09-cloud-data-model/).

## Assignment

Adapt Kaipu Record, a desktop app for quickly recording, capturing, and editing presentations/documentation. Its core experience works locally, without an account. Cloud allows users to upload a private copy and voluntarily share a link. Design settings, library, detail, editor/export, transfers, storage management, and a public playback page.

Do not design a Google Drive, collaborative folders, active billing, complex version history, or a cloud editor. Free includes 1 GB total; the future plan includes 25 GB. Maximum video size: 1 GB; proposed screenshot maximum: 25 MB. Do not insert nonfunctional purchase buttons.

## Visual principles and language

Preserve the existing interface: Geist, neutral surfaces, compact density, 4–8 px radii, and dark/light themes. Use `packages/tokens/src/` as the token source. Magenta is for actions; green for confirmation, yellow for attention, red for errors/destruction. Do not rely on color alone. The [general design brief](/briefings/design-brief/) guides the aesthetic, but this assignment explicitly requires location labels requested by the founder.

One entry per logical video, even with two copies. Cards and rows use a short label with an icon and text; detail views explain revisions/projects. Do not fill each card with five badges. Priority: location always visible; active transfer on a second line; editing or version differences explained contextually in the detail view.

All documentation, prototype copy, labels, and design deliverables must be in English, regardless of the language used in conversation with the founder. Prepare layouts for localization and longer strings. Use Cloud consistently as a product term. Do not use Synced to imply equality when local changes exist; do not label an MP4 Backed up if its project is not stored in cloud.

## Required surfaces

### 1. Settings → Storage and cloud

Keep the local folder selector and Open folder action. Add modes as mutually exclusive options, not three toggles:

| Option           | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| Local only       | Save files on this device. Do not upload files automatically.        |
| Manual upload    | Choose which videos and screenshots to upload to cloud.              |
| Automatic upload | Save locally and upload a copy of new files when space is available. |

Without an account: local remains usable; cloud modes explain Sign in to use cloud, without blocking recording. Creating an account does not select automatic upload. When enabling automatic upload: We will not upload existing files or create links automatically. The preference applies to this device.

Show account, total capacity, a bar distinguishing used and reserved space, available capacity, and Manage storage. Design loading, stale data, recoverable error, expired session, unavailable beta access, and globally suspended uploads. Do not show 0 GB when the query fails.

### 2. Library: cards and rows

Filters: All, On this device, In cloud; the latter two overlap for files with both copies. Show consistent counts and a single entry in All. Add an attention/transfers filter only if density warrants it.

| Visible label       | Meaning                                             | Contextual primary action |
| ------------------- | --------------------------------------------------- | ------------------------- |
| Local               | File available here, without a confirmed cloud copy | Upload to cloud           |
| Cloud               | Media available only in cloud                       | Download to edit          |
| Local and cloud     | A copy exists here and in cloud                     | Edit; Share as secondary  |
| Location unverified | A location could not be confirmed                   | Retry                     |

Do not automatically interpret loss of disk access as Cloud only. When offline, retain known cards, cached thumbnails, and a notice. The page must not become Library empty while fetching cloud data.

Card/menu actions: Upload to cloud, Share, Download to edit, Show in folder, Remove local download, and Delete cloud copy, depending on availability. Do not offer Show in folder without a local file. Avoid an ambiguous trash icon. Disabled states require an accessible explanation.

### 3. Video detail

Show location, local/cloud sizes when they differ, last upload date, and privacy. Local and cloud does not necessarily mean the same version: add Local changes · The shared version has not changed when applicable. Distinguish an editing draft from a newly exported file.

Cloud-only: explicit Internet playback, Download to edit as the CTA, download size, and available disk space. After downloading, open the editor without duplicating the card. If only a render is preserved: You can edit this video. The original project's layers and resources are not stored in cloud.

If the complete session and source are local: Editing project available on this device. If dependencies are missing: Project files are missing; do not imply that downloading the render restores them.

### 4. Editor and export

The editor works with local files. Do not add network spinners that block all editing when an independent upload fails. Show Saved on this device separately from cloud copy status.

First phase: exporting creates a new local video related to the original; offer Upload to cloud and then Share. In automatic mode, the finalized export is queued as a private copy, never published automatically. Later phase: Update shared version, with a summary of the affected link and replacement confirmation. The previous link works until the update finishes.

### 5. Sharing

Dialog with a preview of the selected revision, Anyone with the link can view this video, Create link, and the preceding private state. If there is no cloud copy, present Upload and create link with size/quota; this explicit action authorizes both steps. In Local only, ask the user to enable manual upload; do not silently change settings.

States: preparing upload, uploading, verifying, creating link, link ready, upload error, link creation error, and clipboard error. If upload finishes but link creation fails, show Video saved in cloud. We could not create the link and retry only that step. Show Copied only after the clipboard confirms success.

Active link: copy and revoke. Revoking preserves the file; deleting the cloud copy breaks its link. Explain that revocation prevents new access but does not delete copies others have downloaded.

### 6. Transfers and notices

A compact panel accessible from the library lets users inspect multiple tasks without blocking the app. Keep location visible even if a transfer fails.

| State              | Example copy                                            | Controls                          |
| ------------------ | ------------------------------------------------------- | --------------------------------- |
| Queued             | Waiting to upload                                       | Cancel                            |
| Preparing          | Preparing video…                                        | Cancel                            |
| Uploading          | Uploading · 120 of 200 MB · 60%                         | Cancel                            |
| Verifying          | Verifying upload…                                       | No false success confirmation     |
| Downloading        | Downloading · 60%                                       | Cancel                            |
| Offline            | Pending · Offline                                       | Cancel; retry on reconnect        |
| Session expired    | Sign in to continue                                     | Sign in                           |
| Insufficient quota | Free up 350 MB to continue                              | Manage storage; Retry             |
| File too large     | This video exceeds the 1 GB limit                       | Keep local; export a smaller file |
| Disk full          | Not enough space to download this video                 | Open folder settings; Retry       |
| Error              | We could not upload this file. Your local file is safe. | Retry; Cancel                     |
| Canceling          | Canceling upload…                                       | Wait for confirmation             |
| Deleting           | Deleting cloud copy…                                    | No optimistic quota reduction     |

Show actual byte progress only when known. Preparation/verification use indeterminate indicators. Do not invent percentages, speed, or time remaining. 100% of bytes sent transitions to Verifying, not Shared. Canceling never deletes the source.

At 50% capacity: bar only; 75%: subtle notice; 90%: prominent notice. Group multiple pending files into one notice. No repeated toasts during recording. After freeing capacity, offer an explicit Retry pending uploads action in the MVP; automatic mode may resume pending tasks that were not canceled/excluded.

### 7. Storage management and deletion

Cloud object list sortable by size, with location and link status; selection shows the exact space that would be freed, not just a video count. Calculations include auxiliary objects.

Delete cloud copy dialog: Your local file will be kept. The shared link will stop working, only when both statements are verified. For cloud-only files: This is the only available copy Kaipu knows about; offer Download first as an alternative. If the location is uncertain, say so and do not promise local preservation.

Remove local download dialog: You can download this video again from cloud. Its link will keep working. Show only when an identical replica is recoverable and the action does not compromise local editing. If it is a project source, block the action with an explanation. Do not use the current generic deletion operation.

### 8. Public page

Centered player, title, loading state, recoverable error, and an unavailable view for revoked/deleted links. No private account information or promotion of related files. Do not require registration to view a valid link. Failed loading must not reveal whether a token belonged to a private file. Define mobile behavior, keyboard interaction, and accessible controls.

## Accessibility and deliverables

Design focus/keyboard behavior, icon labels, clear targets, contrast in both themes, reduced motion, and screen-reader progress announcements without announcing every byte. Dialogs return focus to their trigger; destructive actions do not receive default focus. Tooltips supplement rather than replace essential labels.

Deliver screens in both themes, card/row variants, components and states, a flow prototype, and implementation notes labeled MVP or later phase. Adapt to the shell's minimum supported size and check long titles. Do not invent new navigation when an existing section is sufficient.

Required journey: record locally → upload manually → verify → create/copy link → remove an eligible local download → see Cloud label → download to edit → see Local and cloud. Add variants for insufficient quota, connection failure, last remaining copy, local project without backup, account switching, and a failed update that preserves the previous link.

Paths to inspect the current design: `pages/settings/settings-page.tsx`, `pages/library/library-page.tsx`, `features/library/components/video-card.tsx`, `video-row.tsx`, `storage-meta.tsx`, and `features/video-editor/components/export-dialog.tsx`, all under `apps/kaipu-record/src/renderer/src/`. The current implementation is a visual reference; it does not prove cloud is connected.
