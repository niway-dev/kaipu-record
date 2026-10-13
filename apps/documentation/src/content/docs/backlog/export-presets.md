---
title: "Video editor — export presets per destination"
description: "NIW2-218: one export sheet grouped by intent — Balanced (recommended, 1080p · 15 fps · 2 Mbps), Light (720p · 15 fps · 1.2 Mbps) for GitHub · Jira · Linear · Slack, YouTube, Reels · TikTok · Shorts, Feeds, Maximum quality — quality tiers measured on screen text, with fast start. Exports run in the background with in-app progress and Ready to share cards; Share exports the whole recording from its library page."
---

# Video editor — export presets per destination

> **Status: 🟢 Ready to validate — stacked PRs on top of NIW2-217 (#266): #269 → #271 → #272 →
> export quality → Share button → redesign → background export → quality tiers.** The tier numbers
> were measured with ffmpeg VideoToolbox; the in-app WebCodecs path still needs the owner's eye
> (below).
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
> 7. Quality tiers replace the size-capped Small-file rows (`feat/NIW2-218-quality-tiers`).
>
> Unit, hook and component tests pass; real exports (WebCodecs in the worker, VideoToolbox rate
> control, `ffprobe` on the outputs, playback in Safari/Chrome/QuickTime) still need a pass on the
> Mac mini. Spec: Linear NIW2-218 — its "Update 2026-10-10 — Combined design: one Share flow"
> section overrides the original spec.

## What the user gets

One sheet, shared by the editor's Export (titled "Export") and the library's Share ("Share a
copy"), subtitled with the recording's title · duration · resolution. A before/after meter shows
the selected row's estimate against the original's size ("~9.7 MB · 92% lighter"). The rows are
grouped by what the user is about to do — **Recommended** (Balanced), **Share in a tool** (Light,
for GitHub · Jira · Linear · Slack), **Post** (YouTube, Reels · TikTok · Shorts, Feeds), **Keep**
(Maximum quality). Each row shows where it works, its size
in MB ("~" for the quality tiers, "up to ~" for the fixed canvases, "Full size" for
Maximum, which has no estimate) and its output dimensions. The selected row opens with a one-line
explanation and ✓ facts; Reels and Feeds add a framing preview with Fill / Fit. The copy never
says bitrate or fps. The selected row is preselected from Settings → Export quality (or Light,
from a "light copy" shortcut), and Enter exports it ("Export ~9.7 MB ↵").

The internal preset ids and numbers:

| Row                             | Output                                           | Bitrate                                | Notes                                               |
| ------------------------------- | ------------------------------------------------ | -------------------------------------- | --------------------------------------------------- |
| ⭐ **Balanced** (`balanced`)    | Source aspect, short side ≤ 1080, never upscaled | 2 Mbps (fewer below 1080p), ≤ 15 fps   | Recommended default, ~16 MB/min. AAC 128 kbps.      |
| **Light** (`light`)             | Source aspect, short side ≤ 720, never upscaled  | 1.2 Mbps (fewer below 720p), ≤ 15 fps  | ~9 MB/min. Mono AAC 64 kbps (with fallbacks).       |
| **YouTube 16:9**                | 1920×1080                                        | 8 Mbps ≤ 30 fps, 12 Mbps above         | Always Fit, black padding.                          |
| **Vertical 9:16**               | 1080×1920                                        | 8 / 12 Mbps                            | Fill (default) or Fit with a blurred-frame padding. |
| **Square 1:1**                  | 1080×1080                                        | 4.5 / 6.75 Mbps (pixel-scaled)         | Fit (default) or Fill.                              |
| **Maximum quality** (`maximum`) | Source's native size                             | `QUALITY_HIGH` (the pre-preset export) | Was "Original". Fast start.                         |

- Fixed canvases always output the exact preset size (upscaling a smaller source).
- Audio on fixed presets is AAC 128 kbps at the source layout and sample rate.
- **Fill** crops a centred window of the composed (zoomed) view, so it follows the zoom camera.
- Slides are always contained (Fit), never cropped.
- Fit/Fill show only under the selected row.
- **GitHub fit chips** on Balanced and Light, from the estimate (and on the Ready card, from the
  real size): two small chips side by side, one per plan
  ([GitHub's limits](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)).
  "✓ GitHub Free · 10 MB", or muted "GitHub Free · over 10 MB"; "✓ GitHub Pro / Team /
  Enterprise · 100 MB", or amber "Too big for GitHub — export a shorter part". The heavy-file
  banner and the Recording saved card go by the paid limit (teams are assumed to be on one).
  A chip never blocks the export and never lowers the quality: the tier is the floor.
- **Settings → Export quality** (right below Recording quality, `AppSettings.exportQuality`,
  "balanced" | "maximum", sanitized like `recordingQuality`) picks the preselected row. Default
  Balanced for everyone, including people who record at Maximum. Another row applies to that one
  export; nothing is remembered. It replaced the "last used" memory (`lastExportPreset` /
  `lastExportFraming`): settings files that still carry those keys load fine and drop them.
- The export is a new library item with `derivedFromAssetId` and `exportPreset` in its sidecar; the
  title suffix depends on the preset ("(edited)" for Balanced and Maximum, "(YouTube)",
  "(vertical)", "(square)", "(light)"). Older sidecars say `"original"` (read as `maximum`) or
  `"small-10"` / `"small-25"` (read as `light`), via `normalizeExportPresetId`.
- "Already exported" compares the content fingerprint **plus the preset's encode revision**
  (`encodeFingerprint`, `ENCODE_REVISION`): a Balanced file made with the old 30 fps · 3 Mbps
  numbers, or an old Small-file export now read as Light, is never offered as the new encode.

## Background exports and status cards

Exports run in the background (`export/export-runner.ts`, a module singleton like the recorder
store): Export closes the sheet, and the export keeps running while the user moves around the app
or keeps editing. **One at a time** — a second Export or Share while one runs shows "Already
exporting “…”" instead of a sheet. Cards stack in the top-right corner of the window
(`features/status-cards/`, mounted at the app root):

- **Progress:** "Making a lighter copy…", the preset and output size, a progress bar,
  "64% · about 25 s left" (projected from the rate so far), "119 MB → ~9.7 MB", and Cancel. A failure turns it into an error card with Retry.
- **Ready to share:** the real size ("Ready to share · 8.1 MB"), "93% lighter than the original.",
  for the tiers the two GitHub plan chips from the real size,
  the before/after meter, and a file chip that drags out natively under the item's title
  ("Demo (light).mp4"), not its vault id — main hard-links the vault file into a temp folder
  under that name and cleans it on the next drag and on quit. Buttons: **View file** (the
  exported item's Library page), **Show in Finder**, **Done**. It replaces the old "Export saved"
  toast.
- **Recording saved:** right after a recording over 10 MB, its page shows "Recording saved" with
  the Light estimate on a before/after bar ("~9.7 MB · fits GitHub", GitHub only when it fits)
  and **Share a light copy**, which opens the sheet on the Light row. Hides after 8 s (paused while hovered); Settings →
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
copy — about 13 MB, small enough for GitHub or Jira." (the Light estimate; GitHub is promised
only when it fits) with "Make a light copy →" (the sheet on the Light row).
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
(`QUALITY_TIERS`, `PRESETS`, `resolveExportTarget`, `packetCountsFor`, with the platform sources
and the tier measurements in comments).

**Frame pipeline (worker).** The tiers and Maximum compose straight onto the output canvas — the
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

**Quality tiers.** A tier is a quality floor, not a size target: short side ≤ the tier's (never
upscaled), ≤ 15 fps, its bitrate (scaled down by pixel count for a smaller source). The size is
whatever the duration makes it — `(video + audio) × D / 8` plus the moov reservation — and the
sheet says whether it fits GitHub. They replace the size-capped Small-file rows (the ladder down to
480p at 250 kbps, the "Export anyway" warning and the post-export shrink-and-retry), which turned a
2:51 terminal recording into an unreadable 852×480 at 245 kbps.

## Measured / to measure

- **Tier numbers (2026-10-13), measured with ffmpeg `h264_videotoolbox`** — the same macOS
  hardware encoder as the app, but **not** the in-app WebCodecs path — on the owner's real 1440p
  terminal recording (scrolling small mono text), 20 s clips:

  | Output                | Result                           |
  | --------------------- | -------------------------------- |
  | 480p · 24 fps · 250k  | blocks, unreadable               |
  | 720p · 30 fps · 1.2M  | unreadable                       |
  | 720p · 30 fps · 1.8M  | readable, with ghosting          |
  | 720p · 15 fps · 800k  | readable but smudged             |
  | 720p · 15 fps · 1.2M  | clean, ~9 MB/min → **Light**     |
  | 1080p · 15 fps · 1.2M | smudged                          |
  | 1080p · 15 fps · 2M   | clean, ~16 MB/min → **Balanced** |
  | 1080p · 30 fps · 3M   | smudged (the previous Balanced)  |
  | 1080p · 30 fps · 4M   | still smudged                    |

  Frame rate matters more than resolution for screen recordings, and VideoToolbox lands almost
  exactly on the target bitrate (size ≈ bitrate × duration), so the estimates hold. **Pending:**
  the owner's eye on real exports through the app (WebCodecs in the worker), and the owner's
  call on Light vs the 1080p tier — the numbers are one table (`QUALITY_TIERS`), so a change is
  one line.

- The moov reservation is an upper bound (~35 bytes per packet): ≈ 100 KB on a 2-minute Light
  export.
- To measure on the Mac mini: export-time cost of the composite path on fixed presets (expected
  +10–30 %), and whether `elst` appears (the first output frame is clamped to t = 0, so it
  shouldn't).

## Not in v1

Server transcoding, HLS/DASH, direct publishing, HEVC/VP9/AV1, custom resolution/bitrate,
screenshot presets, batch export, more than one export at a time, share by link (cloud, also
the answer for GitHub's free 10 MB), squeezing a file below its tier to fit a limit,
auto-export after recording, a background system for the video editor (padding is black or a blurred copy of the frame).
