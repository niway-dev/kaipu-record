---
title: "Watermark — quieter, bottom-right"
description: "Shipped: the free-plan watermark moved from middle-right to the bottom-right corner, lifted clear of the bottom edge, and lost a third of its opacity. Defaults only — the asset was already the right lockup."
---

# Watermark redesign

> **Status: 🟢 Ready to validate** (2026-09-24). Owner: "modify the Kaipu watermark so it is
> prettier, and put it somewhere else — bottom-left?" Parent:
> [roadmap → 6 — Watermark](./roadmap#6--watermark-free--paid-scalable-plan--shipped-live-gating-awaits-4).

> **2026-09-27.** These defaults now describe the **opt-in "Made with Kaipu" badge**
> (Settings → Recording, off by default). The free plan no longer burns a watermark; see
> [free tier without watermark](./free-tier-no-watermark).

## What shipped

Three default values in `features/watermark/watermark.ts`. No new asset, no new drawing
code, no Settings surface.

| Field         | Before         | After          |
| ------------- | -------------- | -------------- |
| `position`    | `middle-right` | `bottom-right` |
| `opacity`     | 0.9            | 0.75           |
| `marginRatio` | 0.03           | 0.05           |

`variant`, `tint` and `heightRatio` are unchanged. The compositor already draws a soft
drop shadow under the white silhouette, and that shadow is what keeps the mark legible on
light footage at the lower opacity.

The owner's call on the trade-off: **losing some presence is the intent.** This is a
provisional mark, and a watermark that sits over the content costs more than it protects.

### The corner took two passes

The first build put the mark at `bottom-left` with a 2.5 % margin, and the owner tried it
on a real recording. Two things came back:

- **Wrong side.** The corner the owner wanted was the right one; the original request said
  "bottom-left" by mistake. Their words: "it's my fault for not knowing left from right."
- **Too low.** At 2.5 % the mark read as stuck to the bottom edge, overlapping the bottom
  bar and dock belonging to the recorded content itself. The margin doubled to 5 %, which
  leaves a gap below the mark roughly as tall as the mark, and a test now pins that ratio
  so the next margin change cannot quietly undo it.

## Two corrections to the original proposal

The proposal that opened this page got two facts wrong. Both are recorded here so the
next reader does not re-derive them.

1. **The asset was already the right lockup.** The proposal asked for "the Kaipu play-mark
   glyph + wordmark" as new design work. `kaipu-wordmark.svg` (1974×352) is already exactly
   that — the glyph followed by "Kaipu Recorder". Nothing needed drawing.
2. **The corner rationale was backwards.** The proposal argued for bottom-left because
   "the control bar / camera bubble never occupy it (both live bottom-right by default)".
   In fact the camera bubble defaults to **bottom-left** (`camera-bubble-window.ts`, 40 px
   margin) and the control bar to **bottom-center** (`control-bar-window.ts`).

   Neither fact decides the corner. The bubble is `movable: true` with
   `-webkit-app-region: drag`, so the user puts it wherever they want and **no corner is
   safe by construction**. Corner choice is an aesthetic call, not a collision-avoidance
   one, and the owner picked bottom-right after seeing bottom-left on a real recording.

## Acceptance

- [x] Free plan: the mark sits bottom-right, scaled to frame height, on any aspect ratio.
- [x] Existing `watermarkRect` position tests still pass; four new tests pin the default
      corner, the opacity ceiling, the resulting rect at 1080p, and the gap below the mark.
- [x] **Checked by the owner on a real recording:** corner and height confirmed on the
      second pass.
- [ ] **Needs a human:** record on a light background and confirm the mark is still
      readable at 0.75 opacity. The tests prove the geometry, not the look.
- [ ] **Needs a human:** paid plan (dev override on) still produces no mark.

## Not done, on purpose

- **No position picker for paid users.** Separate idea, separate page if it ever lands.
- **No new asset.** If the mark is ever redesigned, only `kaipu-wordmark.svg` changes;
  the defaults above already place whatever it holds.
