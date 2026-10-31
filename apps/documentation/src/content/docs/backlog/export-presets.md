---
title: "Video editor — export presets per destination"
description: "NIW2-218: one export sheet grouped by intent — Balanced (recommended, 1080p · 24 fps · AVC quantizer 30), Light (the same at quantizer 33) for GitHub · Jira · Linear · Slack, YouTube (1440p / 4K), Reels · TikTok · Shorts, Feeds, Maximum quality — constant-quality tiers measured on screen text, 10 s keyframes, fast start. Exports run in the background with in-app progress and Ready to share cards; Share exports the whole recording from its library page."
---

# Video editor — export presets per destination

> **Superseded for sharing a recording (NIW2-578):** the recording page no longer opens this sheet.
> Share, the "Recording saved" card and the heavy banner's target moved to the Export screen
> ([where is your video going?](./prepare-screen), first built as "Prepare" and renamed Export in
> [the export screen](./export-screen)), a full screen built around destinations. The editor's
> Export still uses the sheet described here, and the presets, estimates and background runner are
> unchanged.

> **Status: 🟢 Ready to validate — stacked PRs on top of NIW2-217 (#266): #269 → #271 → #272 →
> export quality → Share button → redesign → background export → quality tiers → quantizer
> encoding.** The encoder settings come from a spike on the app's own WebCodecs path, watched by
> the owner (below).
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
> 8. Quantizer encoding: the tiers move to constant quality at 24 fps, every preset to 10 s
>    keyframes, mediabunny to 1.61 (`feat/NIW2-218-quantizer-encoding`).
> 9. YouTube 1440p / 4K (NIW2-564, **in progress** on `feat/niw2-564-youtube-1440-4k`, not
>    shipped): see "YouTube 1440p / 4K" below.
>
> Unit, hook and component tests pass; real exports (WebCodecs in the worker, VideoToolbox rate
> control, `ffprobe` on the outputs, playback in Safari/Chrome/QuickTime) still need a pass on the
> Mac mini. Spec: Linear NIW2-218 — its "Update 2026-10-10 — Combined design: one Share flow"
> section overrides the original spec.

## What the user gets

One sheet, shared by the editor's Export (titled "Export") and the library's Share ("Share a
copy"), subtitled with the recording's title · duration · resolution. A before/after meter shows
the selected row's estimate against the original's size ("~5.9 MB · 95% lighter"). The rows are
grouped by what the user is about to do — **Recommended** (Balanced), **Share in a tool** (Light,
for GitHub · Jira · Linear · Slack), **Post** (YouTube, Reels · TikTok · Shorts, Feeds), **Keep**
(Maximum quality). Each row shows where it works, its size
in MB ("~" for the quality tiers, "up to ~" for the fixed canvases, "Full size" for
Maximum, which has no estimate) and its output dimensions. The selected row opens with a one-line
explanation and ✓ facts; Reels and Feeds add a framing preview with Fill / Fit. The copy never
says bitrate or fps. The selected row is preselected from Settings → Export quality (or Light,
from a "light copy" shortcut), and Enter exports it ("Export ~5.9 MB ↵").

The internal preset ids and numbers:

| Row                                        | Output                                           | Rate control                                                | Notes                                                                                                 |
| ------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ⭐ **Balanced** (`balanced`)               | Source aspect, short side ≤ 1080, never upscaled | AVC quantizer 30, ≤ 24 fps (fallback 2.5 Mbps)              | Recommended default, estimated ~7 MB/min. AAC 128 kbps.                                               |
| **Light** (`light`)                        | Same as Balanced                                 | AVC quantizer 33, ≤ 24 fps (fallback 1.6 Mbps)              | Estimated ~5.7 MB/min. AAC 128 kbps.                                                                  |
| **YouTube** (`youtube-1440`, `youtube-4k`) | 2560×1440 or 3840×2160 (selector on one row)     | 1440p: 16 Mbps ≤ 30 fps, 24 Mbps above; 2160p: 45 / 68 Mbps | Fit, black padding, source frame rate kept. Keyframe every 2 s. AAC 384 kbps. In progress (NIW2-564). |
| **Vertical 9:16**                          | 1080×1920                                        | 8 / 12 Mbps                                                 | Fill (default) or Fit with a blurred-frame padding.                                                   |
| **Square 1:1**                             | 1080×1080                                        | 4.5 / 6.75 Mbps (pixel-scaled)                              | Fit (default) or Fill.                                                                                |
| **Maximum quality** (`maximum`)            | Source's native size                             | mediabunny's `'high'` level as a bitrate (pre-preset)       | Was "Original". Fast start.                                                                           |

- Every preset but YouTube puts a keyframe every 10 s (mediabunny's default is 2 s). These are
  files to upload or attach, not streams, so the only cost is coarser seeking; on mostly static
  screen content the 2 s keyframes were most of the file. YouTube's upload guide asks for a short
  closed GOP and that preset targets a fixed bitrate anyway, so it keeps 2 s.
- The old single `youtube` preset (fixed 1920×1080, 8 / 12 Mbps, AAC 128 kbps) is being replaced
  by the 1440p / 4K row (NIW2-564, below).
- Fixed canvases always output the exact preset size (upscaling a smaller source).
- Audio on Vertical and Square is AAC 128 kbps at the source layout and sample rate; YouTube uses
  384 kbps (see below).
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
  title suffix depends on the preset ("(edited)" for Balanced and Maximum, "(YouTube)" for both YouTube variants,
  "(vertical)", "(square)", "(light)"). Older sidecars say `"original"` (read as `maximum`) or
  `"small-10"` / `"small-25"` (read as `light`), via `normalizeExportPresetId`.
- "Already exported" compares the content fingerprint **plus the preset's encode revision**
  (`encodeFingerprint`, `ENCODE_REVISION`, now `q30-24fps-kfi10` / `q33-24fps-kfi10`): a
  Balanced or Light file from the bitrate tiers (15 fps), the old 30 fps · 3 Mbps Balanced, or an
  old Small-file export now read as Light, is never offered as the new encode. The same applies to
  the legacy `"youtube"` id: a sidecar with it normalizes to `youtube-1440` for display but never
  counts as "already exported", because the encode changed.

## Background exports and status cards

Exports run in the background (`export/export-runner.ts`, a module singleton like the recorder
store): Export closes the sheet, and the export keeps running while the user moves around the app
or keeps editing. **One at a time** — a second Export or Share while one runs shows "Already
exporting “…”" instead of a sheet. Cards stack in the top-right corner of the window
(`features/status-cards/`, mounted at the app root):

- **Progress:** "Making a lighter copy…", the preset and output size, a progress bar,
  "64% · about 25 s left" (projected from the rate so far), "119 MB → ~5.9 MB", and Cancel. A failure turns it into an error card with Retry.
- **Ready to share:** the real size ("Ready to share · 8.1 MB"), "93% lighter than the original.",
  for the tiers the two GitHub plan chips from the real size,
  the before/after meter, and a file chip that drags out natively under the item's title
  ("Demo (light).mp4"), not its vault id — main hard-links the vault file into a temp folder
  under that name and cleans it on the next drag and on quit. Buttons: **View file** (the
  exported item's Library page), **Show in Finder**, **Done**. It replaces the old "Export saved"
  toast.
- **Recording saved** (replaced by Prepare's "Where is it going?" panel, NIW2-578): right after a recording over 10 MB, its page shows "Recording saved" with
  the Light estimate on a before/after bar ("~5.9 MB · fits GitHub", GitHub only when it fits)
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

> Replaced by [Prepare](./prepare-screen) (NIW2-578). The start logic below moved to
> `features/prepare/use-prepare-copy.ts`; what it encodes is the same.

**Share** is the primary button on the library item page of every local recording, raw or already
an export, next to Edit video / Reveal / Delete. That page is also where a recording lands the
moment it stops (`fromRecording`), so it is the "right after recording" entry point too. Over 25
MB the size shows in amber and a teal banner says "119 MB is heavy to send. Share makes a lighter
copy — about 7.6 MB, small enough for GitHub or Jira." (the Light estimate; GitHub is promised
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

**Quality tiers.** A tier is a quality floor, not a size target: short side ≤ 1080 (never
upscaled), ≤ 24 fps, AVC in quantizer mode (constant quality, like x264's CRF) on the hardware
encoder. They replace the size-capped Small-file rows (the ladder down to 480p at 250 kbps, the
"Export anyway" warning and the post-export shrink-and-retry), which turned a 2:51 terminal
recording into an unreadable 852×480 at 245 kbps.

- **Encoder choice** (`video-encoding.ts`, probed in the worker with `canEncodeVideo`): hardware
  AVC in quantizer mode → hardware AVC at the tier's fallback bitrate (still 10 s keyframes) →
  whatever the platform offers, at the bitrate. The last one is Chromium's software H.264 in
  practice: the export still finishes, and the renderer logs it to `captureException`
  (`video-export-software-encoder`; a tier on hardware without quantizer mode logs
  `video-export-no-quantizer`). No UI for either yet.
- **Size estimate.** Quantizer mode has no bitrate, so the "~" estimate is a per-minute rate of
  video at 1920×1080, scaled by pixel count, plus audio and the moov reservation: 6 MB/min for
  Balanced (measured 5.4 on a web-app demo and 2.0 on a terminal recording — set high on
  purpose) and 4.7 MB/min for Light. The Ready card's GitHub chips use the real size.
- **Frame-rate cap** (`frame-rate-cap.ts`): each frame goes to its nearest 1/24 s slot and the
  first one in a slot is kept, so 30, 48 and 60 fps sources all land on 24 fps. The previous
  rule ("no sooner than 1/fps after the last kept frame") halved anything slower than twice the
  cap: a 30 fps recording, the default, would have exported at 15 fps. Slides are synthesized at
  the cap.

## YouTube 1440p / 4K (NIW2-564, in progress)

> **Status: 🟡 In progress** on `feat/niw2-564-youtube-1440-4k`. Not shipped, not validated.

The sheet's YouTube preset becomes one "YouTube" row with a **1440p / 4K** selector (preset ids
`youtube-1440`, 2560×1440, and `youtube-4k`, 3840×2160). Fit with black padding, source frame
rate kept, keyframe every 2 s, fast start.

- **Bitrates** come from [YouTube's upload guide](https://support.google.com/youtube/answer/1722171),
  SDR, top of the recommended range: 1440p 16 Mbps at ≤ 30 fps and 24 Mbps above; 2160p 45 and
  68 Mbps. Audio is AAC 384 kbps, falling back to 256, 192 then 128 kbps if the encoder refuses.
- **Default variant:** 4K when the source would be downscaled into 2560×1440, otherwise 1440p. The
  user can override it.
- **Smoothing:** slides drawn onto the canvas now use `imageSmoothingQuality = "high"` as well; the
  fixed-canvas framer and the zoom crop already did, so this is not what changed the YouTube result.
- **Size is not a concern** for YouTube files, so this row shows no amber heavy-file warning.
- **Stays on mediabunny / WebCodecs** per ADR 0001: no ffmpeg in the build (libx264 is GPL).

**Why.** YouTube re-encodes 1440p and 4K uploads at a much better quality than 1080p, even for
viewers watching at 1080p. Evidence (owner, 2026-10-30): a 1916×1048 @ 48 fps screen recording
looked soft on YouTube when uploaded at 1080p; the same video upscaled to 2560×1440 (ffmpeg
lanczos, CRF 16) looked clearly sharper. That 1440p+ uploads get VP9/AV1 while 1080p stays on AVC
is community knowledge (for example
[this OBS forum thread](https://obsproject.com/forum/threads/youtube-choosing-its-own-encoders-how-to-get-the-best-quality-1080p.154105)),
**not confirmed by YouTube**; the owner's comparison is a single recording judged by eye.

## Measured / to measure

- **Encoder settings (spike, 2026-10-13, owner-validated).** The owner's real recordings were
  encoded inside Electron's Chromium through WebCodecs — the app's own path — and compared with
  ffmpeg libx264. Hardware AVC at quantizer 30 with 10 s keyframes matches x264
  `-preset slow -crf 28` at about the same size, with clean small text; 15 fps stutters on zooms
  (hence 24); 720p smudges text (hence 1080p); software H.264, HEVC, VP9 and AV1 were rejected.
  The owner picked `full-gen_avc-hw-q30-kfi10-24fps.mp4`. The full record, with every variant,
  size and VMAF, is the
  [encoding benchmark](/architecture/encoding-benchmark-2026-10/) (PR #289). Light's
  quantizer 33 is interpolated between the measured 32 and 34; the owner has not watched one.
- **This branch, same harness, real code** (`chooseVideoEncoding` and the frame-rate cap on
  mediabunny 1.61): the 2:51 terminal recording (2560×1440, ~48 fps) came out at 1920×1080,
  23.9 fps, a keyframe every 10 s, quantizer mode on VideoToolbox, 6.1 MB of video (the old
  2 Mbps Balanced: 18.7 MB), encoded in 17 s.
- **Pending:** the owner's eye on real exports through the app, a q33 Light file, and a
  platform without VideoToolbox (Windows) to see which branch of the encoder choice it takes.
- The moov reservation is an upper bound (~35 bytes per packet): ≈ 200 KB on a 1-minute export.
- To measure on the Mac mini: export-time cost of the composite path on fixed presets (expected
  +10–30 %), and whether `elst` appears (the first output frame is clamped to t = 0, so it
  shouldn't).

## Not in v1

Server transcoding, HLS/DASH, direct publishing, HEVC/VP9/AV1, custom resolution/bitrate,
screenshot presets, batch export, more than one export at a time, share by link (cloud, also
the answer for GitHub's free 10 MB), squeezing a file below its tier to fit a limit,
auto-export after recording, a background system for the video editor (padding is black or a blurred copy of the frame).
