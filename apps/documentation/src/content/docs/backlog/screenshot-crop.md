---
title: "Screenshot crop tool"
description: "How to add a crop tool to the screenshot editor: a normalized crop rect carried in the scene, clipped by the compositor at native pixels. Distinct from view-zoom."
---

# Screenshot crop tool

> **Status: 🔵 Proposed.** "Keep only this section and save just that." This is the
> real ask behind ["save the zoomed view"](./editor-zoom) — a **Crop tool**, separate
> from view-zoom. WhatsApp-practical: drag a rectangle, done.

## Model — crop is one scene field, not a destructive edit

Add an optional crop rect to the scene (normalized 0–1, like everything else):

```ts
interface Scene {
  beautify: BeautifyState;
  annotations: Annotation[];
  crop?: { x: number; y: number; w: number; h: number }; // 0–1 of the base image
}
```

Why a scene field (non-destructive) rather than baking a smaller base image:

- **Undoable** — crop joins the existing undo/redo history like any change.
- **Re-adjustable** — drag the handles again; nothing is lost mid-session.
- **No annotation re-normalization** — annotations stay normalized to the _original_
  image; the crop is just a viewport. Live layer and compositor both render "the image
  windowed to `crop`", so annotation coords never change.
- The output dimensions become the crop's **native pixels** → crisp, never upscaled.

## Interaction

- A **Crop** tool in the tool group. Activating it shows a draggable rectangle with 8
  resize handles over the shot (default = full image). Drag to set, drag handles to
  resize, Enter/click-away to apply, Esc to cancel.
- Optional: aspect-ratio locks (Free / 16:9 / 1:1) later — not v1.
- The beautify frame (padding/bg/shadow) then wraps the **cropped** region, so a crop
  re-frames nicely.

## Rendering

- **Live preview** (`AnnotationLayer` / `BeautifiedFrame`): when `crop` is set, show
  only that sub-rect. Simplest: render the `<img>`/SVG inside a clip and translate so
  the crop's top-left is the frame origin; size the frame to the crop's aspect. Dim the
  area outside the crop while the tool is active (the classic "rule-of-thirds" overlay).
- **Export** (`compositeScene`): the one real code change. Today it draws the whole base
  at `(pad, pad)` sized `naturalW×naturalH`. With a crop:
  - frame size = `crop.w*naturalW + 2pad` × `crop.h*naturalH + 2pad`
  - draw the base translated by `-crop.x*naturalW, -crop.y*naturalH` inside a clip of the
    crop rect (an SVG `clipPath` + offset `<image>`).
  - annotations already render via `translate(pad,pad)` over normalized coords scaled by
    the **crop** width/height instead of the full width/height.
  - No upscaling — pixel count = crop area at native res.

## Complexity

**Medium.** The bulk is the **drag-rect + resize-handles UI** (reuse the pointer math
from the box tool; add handle hit-zones). The compositor change is a clip + offset +
size swap. The live preview needs the clip/translate + a dim overlay. The scene-field +
undo wiring is trivial (it's already a committed scene change).

## Decisions to confirm

- Default crop = full image (so the tool is non-destructive until dragged).
- Native-pixel export only; **no** "upscale to width" in v1 (it softens — see
  [editor-zoom](./editor-zoom)). Offer later with an explicit warning if asked.
