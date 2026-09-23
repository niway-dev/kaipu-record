---
title: "Testing: cursor track check"
description: "Automated inspection of a recorded .cursor.json sidecar — invariants, the CLI, frame overlays, and how to add a new fixture."
---

# Cursor track check

Every screen recording writes a cursor sidecar (`<vault>/.kaipu/<id>.cursor.json`,
[format](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/#file-format)).
Reviewing one used to be manual: open the JSON, eyeball the gaps, guess whether a late
first sample means something dropped. `src/shared/cursor-track-report.ts` turns that
review into a pure inspector (`inspectCursorTrack`), so the expectations of the data
live in the repo as tests instead of in someone's head.

## What a valid track looks like

`inspectCursorTrack(track, media?)` returns a list of findings, each with a stable
`code` and a level (`ok` / `warn` / `error`). A report is `ok` when it has no `error`
finding.

| Code                 | Level             | Meaning                                                                                                                                                                                                                                                                     |
| -------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchor-estimated`   | warn              | `track.anchor !== "exact"` — t0 came from the renderer-clock fallback, not mediabunny's first-media timestamp.                                                                                                                                                              |
| `t-unsorted`         | error             | `t` is not strictly increasing — breaks binary search (`lastIndexAtOrBefore`).                                                                                                                                                                                              |
| `arrays-mismatched`  | error             | `t`/`x`/`y` column lengths differ.                                                                                                                                                                                                                                          |
| `empty`              | warn              | The track has 0 samples.                                                                                                                                                                                                                                                    |
| `out-of-display`     | warn              | Samples with `x`/`y` outside `[0, 1]` — legal (the pointer was on another display), just worth reporting.                                                                                                                                                                   |
| `truncated`          | warn              | `truncatedAtMs` is present — sampling stopped early because `MAX_CURSOR_SAMPLES` was reached.                                                                                                                                                                               |
| `gap`                | ok / warn per gap | A gap > 1500 ms between consecutive samples. `ok` when the position didn't change (an idle pointer — the de-dup writes the trailing duplicate first). `warn` when it did (samples are missing).                                                                             |
| `late-start`         | ok                | `firstMs > 1000` with the first two samples at different positions. Informational: `CursorSampleBuffer` collapses every identical-position sample before the pointer's first move into one entry, so a track legitimately starting late is not evidence of dropped samples. |
| `tail-coverage`      | ok / warn / error | Needs `media.durationMs`. `ok` when `lastMs >= durationMs - 250`; `warn` when the track ends more than 250 ms before the media; `error` when `lastMs > durationMs + 50` (samples past the end of the media — the tail cut failed).                                          |
| `clicks-unavailable` | ok                | `clicksAvailable === false` — an empty `clicks` here means unknown, not none (the Accessibility-gated hook never ran).                                                                                                                                                      |
| `rate`               | ok / warn         | Median interval between consecutive samples while moving (gaps > 100 ms ignored). `warn` above 20 ms — the 125 Hz poller is running slower than 50 Hz.                                                                                                                      |

`inspectCursorTrack` also reports `samples`, `clicks`, `firstMs`, `lastMs`, and `bytes`
(`JSON.stringify(track).length`, which should stay a few MB at most per the capture
plan's size budget).

## Running the CLI

```bash
cd apps/kaipu-record
bun run cursor-track:check <recording-id | path-to.cursor.json> [--vault <dir>] [--frames [n]]
```

- With a recording id, it resolves `<vault>/.kaipu/<id>.cursor.json`, `<vault>/.kaipu/<id>.json`
  (the meta sidecar) and `<vault>/<id>.mp4` — default vault `~/Movies/Kaipu Record`.
- With a direct path to a `.cursor.json` file, it inspects that file, and looks for
  siblings named `<id>.json` / `<id>.mp4`.
- If `ffprobe` is on `PATH`, the real media duration/width/height are read from the
  mp4 and used for `tail-coverage`. Otherwise it falls back to
  `meta.durationSeconds * 1000` and says so in the output (that value is floored —
  see the caveat below).
- Exit code is `1` if the report has any `error` finding, `0` otherwise.

## Reading the frame overlays

`--frames [n]` (default 4, needs `ffmpeg` on `PATH`) picks `n` timestamps evenly
spaced across the track, looks up the sample at or before each one, and extracts that
frame from the mp4 with a red 80×80 box centered on the predicted cursor position
(`(x * width, y * height)`), cropped to a 480×360 region around it. The PNGs land in
`<vault>/.kaipu/<id>.cursor-check/tNNNN.png`. Open them: the recorded cursor in the
frame must be inside every red box. If it's outside, the display mapping, the
clock/pause rebasing, or the anchor is wrong for that recording.

## Adding a new real recording as a fixture

`src/shared/__fixtures__/` holds sidecars from real recordings so their invariants are
pinned by `cursor-track.fixture.test.ts` instead of relying on a one-off manual check.
To add one:

1. Record something (ideally with the pointer idle for a stretch, moving across
   displays, etc. — something worth pinning).
2. Copy `<vault>/.kaipu/<id>.cursor.json` and `<vault>/.kaipu/<id>.json` into
   `src/shared/__fixtures__/` as `<descriptive-name>.cursor.json` and
   `<descriptive-name>.meta.json`.
3. Run `bun run cursor-track:check <id> --vault <vault>` (and `--frames`) once to see
   what the track actually looks like.
4. Write the fixture test's expectations from that output — parses, sample/click
   counts, findings and their levels/data, `bytes` — following the pattern in
   `cursor-track.fixture.test.ts`.

## Known caveat: pre-fix recordings show a tail-coverage warn

Before the tail-cut fix (`RecordingFinalizeMeta.durationMs`, see the plan doc's Task 9),
the cursor tracker's `maxMs` was `meta.durationSeconds * 1000` — a **floored** value.
Flooring can drop up to ~1 s of real samples/clicks at the end of every recording. A
sidecar captured before the fix will show a `tail-coverage` **warn** of up to ~1 s
against the real media duration (from `ffprobe`), even though it looks clean against
the sidecar's own (also floored) `durationSeconds`. This is expected for any fixture
predating the fix — `cursor-track.fixture.test.ts` documents this exact case — and
should not appear in recordings made after it.
