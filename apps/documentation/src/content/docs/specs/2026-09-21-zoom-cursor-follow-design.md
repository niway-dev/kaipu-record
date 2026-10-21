---
title: "Zoom cursor-follow — design"
description: "Automatic cursor-following zoom for screen recordings: record clean, capture a cursor event track, detect zoom segments offline, edit them as segments, and burn them in only at export with mediabunny."
---

# Zoom cursor-follow — design

> **Status: 🟡 In progress** (2026-09-22). Nothing on this spec's literal design is on
> `main`. The [audit](/plans/video-editor-v2/00-audit/) found several places this spec is
> not executable as written (wrong clock source, a "stateless" camera that is also
> damped, etc.) and replaced its PR plan with deep-dive documents `01`–`12`, each with
> its own corrected design; **those** are what got implemented, on unmerged feature
> branches, not this spec directly. See
> [backlog/video-editor-zoom-blur-cover](/backlog/video-editor-zoom-blur-cover/) for the
> per-PR branch table — none of it is merged or validated in production. It extends the
> shipped [video editor](/specs/2026-07-03-video-editor-design/). The screen design
> (states, tracks, properties panel, blur/cover) is in the
> [UI spec](/specs/2026-09-21-video-editor-zoom-blur-cover-design/); the interactive
> mockup lives at [/mockups/zoom-editor.html](/mockups/zoom-editor.html).

Screen + audio recording app. Electron + mediabunny.

## 1. Architecture decision

Three paths were evaluated:

| Option                           | Verdict                                       |
| -------------------------------- | --------------------------------------------- |
| Live zoom, burned into the frame | **Rejected**                                  |
| Automatic post-process on stop   | **Chosen**                                    |
| Post-process + editable timeline | Chosen (same architecture, a UI layer on top) |

Options 2 and 3 are the same architecture: record clean, store metadata, compose
afterwards. The only real decision was whether to burn the zoom into the pixels at
record time.

**Why live zoom was rejected:**

- No lookahead. The camera needs to know the cursor arrived _and stayed_, not that it
  was passing through. Live, only causal filters exist: the result either lags or jumps.
- It competes with the encoder for CPU/GPU at the worst possible moment → dropped frames.
- The cursor scales with the frame: huge and blurry.
- Irreversible. One false positive ruins the whole take.

**Non-destructive model.** The original recording is never modified.

```
project/
  recording.mp4        ← original, untouched
  cursor.json          ← event track
  project.json         ← zoom segments, edited by the user
  exports/
    v1.mp4
    v2.mp4
```

Exporting produces a new file. You can always go back to the original or re-export
with different parameters.

## 2. Render pipeline

**No ffmpeg needed. Mediabunny covers everything.**

Zoom is not a video operation: it is a `drawImage` with a crop.

1. `Input` over the clean recording
2. `VideoSampleSink.samples()` → decoded frames in order
3. Per frame: compute the camera box for that timestamp, apply the crop
4. Draw the cursor on top (crisp, because it does not come from the stream)
5. `CanvasSource.add(timestamp, duration)` → `Output`

```ts
const sink = new VideoSampleSink(videoTrack);
const source = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH });
output.addVideoTrack(source);
await output.start();

for await (const sample of sink.samples()) {
  const cam = camera.at(sample.timestamp); // {x, y, scale}
  ctx.drawImage(
    sample.toCanvasImageSource(),
    cam.x, cam.y, W / cam.scale, H / cam.scale,
    0, 0, W, H
  );
  drawCursor(ctx, cursorTrack.at(sample.timestamp), cam);
  await source.add(sample.timestamp, sample.duration);
  sample.close();
}
await output.finalize();
```

**Always close the sample.** Otherwise VRAM accumulates and the decoder stalls.

**Audio is not touched.** Read it with `EncodedPacketSink` and remux it with
`EncodedAudioPacketSource`: packets pass through as-is, no decode or re-encode. Zero
quality loss and zero drift, because the original timestamps are preserved.

**Where it runs.** In the renderer, not in main. WebCodecs in main forces
`@mediabunny/server`, which is libavcodec underneath — ffmpeg coming back in through
the window. Ideal: a hidden `BrowserWindow`, or a Worker with `OffscreenCanvas`, so
the UI does not freeze during the render.

> **Repository note.** The shipped video editor already exports from a Web Worker with
> `OffscreenCanvas` + mediabunny
> (`apps/kaipu-record/src/renderer/src/features/video-editor/export/export-worker.ts`).
> That is the natural host for the zoom pass; the "hidden BrowserWindow vs Worker"
> question in [Open items](#9-open-items) should be resolved against that existing
> pipeline rather than from scratch.

**ffmpeg only if:** a codec WebCodecs does not support is required, or HDR.

## 3. Quality

- **Capture at native resolution or 2x, export at 1080p.** Zoom up to ~2.5x is then
  free quality-wise: it is only a crop, not an upscale.
- **Exclude the cursor from the capture** and draw it during composition. It stays crisp
  at any zoom level, and enables click ripples and pointer smoothing.

`getDisplayMedia({ video: { cursor: 'never' } })` exists, but through Electron's
`chromeMediaSource` path it is sometimes ignored. **Test on Windows and macOS before
committing to it.** Plan B: draw a larger custom cursor that covers the original (which
is what Screen Studio does anyway).

## 4. Cursor event capture

**Do not detect the cursor from the video.** It is a trap:

- It changes shape constantly (arrow, I-beam, hand, resize, spinner). Dozens of
  templates, and they vary by theme and OS.
- It camouflages: white on white, over text, over another video.
- It yields position but **not clicks**, and the click is the main trigger. That is not
  in the pixels.

Keep it only as a fallback if third-party video import ever happens.

**Position** — from the main process, no permissions or native modules:

```ts
const { screen } = require('electron')
setInterval(() => {
  const p = screen.getCursorScreenPoint() // DIP, not physical pixels
  track.push({ t: performance.now() - t0, x: p.x, y: p.y })
}, 8)
```

At 125 Hz, 30 seconds is ~3,700 points. Irrelevant in size.

**Clicks** — Electron has no global input hook. A native module is required:
`uiohook-napi` is the maintained one.

- macOS: requires the Accessibility permission, in addition to Screen Recording. That
  is two dialogs during onboarding; it needs design.
- Windows: works without asking for anything.

**Coordinates.** `getCursorScreenPoint()` returns DIP in global desktop space; the video
is in physical pixels of one display. Store normalized 0–1 relative to the captured
display: subtract `display.bounds`, divide by the size. Multi-monitor and Retina then
stop mattering.

## 5. The clock

The video and the intent are two separate things. Frames say what was visible; the
event track says what the person was doing. The clock joins them back together.

### Anchor

`t0` is the timestamp of the **first frame that arrives from the stream**, not the
moment the user pressed record — there are hundreds of ms between them. Every event is
stored as `now - t0`.

Never `Date.now()`: if the system syncs NTP mid-recording, the whole track jumps. Use
`performance.now()`.

### Interpolate

Screen capture is **variable framerate**: if nothing moves, the compositor emits no
frames. Never compute `t = n / 60` — read the real `timestamp` of each mediabunny
sample.

```ts
function sample(track, t) {
  const i = binarySearch(track, t)  // last event with t' <= t
  const a = track[i], b = track[i + 1] ?? a
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
}
```

Sorted array + binary search. At 125 Hz interpolation never spans more than 8 ms, so a
linear lerp is enough.

### Anticipate

This is the payoff of doing it offline. At render time the full track is available: we
can look ahead. **The camera starts moving ~200 ms before the click**, not after. That
is what makes it look intentional instead of reactive, and it is impossible live.

Clicks are not interpolated: they are point events and do not feed the camera. They
feed the segment detector, which is an earlier pass over the same track. The camera
consumes position only.

## 6. Camera model

**Main trigger: click and dwell.** Not movement. The cursor crossing the screen is not
a signal of intent.

Rules that keep it from looking dizzying:

- **Deadzone.** The camera does not move until the cursor leaves a central dead zone.
  Same as a platformer camera.
- **Damping.** When it moves, it eases; never a straight line.
- **Hysteresis.** The threshold to enter zoom is higher than the one to leave it.
- **Minimum duration ~1 s.** Prevents the flicker of short zooms.
- **200 ms anticipation** before the click.

Two modes per segment, covering almost all real use:

- **Follow cursor** — "follow the cursor while it walks this menu"
- **Pin here** — "stay locked on this button"

## 7. Editor

**Segments, not keyframes.** A keyframe editor forces the user to think in curves. A
segment is "there is a zoom here, it lasts this long, it points there" — exactly the
unit the automatic detector produces. The user edits what the algorithm proposed
instead of building from scratch.

Layout (see the [mockup](/mockups/zoom-editor.html)):

```
┌─────────────────────────────┐
│  preview + camera box       │  ← draggable, with hold-to-compare
├─────────────────────────────┤
│  ▁▃▁█▁▂▅▁█▁  activity       │  ← evidence: clicks and dwell
│  ▓▓▓  ▓▓▓▓  ▓▓  ▓▓▓ zooms   │  ← editable segments
├─────────────────────────────┤
│  level · smoothing · mode   │  ← inspector for the selection
└─────────────────────────────┘
```

Four things that lift it from "video editor" to "tool that already solved 90%":

1. **Cursor activity track.** It is the evidence of _why_ the algorithm placed a zoom
   there. Without it, segments appear by magic and when one is wrong the user does not
   know what to touch.
2. **A single global sensitivity slider** that re-runs detection and regenerates all
   segments. Most of the time the problem is not one specific zoom: there are too many
   or too few. Fixing them one by one is the long road.
3. **Non-destructive preview.** The canvas applies the transform in real time over the
   original: drag the box and see the result instantly, with no encoding. The render
   only runs on export.
4. **Hold-to-compare.** An "Original" button that shows the raw footage while held.
   The only way to know whether the zoom improves the take is to see both.

**Out of v1:** manual keyframes, editable easing curves, hand-drawn zoom regions. That
is 5% of the cases and doubles the UI surface.

## 8. Data structures

```ts
type CursorTrack = {
  t0: number              // ms, timestamp of the first frame
  display: { w: number, h: number, scaleFactor: number }
  positions: { t: number, x: number, y: number }[]   // x,y normalized 0..1
  clicks:    { t: number, x: number, y: number, button: 0 | 1 | 2 }[]
}

type ZoomSegment = {
  id: string
  start: number           // s, same clock as the video PTS
  end: number
  scale: number           // 1.0 – 4.0
  mode: 'follow' | 'fixed'
  anchor?: { x: number, y: number }   // only in 'fixed'
  smoothing: number       // 0–100
  origin: 'auto' | 'manual'
}

type Project = {
  recording: string
  cursorTrack: CursorTrack
  segments: ZoomSegment[]
  sensitivity: number     // regenerates segments with origin: 'auto'
}
```

## 9. Open items

- [ ] Verify `cursor: 'never'` on Windows and macOS through the Electron path
- [ ] macOS permission flow: Screen Recording + Accessibility
- [ ] Decide where the render lives: hidden BrowserWindow vs Worker (see the repository
      note in [Render pipeline](#2-render-pipeline))
- [ ] Calibrate detector thresholds (minimum dwell, radius, click clustering)
- [ ] Multi-monitor handling when the cursor leaves the captured display
- [ ] Reconcile the `project/` layout and `Project` type above with the existing video
      editor's vault + session JSON model
