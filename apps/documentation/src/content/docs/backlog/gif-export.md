---
title: "Video editor — export as an animated GIF"
description: "NIW2-217: export the edited timeline, or a range of it, as a looping GIF that keeps every edit (cuts, slides, overlays, zoom, burned-in privacy). Client-side gifenc encoder in a worker, size estimate, 30 s limit, saved as a local-only library item. Includes the encoder spike results."
---

# Video editor — export as an animated GIF

> **Status: 🟢 Ready to validate — implemented on `feat/NIW2-217-gif-export` (2026-10-09).**
> Unit, hook and component tests pass; the end-to-end export (WebCodecs decode in the worker,
> real recording, drag into GitHub/Slack) still needs a pass on the Mac mini with
> `bun run dev` or a packaged build. Spec: Linear NIW2-217 (approved with its proposed defaults).

## What the user gets

- **Export** in the editor opens an export sheet with a format row: **Video (MP4)** (exactly the
  previous export) or **GIF**. The sheet is built so NIW2-218 (presets) can add a presets row on top.
- GIF options: range in edited-timeline seconds (two fields + a mini slider, default the whole
  timeline), width 480 / 640 / 800 px (default 640, wider than the source is disabled), 10 / 15 fps
  (default 15). Loop is always forever (NETSCAPE2.0, count 0). No audio.
- A live **size estimate** (refreshed 250 ms after the last change), a hard block outside
  0.5–30 s with the reason in the sheet, and a non-blocking warning above 10 MB (GitHub's limit).
- Progress + cancel in the existing export dialog. Cancel terminates the worker; nothing is
  written, because the file only reaches main once it is complete.
- The GIF lands in the vault as `<id>.gif` with a sidecar (`title` = "{title} (GIF)",
  `durationSeconds`, `derivedFromAssetId`, size and fps) and a JPEG of the first frame. The user
  stays in the editor and gets a toast with **Open**.
- Library: a **GIF** badge, grouped under Recordings (no new chip), listed under the source's
  exports (lineage). The detail page plays it in an `<img>` (loops natively), shows size,
  dimensions and fps, and supports Reveal in Finder, rename, delete and **native drag-out**.
- Local-only: `isCloudUploadEligible()` returns false for `kind: "gif"`; NIW2-214 must use it in
  the UI and in its main-process upload handler (there is no upload path on `main` yet).

## How it works

| Piece                                                                              | File                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Per-frame composition shared with the MP4 worker (redactions, zoom crop, overlays) | `export/compose-output-frame.ts`                        |
| Range slicing, frame schedule (7/7/6 cs at 15 fps), output size, range limits      | `export/export-plan.ts`                                 |
| Palette, frame differencing, streaming writer, estimate arithmetic                 | `export/gif-encode.ts`                                  |
| Worker: `canvasesAtTimestamps` → compose at source size → downsample → encode      | `export/gif-worker.ts`                                  |
| Hook: estimate + export + save, cancel via `terminate()`                           | `export/use-gif-export.ts`                              |
| Sheet UI                                                                           | `components/export-sheet.tsx`                           |
| Atomic save + validation (GIF89a, ≤ 64 MB, no caller path)                         | `src/main/library/gif-save.ts`, `LibraryVault.writeGif` |

Size strategy: one global palette (gifenc `quantize`, rgb565, 255 colours; index 255 reserved for
transparency) from 8 frames sampled across the range. Every frame after the first writes pixels
within a channel delta of 4 of what is already on screen as transparent, is cropped to the
bounding box of what changed, and uses disposal 1. A frame with no change extends the previous
frame's delay. gifenc always writes a 0,0 image offset, so cropped frames are encoded by a second
encoder in manual mode and their image-descriptor offset is patched.

Frames are composed at **source resolution** through the same composer the MP4 export uses and
downsampled once with `imageSmoothingQuality = "high"`, so redaction and overlay geometry are
identical to the MP4 by construction (decided in the spike: composing directly at 640 px would
need its own parity proof for privacy).

## Encoder spike (gifenc vs gifski-wasm)

Reference clip: synthetic 10 s, 1920×1080 "UI" recording (code editor window scrolling text, a
blinking caret, over a gradient wallpaper), downscaled to 640×360 at 15 fps = 150 frames. Run on
the Mac mini with Bun, encoders only (decode and composition are not part of these numbers —
WebCodecs is not available outside the app).

| Encoder                                                   | Size        | Encode time | Notes                                                                                                  |
| --------------------------------------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| **gifenc + Kaipu pipeline** (global palette, diff + crop) | **3.48 MB** | **0.48 s**  | Estimate 2.99 MB (−14 %, inside ±30 %). Text sharp; visible stepped banding on the gradient wallpaper. |
| gifski-wasm 2.2.0 (quality 80)                            | 5.14 MB     | 4.3 s       | Smoother gradients (dithering). Needs all 150 frames in memory (138 MB here), AGPL-3.0, ~290 KB WASM.  |

Decision: **gifenc** for v1 (open question 6's default). It is smaller and ~9× faster on UI
footage, streams one frame at a time, and is MIT. Banding on gradients/wallpapers is the visible
trade-off; gifski-wasm stays the fallback if the owner finds it unacceptable on real recordings.

Not measured yet: the full in-app time for a real 10 s 1080p recording (spec target ≤ 20 s) and
the estimate error on real footage — both need the app running on the Mac mini.

## Open follow-ups

- Toast has one action (**Open**); "Show in Finder" is on the GIF's detail page. A second toast
  action needs a change to the shared `ToastList` in `@kaipu/ui`.
- Copy-animated-GIF to clipboard (spec open question 5) — follow-up spike.
- Animated WebP / APNG — follow-ups.
