---
title: Image editor Inspect mode
description: Inspect mode in the image editor — a loupe and the live color under the cursor, copied in hex, rgb, hsl or oklch, and a ruler that measures and pins pixel runs — behind the image-inspect flag.
---

# Image editor Inspect mode

> **Status: 🟢 Ready to validate (prod review pending) — behind flag image-inspect, off by default.**

Design: [image editor canvas and inspect](../specs/2026-11-11-image-editor-canvas-and-inspect-design/), section 3.
Decision: [ADR 0054](../architecture/decisions/0054-inspection-tools-read-the-pixels-of-a-captured-image-inside-the-editor/).
Issues: [NIW2-699](https://linear.app/niway/issue/NIW2-699) (M1, loupe and color) and
[NIW2-702](https://linear.app/niway/issue/NIW2-702) (M4, ruler), milestones of NIW2-696.

## What it does

Inspect is one mode of the image editor. Press `I` or the pipette button in the toolbar to enter
it, `Esc` to leave. While it is on, over the image:

- **Loupe.** 15 × 15 image pixels around the cursor, drawn unsmoothed, with the centre pixel
  outlined.
- **Live color.** The color of the pixel under the cursor and its position in image pixels. The
  value is the pixel converted once to sRGB, so it matches what a designer typed in CSS or Figma.
- **Formats.** hex (default), rgb, hsl, oklch. A translucent pixel shows its alpha.
- **Copy.** `C` or the Copy color button copies the value as shown.
- **As captured.** Shows the raw value in the profile the image was captured in (only hex and
  rgb: those numbers are not sRGB, so hsl and oklch would be wrong).
- **Out of sRGB.** A pixel whose color lies outside sRGB is marked; the hex shown is the clipped
  value.

The keys do nothing while a text field or a dialog has focus, and `Cmd+C` keeps its meaning.
Inspect works with the `image-canvas` flag on and off, and the readout does not change with zoom.
Inspect never edits the image. The loupe, the color and the ruler under the cursor are never
saved; only a measurement you pin is.

## Ruler

- **`1` / `2`.** Show the horizontal / vertical **pixel run** under the cursor with its length in
  image pixels. The same key again hides it. The Horizontal and Vertical buttons in the Inspect
  bar do the same.
- **What a run is.** From the cursor outward, pixel by pixel, while the color stays within the
  tolerance of the **starting** pixel (per-channel maximum difference, alpha included). Comparing
  with the start, not the neighbor, keeps a gradient from being walked end to end. A run is not an
  element boundary: gradients, shadows and antialiasing end it early.
- **Tolerance.** The mouse wheel changes it while a run is shown (up raises it); the `−` / `+`
  buttons in the bar do the same. 0–255, starting at 10. `Cmd`/`Ctrl` + wheel still zooms, and
  with no run shown the wheel pans as usual.
- **Outer size.** Hold `Shift` (or turn on Outer in the bar): from each edge of the run the scan
  continues over the next run outward, so inside a button with a 1 px border the inner run is the
  fill and the outer one includes the border.
- **Pin.** A click while a run is shown adds it as a `measure` annotation and Inspect stays on.
  Leave Inspect (`Esc`) and use Select to move it or drag either end; the ends snap to pixel
  edges and stay on the image. It is drawn in the exported PNG with its length.
- **Zoom and padding.** The run is scanned on the decoded pixels, so its length does not change
  with zoom. Over padding, background or empty canvas there is no pixel and no run.

A `measure` stores its ends in the image's source pixels (`from`, `to`, `at`) plus the image's
pixel size, so it moves with the image and its label is always `to - from`. The scan is
`inspect/pixel-run.ts`; the annotation's geometry, shared by the live layer and the export, is
`annotations/measure.ts`.

## How it reads pixels

The image is decoded once, the first time Inspect is entered, into an sRGB buffer (about 81 MiB
for a 6K image) that is kept while the editor is open. The out-of-sRGB mark and the "as captured"
value come from decoding a 32 × 32 tile around the pointer again, once the pointer rests for
120 ms. Code: `apps/kaipu-record/src/renderer/src/features/screenshots/inspect/` — the logic
(`color.ts`, `pixel-buffer.ts`, `inspect-keys.ts`, `use-inspect.ts`) is separate from the view so
NIW2-708 can restyle it.

## How to turn it on

- **Released builds:** the PostHog feature flag `image-inspect`.
- **Local development:**

  ```bash
  KAIPU_FLAG_OVERRIDES='{"image-inspect":true}' bun run dev
  ```

  The UI catalog's `image-inspect` profile does the same. The real-app checks are
  `apps/kaipu-record/verify/image-inspect.verify.ts` (loupe and readout) and
  `apps/kaipu-record/verify/image-ruler.verify.ts` (ruler and pinned measurements).

## Not in it yet

- Reopening a saved item with its measurements still editable: that needs the editable canvas
  document (M5, NIW2-700). Until then a pinned measurement is baked into the saved PNG.
- The colors panel: M7, NIW2-704.
- The final look of the HUD and bar: NIW2-708.
