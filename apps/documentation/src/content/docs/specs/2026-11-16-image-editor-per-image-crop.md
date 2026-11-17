---
title: Image editor — per-image crop
description: Crop one image on the canvas, the base screenshot included, without touching the asset. Double-click an image to crop it, a floating action bar and the Tool tab hold Crop, Corners, Reset and the original size. Data model, canvas document v3, compositor, privacy rule and the five delivery units.
---

# Image editor — per-image crop

**Status: 🟡 In progress · 2026-11-16.** Direction approved by the owner in chat. Unit 1 and 2
(model, document v3, compositor) are tracked in
[NIW2-848](https://linear.app/niway/issue/NIW2-848/per-image-crop-spec-data-model-v3-and-compositor-clip).
Everything stays behind the `image-canvas` flag. Units 3 to 5 have no ticket yet: the free Linear
plan refuses sub-issues, so the units live here.

## Summary

Today the canvas crop tool crops the whole canvas (the "Export frame"). The owner wants to crop
**one image**: double-click an image, the base screenshot included, and drag its edges. When an
image is selected, a small floating action bar offers **Crop**, **Corners**, **Reset** and the
original size; the same component sits in the Tool tab.

The crop is non-destructive. The asset on disk stays whole, so Reset (or widening the crop) brings
the cropped-out pixels back. That is also the privacy risk this spec names: a redaction over a
cropped-out part must still reach the asset's pixels (see "Privacy rule").

| Decision                                                                                                    | Why                                                                                                                                        | ADR                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The crop is a window inside the asset (`crop`, 0–1 of the asset); `x/y/w/h` stay the **visible** rect       | Selection, extents, hit-testing, gaps and the export box keep working unchanged; only drawing and redaction baking need the uncropped rect | none                                                                                                                                              |
| A `fullRect(a)` helper gives the uncropped rect on the canvas                                               | One definition of "where the whole asset is", shared by the compositor and the redaction bake                                              | none                                                                                                                                              |
| Per-image corners: `radius` undefined follows the global slider; set is that image's own value in source px | The global slider keeps working for every image that was never touched; an own value survives slider changes                               | none (refines a line of [ADR 0053](#adr-0053-check))                                                                                              |
| Canvas document v3: write v3, read 1, 2 and 3                                                               | An older build would stretch the whole asset into the cropped rect; refusing the file (fallback to the flattened PNG) is the safe failure  | reuses the version rule of [ADR 0053](/architecture/decisions/0053-the-image-editor-is-a-canvas-saved-as-a-document-beside-its-flattened-export/) |
| X stays "Export frame" and never crops a selected image                                                     | Two different crops need two different entry points                                                                                        | none                                                                                                                                              |
| Double-click on image pixels crops that image; on padding or background it opens the Export frame as today  | The click lands on what the user is pointing at; the base is hit-tested on its own rect                                                    | none                                                                                                                                              |
| Cropping the base ships in the same release as the first visible UI                                         | A crop that works on added images only looks broken: the screenshot is the image people crop                                               | none                                                                                                                                              |
| The selection tag and the chip read **source pixels**: "Showing 1200×800 of 3840×2160 px"                   | The user sees how much of the original is visible                                                                                          | none                                                                                                                                              |

### Open question (owner)

The owner also wants to "deform" the base image (resize or stretch it). The meaning is pending:
**corner handles = proportional resize and edge handles = stretch one axis?** Not designed, not
built. It interacts with the crop (a stretched, cropped image), so unit 3 must not close the door:
`x/y/w/h` stay the visible rect, and a stretch would scale that rect, never the asset.

### Out of scope

- Any user-facing UI in this PR (units 4 and 5).
- Cropping the base (unit 3): `baseCrop`, `baseRadius`, signed extents.
- Deform / stretch of an image.
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

**Base image.** The base is not an item in the editor (`scene.ts`: it "stays the anchor"), so it
has no `crop` yet. Unit 3 adds `baseCrop` and `baseRadius` to the scene and has to solve the part
that is hard: the content box and the extents are clamped to contain the **whole** base
(`contentExtents`, `over()`), and the compositor draws the base at the origin. A cropped base
needs either signed extents or a "visible base rect", and then the compositor origin, the live
`BeautifiedFrame`, Fit to content and the gaps follow. It is the riskiest unit and gets its own PR.

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
- The base item (item 0) must not carry `crop` or `radius` yet; a document that does is unreadable
  until unit 3 defines them, rather than read as the base's world rect.
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

| Unit | Content                                                                                                                                                       | PR       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1    | Model: `crop`, `radius` on `ImageAnnotation`, `fullRect`, canvas document v3 (write 3, read 1/2/3)                                                            | NIW2-848 |
| 2    | Compositor clip, per-image radius, def id, redaction bake on `fullRect`, privacy tests                                                                        | NIW2-848 |
| 3    | Base crop: `baseCrop`, `baseRadius`, signed extents or a visible-base rect, compositor origin, `BeautifiedFrame`, Fit to content, gaps. **The riskiest unit** | not yet  |
| 4    | Crop mode state `cropping: id \| null`, one undo step per commit, dimmed whole asset, double-click routing                                                    | not yet  |
| 5    | Shared action bar and Tool tab, chip text, selection-tag fix, ui-map and catalog states, OCR words filtered to the visible rect                               | not yet  |

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
   build must refuse it. **Read literally, the condition is met.** The honest reading is that the
   condition guards against a format that keeps being redesigned, while v3 is purely additive
   (two optional fields) and v2 documents open unchanged. Two ways to respect it, for the owner to
   pick before the first visible release:
   - keep writing v3 and amend the ADR's reopen line to say additive versions do not count; or
   - write v2 unless an image actually carries `crop` or `radius`, so existing documents stay
     readable by old builds until a crop is used. This costs a small branch in
     `buildCanvasDoc`; unit 1 does not do it.

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
  crop edge is baked; one asset placed twice with different crops is baked through the larger
  placement; a blur that misses the asset does nothing.
