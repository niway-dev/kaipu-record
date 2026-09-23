---
title: "Watermark — prettier mark, bottom-left"
description: "Proposal: redesign the free-plan watermark (the mark itself and how it is drawn) and move it from middle-right to bottom-left. The compositor already supports every corner; the work is the asset and the defaults."
---

# Watermark redesign

> **Status: 🔵 Proposed** (2026-09-23). Owner: "modify the Kaipu watermark so it is prettier,
> and put it somewhere else — bottom-left?" Parent:
> [roadmap → 6 — Watermark](./roadmap#6--watermark-free--paid-scalable-plan--shipped-live-gating-awaits-4).

## What exists

`features/watermark/watermark.ts` draws the asset through `watermarkRect()` with a
`WatermarkConfig`: `position` (`bottom-right` · `bottom-left` · `top-right` · `top-left`
· `bottom-center` · `middle-right` …), `opacity`, `heightRatio` (fraction of frame
height), `marginRatio`, and a `white` re-tint. Defaults today: `middle-right`, opacity
0.9, height 5.9 % of the frame, margin 3 %. The recorder's compositor draws it into the
frames of free-plan recordings; positions are already covered by unit tests.

So the move is a one-line default change. The "prettier" part is the design work.

## Proposal

1. **Position: `bottom-left`**, margin 2.5 % — the corner viewers' eyes rest on least,
   and the one the control bar / camera bubble never occupies (both live bottom-right by
   default). Keep `heightRatio` ≈ 5 %.
2. **The mark**: a single asset that reads at 5 % of a 1080p frame (≈ 54 px tall): the
   Kaipu play-mark glyph + wordmark, one colour, generous letter-spacing; ship it as SVG
   rasterised at the frame's scale (crisp on 4K) and keep the `white` tint for dark
   footage with a subtle 1 px dark outline or a soft shadow so it survives light footage
   too. Opacity 0.75 instead of 0.9.
3. **Nothing new in Settings** for free users; the watermark is the plan's price. Paid
   users keep no watermark. (A "position" picker for paid users is a separate idea.)

## Acceptance

- [ ] Free plan: the mark sits bottom-left with the same margin on 16:9 and 4:3 frames,
      legible on a white page and on a dark terminal, never overlapping the camera
      bubble at its default spot.
- [ ] Paid (dev override on): no mark.
- [ ] Existing `watermark.test.ts` position tests still pass; add one for the new default.
