---
title: "Editor zoom — view vs crop vs export resolution"
description: "Analysis of the screenshot editor's zoom feature. Untangles view-zoom from crop-to-region, and works through the pixel/resolution implications of exporting 'only what's zoomed' vs the full image."
---

# Editor zoom — view vs crop vs export resolution

> **Status: ✅ Decided & closed.** **View-zoom is shipped and final** (on
> `feat/screenshots`): a `−/%/+` control + ⌘/pinch-wheel that scales the canvas via CSS
> `transform`; annotations stay aligned; **export ignores zoom** (native resolution).
>
> **Final decision — zoom never determines the output.** We will _not_ "save the zoomed
> view": the zoomed view is the same pixels enlarged, so saving it would crop to the
> viewport **and upscale** → a blurry partial image (the table + app analysis below show
> why, and that every tool keeps them separate). "Keep only a section" is a **separate
> Crop tool** → see [editor tools: crop / freehand / blur](./screenshot-crop). This doc
> stays as the rationale; no further zoom work is planned.

## The core confusion

"Zoom" is being used for three different things. Pin down which one(s) we want, because
they don't share an export model:

1. **View zoom (editor navigation).** Zoom/pan the canvas to see and place annotations
   precisely on a large capture — purely how the editor _looks_, never what it outputs.
2. **Crop / export-region.** Pick a sub-region (possibly framed by zooming/panning) and
   export **only that**. Changes the output's content _and_ dimensions.
3. **Magnify / loupe callout.** A zoomed inset of a region drawn _onto_ the image (a
   "magnifier" annotation/effect). A creative annotation, not navigation.

The owner's "add text in a nice view" need = **#1**. The "export only what's zoomed vs the
full image, and how it hits pixels/resolution" question = **#2**.

## Export semantics by interpretation

| Interpretation          | What exports                           | Output size            | Resolution impact                   |
| ----------------------- | -------------------------------------- | ---------------------- | ----------------------------------- |
| **View zoom only**      | the full composite                     | natural (capture) res  | **none** — export ignores view zoom |
| **Crop, native px**     | the selected region                    | region's native pixels | crisp, just smaller                 |
| **Crop → "full width"** | the region, upscaled to a target width | target width           | **upscaling = softness/blur**       |

Key rule for #2/#3: **the maximum lossless export width of a region is that region's native
pixel width.** Pushing a crop to a bigger "full width" canvas resamples _up_ → interpolation
→ visible softness. Never upscale silently; if offered, warn.

## Resolution / pixel notes

- Captures are at the screen's **native (Retina = 2×)** resolution; the compositor already
  exports the whole frame at that native res. **View zoom touches none of this** — it's a CSS
  transform on the canvas, the export path is unchanged.
- Cropping reduces pixel count ∝ the region area. A small crop has few pixels; making it
  "full width" can't add detail that was never captured.
- **PDF** (see [export-formats](./export-formats)) is the clean answer to "let me zoom as
  much as I want" _at view time_ without baking a resolution choice into a PNG — worth pairing
  with this.

## How other tools handle this (and why)

The pattern is near-universal: **zoom is navigation, never an output decision; keeping
"only a section" is a separate Crop tool.** Nobody ships "save the currently-zoomed
view" — because the zoomed view is the _same pixels enlarged_, so saving it would crop
to the viewport **and upscale** → a blurry partial image.

- **macOS Screenshot / Preview** — zoom (⌘+/pinch) is a magnifier; **Crop** is its own
  tool (drag a marquee → trim to it). Distinct, never linked.
- **CleanShot X / Snagit / Skitch** — zoom is a loupe to work precisely; **Crop / Cut**
  are separate edit tools. Export is always the (cropped) image at its real pixels.
- **Figma / Excalidraw** — zoom is pure canvas navigation; "export" targets a
  _selection / frame / slice_, not "what's visible." Zoom can't change an export.

Takeaway: our **view zoom is correct as-is** — the analysis above matches every tool.
What the owner is asking for ("keep this section, save only that") is the **Crop tool
(#2)**, not "save the zoomed view." Build it as its own tool; export the cropped region
at **native pixels** (crisp), and only offer an upscale-to-width option with a clear
softness warning.

## Recommendation & phasing

- **Phase 1 — view zoom + pan (editor-only).** Ships the "nice view to add text" need with
  **zero** resolution risk: a scale+translate transform on the canvas; the compositor exports
  the full image at native res regardless. This is what the placeholder button should become
  first.
- **Phase 2 — crop / export-region** as a _separate, explicit_ tool (do **not** conflate it
  with view zoom). Export at **native pixels**; an optional target width must clearly flag
  that it upscales.
- **Phase 3 (maybe) — magnify/loupe** callout effect, composited like any annotation.

## Implementation notes

- Annotations are stored in **normalized (0–1) coords**, so they're zoom-invariant by
  construction — view zoom needs no annotation changes. Pointer→normalized mapping uses the
  displayed element's `getBoundingClientRect`, which already reflects a CSS transform, so it
  keeps working under zoom (verify the scaled rect math when implementing).
- View zoom = `transform: scale()` + translate on the shot/overlay container; clamp the scale
  and add pan (drag with space, or trackpad pinch). **No compositor change.**
- Crop (Phase 2) = pass a region rect to `compositeScene` (clip + translate the SVG viewBox);
  decide native-px vs target-width there.
