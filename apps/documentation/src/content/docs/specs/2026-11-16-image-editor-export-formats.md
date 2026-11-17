---
title: Image editor — export as PNG, JPEG or WebP
description: An Export popover in the image editor that writes PNG, JPEG or WebP files with quality, scale and a Web preset, behind the image-canvas flag. Save keeps writing the library PNG.
---

# Image editor — export as PNG, JPEG or WebP

**Status: 🟡 In progress · 2026-11-16.** Requested by the owner ("let us export as PNG, JPEG, WebP, and
formats optimized for the web"). Tracked in
[NIW2-852](https://linear.app/niway/issue/NIW2-852/image-editor-export-as-png-jpeg-or-webp-with-quality-scale-and-a-web).

## Summary

The image editor can copy a PNG, save a PNG into the library, and export a PDF. It cannot write a
JPEG or a WebP, and it cannot make a file smaller. This adds an **Export** button beside PDF that
opens a popover: preset, format (PNG, JPEG, WebP), quality (JPEG and WebP), scale (0.5×, 1×, 2×), the
resulting pixel size and the real file size, and an Export button that opens the save dialog.

The files go where the person picks, outside the library, exactly like the PDF export. **Save does
not change**: it still writes one PNG into the library, linked to the editable document.

| Decision                                                                                 | Why                                                                                                                                                                     | ADR  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Formats are PNG, JPEG, WebP, encoded in the renderer with `canvas.toBlob(type, quality)` | Chromium encodes all three. No new dependency, no install script (repo rule)                                                                                            | none |
| An Export button beside PDF, **not** a split Save button                                 | Save writes `<id>.png` into the library next to the document that reopens it. A JPEG there would break reopening; Save is also a library action, not a file for someone | none |
| Export reuses the PDF's file-export IPC channel and extends its allowlist                | One path for "write a file the person picked"; main already validates it before any dialog                                                                              | none |
| Main validates the extension **and** the file's first bytes                              | `toBlob` returns a PNG, not an error, for a type it cannot encode. Without the check a ".webp" could be a PNG                                                           | none |
| Presets: Original (PNG 1×), Web (WebP 0.8, 1920 px), Small (JPEG 0.7, 1280 px), Custom   | The three things people want; any edit to a field becomes Custom                                                                                                        | none |
| The size cap only shrinks; it never upscales                                             | A 800 px shot under "Web" stays 800 px                                                                                                                                  | none |
| 2× is composited at 2×; 0.5× shrinks the 1× composite                                    | The annotations are vector until rasterized, so 2× is sharp, not an upscaled bitmap                                                                                     | none |
| JPEG is painted over white; the popover says so when the background is None              | A canvas encodes transparent pixels as black, and JPEG has no alpha                                                                                                     | none |
| The file size shown is a real encode, once per pause in changing settings                | A guess would be wrong for screenshots, where size depends a lot on content                                                                                             | none |
| Settings are remembered in `localStorage` (`kaipu.imageEditor.exportSettings`)           | Same mechanism as the redaction notice and onboarding flags; nothing to migrate                                                                                         | none |
| Behind `image-canvas`                                                                    | The pixel size comes from the canvas mode's export box. Flag off: the editor is exactly as before                                                                       | none |
| Every format goes through the one PNG composite                                          | Redactions are baked in once, for every format. There is no second compositing path                                                                                     | none |

**Open questions**

- Should a later version offer "Save as JPEG/WebP" into the library? That needs the library to hold
  non-PNG images, which it does not today. Not proposed here.
- Is a remembered export folder wanted? The dialog opens in Downloads each time, as PDF does.

**Out of scope:** AVIF (see below), an encoder library, PDF changes, Copy in any format other than
PNG, metadata (EXIF, ICC), exporting several files at once, a custom pixel size or a custom cap.
No new ADR: none of these decisions is structural.

## How Save works today (inventory)

This is why the Export button is separate.

1. **Renderer.** `onSave` composites with `exportScene("png", …)` (`export/index.ts`, one-entry memo)
   and calls `window.electronAPI.saveScreenshot(png, meta)`.
2. **IPC.** `screenshotSave` in `main/screenshots/screenshot-ipc.ts` calls `saveEditedScreenshot`.
3. **Main.** `saveScreenshotToVault` reserves an item id and a file name from the title, writes
   `<id>.png` into the workspace folder, then writes a sidecar with the title, creation time, source
   video link and, in canvas mode, the editable document and its assets.
4. **Where.** The active workspace's folder. There is no dialog.
5. **Metadata in the file.** None. Everything lives in the sidecar.

The PDF export is the other path: `screenshotExportFile` validates the bytes (`assertExportPayload`),
opens a save dialog in Downloads seeded with the title, and writes the file. No sidecar, no library
entry, the editor stays "dirty" as it was. Image export extends this path and nothing else.

## Behavior

**The button.** "Export" sits between Save and PDF in canvas mode (flag on). It is disabled until
the image is ready, like the other actions. The compact toolbar shows the icon only.

**The popover** (top to bottom):

- **Preset**: Original, Web, Small. A fourth segment, Custom, appears only when the settings match
  none of them. A line below says what the preset is.
- **Format**: PNG, JPEG, WebP.
- **Quality**: a slider from 10% to 100% in 5% steps. For PNG it is disabled and reads "Lossless".
- **Scale**: 0.5×, 1×, 2× of the export frame.
- **Result line**: `W × H px` and `≈ size`. The pixel size is computed at once; the size reads
  "Measuring size…" until a real encode finishes (250 ms after the last change), then "≈ 312 KB".
- **A note**, only for JPEG on the None background: "Transparent areas become white in JPEG."
- **Export…**: closes the popover and opens the save dialog.

Escape and a click outside close it. The last settings are remembered, so the next open starts
where this one ended; a fresh install starts on Original.

**The file.** The suggested name is the capture title plus the extension of the format (`png`, `jpg`,
`webp`). The dialog filter names the format. A cancelled dialog shows nothing. A failed encode shows
the error toast with Retry.

## Presets and sizes

| Preset   | Format | Quality | Scale | Longest side cap |
| -------- | ------ | ------- | ----- | ---------------- |
| Original | PNG    | —       | 1×    | none             |
| Web      | WebP   | 0.8     | 1×    | 1920 px          |
| Small    | JPEG   | 0.7     | 1×    | 1280 px          |
| Custom   | any    | any     | any   | none             |

The cap belongs to the preset: changing the format, quality or scale of a preset makes it Custom and
drops the cap; clicking the value that is already selected changes nothing and keeps the preset. The output size is `frame × scale`, then shrunk to the cap if it is larger. Examples
(illustrative): a 3840 × 2160 frame under Web becomes 1920 × 1080; an 800 × 600 frame under Web stays
800 × 600; a 1000 × 500 frame at 2× is 2000 × 1000.

At 2× the composite itself is rasterized at 2×, clamped by the compositor's 8192 px limit
(`clampRasterScale`). If it has to clamp, the output size is clamped with it rather than upscaling a
smaller bitmap.

## Where the code is

- `export/image-export-settings.ts`: pure. Presets, scaled size and cap, the plan for a frame, the
  JPEG rule, sanitizing stored settings.
- `export/image-encoder.ts`: decode the composited PNG, draw it at the plan's size (white under a
  JPEG), `toBlob`, and refuse a result whose type is not the one asked for.
- `export/image-exporter.ts`: `exportScene("png", …)` (the shared composite), then the encoder.
- `export/export-image-control.tsx`: the button and popover.
- `export/export-settings-store.ts`: the remembered settings.
- `ExportInput.rasterScale` (new, optional, part of the memo key): the one change to the shared seam.
  Absent means today's 1:1 PNG, so Copy and Save are untouched.
- `main/screenshots/export-file-name.ts`: the extension allowlist (`pdf`, `png`, `jpg`, `webp`) and
  the first-bytes check per format. `screenshot-ipc.ts` picks the dialog title and filter by
  extension.

## Privacy

Redactions are destructive and baked into the pixels by the composite (canvas mode). Every export
format starts from that composite, so a redacted area is redacted in JPEG and WebP too. The encoder
adds no metadata: canvas encoding writes no EXIF, and the file carries no title or source link.

## AVIF

Out of scope. Chromium's canvas encodes PNG, JPEG and WebP only; for any other type `toBlob` returns
a PNG. Electron 39 ships a recent Chromium, but this was **not verified at runtime**: the app was
not launched while building this. The encoder refuses a result whose type differs from the one
asked for, so adding AVIF later would fail loudly, not write a PNG named `.avif`. Supporting it would
need an encoder library, which the repo's native-dependency rules do not allow without a decision.

## Verification

- Unit tests: presets, scaled sizes and the 1920 cap, no upscaling, the JPEG rule, extension per
  format, stored-settings sanitizing, the encoder's calls (type, quality, white under JPEG,
  refusing a wrong type), the exporter's use of the one composite and its memo, and main's
  validation of extension and first bytes.
- Page tests: flag off shows no Export button and Save writes the PNG to the library; flag on with
  default or remembered WebP settings, Save is still the PNG; the popover's behavior end to end with
  the encoder stubbed.
- **Not run here:** a real encode in Electron (file sizes and Finder's "Get Info" check). That is
  the owner's manual test in the PR.
