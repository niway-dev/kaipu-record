---
title: Image editor — per-image crop
description: Crop one image on the canvas, the base screenshot included, without touching the asset. Double-click an image to crop it, a floating action bar and the Tool tab hold Crop, Corners, Reset and the original size. Data model, canvas document v3, compositor, privacy rule and the five delivery units.
---

# Image editor — per-image crop

**Status: 🟡 In progress · 2026-11-16.** Direction approved by the owner in chat. Unit 1 and 2
(model, document v3, compositor) are tracked in
[NIW2-848](https://linear.app/niway/issue/NIW2-848/per-image-crop-spec-data-model-v3-and-compositor-clip).
Unit 3 (the base's crop, scale and corners: model, geometry, compositor, redaction bake) is built
in a PR stacked on it, ticket [NIW2-853](https://linear.app/niway/issue/NIW2-853/image-editor-per-image-crop-unit-3-base-image-crop-scale-and-corners). Everything stays behind the `image-canvas` flag. Units 4
and 5 have no ticket yet: the free Linear plan refuses sub-issues, so the units live here.

## Summary

Today the canvas crop tool crops the whole canvas (the "Export frame"). The owner wants to crop
**one image**: double-click an image, the base screenshot included, and drag its edges. When an
image is selected, a small floating action bar offers **Crop**, **Corners**, **Reset** and the
original size; the same component sits in the Tool tab.

The crop is non-destructive. The asset on disk stays whole, so Reset (or widening the crop) brings
the cropped-out pixels back. That is also the privacy risk this spec names: a redaction over a
cropped-out part must still reach the asset's pixels (see "Privacy rule").

| Decision                                                                                                                                                 | Why                                                                                                                                        | ADR                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The crop is a window inside the asset (`crop`, 0–1 of the asset); `x/y/w/h` stay the **visible** rect                                                    | Selection, extents, hit-testing, gaps and the export box keep working unchanged; only drawing and redaction baking need the uncropped rect | none                                                                                                                                                                 |
| A `fullRect(a)` helper gives the uncropped rect on the canvas                                                                                            | One definition of "where the whole asset is", shared by the compositor and the redaction bake                                              | none                                                                                                                                                                 |
| Per-image corners: `radius` undefined follows the global slider; set is that image's own value in source px                                              | The global slider keeps working for every image that was never touched; an own value survives slider changes                               | none (refines a line of [ADR 0053](#adr-0053-check))                                                                                                                 |
| Canvas document v3: write v3, read 1, 2 and 3                                                                                                            | An older build would stretch the whole asset into the cropped rect; refusing the file (fallback to the flattened PNG) is the safe failure  | amends [ADR 0053](/architecture/decisions/0053-the-image-editor-is-a-canvas-saved-as-a-document-beside-its-flattened-export/) (reopen condition met, owner accepted) |
| X stays "Export frame" and never crops a selected image                                                                                                  | Two different crops need two different entry points                                                                                        | none                                                                                                                                                                 |
| Double-click on image pixels crops that image; on padding or background it opens the Export frame as today                                               | The click lands on what the user is pointing at; the base is hit-tested on its own rect                                                    | none                                                                                                                                                                 |
| Resize means proportional resize with the corner handles, after a crop and at any time; no stretch, rotate or skew; upscaling past the source is allowed | The crop is a unitless window, so scaling the visible rect never loses the hidden pixels                                                   | none                                                                                                                                                                 |
| Cropping the base ships in the same release as the first visible UI                                                                                      | A crop that works on added images only looks broken: the screenshot is the image people crop                                               | none                                                                                                                                                                 |
| The selection tag and the chip read **source pixels**: "Showing 1200×800 of 3840×2160 px"                                                                | The user sees how much of the original is visible                                                                                          | none                                                                                                                                                                 |

### Resize ("deform"), decided 2026-11-16

The owner's "deform" means **resize, not stretch**. After cropping an image, the base included,
the person can make it bigger or smaller, proportionally, and can widen the crop back at any time
without loss:

- Corner handles resize proportionally, as added images do today. There is no non-uniform
  stretch, no rotation and no skew.
- Resizing scales the **visible rect** and the whole asset with it (`fullRect` keeps its ratio to
  the visible rect). The `crop` window is unitless (0–1 of the asset), so it survives a resize
  untouched, and widening it later still brings the hidden pixels back.
- Scaling up past the source pixels is allowed.

### Out of scope

- Any user-facing UI in this PR (units 4 and 5).
- Cropping the base (unit 3): `baseCrop`, `baseRadius`, signed extents.
- Non-uniform stretch, rotation or skew of an image. Proportional resize is in scope (unit 3 for the base, unit 4 for the handles).
- A rotation, a freeform shape or a mask other than a rounded rectangle.
- Changing the Export frame or the classic (non-canvas) crop.
- Retiring the asset's cropped-out pixels (a "bake the crop" action). Non-destructive is the point.

## Model

```ts
interface ImageAnnotation {
  id: string;
  kind: "image";
  assetId: string;
  x: number; y: number; w: number; h: number; // the VISIBLE rect, base-normalized
  pixelWidth: number; pixelHeight: number;     // the asset's own size
  crop?: CropRect;   // window inside the asset, 0–1 of the asset; absent = whole asset
  radius?: number;   // source px; absent = follows beautify.radius
}

fullRect(a) // the whole asset's rect on the canvas, same units as x/y/w/h
```

`fullRect`: with `crop = {x: cx, y: cy, w: cw, h: ch}`, the whole asset is `a.w / cw` wide and
`a.h / ch` tall and starts at `a.x − cx · (a.w / cw)`, `a.y − cy · (a.h / ch)`. No crop gives the
visible rect. A crop that is not a window (non-finite, zero or negative size) **throws**: it fails
closed, because guessing the visible rect would let a redaction over the hidden pixels skip the
bake.

Example (illustrative): a visible rect of 0.25 × 0.25 at (1, 0.5) that shows the middle half of its
asset on both axes. The whole asset is 0.5 × 0.5 and starts at (0.875, 0.375).

**Base image (unit 3).** The base is not an item in the editor (`scene.ts`: it "stays the
anchor"), so its crop, corners and size live on the scene, not on an annotation:

- `baseCrop?` is the window of the base asset that shows (0–1 of the asset), as for an added image.
- `baseRadius?` is the base's own corner radius in source px; absent follows the global slider.
- `basePlacement?: { x, y, scale }` is where the **whole** base asset sits: its top-left corner in
  the same base-normalized units as every annotation, and a uniform `scale` (1 = natural size).
  Absent is `{ x: 0, y: 0, scale: 1 }`. The whole rect is `{ x, y, w: scale, h: scale }`
  (`baseFullRect`); the visible rect is the `baseCrop` window of it (`baseVisibleRect`).

**Why a placement, and how the base scales proportionally.** The world origin and the world unit
never move: they stay "the base asset at scale 1, corner at 0,0". Cropping or resizing the base
changes only these three scene fields, so **no annotation, image, ruler or export-frame coordinate
is rewritten**, and undoing a crop or a resize is one field edit. A resize is a change of `scale`
(and of `x/y` so the chosen corner stays put); the crop window is unitless, so it follows the
scale and expanding it later brings the hidden pixels back at the scale they had.

_Rejected: rebase the world on the visible base._ Making the visible base the new origin and unit
would keep the base looking like "item 0 at 0,0 with its pixel size", but every crop or resize
would have to rewrite the coordinates of every other item (and the ruler's source-px values, and
the export frame), and an undo would rewrite them back. One rounding slip would move an annotation
off the thing it marks. That is the opposite of the invariant this unit keeps.

Consequences, all in `canvas-geometry.ts`, `compositor.ts` and `content-box.ts`:

- `CanvasGeom.base` (`visibleBaseBounds`) is the visible base in natural px from the world origin,
  snapped **outward** to whole px so the base's edge is never left outside the box. The extents
  (`contentExtents`, `over()`) are measured from it, clamped at 0, and the content box always
  contains the whole **visible** base. A blur counts only where it covers the visible base.
- `canvasLayout` puts the **world origin** at `pad + extents.left - base.x1`, so it is no longer the
  base's corner when the base is cropped or moved; annotations still translate by it.
- The compositor clips the visible rect (with `baseRadius` when set), sizes the `#shot` def to the
  whole asset at the placed size, and draws it at the whole rect. The blur-under-base redraw is
  clipped to the visible rect only when a crop is set, so the default SVG is unchanged.
- Fit to content (`contentBoxFrame`) and the export frame math use `base` the same way.
- Redaction baking tests every blur against the **whole** placed base rect (`baseFullRect`), never
  `baseCrop`; an invalid placement throws. Every caller passes the placement: the export
  (`compositeSceneAt`), the save (`buildCanvasPayload` in the editor page), and the text cache
  (`redactionRectsInPixels`, which decides which recognized words a save may store; it fails closed
  on an invalid placement by treating the whole image as redacted).
- `baseVisibleRect` throws on an invalid `baseCrop`, like `fullRect` does for an image, so a save
  or an export stops instead of writing a NaN rect.
- The reader refuses a placement outside sane bounds (scale under 1/1000 or over 1000, a corner
  more than 10 000 base widths away): a corrupt file opens the flattened PNG instead of asking for
  a 1e12 px export.

### Canvas document v3

`CANVAS_DOC_VERSION` goes from 2 to 3. An image item may carry `crop` and `radius`:

- `x/y/w/h` stay the visible rect, in world units (converted as in v2).
- `crop` is unitless (0–1 of the asset) and `radius` is source px: the world conversion leaves both
  alone.
- Read 1, 2 and 3. A v1 or v2 document has neither field and opens as before. A v2 file that
  somehow carries them has them ignored: that version never wrote them.
- A crop outside the asset (any edge beyond 0–1, a side under 1/1000 of the asset) or a negative or
  non-numeric radius
  makes the document unreadable, so the editor opens the flattened PNG (ADR 0053 point 4) rather
  than guess.
- The base item (item 0) is an image item like any other: `x/y/w/h` is its **visible** rect and
  it may carry `crop` and `radius`. The world conversion always uses the unit rect
  `0,0,pixelWidth,pixelHeight` (the asset at scale 1), so the base's crop or resize never changes
  another item's numbers. The reader derives `basePlacement` from the item (visible rect divided
  by the crop window gives the whole asset's rect). A base that stretches the asset, with unequal
  scale on the two axes, is unreadable and opens the flattened PNG. v1 and v2 convert by the base
  item's rect, as before, and ignore a crop or radius on it.
- **An older build rejects v3 on purpose.** It would draw the whole asset stretched into the
  cropped rect and show the wrong picture with no warning.

An image without crop and radius writes neither key; its drawing is unchanged (see Compositor).

## Compositor

For each image, the asset is drawn **whole** from its own top-left corner (`fullRect`), and a clip
cuts the **visible** rect:

1. The `<image>` def is the whole asset at its canvas size (`fullRect` size). The def id carries
   that size, so a crop enters the id through it: two placements share a def only when the asset
   is drawn at the same size, whatever window each shows. Two crops that differ only in position
   share one def, which avoids embedding the (large) data URL twice.
2. The clip rect is the visible `x/y/w/h`. Its `rx` is `radius` when set, else the global radius.
   The drop shadow uses the same rect and radius.
3. The `<use>` sits at `fullRect.x/y`, which is left of or above the clip when cropped.

An image **without** `crop` and `radius` produces exactly the SVG it produced before this change
(test: the pre-crop template, written out, is matched literally).

## Privacy rule

Redactions are destructive at save (ADR 0053 point 5): the blur or solid is baked into the asset's
pixels. A crop must never let a redaction be "forgotten":

> `bakeCanvasRedactions` tests a blur's overlap with `fullRect(image)`, not with the visible rect.
> A blur over a cropped-out part is baked into the asset, so widening the crop or pressing Reset
> shows redacted pixels, never the original.

This is the same class of problem as the redaction privacy fix
[NIW2-799](https://linear.app/niway/issue/NIW2-799) (a redaction that showed through a later image), which is why it is a hard
requirement and has tests: the blur over a cropped-out part, one straddling the crop edge, and one
asset placed twice with different crops are all baked through the whole asset's rect, and a blur
that misses the whole asset still does not touch it. What the unit tests cannot show is the
saved-then-widened flow on real pixels (the test canvas only records the rects it blurs); unit 4
adds that check with the crop writer.

Consequences for later units. Found in review of unit 1 and 2, they are latent until a crop can be
written, so they are **blocking for unit 4**:

- The live preview still treats the visible rect as the asset rect: `ImageRedactionTile`, the
  locked branch of `BlurOverImagesBelow` and `ImageShape` in `annotations/annotation-layer.tsx`
  must draw the asset from `fullRect` and clip to the visible rect, or the preview shows a
  redaction at different pixels than the export bakes.
- `resizeImage` in `annotations/handles.ts` locks the aspect ratio to the whole asset
  (`pixelWidth / pixelHeight`) while resizing the visible rect, which distorts a cropped image;
  it must lock to the crop window's aspect.
- Also: OCR text and any "copy text" must only offer words inside the
  **visible** rect (unit 5), and the Inspect panels must not read colors or sizes from cropped-out
  pixels.

## Interaction (units 4 and 5)

States of an image:

| State                     | What the user sees                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Idle                      | The visible rect only. A hover chip "Cropped" when a crop is set (same chip language as [the crop enter-and-leave spec](/specs/2026-11-13-image-editor-crop-enter-and-leave/)) |
| Selected                  | Selection box, plus the floating **image action bar** (Crop, Corners, Reset, original size); the Tool tab shows the same component                                             |
| Cropping (`cropping: id`) | The whole asset appears at its real place, dimmed outside the crop window, with handles on the window. Other images and annotations stay as they are                           |

Rules:

- **Enter cropping:** double-click on the image's pixels, or Crop in the action bar. The base is
  hit-tested on its own rect. Double-click on padding or background keeps opening the Export
  frame. Disabled in Inspect and in select-text.
- **Commit:** Enter or Done. **Esc keeps the crop and leaves**, as decided in
  [NIW2-759](https://linear.app/niway/issue/NIW2-759/image-editor-figma-style-crop-leave-the-tool-to-see-the-result-cropped);
  it never clears the work. Reset and ⌘Z remove a crop. Releasing a drag does not leave.
- **One undo step per commit**, not per drag.
- **X** stays "Export frame" and never crops a selected image.
- **Corners** edits `radius` in source px; Reset on the control returns it to "follows the
  slider".
- **Original size** reads "Showing 1200×800 of 3840×2160 px". The selection tag
  (`canvas/image-selection.tsx`) prints `pixelWidth × pixelHeight` today and must show the
  visible size.

## Delivery units

| Unit | Content                                                                                                                                                                                       | PR       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1    | Model: `crop`, `radius` on `ImageAnnotation`, `fullRect`, canvas document v3 (write 3, read 1/2/3)                                                                                            | NIW2-848 |
| 2    | Compositor clip, per-image radius, def id, redaction bake on `fullRect`, privacy tests                                                                                                        | NIW2-848 |
| 3    | Base crop, scale and corners: `baseCrop`, `baseRadius`, `basePlacement`, visible-base geometry, compositor, redaction bake, document v3 base item. The live frame is **not** in it, see below | NIW2-853 |
| 4    | Crop mode state `cropping: id \| null`, one undo step per commit, dimmed whole asset, double-click routing                                                                                    | not yet  |
| 5    | Shared action bar and Tool tab, chip text, selection-tag fix, ui-map and catalog states, OCR words filtered to the visible rect                                                               | not yet  |

**Left for unit 4, and blocking it.** Unit 3 carries the base fields from a reopened document to
the next save and export, but nothing in the editor writes them yet, and the live view does not
read them:

- The live frame (`BeautifiedFrame` and the page's flex layout, where the `<img>` is the world
  anchor) draws the whole base. A document with a cropped or resized base therefore exports
  correctly but previews as uncropped until unit 4 gives the live geometry `CanvasGeom.base`.
  This could not be changed safely without running the app.
- The editor page's own geometry reads the whole base too: its `contentExtents` calls, the
  `canvasGeom` it hands to `worldToFrame` / `frameToWorld` (in display px, so `visibleBaseBounds`,
  which snaps to whole px, cannot be reused as is), and the scene it gives `exportPixelSize`. For
  a cropped or resized base the size label, the Fit to content overhang and the coordinates of a
  dragged Export frame are therefore computed against the whole base, while Copy and Save use the
  right geometry. Unreachable until a crop can be written; it must be fixed together with the
  live frame.
- The per-image `radius` and the crop of added images are drawn by the live layer from the
  visible rect; the base's own radius needs the same treatment.
- A ruler (`measure`) is anchored to the base asset and does not follow a scaled base.
- The base's corner handles (proportional resize) are not wired. `resizeImage` already locks the
  crop window's aspect and keeps the crop, so wiring them is a matter of writing `basePlacement`.

Units 1 and 2 ship together because the model is untestable without the compositor. Nothing is
visible until unit 5, and the first visible release must include unit 3 (decision 7).

### ui-map entries (unit 5, [ADR 0046](/architecture/decisions/0046-a-typed-ui-map-declares-every-screen-area-and-state/))

Added to `apps/kaipu-record/src/shared/ui-map.ts`, each area root spreading `uiArea("<AreaId>")`,
with a catalog state per area:

- area `imageActionBar` (the floating bar over a selected image);
- area `imageCropMode` (the dimmed whole asset and window handles);
- chip state `cropped-image` (the hover chip on a cropped image);
- tool panel state `imageOptions` (the same action component in the Tool tab).

## ADR 0053 check

[ADR 0053](/architecture/decisions/0053-the-image-editor-is-a-canvas-saved-as-a-document-beside-its-flattened-export/)
is not contradicted in its Decision section. Two lines need a note:

1. **"Radius and shadow apply to every image item"** (Implementation status, "Several images").
   Per-image `radius` refines it: the global radius still applies to every image that has no own
   value. Shadow is unchanged. This is a refinement, not a reversal; no reopen condition applies.
2. **Reopen condition "the document needs a second breaking schema change within its first three
   versions."** v1 → v2 (world units) was the first breaking change. v3 is the second: an older
   build must refuse it, so the condition is met. **The owner accepted it on 2026-11-16:** every
   save writes v3, whether or not an image carries a crop, and an older build opens a v3 document
   as the flattened PNG, with no data lost. The ADR carries the
   [amendment](/architecture/decisions/0053-the-image-editor-is-a-canvas-saved-as-a-document-beside-its-flattened-export/#amendment-2026-11-16-version-3-per-image-crop)
   with the new reopen condition. Rejected: writing v2 unless an image carries a crop or radius
   (two writers to keep honest, and the version would depend on content).

A third point is not a contradiction: the ADR calls the base "the anchor (item 0, not selectable
or movable)" and leaves open whether it becomes an ordinary item. Unit 3 gives the base a crop
without making it an item, so that question stays open.

## Testing

Unit 1 and 2 tests (existing files):

- `annotations/scene.test.ts` — `fullRect`: no crop, full crop, a crop, a degenerate crop.
- `annotations/canvas-doc.test.ts` — v3 round trip with crop and radius, no keys without them,
  a v2 document still loads, v2 ignores the new fields, invalid crop or radius falls back.
- `annotations/compositor.test.ts` — cropped image draws the whole asset clipped to the visible
  rect, per-image radius, radius 0, def ids, and an uncropped image draws the same SVG as before.
- `annotations/redaction.test.ts` — a blur over the cropped-out part is baked; one straddling the
  crop edge is baked; one asset placed twice with different crops is baked through each placement's
  whole-asset rect; a blur that misses the asset does nothing.

Unit 3 tests:

- `annotations/base-crop.test.ts` — the default SVG matches three strings captured from the parent
  commit; `visibleBaseBounds` (crop, resize, outward snapping); extents measured from a cropped
  base (never negative, blur limited to the visible part); layout origin; Fit to content; the export
  frame window; the cropped and the resized base in `buildSvg` (clip, radius override, def size,
  `use` position).
- `annotations/canvas-doc.test.ts` — the base item as its visible rect, round trip of crop, radius
  and placement with every other item's coordinates unchanged, an untouched base writes nothing
  extra, a stretching or invalid base falls back, an invalid placement refuses to build, v2 ignores
  the fields.
- `annotations/redaction.test.ts` — a blur over the cropped-out part of the base is baked; redact,
  crop out, save, expand the crop: the stored pixels stay redacted; a resized base is baked through
  its placed rect; an invalid placement throws.
- `annotations/compositor.test.ts` — the export hands the placement, not the crop, to the bake.
- `pages/screenshot-editor/screenshot-editor-page.document.test.tsx` — Save over a reopened v3
  document with a resized base hands that placement to the bake (this test fails without the fix).
- `text-selection/geometry.test.ts` — redactions measured against the placed base; an invalid
  placement fails closed.
- `annotations/scene.test.ts`, `handles.test.ts`, `use-editor-scene.test.ts` — the base rects,
  `resizeImage` on a cropped image, the scene carrying the base fields through undo and redo.

The redaction tests use a fake canvas that records the blurred rects, so they prove which rectangle
is baked, not the pixels (unit 4 adds the crop writer and should add a real-pixel check).
