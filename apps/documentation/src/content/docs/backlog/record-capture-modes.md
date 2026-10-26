---
title: "Record capture modes — record a display or a selected area"
description: "Proposal: choose what a recording covers — a display, an area drawn on the capture overlay, or a window — with the crop done in the recording compositor, a shade outside the recorded area, and a redesigned widget and Record page."
---

# Record capture modes

> **Status: 🔵 Proposed** (2026-10-26). Owner request after using the screenshot modes:
> "now I want to choose a full screen or a selection range, like screenshot". Design:
> [Record capture modes](/specs/2026-10-26-record-capture-modes-design/) · ADR
> [0030](/architecture/decisions/0030-recording-target-and-area-crop-in-the-compositor/) ·
> Linear [NIW2-513](https://linear.app/niway/issue/NIW2-513/record-capture-modes-record-a-display-or-a-selected-area-through-the).
> Fills the Record seat reserved by [screenshot modes v2](/specs/2026-10-17-screenshot-modes-v2-design/)
> (decision 12) and ADR 0024.

## What it adds

- A recording **target**: a display, an area (rectangle on one display) or a window. The current
  mode is remembered like the screenshot mode.
- The **capture overlay** opened with a `record` intent: Frame and Screen as in screenshots, an
  action bar with Use selection, Record and Capture, so the user can switch between shooting and
  recording without leaving it.
- The **crop in the recording compositor** from a full-display capture, with the DPI geometry the
  screenshot backend already uses; no native module, one path for macOS and Windows.
- A **recording shade** while an area records: clear inside, dark outside, click-through and never
  in the video.
- The **cursor sidecar normalized to the recorded rectangle**, so auto-zoom keeps working; the
  camera bubble anchored inside the rectangle.
- A redesigned **widget Record tab and Record page**: mode row, selection card, camera, audio and
  microphone controls. The design brief lives in the spec, section 7.

## What is left

Everything: the design PR is the first step. Tasks and their order are in the spec, section 8.
Open questions (compositor cost in the hidden window, Enter semantics in record intent, the
analytics event name) are in the spec's one-minute block.
