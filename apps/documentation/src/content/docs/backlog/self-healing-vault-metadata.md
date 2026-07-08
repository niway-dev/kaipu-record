---
title: Self-healing vault media metadata (duration + thumbnail)
description: Derive duration and thumbnail from any recording file on disk when the sidecar is missing. Fixes imported/interrupted recordings showing 0:00 with a disabled editor, and edited videos that never get a thumbnail. One shared thumbnail primitive, two consumers.
---

# Self-healing vault media metadata

> **Status: 🔵 Proposed.**
> Design agreed. Ships as two PRs (see [Rollout](#rollout)). One shared thumbnail
> primitive fixes both bugs; the imported-file heal consumes it.

## Problem

The Library shows recordings whose duration/title/thumbnail come **only** from a
per-recording sidecar the app writes at record time — it never re-derives them from
the video file itself. Two independent situations leave a valid `.mp4` in the vault
without that sidecar data, and both produce broken Library cards:

|                | **Bug 1 — imported / interrupted recording**                                                                                                                                 | **Bug 2 — edited video**                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| How it happens | A file is dropped into the vault by hand, **or** a recording's `finalize` is interrupted (app quit / crash / no battery) after the `.mp4` is written but before the sidecar. | Every time a user edits a video and exports it. |
| Duration       | Missing → card shows `0:00`                                                                                                                                                  | Correct (`plan.totalDuration`)                  |
| Thumbnail      | Missing → generic film-strip icon                                                                                                                                            | Missing → generic film-strip icon               |
| "Edit video"   | **Disabled** (gated on `durationSeconds > 0`)                                                                                                                                | Works                                           |
| Frequency      | Rare (import) / occasional (interrupted)                                                                                                                                     | **Reproduces on every edit**                    |

The unifying observation: **a valid video file exists in the vault but its
duration and/or thumbnail were never derived from it.** Both bugs are the same
capability gap, so they share one fix.

## Root causes (verified in code)

### The vault metadata model

`src/main/library/library-vault.ts` — the filename is the id; metadata lives in a
`.kaipu/<id>.json` sidecar (`{ title?, durationSeconds?, createdAt? }`) plus a
thumbnail `.kaipu/<id>.jpg`. There is **no database**.

`describe()` (`library-vault.ts:72-99`) reads size live from `stat()` but takes
duration **only** from the sidecar:

```ts
durationSeconds: meta.durationSeconds ?? 0,   // library-vault.ts:89 — 0 when no sidecar
```

The `.mp4` is never probed on read. The app doesn't even probe at record time — a
normal recording's duration comes from the recording clock (`recorder-store.ts:252`,
`elapsedMs`), and its thumbnail is captured live from the screen stream
(`recorder-engine.ts:275`, `captureThumbnail`). "Read metadata from an existing
file" is a brand-new capability that this work introduces.

### Bug 1 — no sidecar → 0:00 → editor disabled

A hand-placed or interrupted `.mp4` has the right filename but no
`.kaipu/<id>.json`, so `describe()` yields `durationSeconds: 0`. That trips the
editor guard:

```ts
// src/renderer/src/pages/library-detail/library-detail-page.tsx:87
const canEditVideo = video.durationSeconds > 0;   // false → button disabled, editVideo() early-returns
```

The `.mp4` itself is fine (its container header holds the true duration — the HTML5
player reads it correctly). Only the app's sidecar is missing.

### Bug 2 — edit-export thumbnail capture always returns `null`

The edit-export path reuses the exact same `recordingFinalize` contract as live
recording (`use-video-export.ts` → `recording-writer.ts` `finalize`), which writes
the thumbnail **only if one is provided**:

```ts
// src/main/recording/recording-writer.ts:118-123
await vault.writeMeta(id, { title, durationSeconds, createdAt });   // always runs → duration OK
if (meta.thumbnail) await vault.writeThumbnail(id, Buffer.from(meta.thumbnail));   // skipped when null
```

The export path passes `thumbnail = await captureExportThumbnail(...)`, which
reliably resolves to `null`:

```ts
// src/renderer/src/features/video-editor/export/export-thumbnail.ts:51-58
await Promise.race([
  new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve();
    video.currentTime = 0;   // no-op: a freshly loaded <video> is ALREADY at 0
  }),
  timeout,                   // 2s → wins the race → rejects → catch returns null
]);
```

A just-loaded `<video>` is already at `currentTime === 0`, so assigning `0` fires no
`seeked` event; the seek promise never resolves, the 2s timeout rejects, and the
`catch` returns `null`. `writeThumbnail` is therefore never reached. The export
mints a **new** vault id each time (`recording-writer.ts:107`), so nothing is
overwritten — the new entry simply never gets a thumbnail.

## Design

### The shared primitive: file → thumbnail (renderer)

Both bugs need "decode one frame of a video file on disk and turn it into a JPEG."
Decoding H.264 requires a video decoder, which only exists in the renderer
(Chromium `VideoDecoder` / WebCodecs); the main process is plain Node and has none.
The repo already decodes frames from a file the correct way — mediabunny
`CanvasSink`, which decodes a frame at an exact timestamp **without** the flaky
`<video>.seeked` seek that breaks Bug 2 (`use-source-thumbnails.ts:37-43`).

Extract one reusable module:

```
src/renderer/src/features/library/media/generate-thumbnail.ts

generateThumbnail(blob: Blob, atSeconds: number): Promise<ArrayBuffer | null>
  fetch/receive Blob
  → new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  → track = getPrimaryVideoTrack()
  → new CanvasSink(track, { width: THUMB_WIDTH })
  → first canvas from canvasesAtTimestamps([clamp(atSeconds, 0, duration)])
  → canvas.toBlob("image/jpeg", 0.7) → ArrayBuffer
```

Cosmetic and failure-tolerant: returns `null` on any decode error (never throws).
Pick a representative frame time (e.g. `min(1, duration/2)`) rather than exactly 0
so the poster isn't a black lead-in frame.

**Consumers:**

1. **Bug 2 fix** — replace `captureExportThumbnail` (the `<video>` seek) with
   `generateThumbnail(sourceBlob, t)`. The export path already fetches the source
   Blob (`use-video-export.ts:100`), so the input is in hand. The result flows
   through the unchanged `recordingFinalize` → `writeThumbnail`.
2. **Bug 1 thumbnail** — the imported-file heal calls the same primitive.

### Imported-file heal: all in the renderer (SINGLE)

The orphan heal runs entirely in the renderer, deriving **both** duration and
thumbnail in one pass, then persisting via IPC. This keeps mediabunny in a single
process (no main-process bundling), reuses the already-proven `BlobSource` path,
and shares the thumbnail primitive with the Bug 2 fix.

```
src/renderer/src/features/library/media/heal-orphan-metadata.ts

healOrphan(id): Promise<{ durationSeconds, thumbnail } | null>
  blob = await fetch(`kaipu-media://recording/${id}`).blob()
  input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  durationSeconds = Math.floor(await input.computeDuration())   // demux only, no decode
  thumbnail = await generateThumbnail(blob, min(1, durationSeconds / 2))
  → IPC: persist to sidecar (writeMeta + writeThumbnail)
```

Orchestration (a small hook, kept out of `use-local-library`): after `list()`
resolves, find orphans and heal them in the background with a small concurrency
pool (2–3 at a time). Fires on Library mount **and** on the Sync button — Sync
already maps to `refresh()`. This realizes model **A** (self-healing on scan): the
user never has to know a manual step exists.

**Orphan predicate:** `kind === "recording"` AND (`durationSeconds === 0` OR
`thumbnailUrl === null`). Screenshots (`kind === "screenshot"`, also
`durationSeconds 0`) are **excluded**.

**Persistence IPC:** add a `libraryBackfillMeta(id, { durationSeconds, thumbnail })`
channel that calls the existing `vault.writeMeta` + `vault.writeThumbnail`. Also
persist `title` (humanized id) and `createdAt` (`stat().birthtimeMs`) so the sidecar
is complete and stable after healing.

### What deliberately does NOT change

- **The editor guard** `canEditVideo = durationSeconds > 0` stays as-is. After
  healing it passes. If a probe fails (corrupt / unsupported file), duration stays
  `0` and the button stays disabled — which is now **correct**, and the existing
  `durationUnreadable` tooltip finally tells the truth.
- **Duration in main via `FilePathSource`** was considered and rejected: it avoids a
  `0:00 → 0:54` flash but splits mediabunny across two processes and adds
  main-process bundling risk, to save a cosmetic flash on a rare path.

## Trade-offs & edge cases

- **Cosmetic pop-in.** An orphan briefly shows `0:00` / generic icon before the
  renderer heal lands, then updates. Acceptable for a rare path.
- **Probe failure.** On any mediabunny error: log, write **nothing** (no sidecar),
  leave the orphan. Re-probed cheaply next scan; self-corrects. Never cache a bad
  `0` — that would poison a transient read error permanently.
- **`.kaipu/` lost wholesale** (backup/restore, cloud-sync that skips the hidden
  folder, moving the vault to another Mac): every recording becomes an orphan and
  self-heals on next scan. This is the interrupted-recording resilience case
  generalized, and the main reason heal is automatic rather than Sync-only.
- **Concurrency.** Cap the heal pool so a lost-`.kaipu` vault of dozens of files
  doesn't decode everything at once.

## Testing

- **Unit** — orphan predicate (recordings only, excludes screenshots; triggers on
  missing duration or missing thumbnail); heal-result → IPC persistence with
  mediabunny mocked; `generateThumbnail` returns `null` (not throws) on decode
  error.
- **E2E (Playwright + Electron harness)** —
  - Bug 1: drop a fixture `.mp4` with no sidecar into a temp vault → load Library →
    assert `.kaipu/<id>.json` written with `durationSeconds > 0`, `.kaipu/<id>.jpg`
    exists, and "Edit video" is enabled.
  - Bug 2: edit + export a fixture recording → assert the new entry has a
    `.kaipu/<id>.jpg` (no longer a generic icon).

## Rollout

Two PRs, same feature branch lineage, shared primitive born where it's first needed:

- **PR-A — Fix editor thumbnail (Bug 2), high priority.** Introduce
  `generateThumbnail` (the shared primitive). Replace `captureExportThumbnail` with
  it. Self-contained, ships value immediately, and every edit gets a thumbnail.
- **PR-B — Heal imported/interrupted recordings (Bug 1).** Add `computeDuration`
  probe + `heal-orphan-metadata` + `libraryBackfillMeta` IPC + the background heal
  hook. Consumes PR-A's primitive for the thumbnail. Relies on the guard staying
  as-is so healed files become editable automatically.
