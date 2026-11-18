---
title: Image editor — infinite canvas and Inspect mode
description: The image editor becomes an infinite canvas whose export is the box around its content, saved as an editable document beside a flattened PNG. On top of it, one Inspect mode gives a loupe, the live color under the cursor, a ruler that measures pixel runs, pinned measurements, a step counter, a colors panel, and text recognition on macOS and Windows.
---

# Image editor — infinite canvas and Inspect mode — design

**Status: 🔵 Proposed · 2026-11-11.** Nothing in this document is built. Linear:
[NIW2-696](https://linear.app/niway/issue/NIW2-696/image-editor-infinite-canvas-and-inspect-mode-ruler-loupe-color).
ADRs: [0053](/architecture/decisions/0053-the-image-editor-is-a-canvas-saved-as-a-document-beside-its-flattened-export/),
[0054](/architecture/decisions/0054-inspection-tools-read-the-pixels-of-a-captured-image-inside-the-editor/),
[0055](/architecture/decisions/0055-text-recognition-is-a-port-served-by-the-os-engine-on-each-platform/).
Absorbs [NIW2-480](https://linear.app/niway/issue/NIW2-480/image-editor-keep-annotations-editable-with-a-sidecar-scene-instead-of)
and the analysis in [re-editable screenshots](/backlog/screenshot-scene-doc/).

## Summary (one minute)

Today the image editor shows one screenshot inside a beautify frame, and saving bakes every
annotation into a flat PNG (`annotations/scene.ts`, `annotations/compositor.ts`). Two things
change.

**The editor becomes a canvas.** A capture lands in the middle of an infinite, pannable
surface. Objects can sit outside the image and more images can be added. Copy and Save take
the **content box**: the smallest rectangle that contains every item, plus the beautify padding. One image alone exports
exactly that image, as today. The canvas is saved as a document (items plus the original
images) beside the flattened PNG, so a saved screenshot reopens with its objects still
editable.

**Inspect is one mode for pixel-perfect work.** Inside it a loupe and the color under the
cursor follow the pointer, `1` measures horizontally, `2` vertically, a click pins the
measurement as an object, and `C` copies the color. A colors panel lists every color in the
image and shows where each is used. Text recognition, served by the operating system's own
engine on macOS and on Windows, makes the text inside a screenshot selectable and offers
each text block as a target to hide.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Why                                                                                                                                                                                                                                                                                                                          | ADR                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | The editor is an infinite canvas. Items (images and annotations) live in one world coordinate space.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Objects outside the image and a second image cannot be expressed in coordinates normalized to one shot.                                                                                                                                                                                                                      | 0053 (new)                       |
| 2   | Copy and Save export the **content box**: the union of every item's bounds. A manual export frame (today's crop tool) overrides it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The owner's rule: "the canvas does not stay; only the space of the content". One image alone must export unchanged.                                                                                                                                                                                                          | 0053                             |
| 3   | A saved item is three things: the flattened `<id>.png`, a canvas document, and the original image assets. The flattened PNG is always valid on its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Edits stay editable after saving (owner, 2026-11-11). A document that fails to parse must never make a screenshot unopenable.                                                                                                                                                                                                | 0053, absorbs NIW2-480           |
| 4   | A redaction is destructive at save: its pixels are replaced in the stored asset, not only in the flattened PNG. The redact tool offers a **strong blur** (the default: the region is reduced to coarse blocks, then smoothed) and `solid`; the current light gaussian is retired, and a redaction made with it is saved as the strong blur. Only `solid` is documented as hiding content for certain, and the tool says so: the block averages of short, predictable text (digits, a known font) can be matched against rendered candidates. A block is at least 24 image pixels and at least a quarter of the region's shorter side, a starting value M3 tests. | Keeping the original image beside a blurred export keeps the secret on disk; the current gaussian blur is documented as reversible in `annotations/tools.ts`.                                                                                                                                                                | 0053                             |
| 5   | Inspection tools live in the shared image editor and read the pixels of an image item. The capture overlay does not change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ADR 0022 keeps the overlay a geometry picker; a static image is where measuring is exact.                                                                                                                                                                                                                                    | 0054 (new)                       |
| 6   | The ruler measures a **pixel run**: from the cursor outward until the color differs from the starting pixel by more than a tolerance. No text recognition is involved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | It needs no native code, runs on every platform, and is how the open-source reference (PowerToys Screen Ruler) documents it.                                                                                                                                                                                                 | 0054                             |
| 7   | Inspect is one mode. Loupe and color readout are a cursor HUD and are never saved. A pinned measurement (`measure`) and a step badge (`step`) are annotations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | One key to enter, sub-tools on `1` and `2` (owner's proposal). What the user pins is content; what follows the cursor is not.                                                                                                                                                                                                | 0054                             |
| 8   | Sizes are shown in image pixels. No point or logical unit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | A pasted or reopened image carries no scale, and browser zoom makes "pt" ambiguous (owner chose pixels, 2026-11-11).                                                                                                                                                                                                         | 0054                             |
| 9   | The color readout is the sampled color converted **once** to sRGB, shown as hex by default with a format switch (hex, rgb, hsl, oklch) and an "as captured" switch that shows the display-profile value. Out-of-sRGB colors are marked.                                                                                                                                                                                                                                                                                                                                                                                                                          | A designer compares against the value they typed in CSS or Figma, which is sRGB; the raw number in a Display P3 capture differs from it.                                                                                                                                                                                     | 0054                             |
| 10  | Text recognition is a port in main with one backend per platform: Apple Vision through a Swift helper on macOS, `Windows.Media.Ocr` on Windows. Feature off where no backend answers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Works on both platforms the app captures on, adds no download and no npm dependency.                                                                                                                                                                                                                                         | 0055 (new, pending the M0 spike) |
| 11  | Recognized text is cached in the item's sidecar. Words under a baked redaction are removed from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Everything is local (owner, 2026-11-11), and a cache makes selection instant on reopen; a hidden word must not survive in a side file.                                                                                                                                                                                       | 0055                             |
| 12  | No new npm dependency. The SVG annotation layer and Canvas 2D compositor stay; scan, histogram and color math are written in-house.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The current layer already draws, selects and exports five annotation kinds; the adversarial review found no reason to adopt Konva or Fabric.                                                                                                                                                                                 | —                                |
| 13  | Padding is the beautify padding, unchanged: it applies at any background and stays transparent with `none`, and a fresh capture still opens with `none` and padding 0 (owner, 2026-11-11: no background by default for now). What is new is the gap between items: it is filled with the canvas background, and stays transparent when the background is `none` (amended 2026-11-16, see below).                                                                                                                                                                                                                                                                 | One image alone must export unchanged (decision 2); a transparent gap pastes as black in some apps, which the explicit White swatch answers (NIW2-851). Images stay off the edge of the export (owner, 2026-11-11) whenever a background with padding is chosen; the owner keeps a fresh capture without background for now. | 0053                             |
| 14  | Copy and Save always export the whole canvas (or the export frame). A selection does not narrow the export.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Owner, 2026-11-11: everything on the canvas for now; exporting a section waits until the editor needs it.                                                                                                                                                                                                                    | —                                |
| 15  | A second image arrives two ways: an **Add image** button that takes a new capture or picks an item already in Kaipu (the Library), and paste (`Cmd+V` / `Ctrl+V`) of an image on the clipboard. The new image lands as an image item the user can move on the canvas.                                                                                                                                                                                                                                                                                                                                                                                            | Owner, 2026-11-11. Dragging a file in from outside is not asked for and stays out.                                                                                                                                                                                                                                           | —                                |

## Open questions

1. **Windows text recognition latency.** M10 showed `Windows.Media.Ocr` can be driven from a
   PowerShell script with no compiled module. On a CI VM the first call took 3.4 s on a
   1920×1080 image, over the 1.5 s target; later calls took 0.5–0.8 s. The owner decides
   between keeping it, a compiled helper and the WASM fallback (ADR 0055, What would reopen
   this).
2. **Mocks.** The owner makes them with Claude Design from the
   [design brief](/specs/2026-11-11-image-editor-design-brief/). The milestones build the
   logic on the current editor chrome; M11 applies the mocks (owner, 2026-11-11).

## Out of scope

- Anything in the live capture overlay: no loupe, ruler or color readout while selecting.
- Points, logical units, or any unit other than image pixels.
- Detecting UI boxes (buttons, cards) as objects. Only text is recognized.
- Using recognized regions as zoom targets in the video editor. Separate spec, after M8.
- Exporting only the selected items or a named section of the canvas.
- Dragging an image file into the canvas from outside Kaipu.
- Scrolling capture, combining captures automatically, layout helpers (align, distribute).
- Cloud sync of the canvas document and assets. The flattened PNG keeps syncing as today.
- Linux. `screenshot-capture.ts` returns `unsupported` there.

## Failures this must protect against

These are risks, not observed incidents. Source: adversarial review by gpt-6.1-sol on
2026-11-11, judged against the repository.

- **A single image exports differently than today.** Size, pixels and beautify output must be
  byte-comparable with the current editor for a canvas holding one untouched image.
- **A document that cannot be read.** Corrupt JSON, a newer `schemaVersion` or a missing asset
  must fall back to editing the flattened PNG.
- **A secret left on disk.** After a redaction is saved, neither the stored asset nor the text
  cache may contain what it covered. `solid` guarantees that; the strong blur keeps one
  average color per block, so its minimum block size (decision 4) is what M3 must test.
- **A wrong hex.** Converting Display P3 to sRGB twice, or not at all, shows a color the
  designer did not choose. A translucent color reads as the composited result; the readout
  must not claim to recover the CSS value.
- **A run that is not the element.** Inside a button the scan stops at the label; a gradient
  stops it early; a borderless control has no edge. The tool must say what it measures, let
  the tolerance change, and let the user drag the endpoints.
- **Measuring the frame instead of the image.** A measurement taken over padding or empty
  canvas has no source pixel. Inspect only acts over an image item and stores endpoints in
  that image's pixel coordinates, so zoom and pan do not change the number.
- **Memory.** A 6144×3456 RGBA buffer is about 81 MiB before canvases and the export cache.
  One buffer per image, released when the image leaves the canvas.
- **A colors panel that freezes.** A photograph has millions of distinct colors; comparing
  every pair is quadratic. Quantize before grouping and run in a worker.
- **Keys that fire while typing.** `1`, `2`, `C` must be ignored in text fields and modal
  dialogs, as `annotation-layer.tsx` already does for Delete.
- **A helper that exists but fails.** Wrong architecture, timeout, malformed output. Each must
  end as "text recognition unavailable", never as a broken editor.
- **Step numbers after reopen.** With the document persisted, a reopened canvas continues at
  the next number; if the document was lost, numbering restarts at 1 over baked badges.

## Acceptance criteria

- [ ] A canvas with one untouched image copies and saves a PNG with the same dimensions and
      pixels as the current editor produces for the same capture and beautify settings.
- [ ] Text placed outside the image is included in the exported PNG, and the export is the
      box that contains the image and the text.
- [ ] With two images on the canvas, the exported PNG is the box that contains both.
- [ ] Saving, closing and reopening an item shows its annotations selectable and movable.
- [ ] Deleting the canvas document from disk and reopening the item opens the flattened PNG.
- [ ] After saving a redaction, the stored asset shows the redacted pixels and the text cache
      has no word that intersected it.
- [ ] In Inspect mode the loupe shows unsmoothed pixels and the readout matches a fixture of
      known sRGB swatches exactly, and a tagged Display P3 fixture within one unit per channel.
- [ ] `C` copies the color in the selected format; the format switch offers hex, rgb, hsl, oklch.
- [ ] `1` and `2` show the horizontal and vertical run under the cursor in image pixels; the
      number does not change when the canvas is zoomed.
- [ ] A click pins the measurement; it appears in the exported PNG and can be moved after reopen.
- [ ] The step tool places badges numbered 1, 2, 3 in order; deleting one renumbers the rest.
- [ ] The colors panel lists the image's colors with their share; clicking one highlights
      where it appears in the image. A 5K photograph does not block the UI for more than 100 ms.
- [ ] On macOS and on Windows, dragging over recognized text selects it and copies it.
- [ ] Clicking a recognized text block in the redact tool hides exactly that block.
- [ ] With the helper removed, the editor opens and the text tools report unavailable.

## Milestones

One issue and one PR each, in this order. A milestone starts when the one it depends on is
merged. Every UI milestone adds its areas and states to `ui-map.ts` (ADR 0046).

| #   | Milestone            | Delivers                                                                                                                                                                             | Depends on | Flag            |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------- |
| M0  | Spikes               | Color fixtures through capture, decode and readout; memory at 6K; Vision latency. macOS only. Results written into ADR 0054 and 0055.                                                | —          | —               |
| M1  | Inspect HUD          | Inspect mode, loupe, live color, `C` to copy, format switch, "as captured" switch.                                                                                                   | M0         | `image-inspect` |
| M2  | Canvas               | World coordinates, pan and zoom, content-box export, export frame replaces crop. One-image parity test.                                                                              | —          | `image-canvas`  |
| M3  | Editable saves       | Canvas document and assets on disk, reopen editable, flattened fallback, destructive redaction with the strong blur (minimum block size tested) and `solid`, light gaussian retired. | M2         | `image-canvas`  |
| M4  | Ruler                | Pixel-run scan, tolerance on the wheel, `1`/`2`, pinned `measure` annotation with draggable endpoints.                                                                               | M1, M2     | `image-inspect` |
| M5  | Step counter         | `step` annotation, auto-numbering, renumber on delete.                                                                                                                               | M2         | —               |
| M6  | More images          | **Add image** button (new capture or an item from the Library), paste from the clipboard, move the image on the canvas.                                                              | M3         | `image-canvas`  |
| M7  | Colors panel         | Quantized histogram in a worker, grouping of near-identical colors, click to locate.                                                                                                 | M1         | `image-inspect` |
| M8  | Text recognition     | Port, macOS helper, cache, select and copy text (Windows backend: M10).                                                                                                              | M0, M3     | `image-text`    |
| M9  | Hide recognized text | Recognized blocks as one-click redaction targets.                                                                                                                                    | M8, M3     | `image-text`    |
| M10 | Windows text         | The Windows spike moved out of M0, then the Windows backend behind the port.                                                                                                         | M8         | `image-text`    |
| M11 | Final UI             | The owner's mocks applied to every surface. Views and styles only. A surface can be done as soon as its logic is merged and its mock exists.                                         | the mocks  | —               |

M1 and M2 do not depend on each other and can run in parallel. M0 to M9 build the logic with
the current editor chrome and only the UI needed to use it; the final look is M11.

---

## Detail

### 1. Canvas model

```ts
interface CanvasDoc {
  schemaVersion: 1;
  items: CanvasItem[];          // z-order = array order
  frame: BeautifyState;         // background, padding, radius, shadow
  exportFrame?: WorldRect;      // manual override of the content box
}
type CanvasItem = ImageItem | Annotation;

interface ImageItem {
  id: string;
  kind: "image";
  assetId: string;              // .kaipu/<id>.assets/<assetId>.png
  x: number; y: number;         // world units, top-left
  w: number; h: number;         // world size; 1 world unit = 1 source pixel at scale 1
  pixelWidth: number; pixelHeight: number;
}
```

Annotations keep their current shapes (`box`, `arrow`, `text`, `path`, `blur`) with coordinates
moved from "normalized to the shot" to world units. New kinds:

```ts
interface MeasureAnnotation {
  id: string; kind: "measure";
  imageId: string;              // the image it was measured on
  axis: "x" | "y";
  from: number; to: number;     // source pixels along the axis
  at: number;                   // source pixel on the other axis
  color: string;
}
interface StepAnnotation {
  id: string; kind: "step";
  x: number; y: number; color: string; size: number;
  // the number is the item's position among `step` items, not stored
}
```

A `measure` is anchored to its image: moving the image moves the measurement, and the label is
always `to - from` in that image's pixels.

**Content box.** The union of every item's bounds (stroke and label included), then the
beautify padding around it. With one image and nothing else this is the current output.
A gap between items takes the background. With `none` it is transparent, like the padding
around it: the PNG keeps its alpha, and so do the clipboard and the PDF. The live view draws the
dark checker under the box, so the preview says what the export contains. A solid White swatch
(`white`, #ffffff) sits after the dark solids for people who want white, for example when pasting
into an app that flattens alpha to black.

_Amended 2026-11-16 (NIW2-851):_ this first said a neutral white solid filled the gap when the
background was `none` (“never a see-through void”). The owner tested it, found a transparent
swatch that exported white, and reversed it: `none` now means transparent everywhere.
Radius and shadow apply to each image item, the background to the whole box.

**Crop.** The crop tool becomes the export frame: a rectangle in world units that replaces
the content box. Items outside it are cut.

### 2. Storage

| File                               | Purpose                                                        |
| ---------------------------------- | -------------------------------------------------------------- |
| `<id>.png`                         | Flattened export. Thumbnail, Copy, share, cloud. Always valid. |
| `.kaipu/<id>.canvas.json`          | The `CanvasDoc`.                                               |
| `.kaipu/<id>.assets/<assetId>.png` | Each image as it was added, minus baked redactions.            |
| `.kaipu/<id>.text.json`            | Recognized words per asset (M8).                               |

Open: load the document and assets; on any failure load `<id>.png` as a single image item.
Save: bake redactions into the assets, write assets and document, re-flatten `<id>.png`.
A baked redaction stays in the document as a locked item so it still draws, but its source
pixels are gone.

The quiet capture path (ADR 0042: capture and copy without opening the editor) writes only
`<id>.png`; the document is created the first time the item is opened in the editor.

**As built in M3 (NIW2-700).** Coordinates stay normalized to the base image until M6 adds a
second image; the base asset is `base.png`; the strong blur's block is
`max(24, ceil(min(w, h) / 4))` pixels. The details are in ADR 0053's Implementation status.

**As built in M6 (NIW2-703).** The document is `schemaVersion: 2` with every geometry in world
units (one unit per base source pixel, base at 0,0); version 1 still opens. Inside the editor
the geometry stays normalized to the base, which remains the anchor. An added image is an
`image` item with its own `img-<random>` asset, and a redaction bakes into every image it
overlaps. ADR 0053's Implementation status has the reasoning.

### 3. Inspect mode

Entered with one key or a toolbar button; `Esc` leaves. While active, over an image item:

| Input                      | Effect                                                                        |
| -------------------------- | ----------------------------------------------------------------------------- |
| move                       | Loupe (unsmoothed pixels around the cursor) and color chip follow the pointer |
| `C`                        | Copy the color in the selected format                                         |
| `1` / `2`                  | Show the horizontal / vertical run under the cursor with its length           |
| wheel while a run is shown | Change the tolerance                                                          |
| click while a run is shown | Pin it as a `measure` annotation                                              |
| `Shift`                    | Measure the outer size (scan outward from both edges of the run)              |

Keys are ignored when a text field or a modal dialog has focus. Each key has a visible
control in the Inspect bar.

**Pixel buffer.** One `Uint8ClampedArray` per image item, decoded once through a canvas
created with an explicit `colorSpace`, kept while the item is on the canvas. M0 decides
whether the buffer is read in `display-p3` or `srgb`; whichever it is, conversion to the
other space happens exactly once, in one module with reference-vector tests.

**Scan.** From the cursor, step along the axis while the pixel is within the tolerance of the
**starting** pixel (per-channel maximum difference). Comparing with the start, not the
neighbor, keeps a gradient from being walked end to end.

### 4. Colors panel

Count colors in a worker after dropping the low bits of each channel (quantization), merge
bins whose representatives are closer than a threshold in OKLab, and show each group with its
share of the image and its exact most-frequent member. Clicking a swatch dims the image and
highlights the pixels in that group. The use case is spotting two near-identical values (two
whites) and seeing which region uses which.

### 5. Text recognition

```ts
interface TextRecognizer {
  recognize(png: Buffer): Promise<RecognizedWord[] | "unavailable">;
}
interface RecognizedWord {
  text: string;
  rect: { x: number; y: number; w: number; h: number }; // source pixels, top-left origin
  line: number;                                          // reading order
  confidence: number;
}
```

- **macOS:** a Swift helper (`native/text-recognition/main.swift`) built and shipped like
  `native/encoded-capture` (`swiftc`, universal, `resources/native`, `asarUnpack`). It reads a
  PNG path, prints versioned JSON, and is run with a timeout. Vision returns normalized,
  bottom-left boxes; the helper converts to top-left source pixels.
- **Windows:** `Windows.Media.Ocr`, reached without a compiled module if M0 shows it is
  viable (the window list already runs through a PowerShell script).
- Output is validated with a Zod schema; anything else is `"unavailable"`.

**Selecting text.** In the editor, recognized words are hit targets over the image. Dragging
selects a range in reading order, shown as highlights; copy puts the text on the clipboard.

**Hiding text (M9).** In the redact tool, hovering a recognized line outlines it; a click
creates a redaction over its box grown by a small margin, in the strong blur or `solid` style.

**As built in M8 (NIW2-705).** macOS only, behind `image-text`; it also works in the classic editor, whose saves delete the cache. The helper
reads the PNG on stdin instead of a path; the timeout is 45 s; the cache keys each asset by the
sha256 of the bytes recognized; selection is a **Select text** tool, so dragging elsewhere keeps
moving annotations. Details in ADR 0055's Implementation status.

**As built in M9 (NIW2-706).** Canvas mode only: the classic editor's gaussian blur is not a
redaction, so it offers no targets. A block is a recognized line (the words sharing a `line`
index). The margin is a quarter of the line's height, 2 to 16 px, and halves, then drops, rather
than touch another line's word. A press that turns into a drag still draws a region; the tool stays
on after a click so several lines are hidden in a row.

**As built in M10 (NIW2-707).** Windows, behind the same flag. A PowerShell 5.1 script passed
with `-EncodedCommand` reads the PNG base64 on stdin and prints the helper's JSON; boxes are
rotated back by the text angle; every word reports confidence 1, which Windows OCR does not
give. Timeout 30 s. Checked on a GitHub Windows runner, not on a real install. Details and
the measurement in ADR 0055's Implementation status.

### 6. Flags

`image-inspect`, `image-canvas`, `image-text`, added to `FLAG_NAMES` in `shared/analytics.ts`
with offline default off. `image-canvas` is removed once one-image parity and editable saves
pass owner QA; the canvas is then the only editor.

## Sources and unverified claims

- Owner request and sketches, 2026-11-11 (this ticket). Reference product: [Shottr](https://shottr.cc/).
- Shottr documents how to use its ruler, not how it works; pixel scanning is inferred from its
  behavior. PowerToys documents scan-until-tolerance:
  [Screen Ruler](https://learn.microsoft.com/en-us/windows/powertoys/screen-ruler).
- Canvas color spaces: [WebKit](https://webkit.org/blog/12058/wide-gamut-2d-graphics-using-html-canvas/),
  [MDN `ImageData.colorSpace`](https://developer.mozilla.org/docs/Web/API/ImageData/colorSpace).
- Not verified: that `screencapture` PNGs carry a Display P3 profile; Vision latency on a
  Retina screenshot. `Windows.Media.Ocr` from PowerShell was measured in M10 on a CI runner
  only (ADR 0055).
