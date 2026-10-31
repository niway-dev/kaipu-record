---
title: "Export: its own screen and rail entry (replaces Prepare)"
description: "Export replaces Prepare: the video fixed at the top, what changes in the middle, the destinations in one row at the bottom, and its own EXPORT entry in the rail. The Library stops importing; Export is the door for outside videos."
---

# Export: its own screen and rail entry (replaces Prepare)

> **Status: 🟢 Ready to validate** (2026-10-30). Branch `feature/export-screen`, stacked on
> `feature/niw2-587-prepare-drop-zone` (#459). No Linear ticket: the workspace hit its issue
> limit. Unit-tested; not run in Electron yet — owner QA pending.

Design: Claude Design file "Kaipu Export v3", section 3 "EXPORT · ITS OWN SCREEN".

## Why

Owner feedback on Prepare:

1. You could not tell which video you were preparing.
2. The video must stay fixed while the destinations scroll on their own, since there can be
   many destinations.
3. The Library had too many jobs: the "Drop a video here" strip and the "Prepare a video" and
   "Import a video" buttons. Export is now the door for outside videos.

## What it does

- **Rail.** A new **EXPORT** entry (upload icon) directly under EDITOR. Its badge counts the
  copy being exported right now plus finished copies not shown yet; it moved here from
  LIBRARY. Opening Export or the Library clears the finished ones.
- **Routes.** `/export/:assetId` and `/export`. Old `/prepare/:assetId` and `/prepare` URLs
  redirect there with the query kept (`?to=`). `preparePath()` / `prepareNewPath()` keep their
  names and signatures and now return Export URLs, so every existing caller lands on Export.
- **Header (fixed).** A 96×54 thumbnail, the title (ellipsis), ORIGINAL, and the real
  duration, size and file size with "copies are made from this file; it never changes".
  **Change video** lists the Library's originals and reopens Export on the one picked,
  keeping the destination.
- **Stage.** With nothing picked: the fox and "Where is it going?". With a destination:
  its logo, "For …" and one sentence. Upload destinations (YouTube, TikTok · Reels,
  LinkedIn · Feeds) show **Upload size** — 1440p / 4K with real estimates for YouTube, the one
  canvas plus Fill / Fit for the others — and an illustrated 1080p vs this-copy text crop.
  Light destinations (GitHub · Jira, Slack · Discord, Email · anywhere) show the size bar;
  GitHub's is drawn against the 10 MB free limit (`githubPlans().free`). Then the pink Export
  button with ↵. The stage scrolls on its own if the window is too short.
- **Destination row (fixed).** "WHERE IS IT GOING?" with the legend (amber: bigger on
  purpose; teal: light) and seven equal cards. The row scrolls sideways on its own when the
  cards do not fit. ←/→ move the selection; Enter exports.
- **No video.** "Export" header, a dashed drop zone ("Drop a video here", **Pick from Library**,
  **Browse files…**) and **Recent exports**: the copy in progress with its percentage, then
  the newest finished copies, three in all. A video dropped anywhere on Export is imported
  into the Library and opened on Export with the selected destination.
- **Library.** No drop strip, no Prepare / Import buttons, and it no longer takes window
  drops.

## Decisions and limits

- **Email is a destination of its own** over the same preset as Slack · Discord (Balanced),
  because the design has seven cards and there are six presets. A Balanced file still reads
  as the chat copy (`destinationOfPreset`), and both cards show "Ready" for it. The
  progress and ready cards say "your export" for an Email copy, since their ICU `select` has
  no email branch yet (owned by the toasts branch).
- **No "About N minutes."** The design's encode-time estimate has no measurement behind it in
  the app yet, so the line says only that it runs in the background.
- **After Export starts, the screen stays.** The progress card shows it, and another
  destination is one click away. Prepare used to go back to the recording.
- **Code layout.** The screen is `pages/export/`. The shared logic stays in
  `features/prepare/` (destinations, estimates, `usePrepareCopy`, `usePrepareImport`) so the
  sibling branches that import it merge cleanly. The screen's strings are the `export`
  i18n namespace; the destination vocabulary other screens use stays under `prepare`.

## Not in this change

The recording page layout, the post-recording card, the Library grid cards and the export
progress / ready toasts belong to sibling branches.
