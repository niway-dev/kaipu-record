---
title: Cursor follow and styling — research and plan
description: How established screen recorders let users restyle the cursor after recording, why both earlier Kaipu ideas are dropped, and the plan that would get Kaipu there. Research only; nothing here is scheduled.
---

# Cursor follow and styling — research and plan

**Status: ⚪ Research · 2026-10-06.** Planning only, no implementation scheduled. Replaces the
two options in [cursor-sprite-capture](/backlog/cursor-sprite-capture/) (Spike A on
`getDisplayMedia`, or going straight to a native module), which the owner dropped.

## Summary (one minute)

Users want to pick the cursor's size and style, smooth its path and add click effects in the
editor. Every tool that does this — Screen Studio, Cap, Recordly — works the same way:
**record the screen without the cursor, record the cursor separately (position, clicks and
the cursor's image/shape), and draw it in the editor/export.** Kaipu already has half of
it: a cursor track (position at 125 Hz, clicks) and auto-zoom that follows it. The missing
half is a capture path that leaves the cursor out of the pixels, plus recording the cursor's
shape. On Electron that means a native capture helper on macOS (ScreenCaptureKit), which is
exactly how Recordly — also Electron — does it.

| #   | Decision                                                                    | Why                                                                                       | ADR |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --- |
| 1   | Drop both earlier ideas as standalone projects.                             | Owner decision.                                                                           | —   |
| 2   | The target design is "cursor-free capture + cursor track + drawn cursor".   | It is what every product with cursor styling ships; drawing over a recorded cursor fails. | —   |
| 3   | Start with a capture spike on the packaged build, not with a native module. | The capture path also carries system audio, the source picker and permissions.            | —   |

### Open questions

1. Is a native helper (a small Swift binary or Node addon around ScreenCaptureKit) acceptable
   in the build and notarization pipeline? It is the decision that would need an ADR.
2. Windows: Windows Graphics Capture can exclude the cursor from build 19041; is Windows
   in scope when this starts?

### Out of scope

Implementation; custom cursor themes uploaded by users; detecting the cursor from pixels.

---

## How established products do it

| Product                                                        | Capture                                                                                     | Cursor data                                                                              | Editor controls                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [Screen Studio](https://screen.studio/guide/cursor)            | Native macOS (ScreenCaptureKit), cursor excluded                                            | Raw positions at high frequency; original cursor types                                   | Size, type (macOS / touch), smoothing with Bezier interpolation, "optimize cursor type changes" |
| [Cap](https://cap.so/)                                         | Native capture per OS, cursor excluded                                                      | Its own cursor track; controls do not work on imported video because the data is missing | Show/hide, size, hide when idle, smoothing presets, click effects                               |
| [Recordly](https://github.com/DanielYanZu/recordly) (Electron) | Native helpers: ScreenCaptureKit on macOS, WGC on Windows 19041+, Electron capture on Linux | Cursor track rendered as an overlay                                                      | Animated cursor, zoom faithful to Screen Studio; cursor hiding depends on OS support            |

The pattern: the cursor is **data**, not pixels. Once it is data, size, style, smoothing,
idle-hide and click ripples are draw-time choices.

**Cursor shape.** On macOS, `NSCursor.currentSystem` returns the cursor currently shown by
any app, with its image and hotspot ([example](https://www.codejam.info/2023/07/macos-harvest-cursor-from-any-app.html)).
Sampling it on change and storing each distinct image once (by hash) gives the editor the
real arrow, I-beam or hand. That removes the "two cursors" problem
[cursor-sprite-capture](/backlog/cursor-sprite-capture/) documented. It needs native code too.

## Why the two earlier ideas were dropped

- **`getDisplayMedia({cursor: "never"})` spike.** Electron issues
  [#7584](https://github.com/electron/electron/issues/7584) and
  [#14337](https://github.com/electron/electron/issues/14337) are still open; the constraint
  has historically been ignored on macOS. A spike would most likely confirm a no.
- **Native module first.** Right direction, wrong order: it replaces the capture path that
  system audio, the source picker and permissions ride on. Nothing has measured that
  same path, so the first step is measuring what moves.

## Plan (when picked up)

1. On a packaged build, check whether a `getDisplayMedia` capture served by
   `setDisplayMediaRequestHandler` honors `cursor: "never"` on current macOS, and what it
   does to system audio and permissions.
2. Prototype a ScreenCaptureKit helper (`showsCursor = false`) that produces frames for the
   existing mediabunny encoder, behind a flag. Measure CPU against the current path.
3. Extend the cursor track with a `shapeId` per sample and a shape table (image + hotspot),
   sampled from `NSCursor.currentSystem`.
4. Draw the cursor in the editor preview and the export after the zoom crop, at a fixed
   on-screen size; then add size, smoothing, idle-hide and click ripple controls.
5. Fallback: recordings made without the helper keep today's behavior (cursor in pixels,
   styling controls hidden).

## References

- [Screen Studio — cursor guide](https://screen.studio/guide/cursor)
- [Cap](https://cap.so/) · [Recordly](https://github.com/DanielYanZu/recordly) ·
  [ScreenKite vs Recordly](https://www.screenkite.com/blog/screenkite-vs-recordly)
- [Electron #7584](https://github.com/electron/electron/issues/7584) ·
  [Electron #14337](https://github.com/electron/electron/issues/14337)
- [Harvesting the macOS cursor from any app](https://www.codejam.info/2023/07/macos-harvest-cursor-from-any-app.html)
- Prior work: [zoom cursor follow spec](/specs/2026-09-21-zoom-cursor-follow-design/),
  [plan 12 — capture resolution and cursor sprite](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/)
