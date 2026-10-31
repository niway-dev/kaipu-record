---
title: "Prepare: drop a video from outside"
description: "NIW2-587: Prepare with no recording is a drop zone. A video dropped on any Prepare screen is imported into the Library (NIW2-579) and opened in Prepare with the selected destination."
---

# Prepare: drop a video from outside

> **Status: 🟢 Ready to validate** (2026-10-30). NIW2-587, branch
> `feature/niw2-587-prepare-drop-zone`, stacked on the two-column Prepare (NIW2-583) and
> carrying the Library import (NIW2-579) until that lands in the stack. Unit-tested; not run
> in Electron yet — owner QA pending.

Design: Claude Design project "Kaipu Prepare", section 5 "Bring a video from outside", board
"Drop zone".

## What it does

Prepare also works on a video Kaipu did not record — a phone clip, a Zoom recording, a file
a colleague sent. It becomes a master in the Library, then Prepare opens on it.

- **`/prepare` (no recording)**: the left column lists the destinations as usual, without
  sizes (there is no source to estimate from) and with nothing selected unless `?to=` names
  one. The right column is a large dashed pink drop zone: "Drop a video to prepare it", what
  can be dropped, and two buttons — **Choose a file…** (the Library's import dialog) and
  **From your Library**. Back goes to the Library.
- **Dropping a video anywhere on Prepare** — the no-recording screen, a recording's Prepare
  screen, or onto the left footer **Prepare another video** — imports it and navigates to
  `/prepare/<newAssetId>`, keeping the selected destination as `?to=`. Several videos: all
  are imported, Prepare opens on the first, and a toast says how many more are in the
  Library. Files that are not videos are skipped with the Library's toast.
- **Prepare another video** (the footer) now opens `/prepare?to=<selected>`; on the
  no-recording screen it opens the file dialog. Its hint is back to "Drop a file here or
  from your Library". It lights up while files are dragged over the window.
- **Entry point**: a **Prepare a video** button in the Library header, next to Import a video.
  No sidebar entry.

## How it is built

- There is one import path. `usePrepareImport` (`features/prepare/use-prepare-import.ts`)
  wraps the Library's `useImportVideos` and `useFileDrop` (NIW2-579): the same main-side
  validation and atomic copy into the vault. `useImportVideos` takes an optional
  `onImported` that replaces its "is in your Library" toast; failures are still reported by
  the hook.
- While Prepare is mounted, the whole window takes file drops, so a drop never makes
  Electron navigate the window to the file (the default for an unhandled drop). The hook sits
  above every Prepare state (loading, not found, not preparable), so those screens take a
  drop too.
- After an import, Prepare re-lists the Library before navigating, so the next screen
  already holds the new video rather than a brief "File not found".
- The destination to carry over is the one picked on the screen, else the one in the URL.
  With a recording and no pick, no `?to=` is added: the next screen defaults to YouTube
  either way.

## Open questions

- An import from Prepare opens the new video without the Library's "Open" toast. If the
  owner wants to know where the file went, a "Show in Library" action could be added to a
  toast after the navigation.
