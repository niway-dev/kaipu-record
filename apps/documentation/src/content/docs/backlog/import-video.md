---
title: "Import a video into the Library"
description: "NIW2-579: bring an outside video (phone, Zoom, another app) into the Library as a normal recording item — Import a video button, a drop zone, validation in main, an atomic copy into the vault, and an Imported marker."
---

# Import a video into the Library

> **Status: 🟢 Ready to validate** (2026-10-30). NIW2-579, branch
> `feature/niw2-579-import-video`. Unit-tested; not run in Electron yet — owner QA pending
> (steps in the PR's "How to test it yourself").

## What it does

A video made outside Kaipu — an iPhone `.mov`, a Zoom `.mp4`, a `.webm` from another
recorder — can be brought into the Library, where it becomes a recording item like any
other: it plays, opens in the editor, takes tags, and can be exported or prepared for a
destination (the "Prepare for…" screen, NIW2-578, works on any recording item).

Three ways in, all on the Library page:

- **Import a video** next to the Library title opens a file dialog (`mp4`, `mov`, `m4v`,
  `webm`; several at once).
- The dashed **Drop a video here — from your phone, Zoom, another app** strip opens the same
  dialog when clicked.
- **Dropping files anywhere on the window while the Library is open** imports them (the
  whole window, not one element: a file dropped where nothing handles it makes Electron
  navigate the window to it). The strip lights up while files are over the window. Files that are not videos are skipped, and a toast names them.

After an import, the Library re-lists. One video in: a toast offers **Open** (its page).
Several: a count. Every file that failed is named in an error toast with the reason; the
other files in the batch still import.

Imported items show **Imported** in the metadata line of the Library card and row, and
**IMPORTED** in the detail page's metadata, where a recording made in Kaipu shows
SCREEN / FRAME / WINDOW.

## How an imported item is stored

The same layout a finished recording has (`RecordingWriter.finalize`), no parallel format:

- `<vault>/imported-<YYYY-MM-DD-HH-MM-SS>[-n].<ext>` — a **copy** of the source. The
  source file is only read, never moved or modified
  ([ADR 0003](/architecture/decisions/0003-export-never-replaces-the-original/): the
  original is never touched). The container is kept (`.mov` stays `.mov`, lowercased), so
  the bytes in the vault are the bytes the user picked.
- `<vault>/.kaipu/<id>.json` — the sidecar: `title` (the source's file name without its
  extension), `durationSeconds`, `createdAt` (import time, so it lands on top of the
  Library), `derivedFromAssetId: null`, and
  `capture: { mode: "import", width, height, ratio: null }`.
- The poster (`.kaipu/<id>.jpg`) is made by the Library's existing orphan heal
  (`useOrphanHeal` → `backfillLocalRecordingMeta`): main has no video decoder, the renderer
  does (WebCodecs). The content hash stays lazy (`LibraryVault.ensureContentHash`), as for
  recordings.

**Why `capture.mode = "import"`** and not a new field: `capture` is the sidecar field that
says where a take came from, and it already carries the output size — exactly what the
Prepare screen needs to know about a source. A build that predates the mode reads the
value as `null` (`sanitizeRecordingCapture`), so older apps list the item as a plain
recording. No migration: every older item stays valid.

The vault now also lists `.mov` and `.m4v` files (`VIDEO_EXTS`), after `.mp4` and
`.webm`.

## Validation and atomicity (main process)

`src/main/library/import-video.ts`. Paths come from the dialog or from a drop
(`webUtils.getPathForFile` in preload); main trusts neither:

1. The payload must be a list of strings, at most 50 (`MAX_IMPORT_FILES`).
2. Each path must be absolute, have an importable extension, exist, be a regular file,
   and be readable. A file already inside the recordings folder is refused ("already in
   your Library") — otherwise dragging a Library card out and back in would duplicate it.
3. The file is copied (copy-on-write clone where the volume supports it) to a staged
   `<vault>/import.<ext>.<pid>.<uuid>.part` and fsynced. `.part` is never listed.
4. The **copy** is probed with mediabunny (already the app's media library; it demuxes in
   Node): it must parse, have a video track with a known codec, and a duration. Audio-only
   files and non-media files are refused.
5. Under a per-vault lock, a free id is picked (never the id of an existing file or of a
   sidecar left by "remove local copy"), the sidecar is written, then the staged copy is
   renamed in. A sidecar without media is never listed; media without a sidecar would be.
6. Any failure removes the staged copy, and the sidecar or media if they were written.
   Nothing half-imported remains.

Then `broadcastLibraryChanged()`.

Failure reasons (`ImportVideoFailureReason`): `unsupported-type`, `not-found`,
`not-a-file`, `unreadable`, `no-video-track`, `copy-failed`, `too-many`,
`already-in-library`. Each has a translated sentence in `library.importReason*`.

## Limits

- Main checks that the video **demuxes**, not that it **decodes** on this machine. A
  codec WebCodecs cannot decode here imports, then shows no poster (the heal retries on
  each scan) and fails in the editor. Not yet checked on real files: owner QA covers an
  iPhone HEVC `.mov`.
- The import runs file by file in main; a multi-gigabyte copy keeps the button in
  "Importing…" until it ends. There is no progress bar or cancel.
- `createdAt` is the import time, not the time the video was shot.
- Dropping a file while **another** page is open still does Electron's default (the
  window navigates to the file). Not changed here.

## Code

| Piece                         | File                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| Shared contract               | `apps/kaipu-record/src/shared/import-video.ts`                       |
| Validate, copy, probe, commit | `apps/kaipu-record/src/main/library/import-video.ts`                 |
| IPC + file dialog             | `apps/kaipu-record/src/main/library/index.ts`                        |
| Drop path bridge              | `apps/kaipu-record/src/preload/index.ts` (`pathForFile`)             |
| Import + toasts               | `.../renderer/src/features/library/hooks/use-import-videos.ts`       |
| Window drop target            | `.../renderer/src/features/library/hooks/use-file-drop.ts`           |
| Drop zone                     | `.../renderer/src/features/library/components/import-drop-zone.tsx`  |
| "Imported" label              | `src/shared/recording-capture.ts`, `video-card.tsx`, `video-row.tsx` |
