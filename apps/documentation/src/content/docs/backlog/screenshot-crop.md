---
title: "Screenshot crop tool"
description: "A crop tool in the screenshot editor: a normalized crop rect over the composed FRAME (bg + padding + shot), previewed as a windowed frame and exported via SVG viewBox. Distinct from view-zoom."
---

# Screenshot crop tool

> **Status: 🟢 Built + owner-validated locally** (on `feat/screenshot-crop`, PR #15; prod
> review pending). A **Crop tool** in the editor: drag a rectangle over the whole frame
> (reposition by dragging the interior, resize with 8 handles), leave the tool to see the
> windowed result; Esc / Restablecer goes back to full. Non-destructive (`scene.crop`),
> undoable, exports at native pixels. Padded export + crop-into-padding + 3:4→square all
> verified in the running build.
>
> **Crop is over the CANVAS/frame, not the capture** — the crop rect spans the background +
> padding + shot, so you can capture a 3:4 shot, add padding to make room, and crop it to a
> **square that includes the padding**. Aspect-ratio locks remain a follow-up. See the
> [canvas-relative rework handoff](../plans/2026-07-01-screenshot-crop-canvas-rework), the
> [design spec](../specs/2026-06-30-screenshot-crop-design) (older image-relative model), and
> the [original implementation plan](../plans/2026-07-01-screenshot-crop-tool).

## Model — crop is one scene field over the FRAME, not a destructive edit

An optional crop rect on the scene, normalized 0–1 of the **beautified frame** (background +
padding + shot) — not the base image:

```ts
interface Scene {
  beautify: BeautifyState;
  annotations: Annotation[];
  crop?: { x: number; y: number; w: number; h: number }; // 0–1 of the composed FRAME
}
```

Why a scene field (non-destructive) rather than baking a smaller base image:

- **Undoable** — crop joins the existing undo/redo history like any change.
- **Re-adjustable** — drag the handles again; nothing is lost mid-session.
- **No annotation re-normalization** — annotations stay normalized to the shot and render via
  `translate(pad,pad)`; only `crop` lives in frame space. Two independent coordinate spaces.
- The output dimensions become the crop window's **native pixels** → crisp, never upscaled.

Why frame-relative (the rework): the earlier image-relative model couldn't reach the padding
and re-added padding around the crop on export, which compounded on re-open (mostly-background
PNGs). Windowing the composed frame fixes both and enables the crop-into-padding use case.

## Interaction

- A **Crop** tool in the tool group. Activating it shows a draggable rectangle with 8 resize
  handles over the **whole frame** (default = full frame). Drag to set, drag the interior to
  move, drag handles to resize; leave the tool to preview the window, Esc / Restablecer resets.
- Optional: aspect-ratio locks (Free / 16:9 / 1:1) later — not v1.

## Rendering

- **Crop overlay** (`beautify/crop-overlay.tsx`): a frame-covering overlay (measures its own
  box = the frame) that draws the dim mask + rect + 8 handles in frame-normalized coords and
  drives draw/move/resize through the pure `annotations/crop.ts` geometry. Rendered by the
  editor only while the crop tool is active, over the un-windowed frame.
- **Live preview** (`BeautifiedFrame`): when a crop is applied (tool inactive), it measures
  the frame's natural size, then renders that fixed size and **pans it via transform** inside
  a clipping viewport. A pure pan (no re-layout) keeps the preview pixel-accurate to the export
  and keeps the shot's layout width — the export scale — stable whether cropped or not.
- **Export** (`compositeScene` / `buildSvg`): compose the full frame once (bg rect at
  `0,0,fullW,fullH`; shot `<use>` at `(pad,pad)`; annotations `translate(pad,pad)`), then
  window it with the output SVG:
  - `fullW = naturalW + 2·pad`, `fullH = naturalH + 2·pad`
  - `viewBox = "${crop.x*fullW} ${crop.y*fullH} ${crop.w*fullW} ${crop.h*fullH}"`,
    `width/height = crop.{w,h}*full{W,H}`, rasterized at those dims.
  - No crop → `viewBox="0 0 fullW fullH"` (byte-identical to the pre-crop output).
  - Padding is **not** re-added around the crop; the crop is a window of the already-padded
    frame, so it can span into the padding/background. No upscaling — native pixels.

## Decisions

- Default crop = full frame (non-destructive until dragged); a full-frame result normalizes
  back to `undefined` on release.
- Native-pixel export only; **no** "upscale to width" in v1 (it softens — see
  [editor-zoom](./editor-zoom)). Offer later with an explicit warning if asked.
- Applied-crop preview is shown 1:1 (the window at native relative size, centered); use the
  zoom control to magnify. Scale-to-fill is a possible follow-up.

## Gotchas

- ⚠️ **Never put `clip-path` on the shot's translated `<use>`.** A `clip-path` (userSpaceOnUse)
  on an element that also carries an `x`/`y` translation resolves in the _translated_ space, so
  the clip rect `rc` (authored at `(pad,pad)`) lands at `(2·pad,2·pad)` and shears the shot's
  top/left `pad`-wide strip off — the shot exports shoved toward the bottom-right, worse the
  larger the padding, on **every** padded export (crop or not). Fix: clip via a non-translated
  wrapping group — `<g clip-path="url(#rc)"><use href="#shot" x=pad y=pad/></g>`. The annotation
  group escapes this only because its clip `rcLocal` is authored at `(0,0)`, so its own
  `translate(pad,pad)` lands it correctly (coincidence, not design). Regression test:
  `compositor.test.ts` → "clips the base shot via a wrapping group". This was the single hardest
  bug in the feature; it was found by decoding the exported PNG's actual pixel bounding box
  (top-left sat at `2·pad`), not by reading the SVG.
- ⚠️ The applied-crop preview keeps `img.clientWidth` stable by rendering the frame at its fixed
  natural size and **panning via transform** (not re-laying-out). Don't "optimize" this to a
  percentage-resize — the export scale (`naturalW / displayedW`) would then drift when cropped.
