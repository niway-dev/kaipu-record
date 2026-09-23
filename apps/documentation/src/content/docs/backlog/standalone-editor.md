---
title: "Idea — a standalone editor: open any photo or video, join two videos"
description: "Owner idea: an editor window that does not start from a Kaipu capture — open an existing image or video from disk, edit it with the same tools, and join two videos into one. Large; needs its own brainstorming before any plan."
---

# Standalone editor (open any media, join videos)

> **Status: ⚪ Idea** (2026-09-23). Owner: "a new window or screen for screenshots or the
> editor, so I can edit photos or videos from our editor even without our own material,
> or to join two videos." Recorded here so it is not lost; **not** designed. It is an
> architectural change and gets its own brainstorming session before a spec.

## What it would mean

Today both editors are reached **from a capture**: the screenshot editor from ⌃⌘X or a
Library item; the video editor from a Library recording. Every assumption downstream —
`derivedFromAssetId`, the vault sidecars (`.kaipu/<id>.edit.json`), the cursor track, the
export writing next to its source — starts from "there is a recording in the vault".

A standalone editor breaks that in three places:

1. **Import**: an "Open…" that copies (or references) an external `.mp4` / `.png` into
   the vault as a first-class item, so every existing flow keeps working unchanged.
   Probably the cheapest 80 %: once the file is a Library item, both editors already
   work on it (no cursor track → no auto-zoom proposals, which is fine).
2. **Multi-source timelines** ("join two videos"): the scene model has one source. The
   main track would need `ClipItem.sourceId`, the export worker would decode from N
   inputs, the preview would swap `<video>` elements at boundaries, and audio would need
   resampling when the sources differ. This is the real cost.
3. **Entry point**: a sidebar entry / menu "New project" that opens the editor with no
   capture, or with a picked file.

## Questions for the brainstorm

- Is "import into the Library, then edit as usual" enough for the photo/video-from-disk
  case? (Likely yes, and it is a small PR.)
- For "join two videos": is it appending recordings end-to-end (concat, same
  resolution/fps) or arbitrary mixing? The first is far cheaper than the second.
- Does this stay desktop-only, or does it change the cloud catalog (an imported item
  has no `assetId` origin)?

## Suggested first slice (if picked)

**Import into the Library** only: Open… → copy into vault → item with `kind` inferred →
opens in the matching editor. No scene changes, no multi-source. Then reassess the
concat case as its own item.
