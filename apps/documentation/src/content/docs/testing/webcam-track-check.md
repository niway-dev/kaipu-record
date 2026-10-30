---
title: "Testing: webcam track check"
description: "Inspect a take's webcam file against its screen file — durations, start offset and its quality, size and fps — with bun run webcam-track:check."
---

# Webcam track check

A take recorded with the webcam on writes two files: `<vault>/<id>.mp4` (the screen) and
`<vault>/.kaipu/<id>.webcam.mp4` (the raw webcam), on one renderer clock. The sidecar
`.kaipu/<id>.json` stores where the webcam's time 0 sits against the screen's, under
`webcam.startOffsetMs`, with `webcam.offsetQuality` (`exact` when both first-media timestamps
came from mediabunny, `estimated` otherwise)
([ADR 0032](/architecture/decisions/0032-webcam-is-its-own-track-and-the-bubble-is-excluded-from-capture/),
[design, section 2](/specs/2026-10-30-webcam-track-design/#2-sync-and-the-check-script)).

`src/shared/webcam-track-report.ts` (`inspectWebcamTrack`) checks the sidecar entry against
both files; `scripts/webcam-track-check.ts` is its CLI, the sibling of
[cursor track check](/testing/cursor-track-check/).

## Running the CLI

From `apps/kaipu-record`:

```bash
bun run webcam-track:check <recording-id> [--vault <dir>]
```

The vault defaults to `~/Movies/Kaipu Record`. It needs `ffprobe` on the PATH for the
durations and the file's size and fps; without it, it prints the sidecar values only. It
prints both durations, the offset and its quality, and the webcam size and fps, then the
findings. Exit code 0 when there is no error finding, 1 otherwise, 2 for a bad invocation or
a missing sidecar.

## Findings

| Code                  | Level | Meaning                                                                                                                                     |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-webcam-meta`      | error | The sidecar has no usable `webcam` entry: the take reads as one without a webcam (camera off, webcam failed, or a recovered stranded take). |
| `webcam-file-missing` | error | No `.kaipu/<id>.webcam.mp4`.                                                                                                                |
| `offset-estimated`    | warn  | A first-media timestamp fell back to the renderer clock; the offset may be off by about a frame.                                            |
| `duration-mismatch`   | warn  | screen − webcam − offset is more than 500 ms either way. Expected when the camera was turned off mid-take (the webcam file ends there).     |
| `size-mismatch`       | warn  | The file's size differs from the sidecar's `width`/`height`.                                                                                |
| `fps-mismatch`        | warn  | The file's average frame rate differs from the sidecar's `fps` by more than 1.                                                              |

## The human check behind it

The script proves the numbers are consistent, not that the face is in sync. The QA sheet's
clap test is that check: clap in front of the webcam, open both files, and the clap's frame in
the webcam file, shifted by `startOffsetMs`, must land within one frame of the audio peak in the
screen file; repeat after a 5 s pause mid-take.
