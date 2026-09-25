---
title: "Watermark — quieter, bottom-left"
description: "Shipped: the free-plan watermark moved from middle-right to the bottom-left corner and lost a third of its opacity. Defaults only — the asset was already the right lockup."
---

# Watermark redesign

> **Status: 🟢 Ready to validate** (2026-09-24). Owner: "modify the Kaipu watermark so it is
> prettier, and put it somewhere else — bottom-left?" Parent:
> [roadmap → 6 — Watermark](./roadmap#6--watermark-free--paid-scalable-plan--shipped-live-gating-awaits-4).

## What shipped

Three default values in `features/watermark/watermark.ts`. No new asset, no new drawing
code, no Settings surface.

| Field         | Before         | After         |
| ------------- | -------------- | ------------- |
| `position`    | `middle-right` | `bottom-left` |
| `opacity`     | 0.9            | 0.75          |
| `marginRatio` | 0.03           | 0.025         |

`variant`, `tint` and `heightRatio` are unchanged. The compositor already draws a soft
drop shadow under the white silhouette, and that shadow is what keeps the mark legible on
light footage at the lower opacity.

The owner's call on the trade-off: **losing some presence is the intent.** This is a
provisional mark, and a watermark that sits over the content costs more than it protects.

## Two corrections to the original proposal

The proposal that opened this page got two facts wrong. Both are recorded here so the
next reader does not re-derive them.

1. **The asset was already the right lockup.** The proposal asked for "the Kaipu play-mark
   glyph + wordmark" as new design work. `kaipu-wordmark.svg` (1974×352) is already exactly
   that — the glyph followed by "Kaipu Recorder". Nothing needed drawing.
2. **The corner rationale was backwards.** The proposal argued for bottom-left because
   "the control bar / camera bubble never occupy it (both live bottom-right by default)".
   In fact the camera bubble defaults to **bottom-left** (`camera-bubble-window.ts`, 40 px
   margin) and the control bar to **bottom-center** (`control-bar-window.ts`). Bottom-left
   is where the camera sits.

   This does not change the outcome. The bubble is `movable: true` with
   `-webkit-app-region: drag`, so the user puts it wherever they want and **no corner is
   safe by construction**. Corner choice is an aesthetic call, not a collision-avoidance
   one, and bottom-left is the one the owner asked for.

## Acceptance

- [x] Free plan: the mark sits bottom-left, scaled to frame height, on any aspect ratio.
- [x] Existing `watermarkRect` position tests still pass; three new tests pin the default
      corner, the opacity ceiling and the resulting rect at 1080p.
- [ ] **Needs a human:** record on a light background and on a dark one, and confirm the
      mark is still readable at 0.75 opacity. The tests prove the geometry, not the look.
- [ ] **Needs a human:** paid plan (dev override on) still produces no mark.

## Not done, on purpose

- **No position picker for paid users.** Separate idea, separate page if it ever lands.
- **No new asset.** If the mark is ever redesigned, only `kaipu-wordmark.svg` changes;
  the defaults above already place whatever it holds.
