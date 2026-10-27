---
title: "Recording capture metadata — label recordings by how they were captured"
description: "Every new recording stores its capture mode (screen, area, window), output size and ratio in the vault sidecar; the library shows it as a small tag on the card and in the detail metadata."
---

# Recording capture metadata

> **Status: 🟢 Ready to validate** (2026-10-26). PR #382, integrated with the rest of task 5 on `feat/record-modes-integration`; the Record page's Recent grid uses the same tag;
> owner QA on a real recording pending. Follow-up of
> [Record capture modes](./record-capture-modes) ·
> [design, decision 12](/specs/2026-10-26-record-capture-modes-design/) · ADR
> [0030](/architecture/decisions/0030-recording-target-and-area-crop-in-the-compositor/).

## What it adds

- A `RecordingCapture` value saved with every new recording, in its sidecar next to
  `durationSeconds`:

  ```ts
  {
    mode: "screen" | "area" | "window";
    width: number;  // encoded output size, px (0 when unknown)
    height: number;
    ratio: "free" | "16:9" | "9:16" | "1:1" | null; // null for screen and window
    displayId?: number; // area recordings only
  }
  ```

- `LibraryItem.capture` (and `LocalRecording.capture`): read from the local sidecar. A
  cloud-only item, a screenshot, a GIF, an editor export and any recording made before this
  change read `null`. Nothing migrates.
- A small mono tag on the library card's poster (top-left, next to the kind badge) and the same
  label in the detail page's metadata line: `FRAME · 16:9`, `FRAME · 1280 × 720` (free ratio),
  `SCREEN`, `WINDOW`.
- `RecordingCaptureTag` and `useRecordingCaptureLabel` in
  `features/library/components/recording-capture-tag.tsx`, for the Record page's "Recent" grid.

## How it works

- **Mode** — `recordingCaptureMode` in `src/shared/recording-capture.ts`: a `window:` source is a
  window, a `screen:` source with an area is an area, otherwise a screen. `recording_started`
  analytics uses the same helper.
- **Size** — the renderer engine already computes the encoded size (`areaEncodePlan(...).target`
  for an area, `fitToCap` otherwise) and now exposes it as `EngineHandle.outputSize`. The
  recorder store builds the capture once the engine starts and sends it with
  `recordingFinalize`. The builder falls back to the area rect (DIP × scale) and then to zeros,
  but the engine always provides the output size today.
- **Ratio** — `RecordingArea.ratio`: the chip the Frame box was locked to. The overlay's record
  answer carries it, and main keeps it on the area (`sanitizeArea`). Otherwise an area recording infers 16:9, 9:16 or 1:1 within
  1% of `width / height` (even rounding moves it slightly), else `free`.
- **Trust** — main sanitizes the value from IPC before writing it and again when reading the
  sidecar; a malformed value reads as `null`.
- **Words** — `library.captureScreen`, `captureWindow`, `captureFrame`, `captureFrameRatio`,
  `captureFrameSize` in `@kaipu/i18n` (en, es). The shared helper returns a key and params, the
  renderer translates; `src/shared/**` takes no value import from a workspace package.

## How to validate

1. Record a whole display, a window and an area (one 16:9, one free) from the Record flow.
2. Open the Library: each card shows `SCREEN`, `WINDOW`, `FRAME · 16:9` or
   `FRAME · <w> × <h>` at the top-left of the poster.
3. Open each recording: the same label sits in the metadata line after the duration.
4. Older recordings show no tag. Inspect `.kaipu/<id>.json` in the vault: `capture` sits next to
   `durationSeconds`.

## Not included

- No cloud sync of the value; the server catalog is unchanged.
