---
title: "Video editor — export presets per destination"
description: "NIW2-218: one export list — Balanced 1080p (recommended default), YouTube 16:9, Vertical 9:16, Square 1:1, GitHub ≤ 10 MB, Chat / Discord ≤ 25 MB, Maximum quality — each producing a file that fits, with the moov box at the front (fast start). The default comes from Settings → Export quality."
---

# Video editor — export presets per destination

> **Status: 🟢 Ready to validate — stacked PRs on top of NIW2-217 (#266): #269 → #271 → #272 →
> export quality → Share button.** The Balanced numbers are **pending the quality probe** (below).
>
> 1. Pipeline + fast start (`feat/NIW2-218-export-presets`).
> 2. Preset picker in the export sheet (`feat/NIW2-218-export-presets-ui`).
> 3. Small-file post-export size check + retry (`feat/NIW2-218-small-file`).
> 4. One list with Balanced recommended + Maximum, Settings → Export quality
>    (`feat/NIW2-218-export-quality`).
>
> Unit, hook and component tests pass; real exports (WebCodecs in the worker, VideoToolbox rate
> control, `ffprobe` on the outputs, playback in Safari/Chrome/QuickTime) still need a pass on the
> Mac mini. Spec: Linear NIW2-218 — its "Update 2026-10-10 — Combined design: one Share flow"
> section overrides the original spec.

## What the user gets

One list, in this order. The selected row is preselected from Settings → Export quality, and
Enter exports it.

| Row                                | Output                                           | Bitrate                                | Notes                                                   |
| ---------------------------------- | ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------- |
| ⭐ **Balanced 1080p** (`balanced`) | Source aspect, short side ≤ 1080, never upscaled | ~3 Mbps (fewer below 1080p), ≤ 30 fps  | Recommended default, ~23 MB/min. Numbers pending probe. |
| **YouTube 16:9**                   | 1920×1080                                        | 8 Mbps ≤ 30 fps, 12 Mbps above         | Always Fit, black padding.                              |
| **Vertical 9:16**                  | 1080×1920                                        | 8 / 12 Mbps                            | Fill (default) or Fit with a blurred-frame padding.     |
| **Square 1:1**                     | 1080×1080                                        | 4.5 / 6.75 Mbps (pixel-scaled)         | Fit (default) or Fill.                                  |
| **GitHub** (`small-10`)            | Source aspect, short side 1080 → 720 → 540 → 480 | Computed from the duration, ≤ 10 MB    | Mono 64 kbps AAC, fps ≤ 30 below 1080p, never upscales. |
| **Chat / Discord** (`small-25`)    | Same ladder                                      | Computed from the duration, ≤ 25 MB    | Same as GitHub.                                         |
| **Maximum quality** (`maximum`)    | Source's native size                             | `QUALITY_HIGH` (the pre-preset export) | Was "Original". Fast start.                             |

- Fixed canvases always output the exact preset size (upscaling a smaller source).
- Audio on fixed presets is AAC 128 kbps at the source layout and sample rate.
- **Fill** crops a centred window of the composed (zoomed) view, so it follows the zoom camera.
- Slides are always contained (Fit), never cropped.
- Fit/Fill and the "cap can't be met" warning show only under the selected row.
- **Settings → Export quality** (right below Recording quality, `AppSettings.exportQuality`,
  "balanced" | "maximum", sanitized like `recordingQuality`) picks the preselected row. Default
  Balanced for everyone, including people who record at Maximum. Another row applies to that one
  export; nothing is remembered. It replaced the "last used" memory (`lastExportPreset` /
  `lastExportFraming`): settings files that still carry those keys load fine and drop them.
- The export is a new library item with `derivedFromAssetId` and `exportPreset` in its sidecar; the
  title suffix depends on the preset ("(edited)" for Balanced and Maximum, "(YouTube)",
  "(vertical)", "(square)", "(10 MB)" / "(25 MB)"). Older sidecars say `"original"`; readers
  treat it as `maximum` (`normalizeExportPresetId`).

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

- **Balanced (pending, do not treat as final):** before fixing the ~3 Mbps / 1080p / 30 fps
  numbers in `export-presets.ts`, run the quality probe on a real Kaipu export with zoom pans
  (small text while panning) at ~3 Mbps and lower, and check via `onEncoderConfig` that
  VideoToolbox keeps `bitrateMode: "variable"` with `prefer-hardware`. Reference weights from
  NIW2-227: recording default 8 Mbps (~61 MB/min); the old editor export `QUALITY_HIGH` ≈ 5.4 Mbps
  at 1662×1080 (~40 MB/min).

- The moov reservation is an upper bound (~35 bytes per packet): ≈ 430 KB on a 2-minute export
  (≈ 4 % of a 10 MB cap). It is subtracted from the Small-file budget.
- To measure on the Mac mini: export-time cost of the composite path on fixed presets (expected
  +10–30 %), VideoToolbox overshoot on Small file, and whether `elst` appears (the first output
  frame is clamped to t = 0, so it shouldn't).

## Not in v1

Server transcoding, HLS/DASH, direct publishing, HEVC/VP9/AV1, custom resolution/bitrate,
screenshot presets, export from the library without the editor, batch export, a background system
for the video editor (padding is black or a blurred copy of the frame).
