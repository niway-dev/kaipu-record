---
title: "Video editor — export presets per destination"
description: "NIW2-218: pick a destination before exporting (Original, YouTube 16:9, Vertical 9:16, Square 1:1, Small file 10/25 MB) and get a file that fits it — size, aspect, bitrate or size cap — with the moov box at the front (fast start) on every export."
---

# Video editor — export presets per destination

> **Status: 🟢 Ready to validate — implemented as three stacked PRs on top of NIW2-217 (#266): #269 → #271 → this slice.**
>
> 1. Pipeline + fast start (`feat/NIW2-218-export-presets`).
> 2. Preset picker in the export sheet (`feat/NIW2-218-export-presets-ui`).
> 3. Small-file post-export size check + retry (`feat/NIW2-218-small-file`).
>
> Unit, hook and component tests pass; real exports (WebCodecs in the worker, VideoToolbox rate
> control, `ffprobe` on the outputs, playback in Safari/Chrome/QuickTime) still need a pass on the
> Mac mini. Spec: Linear NIW2-218 (approved with its proposed defaults).

## What the user gets

| Preset                       | Output                                           | Bitrate                        | Notes                                                   |
| ---------------------------- | ------------------------------------------------ | ------------------------------ | ------------------------------------------------------- |
| **Original**                 | Source's native size                             | `QUALITY_HIGH` (unchanged)     | Only change: fast start.                                |
| **YouTube 16:9**             | 1920×1080                                        | 8 Mbps ≤ 30 fps, 12 Mbps above | Always Fit, black padding.                              |
| **Vertical 9:16**            | 1080×1920                                        | 8 / 12 Mbps                    | Fill (default) or Fit with a blurred-frame padding.     |
| **Square 1:1**               | 1080×1080                                        | 4.5 / 6.75 Mbps (pixel-scaled) | Fit (default) or Fill.                                  |
| **Small file 10 MB / 25 MB** | Source aspect, short side 1080 → 720 → 540 → 480 | Computed from the duration     | Mono 64 kbps AAC, fps ≤ 30 below 1080p, never upscales. |

- Fixed canvases always output the exact preset size (upscaling a smaller source).
- Audio on fixed presets is AAC 128 kbps at the source layout and sample rate.
- **Fill** crops a centred window of the composed (zoomed) view, so it follows the zoom camera.
- Slides are always contained (Fit), never cropped.
- The last preset and framing are remembered app-wide (settings), never in the edit session.
- The export is a new library item with `derivedFromAssetId` and `exportPreset` in its sidecar; the
  title suffix depends on the preset ("(editado)", "(YouTube)", "(vertical)", "(cuadrado)",
  "(10 MB)" / "(25 MB)").

## How it works

All numbers live in one pure, worker-safe module:
`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-presets.ts`
(`PRESETS`, `resolveExportTarget`, `packetCountsFor`, `SMALL_FILE_LADDER`, with the platform sources
in comments).

**Frame pipeline (worker).** Original and Small file compose straight onto the output canvas — the
same aspect as the source, so the existing composition (frame → redactions → content-pinned overlays
→ zoom crop) runs unchanged, just at the output size. Fixed-canvas presets compose a **source-size
view** first, exactly like Original, then `createFramer` (in `compose-output-frame.ts`) places that
view on the target canvas with `framingRect` (Fit or Fill). Privacy is decided on the view, before
framing, so a redaction always covers the same content pixels.

**Fast start.** Every preset uses `Mp4OutputFormat({ fastStart: 'reserve' })` with
`maximumPacketCount` on each track: video `ceil(D × fps × 1.33) + slide frames` (never assuming
< 30 fps without a cap, since screen recordings are variable-rate), audio
`ceil(D × sampleRate / 1024 × 1.33)`. The worker raises the renderer's counts with the real source
rate. Never `'in-memory'` (it buffers the whole file — the OOM in the fable audit). If mediabunny
throws "maximum packet count", the hook aborts that attempt's writer session and retries **once**
with `fastStart: false` (logged to `captureException`).

**Small file.** Budget `B = cap × 0.92`, minus the moov reservation. `V = (B × 8 − 64 kbps × D) / D`,
then the largest rung whose floor `V` clears (1.2 Mbps / 600 / 350 / 250 kbps), capped at the
fixed-preset rate for that size so a short clip doesn't get a pointlessly high bitrate. If even
480p at 250 kbps doesn't fit, the sheet warns and shows the longest duration that fits; exporting
is still allowed ("Export anyway"). After the worker is done, the hook stats the temp file
(`recordingStat` IPC); over the cap it aborts that session and re-encodes once at
`V × 0.8 × cap / actual` (or one rung lower), showing "Making it smaller…". A second overshoot is
kept, with a toast giving its real size.

## Measured / to measure

- The moov reservation is an upper bound (~35 bytes per packet): ≈ 430 KB on a 2-minute export
  (≈ 4 % of a 10 MB cap). It is subtracted from the Small-file budget.
- To measure on the Mac mini: export-time cost of the composite path on fixed presets (expected
  +10–30 %), VideoToolbox overshoot on Small file, and whether `elst` appears (the first output
  frame is clamped to t = 0, so it shouldn't).

## Not in v1

Server transcoding, HLS/DASH, direct publishing, HEVC/VP9/AV1, custom resolution/bitrate,
screenshot presets, export from the library without the editor, batch export, a background system
for the video editor (padding is black or a blurred copy of the frame).
