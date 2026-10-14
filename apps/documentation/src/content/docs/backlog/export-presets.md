---
title: "Video editor — export presets per destination"
description: "NIW2-218: one export sheet grouped by intent — Balanced (recommended), GitHub · Jira · Linear ≤ 10 MB, Slack · Discord ≤ 25 MB, YouTube, Reels · TikTok · Shorts, Feeds, Maximum quality — each producing a file that fits, with fast start. Exports run in the background with in-app progress and Ready to share cards; Share exports the whole recording from its library page."
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
> 5. Share button on the recording's page + "already exported → reuse"
>    (`feat/NIW2-218-share-button`).
> 6. Export flow redesign (owner, 2026-10-13): the sheet redesign and the "heavy to send" banner
>    (`feat/NIW2-218-share-sheet-design`), then background exports with the progress, Ready to
>    share and Recording saved cards (`feat/NIW2-218-background-export`). Design: Claude Design
>    project `71546ef1-baf5-42e9-8fcc-9b9b44f2c7ab`, file `Kaipu Export.dc.html`.
>
> Unit, hook and component tests pass; real exports (WebCodecs in the worker, VideoToolbox rate
> control, `ffprobe` on the outputs, playback in Safari/Chrome/QuickTime) still need a pass on the
> Mac mini. Spec: Linear NIW2-218 — its "Update 2026-10-10 — Combined design: one Share flow"
> section overrides the original spec.

## What the user gets

One sheet, shared by the editor's Export (titled "Export") and the library's Share ("Share a
copy"), subtitled with the recording's title · duration · resolution. A before/after meter shows
the selected row's estimate against the original's size ("~9.2 MB · 92% lighter"). The rows are
grouped by what the user is about to do — **Recommended** (Balanced), **Share in a tool** (GitHub ·
Jira · Linear, Slack · Discord), **Post** (YouTube, Reels · TikTok · Shorts, Feeds), **Keep**
(Maximum quality) — and named after where the file goes. Each row shows where it works, its size
in MB ("~" for Balanced and the capped rows, "up to ~" for the fixed canvases, "Full size" for
Maximum, which has no estimate) and its output dimensions. The selected row opens with a one-line
explanation and ✓ facts; Reels and Feeds add a framing preview with Fill / Fit. The copy never
says bitrate or fps. The selected row is preselected from Settings → Export quality (or GitHub,
from a "light copy" shortcut), and Enter exports it ("Export ~9.2 MB ↵").

The internal preset ids and numbers:

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

## Background exports and status cards

Exports run in the background (`export/export-runner.ts`, a module singleton like the recorder
store): Export closes the sheet, and the export keeps running while the user moves around the app
or keeps editing. **One at a time** — a second Export or Share while one runs shows "Already
exporting “…”" instead of a sheet. Cards stack in the top-right corner of the window
(`features/status-cards/`, mounted at the app root):

- **Progress:** "Making a lighter copy…" (or "Making it smaller…" during the size-check retry),
  the preset and output size, a progress bar, "64% · about 25 s left" (projected from the rate
  so far), "119 MB → ~9.2 MB", and Cancel. A failure turns it into an error card with Retry.
- **Ready to share:** the real size ("Ready to share · 8.1 MB"), "93% lighter than the original —
  under the 10 MB limit" (the limit only for capped rows; over it, the real size in amber), the
  before/after meter, and a file chip that drags out natively under the item's title
  ("Demo (10 MB).mp4"), not its vault id — main hard-links the vault file into a temp folder
  under that name and cleans it on the next drag and on quit. Buttons: **View file** (the
  exported item's Library page), **Show in Finder**, **Done**. It replaces the old "Export saved"
  toast.
- **Recording saved:** right after a recording over GitHub's 10 MB limit, its page shows
  "Recording saved" with the GitHub estimate on a before/after bar and **Share a light copy**,
  which opens the sheet on the GitHub row. Hides after 8 s (paused while hovered); Settings →
  Export quality → "Offer a light copy after recording" turns it off
  (`AppSettings.showRecordingSavedCard`). The card component is generic, for a future "uploaded
  to the cloud" card.

From the editor, the user stays in the editor; when the export finishes, the edit session is
stamped as exported only if it still holds the exported edit (the user may have kept editing, or
left). Leaving the editor with unsaved edits keeps the discard guard. Closing the window or
quitting while an export runs asks first ("Cancel export and close / quit"); on confirm, main asks
the renderer to cancel (its writer session is aborted, no temp file left) and closes after it
stops or 2 s.

## Share (export without the editor)

**Share** is the primary button on the library item page of every local recording, raw or already
an export, next to Edit video / Reveal / Delete. That page is also where a recording lands the
moment it stops (`fromRecording`), so it is the "right after recording" entry point too. Over 25
MB the size shows in amber and a teal banner says "119 MB is heavy to send. Share makes a lighter
copy — about 9.2 MB for GitHub or Jira." with "Make a light copy →" (the sheet on the GitHub row).
Share exports the **whole file as it is on disk**: no edits applied, even when the recording has an
edit session. The editor's Export keeps applying the edits.

- Same export worker, trivial plan: `initialScene(duration)` — one clip over the whole file,
  no overlays, slides or zoom. No second pipeline (`features/library/components/share-recording.tsx`).
- Without a `<video>` element to ask, `probeSource` reads the display size, exact duration (the
  sidecar's is floored), frame rate and audio layout from the file.
- The result is a new library item derived from the shared one (ADR 0003). Balanced and Maximum
  are titled "(for sharing)"; destination rows keep their suffix. It shows under Exports, and the
  Ready to share card takes over.
- Share by link (cloud) is not built; it joins this button once NIW2-214/216/222 land. No
  auto-export after recording: the Recording saved card only offers it.

### Already exported → reuse

Each MP4 export now records **what** it encoded in its sidecar, `exportFingerprint`: `"whole"`
for Share, `"edit:<hash>"` (a hash of the scene with sorted keys) for the editor. A sheet row
shows a "✓ Already exported · Open" badge — and the main button, and Enter, open it —
when a local MP4 export of the same source (`derivedFromAssetId`) has the same preset
(`exportPreset`) and the same fingerprint (`findReusableExports` in `export-reuse.ts`). Open
goes to that item's page.

Why a fingerprint rather than the session stamps (`editExportedSavedAt === editSavedAt`): the
stamp only says the newest export carries the current edit. An older export with the same preset
may hold an earlier cut, and reusing it would ship the wrong video. Exports made before this
change have no fingerprint and are never reused — the safe answer is to encode again.

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
kept, and the Ready to share card gives its real size.

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
screenshot presets, batch export, more than one export at a time, share by link (cloud),
auto-export after recording,
a background system for the video editor (padding is black or a blurred copy of the frame).
