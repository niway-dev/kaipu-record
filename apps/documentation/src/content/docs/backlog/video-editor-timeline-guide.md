---
title: "Video editor — Timeline guide and the amber click color"
description: "A Timeline guide modal that explains each lane of the video editor timeline, and a secondary amber color so a recorded click no longer looks like a mini zoom."
---

# Video editor — Timeline guide and the amber click color

> **Status: 🟢 Ready to validate** (2026-11-09, Linear NIW2-679). Owner QA on the real app pending.

## Why

On a long recording, the thin pink tick in the **Zooms** lane (a recorded click) read as a tiny
zoom next to the pink zoom blocks. Kaipu had no secondary color and no legend to say otherwise.

## What shipped

- **Color rule.** Pink = something you edit. Amber = something you did while recording. Blues =
  context you do not touch. White = trim and cover. Clicks are now amber, through a new token,
  `--accent-secondary` (dark `#f5884a`, light `#c2570f`, in `packages/tokens`).
- **Timeline guide modal.** One tab per lane (Clips, Objects, Zooms, Privacy, Audio, Webcam), a
  fictional 0:40 sample timeline drawn with the real lane styles (the active lane lit, the rest
  dimmed), and the sections _What you see_, _Why it helps_ and _How to edit_, with Prev/Next.
  Esc closes it and focus returns to the control that opened it.
- **Entry points.** The ⓘ on a lane label (opens that lane's tab), a `?` button next to Tracks,
  a Guide button in the header (opens the first tab), and the **H** key (same). Fullscreen shows
  only the stage, so the `?` button is disabled there and H does nothing.
- **Objects.** The Annotations lane is now named **Objects** (label and copy only). Its guide
  covers boxes, arrows and text; images, GIFs and rows come later.

## Honest scope

The guide describes only what the editor does today. Audio covers muted ranges and says the
waveform shows loudness (no boost yet); Webcam covers the frame strip and hidden/custom blocks. A lane that grows a
capability grows its entry in `track-guide.ts` in the same PR.

## Out of scope (follow-ups)

- Amber click ring in the preview and the export.
- "Don't show tips" persistence, the compact popover variant, the modal animation.
- A step-by-step tour.
- Objects images, GIFs and multiple rows.
