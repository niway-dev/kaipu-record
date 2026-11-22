---
title: Image editor Inspect mode
description: Inspect mode in the image editor — a loupe and the live color under the cursor, copied in hex, rgb, hsl or oklch, a ruler that measures and pins pixel runs, and a colors panel that locates each color — behind the image-inspect flag.
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
- **Picked color.** A click on the image, with no ruler run shown, picks that pixel into the
  **Color** box in the Tool tab: a swatch, the value in the current format and a Copy button
  that names the value ("Copy #ff0052"). A new click replaces the picked color and the old one
  moves to the front of **Recent**, which keeps three (the oldest drops; the same color twice in
  a row is not listed). A click while a run is shown pins the run and does not pick. Picks are
  stored as raw values, so Format and As captured re-render the box and the recents. The picked
  color, the recents and the Loupe switch persist across sessions in the app settings
  (`imageInspect`) ([NIW2-911](https://linear.app/niway/issue/NIW2-911)).
- **Copy.** `C` copies the value under the pointer as shown; the Copy button in the Color box
  and each recent chip copy their own value.
- **Loupe switch.** The Ruler section has a Loupe toggle (on by default) that shows or hides the
  magnifier next to the pointer; the crosshair and the color chip stay.
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

## Colors panel

The **Colors** button in the Inspect bar opens a panel with the colors of the image, largest
share first ([NIW2-704](https://linear.app/niway/issue/NIW2-704), milestone M7).

- **Groups.** Near-identical colors form one group, shown with its most frequent exact value
  and its share of the image. When a group has more than one notable exact value, they are
  listed under it, so two whites that should have been one sit side by side.
- **Locate.** Clicking a group, or one exact value, dims the image everywhere except those
  pixels and says how many there are. Clicking it again, Clear highlight, closing the panel
  or leaving Inspect removes the highlight. The highlight follows zoom and pan.
- **Format.** Values are sRGB, in the Inspect bar's format.
- **Photographs.** An image with 1,000 or more distinct colors lists every group of at least 1%
  of the counted pixels and folds the rest into "Other" (it used to stop at 80% of the image,
  which hid a small accent such as a 3% pink).

How it counts: the buffer Inspect already decoded is copied once into a worker (a few
milliseconds on the main thread), so the editor never waits on the count. The worker counts
exact colors, drops the low 3 bits of each channel (32,768 bins), and groups bins closer than
0.03 in OKLab around the most frequent ones, looking only at neighbouring cells of a grid, so
the work is linear: a 5K image of pure noise takes about half a second, all of it off the main
thread. Fully transparent pixels are not counted. The worker and its copy of the pixels live
while the panel can be used and are released when Inspect exits, the image changes or the
editor closes. Code: `inspect/colors/` — the counting (`histogram.ts`) is pure and tested; the
worker, the hook and the view are separate, so NIW2-708 can restyle the panel. The real-app
check is `apps/kaipu-record/verify/image-colors.verify.ts`.

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

- Reopening a saved item with its measurements still editable works only behind `image-canvas`:
  the editable canvas document (M3, NIW2-700) keeps them since M6 (NIW2-703). With the flag off,
  a pinned measurement is baked into the saved PNG.
- The final look of the HUD, bar and colors panel: NIW2-708.
