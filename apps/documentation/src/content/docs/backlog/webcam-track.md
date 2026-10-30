---
title: "Webcam track — record the webcam as its own track and compose it above the zoom"
description: "Proposal: the webcam stops being pixels of the screen capture. The recorder writes a second, synchronized MP4 from the webcam, the floating bubble is excluded from the capture, and the video editor composes the webcam as a layer above the auto-zoom so the face never disappears into a zoom."
---

# Webcam track

> **Status: 🔵 Proposed** (2026-10-30). Design approved by the owner; nothing implemented.
> Design: [Webcam track](/specs/2026-10-30-webcam-track-design/) · ADRs
> [0032](/architecture/decisions/0032-webcam-is-its-own-track-and-the-bubble-is-excluded-from-capture/)
> (track and exclusion) and
> [0033](/architecture/decisions/0033-webcam-is-a-viewport-layer-composed-after-the-zoom-crop/)
> (editor layer) · Linear [NIW2-565](https://linear.app/niway/issue/NIW2-565).
> Effort: High (16–25 days plus owner QA). First step: the one-day exclusion spike (spec task 0),
> run by the owner by hand.

## The problem

When the webcam is on, the camera bubble is a floating window that the screen capture records
as part of the screen (`camera-bubble-window.ts` is deliberately not content-protected). The
recorder writes one MP4 — screen plus mixed audio — and no webcam file. So when the video
editor's auto-zoom crops into a region, the face is cropped away with the rest of the frame.
Today the owner records without zoom to keep it.

Re-pasting the bubble's pixels from the unzoomed frame was considered and rejected: a hack over
the wrong model.

## The decision

The professional model (Screen Studio, Cap, Tella, Camtasia):

- **Record the webcam as its own file**, `.kaipu/<id>.webcam.mp4`, encoded by the recorder
  renderer on the same clock as the screen; the start offset goes on the sidecar, as the cursor
  track is anchored today. The screen file stays screen-only and nothing changes for recordings
  made before.
- **Keep the bubble on screen but out of the capture.** Plan A is content protection from
  creation (Electron's `desktopCapturer` path hands in-process protected windows to
  ScreenCaptureKit's `excludingWindows`); a spike with written pass/fail criteria goes first. Plan
  B, only if the spike fails, is a native ScreenCaptureKit capture that excludes the bubble by
  window id, as Cap does. Hiding the bubble during a take is rejected.
- **The editor composes the webcam as a viewport layer** — a global layout (shape, size,
  position, mirror, framing, shrink during zoom) plus source-anchored hide/override segments —
  drawn after the zoom crop and after the output framing, in the composer the MP4 and GIF exports
  share. Share composes it at the recorded layout.

## What to validate first

The spike (spec section 3.5): seven short takes on the owner's Mac and on Windows, display /
area / window targets, checking that the text under the bubble and under the control bar is in
the file with no bubble and no blank patch. Its outcome selects Plan A or B and also settles the
[terminal-line patch hypothesis](/backlog/bug-control-bar-hides-last-terminal-line/).

## Dependencies and follow-ups

- Cloud upload of the webcam file waits for the transfer client
  ([cloud plan 03](/backlog/desktop-cloud-sync-gap/)); until then "Remove local copy" is refused
  for recordings with a webcam file.
- Supersedes decision 6 of the [capture modes spec](/specs/2026-10-26-record-capture-modes-design/)
  (the bubble "recorded as part of the screen"); the bubble's shape, size, mirror and framing
  settings ([camera bubble](/backlog/camera-bubble-shape-and-size/)) become the layer's defaults.
- Later: camera-only and split-screen scenes, background blur, layout transitions.
