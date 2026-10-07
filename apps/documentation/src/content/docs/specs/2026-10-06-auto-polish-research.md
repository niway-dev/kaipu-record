---
title: Auto polish — research brief (open a new recording already beautified)
description: Research task for the night shift — what it takes for a just-recorded video to open in the editor already trimmed, framed on a background and zoomed, how established tools do it, and what each piece would cost Kaipu.
---

# Auto polish — research brief

**Status: 🔵 Researched, awaiting owner review · 2026-10-07.** A research task, not an
implementation. The night shift filled in [Findings](#findings) (NIW2-158) and ends with a
[recommended first slice](#recommended-first-slice). Related direction: "Product direction and monetization" (Auto Polish), added to
`marketing/` in PR #239.

## Summary (one minute)

Goal: the user stops a recording and the editor opens with the video **already polished** —
dead time and silences trimmed, the screen framed on a default background with padding and
rounded corners, zooms on the clicks, and possibly a layout ("panels", e.g. screen and
camera side by side). Every change is an editable decision the user can keep or remove,
never a baked-in edit. The question is what each piece needs and what it costs. Kaipu already
has the pattern: the video editor opens with automatic zooms computed from the cursor track
(`withInitialZooms`) without marking the session dirty. Auto polish extends that one loader
step.

| #   | Decision (already fixed for the research)                                                          | Why                                                                          | ADR         |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- |
| 1   | Auto edits are proposals in the same session model as manual edits, applied when the editor opens. | Same as auto-zoom today; the user corrects decisions instead of making them. | —           |
| 2   | The original file is never modified.                                                               | ADR 0003.                                                                    | reuses 0003 |
| 3   | Prefer deterministic, local analysis; an LLM only where nothing else works.                        | Local is free and private; model costs are a business decision.              | —           |

### Questions the research must answer

1. **Silence and dead-time trim.** Can cut proposals come from the audio alone (RMS below a
   threshold for longer than N ms), from the cursor track (no movement or clicks), or from
   frame differences (nothing changes on screen)? Which combination avoids cutting a pause the
   user wanted? What thresholds do tools use?
2. **Default look for video.** The screenshot editor already has backgrounds
   (`features/screenshots/beautify`). The video editor has none. What does adding
   background, padding, rounded corners and shadow to the video preview and the export cost
   (preview compositing + export renderer)? Can the screenshot backgrounds be shared?
3. **"Panels" / layouts.** Which layouts do tools offer (screen only, screen + camera side by
   side, camera full screen for intro/outro)? What does each need from the camera box and the
   export?
4. **Defaults vs presets.** Is a single default enough, or do users need saved presets (Screen
   Studio shares them across a team)? Where would presets live — the tags store pattern
   ([ADR 0012](/architecture/decisions/0012-recording-tags-local-first-with-cloud-replica/))
   fits.
5. **When it runs.** At stop (background job, ready when the editor opens) or when the editor
   opens (like auto-zoom)? What is the analysis time for a 10-minute recording on a base
   Apple Silicon Mac?
6. **What is free and what is paid.** Following the product direction (PR #239): which pieces are
   "editing tools" (free) and which are "Kaipu does the work" (candidate paid)?

### Out of scope

Implementation; transcription and captions (separate item); AI summaries.

## What established tools do (starting points)

| Tool                                                                   | Automatic on open                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Screen Studio](https://screen.studio/guide/adding-editing-zooms)      | Zooms created from clicks; background, padding, rounded corners and cursor style from a preset; shareable presets                 |
| [Descript](https://help.descript.com/script-editing/shorten-word-gaps) | "Shorten word gaps": threshold (e.g. gaps over 0.5 s) and target length (e.g. 0.25 s); keeps a 0.2–0.3 s floor so speech breathes |
| [Cap](https://cap.so/)                                                 | Default backgrounds and auto-zoom in Studio Mode; cursor effects from its own cursor data                                         |

## What Kaipu has today (verified on `main`, 2026-10-06)

- `features/video-editor/initial-zooms.ts` — `withInitialZooms` decides the zooms of the
  scene the editor opens with, from the cursor track; a saved session wins over detection;
  opening does not mark the editor dirty. **This is the hook auto polish extends.**
- `features/video-editor/session.ts` — versioned edit session with clips, overlays, zooms,
  redactions and mute ranges; cuts are already representable.
- `features/screenshots/beautify/` — backgrounds, beautified frame and panel for screenshots.
- `features/video-editor/mute-edits.ts` — audio ranges; a silence detector could reuse its
  range model.

## Findings

Researched 2026-10-07 for [NIW2-158](https://linear.app/niway/issue/NIW2-158), against the code
of `night/niw2-154-recording-tags` (`main` plus recording tags). Effort: **S** ≤ 1 night, **M**
2–3 nights, **L** more, or needs a recorder change.

### At a glance

| #   | Question               | Answer in one line                                                                                                                           | Effort                 | Local |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----- |
| 1   | Silence and dead time  | Propose a cut only where audio **and** cursor are both quiet for ≥ 1.5 s, keep 0.3 s each side. Start with the head and tail.                | S head/tail · M middle | Yes   |
| 2   | Default look for video | A frame stage after the zoom crop: background, padding, rounded clip, a shadow drawn once. Presets and paints from screenshots are reusable. | M                      | Yes   |
| 3   | Panels and layouts     | Not possible yet: the camera is burned into the screen pixels. Layouts need a separate camera file first.                                    | L                      | Yes   |
| 4   | Defaults vs presets    | One saved default is enough for v1. Named presets later, shared as files; team sync belongs to Cloud.                                        | S default · M presets  | Yes   |
| 5   | When it runs           | When the editor opens, like auto-zoom. Audio plus cursor analysis of 10 minutes takes well under a second; frame diffing does not.           | —                      | Yes   |
| 6   | Free vs paid           | The pieces are editing tools (free). Only "apply everything automatically", transcript or LLM work, and team presets are paid candidates.    | —                      | —     |

### Measurements

Throwaway scripts, not committed. Machine: Apple **M4** (base chip, 10 cores, 16 GB), the
base Apple Silicon configuration. Input: a synthetic **10-minute 1080p30 H.264** file with
**AAC 128 kbit/s** audio, which is Kaipu's default quality preset (`balanced`:
1080p, 30 fps, 8 Mbit/s, `shared/recording-quality.ts`). Its audio is "narration" (noise shaped
at a 4 Hz syllable rate) with 70 known pauses: 28 breaths under 0.5 s, 31 natural pauses of
0.5–1.5 s and 11 dead spans of 3–20 s (122 s in total). The screen alternates 25 s of motion
with 15 s of a still frame.

| Step, for the 10-minute file                                                        | Time                     | How                                          |
| ----------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| Decode the AAC track to 16 kHz mono PCM                                             | 0.21 s                   | ffmpeg 9 (stand-in for WebCodecs)            |
| RMS in 20 ms windows + hysteresis + span filter (30,000 windows)                    | 12–13 ms                 | Node 24                                      |
| Parse a worst-case cursor track (75,000 samples at 125 Hz, 281 clicks, 3.4 MB JSON) | 4 ms                     | Bun                                          |
| `detectZoomSegments` (the repo's own file, sensitivity 50) on that track            | 25–27 ms                 | Bun                                          |
| Cursor-idle pass (pointer within 0.5 % of the diagonal, no click, ≥ 3 s)            | 1–2 ms                   | Bun                                          |
| Decode every frame, downscale to 160×90 gray, diff at 5 fps                         | **8.6 s** wall, 27 s CPU | ffmpeg software decode + Node                |
| The same with VideoToolbox through ffmpeg                                           | 39 s                     | Copying every full-size frame back dominates |

The real cursor track is smaller than the worst case: the recorder skips identical samples
(`main/recording/cursor-sample-buffer.ts`), so an idle pointer costs almost nothing.

Silence detection against the known pauses, at a −45 dBFS threshold (enter below it, leave 6 dB
above it):

| Minimum silence | Breaths < 0.5 s proposed | Natural pauses 0.5–1.5 s proposed | Dead spans ≥ 3 s found | Speech inside proposals |
| --------------- | ------------------------ | --------------------------------- | ---------------------- | ----------------------- |
| 300 ms          | 14 / 28                  | 31 / 31                           | 11 / 11                | 0.03 s                  |
| 700 ms          | 0 / 28                   | 25 / 31                           | 11 / 11                | 0.01 s                  |
| **1500 ms**     | **0 / 28**               | **0 / 31**                        | **11 / 11**            | **0 s**                 |

At −40 dBFS the proposals start to swallow quiet syllables (0.31–0.46 s of speech inside them).
The synthetic room noise is −60 dBFS, cleaner than a real microphone in a room, so the
threshold must be **relative** (for example the 10th percentile of window levels + 10 dB, capped
at −35 dBFS) and must be validated on real recordings. That has not been done (see
[Not verified](#not-verified)).

Frame differencing: a **mean** pixel difference on a 64×36 thumbnail missed a moving 200×120 box
entirely and called 599 of 600 seconds "static". Counting **changed pixels** (any pixel with
|Δ| > 12 on a 160×90 thumbnail) found all 15 still spans (222 s against 225 s of truth, each
0.2 s late at 5 fps). A caret or a few typed characters is about one pixel at 160×90, so screen
difference alone cannot tell "nothing happens" from "the user is typing".

### 1. Silence and dead-time trim

**Answer.** No single signal is safe:

- **Audio alone** finds silence, but a silent stretch while a build runs, or while the user
  shows a result without talking, is wanted.
- **The cursor alone** goes idle while the user explains something.
- **Screen difference** misses typing and costs 8.6 s per 10 minutes.

The rule that avoids cutting a wanted pause is to propose a cut **only where every available
signal is quiet**: audio below the threshold **and** the pointer idle (no movement beyond 0.5 %
of the diagonal, no click) for at least **1.5 s**. The cut **shortens** the pause rather than
removing it, keeping **0.3 s** on each side. Descript keeps a 0.2–0.3 s floor
([shorten word gaps](https://help.descript.com/script-editing/shorten-word-gaps)), and
[auto-editor](https://github.com/WyattBlue/auto-editor) keeps 0.2 s of margin by default with a
4 % amplitude threshold. With those numbers no breath or natural pause was proposed in the
measurement, and every dead span was found. Screen difference is at most a later veto,
computed at stop.

**The head and tail are the safe first case.** Every take starts with the user reaching away
from Record and ends reaching for Stop. The zoom detector already ignores the first and last
second for this reason (`DETECTION.edgeIgnoreMs`, `zoom/detect-zoom-segments.ts`).

**Evidence from the code:**

- **Head and tail cuts fit today's model.** A trimmed head or tail is just the single clip's
  `sourceStart` and `sourceEnd` (`scene.ts`: "uncovered source footage is deleted footage").
  `trimClip` (`timeline.ts`) clamps only to 0 and to the other edge, so dragging the edge back
  restores the footage.
- **Cuts in the middle don't fit as well.** A pause in the middle needs a clip split per
  pause: dozens of items, no `origin: "auto"` flag (zoom segments have one, `zoom-model.ts`),
  and no way to remove or regenerate them as a group.
- **Undo can't remove an auto cut.** Auto edits are part of the _initial_ scene, not a
  commit (`initial-zooms.ts`, `use-video-scene.ts`), so undo cannot take one away. Something
  else has to restore the footage.
- **A better model for the middle is skip ranges.** That means a source-anchored
  `skipRanges: { id, sourceStart, sourceEnd, origin }[]` that `toLayout` steps over. This is
  the same shape and the same "additive field" rule as `mutedRanges` (`audio-edits.ts`,
  `session.ts`). It gives a lane, removal one by one, and regeneration at a sensitivity, like
  zooms.
- **Background sound means fewer cuts, never wrong ones.** The microphone and system audio are
  **mixed into one track** while recording (`recorder-engine.ts`: two `GainNode`s into one
  destination). System sound (music, notifications) therefore reads as "not silent", so the
  detector makes fewer cuts and never a wrong one.

**Effort:** head and tail **S**. Pauses in the middle **M** (skip ranges in timeline, export plan,
session, a lane). Screen-difference veto **M**, and only as a job at stop.
**Local:** yes, deterministic, no model.

### 2. Default look for video (background, padding, corners, shadow)

**Answer.** Add one stage at the end of both pipelines, after the zoom crop: paint the
background, draw the shadow, clip to a rounded rectangle, and draw the composed frame into the
inset rectangle. The zoom stays **inside** the frame, which is what Screen Studio does with
padding and inset ([background guide](https://screen.studio/guide/background)).

- **Preview.** `PreviewStage` already writes the camera transform to an inner content layer
  (`components/preview-stage.tsx`). Wrapping that layer in a frame element gives the look:
  CSS background, padding, `border-radius` with `overflow: hidden`, and `box-shadow`. The zoom
  keeps working unchanged, while `preview-stage-sizing.test.ts` changes.
- **Export.** The worker composes `frame → redactions → overlays → camera crop` onto a canvas
  the size of the source (`export/compose-frame.ts`; output size = `videoWidth × videoHeight`
  in `use-video-export.ts`). The new stage per frame is one fill, one bitmap draw and one
  clipped `drawImage`.
  - **Draw the shadow once.** The frame rectangle never moves, so the shadow is rendered once
    into a bitmap. Setting `shadowBlur` on every frame would be the expensive way.
  - **Extend `Ctx2D`.** The interface has no `roundRect`, gradient or shadow members yet, so it
    and the test fake grow.
  - **The trade-off.** At a fixed output size, the padding scales the screen down: 1080p with
    5 % padding shows the recording at about 1728×972. Exporting on a larger canvas is a
    later option.
- **Reuse from screenshots:**
  - **Reusable.** `features/screenshots/beautify/backgrounds.ts` has no imports, so the presets
    (`BACKGROUNDS`), canvas paints (`BackgroundPaint`), the shadow formula and the slider ranges
    can move to a shared beautify module and be imported by the export worker.
  - **Not reusable.** The screenshot compositor (`annotations/compositor.ts` builds an SVG,
    which a worker cannot rasterize) and `BeautifiedFrame` (it is built around an image
    element).
  - **No transparent background.** The transparent `"none"` background has no meaning in
    H.264 (no alpha channel), so video maps it to "no frame".
- **Model.** An additive scene field `look: { bg, padding, radius, shadow }`: missing means "no
  frame", following the `session.ts` rule. Padding is stored as a **fraction of the output
  width**, not in pixels like screenshots, so the preview and the export agree at any size.

**Conflict to decide.** Screenshots deliberately open **plain** (`DEFAULT_BEAUTIFY` is all
zeros: "friendlier than landing on an already-decorated image"). Auto polish wants the opposite
for video. See [Open questions](#open-questions).

**Effort:** M (preview frame, export stage, inspector panel, session field). The cost per
frame was not measured: measure it in the slice. **Local:** yes.

### 3. Panels and layouts

**Answer.** Established tools offer four layouts:

- the **camera in a corner** (default);
- **camera only**, for an intro or outro;
- **hide camera** (screen only);
- **side by side**, plus "floating cards".

[Screen Studio](https://screen.studio/guide/dynamic-camera-layouts-) has corners and a
full-screen camera on a Layouts timeline. [Cap](https://cap.so/docs/recording/studio-mode) has a
Scene track with Default, Camera Only, Hide Camera, Split Screen and Floating, unavailable "when
no clip contains camera footage". Both record the **camera as its own track**.

Kaipu cannot offer any of these today. The webcam is a floating bubble window that the screen
capture records as pixels: `main/recording/camera-bubble-window.ts` says the screen recording
"captures it — no compositing needed". There is no camera file, so not even "hide camera" is
possible after the fact. The editor's "camera box" (`components/camera-box.tsx`) is the zoom
window, not the webcam.

**What layouts need, in order:**

1. Record the camera to its own file (a second encoder on the camera stream), and keep the
   bubble out of the screen capture (content protection, like the control bar).
2. Align both files to the same t0, the way the cursor clock does (`main/recording/cursor-clock.ts`).
3. Add source-anchored `cameraLayout` segments to the scene: corner, camera only, hidden, side by
   side.
4. Preview with a second synced `<video>`, and export by decoding two inputs per frame. Side by
   side also needs an output aspect ratio.

This overlaps the multi-video work in the editor workspace spec (PR #241).

**Effort:** L (recorder, sync, scene, preview, export). **Local:** yes. Out of auto polish v1.
Its only future auto-decision is small: for example, "camera only until the first click".

### 4. Defaults vs presets

**Answer.** **One saved default is enough for v1.** The default is the look plus zoom
sensitivity plus the trim on/off switch, applied to new recordings. Screen Studio's presets
cover background, aspect ratio and camera position
([creating presets](https://screen.studio/guide/creating-preset)). They are shared **as files**
("Open in Finder", then send the file; [sharing](https://screen.studio/guide/sharing-preset)).
Automatic team sharing is still a
[feature request](https://hub.screen.studio/p/shared-presets-for-all-user-of-the-same-suscriptionlicense).
So sharing presets needs no cloud.

**Where presets live:**

- **The default.** One more key in the settings store (`main/infrastructure/settings-store.ts`,
  `userData/settings.json`), with a "Use this look for new recordings" action in the editor
  inspector. **S**.
- **Named presets.** A local store with the same local-first shape as tags (ADR 0012 in PR
  #241, with the sidecar and store pattern from NIW2-154): a list in `userData`, then
  import/export as a JSON file for sharing. **M**, mostly UI.
- **Team presets synced through Cloud.** The cloud replica from ADR 0012, which belongs to team
  workspaces (paid, see question 6). **L**.

**Local:** yes for the default, named presets and file sharing; team sync needs the cloud.

### 5. When it runs, and analysis time

**Answer.** Run it **when the editor opens**, in the loader, exactly where `withInitialZooms`
runs today (`pages/video-editor/video-editor-page.tsx` → `features/video-editor/initial-zooms.ts`).
The result is part of the initial scene, so opening is not an edit. A saved session wins. For
10 minutes on the M4:

- **Audio.** About 0.2 s to decode and about 13 ms to analyze (ffmpeg as a stand-in).
- **Cursor.** About 30 ms for zooms plus idle.

The total should stay under a second. Decode the audio off the main thread, in a worker with
mediabunny's `AudioSampleSink`, which the export worker already uses (`export/export-worker.ts`).

There is a cheaper path for new recordings. The recorder already has an `AnalyserNode` on the
mix (`recorder-engine.ts`), so it could write a level envelope next to the cursor track at
finalize: 30,000 values for 10 minutes, about 120 KB. The editor would then decode nothing.
Older recordings fall back to decoding.

Frame differencing (8.6 s per 10 minutes, software decode) is too slow for opening. If it is
ever needed, run it **at stop** as a background job that writes a sidecar, and treat it as
optional.

**Not measured:** decoding through WebCodecs inside Electron. Add a performance mark in the
slice. ffmpeg is a stand-in for the hardware decoder, not a measurement of it.

### 6. What is free and what is paid

**Answer.** The product direction says "Free gives excellent editing tools; paid performs the
editing" (`marketing/product-direction.md`). Its capability matrix already lists backgrounds,
presets, smart zoom, trim and the camera bubble as free on every tier. It leaves "Automation
(Auto Polish …)" as an open question for the local tier. Everything in this brief is
**deterministic, local and costs nothing per use**, so the split follows the product
direction rather than cost:

| Piece                                                                                                     | Kind                          | Tier           |
| --------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------- |
| Video look (background, padding, corners, shadow), one default, named presets, sharing as files           | Editing tool                  | Free           |
| Silence and dead-time **suggestions** (a lane the user accepts), head/tail trim, auto-zoom (already free) | Editing tool                  | Free           |
| Camera layouts (once a camera track exists)                                                               | Editing tool                  | Free           |
| **One-click auto polish**: applying trim, look and zoom together, unasked, on every new recording         | "Kaipu does the work"         | Paid candidate |
| Mistake-and-retake removal, gaps between words from a transcript, typing speed-up                         | Needs transcription or an LLM | Paid candidate |
| Team presets synced through Cloud                                                                         | Infrastructure                | Cloud / Team   |

Charging for a **local** automation conflicts with the monetization ADR ("never charge for
local features"). The product direction says that ADR must be reopened first. Pieces that need
a transcription or a hosted model stay inside the ADR as written (Cloud or usage-based).
Recommendation: ship the deterministic building blocks free, and leave "auto-apply on open as a
paid switch" to the owner (see [Open questions](#open-questions)).

### Recommended first slice

**Auto polish v0: trim the dead head and tail on open.** It is the smallest change that makes
every new recording open better. It reuses the existing hook. It needs no new scene field,
because it only moves the single clip's edges. It cannot cut a wanted pause, since nothing in
the middle is touched.

Acceptance criteria:

1. A pure `withInitialPolish(scene, hasSavedSession, track, levels, duration)` (or a sibling
   `withInitialTrim` composed with `withInitialZooms` in the loader) decides the opening scene.
   It is unit tested with fixtures.
2. On a **fresh open** with a cursor track, "activity" means:
   - audio above the relative threshold, or
   - the pointer moving more than 0.5 % of the diagonal, or
   - a click.

   If no activity happens in the first **≥ 1.5 s**, the clip starts **0.3 s before the first
   activity**. The same rule moves the end to **0.3 s after the last activity**.

3. No cursor track → no trim. No audio track, or the whole recording muted → the cursor alone
   decides. No activity at all → no trim. The clip never ends up shorter than
   `MIN_ITEM_DURATION` or the minimum the owner picks.
4. A saved session opens unchanged, and merely opening the editor does not mark it dirty, as
   with auto-zoom today.
5. When something was trimmed, the editor shows one notice ("Trimmed 0:04 at the start and 0:06
   at the end") with **Restore**. Restore is one undoable commit back to the full length.
   Dragging a clip edge outwards also brings the footage back (`trimClip`).
6. Audio is analyzed off the main thread. A dev performance mark shows the whole analysis under
   1 s for a 10-minute 1080p30 recording on a base Apple Silicon Mac.
7. Tests:
   - leading silence with an idle pointer → trimmed;
   - leading silence with a moving pointer → not trimmed;
   - an idle pointer with speech → not trimmed;
   - a recording with no activity → not trimmed;
   - a saved session → not trimmed.

Next slices, in order: the **video look** (question 2, M), **skip ranges** for pauses in the
middle as a suggestion lane (question 1, M), then the **one saved default** (question 4, S).
Camera layouts (question 3, L) wait for a separate camera track.

### Open questions

Each has the default this brief assumed.

1. **Should a new video open framed?** Screenshots deliberately open plain. Assumed: video
   also opens plain until the user saves a default look. Auto polish v0 only trims.
2. **Is auto-apply paid?** Assumed: the building blocks are free, and the decision waits for the
   monetization ADR to be reopened.
3. **Trim thresholds.** Assumed: 1.5 s minimum dead time, 0.3 s kept on each side, a relative
   audio threshold (10th percentile + 10 dB, capped at −35 dBFS). These need tuning on real
   recordings.

### Not verified

- Silence thresholds on **real** narrated recordings (mic noise, keyboard, music). The
  measurements use synthetic audio.
- Decoding with WebCodecs/mediabunny inside Electron. ffmpeg stood in for it.
- The per-frame export cost of the look stage.

### Measurement scripts (not committed)

- `gen-audio.mjs`: 10 minutes of synthetic narration as a WAV, plus the truth JSON of its
  pauses.
- The video: one `ffmpeg` command (`testsrc2` still frame + a box moving for 25 s of every 40 s,
  `h264_videotoolbox` 8 Mbit/s, AAC 128 kbit/s).
- `analyze-audio.mjs`: RMS detector scored against the truth.
- `analyze-frames.mjs`: gray thumbnails read from an ffmpeg pipe, still spans by changed-pixel
  count.
- `cursor-bench.ts`: the repo's `detectZoomSegments` copied verbatim, run with Bun on a
  synthetic 125 Hz track, plus the idle pass.

## Deliverable

This page, completed, in a docs-only PR. No code beyond throwaway measurement scripts, which
are described in the findings rather than committed.
