---
title: "Cursor-free capture and a drawn cursor (v2.1)"
description: "Future improvement for the video editor's auto-zoom: exclude the OS cursor from the screen capture and draw our own at export, so it stays sharp at any zoom level and can be smoothed. Deferred from v2; reopen if zoomed cursors look bad in production."
---

# Cursor-free capture and a drawn cursor

> **Status: ⚪ Idea — deferred from video editor v2** (2026-09-22). Not scheduled. This is
> the one structural gap between our auto-zoom and Screen Studio / Cap, recorded here so
> the decision and its trigger are not lost. Reopen when the condition in
> [When to pick this up](#when-to-pick-this-up) is met. Design background:
> [plan 12 — capture resolution and cursor sprite](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/).

## The gap

Video editor v2 records the cursor track (position at 125 Hz, clicks when
Accessibility is granted) as a sidecar next to the recording — the same approach the
auto-zoom tools use. Where v2 differs from the best of them is one layer earlier, in
the **capture**:

|                                  | Screen Studio, Cap                    | Kaipu v2                                              |
| -------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| OS cursor in the captured pixels | **No** — excluded at capture time     | **Yes** — baked into every frame                      |
| Cursor drawn at export           | Their own sprite, after the zoom crop | None; the recorded cursor is magnified with the frame |
| Cursor at 2× zoom                | Sharp, fixed on-screen size           | Blurry, twice its natural size                        |
| Pointer smoothing, click ripples | Possible                              | Not possible                                          |

Their capture path (ScreenCaptureKit on macOS, the Graphics Capture API on Windows)
has a flag to leave the cursor out. Ours does not: the app records through Electron's
`getUserMedia` + `chromeMediaSource: "desktop"`, which exposes no such option. That is
the whole reason this is deferred, not a lack of design.

## Why "just draw a cursor on top" was rejected for v2

Plan 12 evaluated drawing a sprite over the recorded cursor and cut it:

- The recorded cursor is in the pixels and is magnified by the zoom; a sprite must be
  at least as large as the magnified original to hide it.
- The track stores positions, not cursor **shapes**. Over text the OS shows an I-beam,
  over links a hand, over a resize edge an arrow pair. An arrow sprite on top of an
  I-beam is not "faint", it is two different cursors — most of the time, on
  text-heavy recordings. Electron has no API for another app's current cursor shape.
- The sprite must sit on the recorded cursor's hotspot within a couple of pixels on
  every frame; the clock model accepts up to one frame of error per pause, which at
  fast pointer speeds is tens of pixels — a visible ghost trail.

So a drawn cursor is only worth it when the recorded one is **gone** from the pixels.

## What v2.1 would do

1. **Capture without the cursor** when auto-zoom is on. Either a Chromium/Electron
   path that honours cursor exclusion, or a native capture module that replaces
   `getUserMedia` for the screen track. The latter is a much bigger change (system
   audio, source picker and permissions all ride on the current path).
2. **Store a coarse cursor type per sample** if the OS exposes it (arrow / I-beam /
   hand / resize); otherwise draw an arrow only and document the limitation.
3. **Draw the sprite after the camera crop**, at a fixed on-screen size, using the
   existing cursor track (`sampleCursor(track, t)` already interpolates it). The track
   format does not change.
4. **Tighten the clock error** across pauses to under one frame (plan 01 accepts
   about one frame today), because with a drawn cursor a one-frame offset is visible.
5. Then the extras become cheap: pointer smoothing, click ripples, a hidden cursor
   during "fixed" zooms.

Everything below the capture layer — the track, the detector, the camera path, the
export composition order — is already built to accept this; the sprite is one more
draw call after `cropRectPx`.

## Spike A (the research that gates this)

Time-box one day on a throwaway branch and record the result here:

- [ ] macOS and Windows: capture via `getDisplayMedia({ video: { cursor: "never" } })`
      served by `session.setDisplayMediaRequestHandler` (same screen source); record
      5 s moving the pointer. **Is the cursor in the pixels?**
- [ ] Same with the current `getUserMedia` + `chromeMediaSource: "desktop"` path and any
      constraint Chromium documents for cursor capture on this Electron version.
- [ ] If either excludes the cursor on **both** OSes: list what else changes (system-audio
      path, source picker, permissions) — that is the real cost of v2.1.
- [ ] If neither does: estimate a native capture module (ScreenCaptureKit / Windows
      Graphics Capture) and decide whether the feature justifies it.

## When to pick this up

Reopen this item if, after v2 ships, any of these shows up:

- Users comment on the **blurry or oversized cursor** inside zooms, or compare it to
  Screen Studio.
- The soft-zoom hint (plan 12) is not enough and people want zooms above 2× on 1080p
  recordings — a sharp cursor is a large part of what makes those look acceptable.
- Spike A is run for another reason and comes back positive on both platforms.

Until then, v2's behaviour — the recorded OS cursor, zoomed with the frame — is the
accepted trade-off.

## Non-goals

Detecting the cursor from the video pixels (shape changes, camouflage, no click
signal — rejected in the [pipeline spec](/specs/2026-09-21-zoom-cursor-follow-design/)).
Custom cursor themes. Cursor effects on recordings without a cursor track.
