---
title: "Video editor — audio waveform in the Audio lane"
description: "The Audio lane draws the recording's loudness as bars, so people can see where they talk and where it is silent before they cut or mute."
---

# Video editor — audio waveform

> **Status: 🟢 Ready to validate —
> [NIW2-775](https://linear.app/niway/issue/NIW2-775/audio-waveform-in-the-video-editors-audio-lane).**
> Ships without a flag: the owner tested it and chose to ship it directly on 2026-11-14. Seen
> in the real app on the UI catalog's seeded recordings. Pending: production validation on
> long real takes (decode time, smoothness while it decodes). The owner asked for it on 2026-11-14
> and approved the look with a mock: blue bars of the recording's loudness across the lane,
> muted ranges as hatched blocks over a dimmed waveform.

## Why

The Audio lane only drew muted ranges. With none, it said "No muted sections yet." and
nothing else, so the lane gave no help in deciding what to cut or mute. A waveform shows at a
glance where someone talks and where it is silent. The [mute doc](./video-editor-mute) had
listed it as a non-goal ("Useful, separate"); this is that separate piece.

## Decisions

| Decision                                                                                                                | Why                                                                                                                                                                             | ADR  |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Compute the peaks in the renderer with mediabunny's `AudioSampleSink`, streamed through `kaipu-media://` Range requests | The editor already decodes the recording this way for the filmstrip (`use-source-thumbnails.ts`). No new IPC, no ffmpeg (the app does not ship one).                            | none |
| Stream and reduce as it decodes, yielding to the event loop every few milliseconds                                      | A 54-minute take decoded whole would hold over 1 GB of samples. Reduced on the fly it holds 100 peaks per second (about 1.3 MB for that take), and the editor stays responsive. | none |
| 100 peak buckets per second, each the largest absolute sample in it                                                     | Fine enough for the deepest zoom on a short clip, small enough for an hour-long take.                                                                                           | none |
| Cache peaks in memory per recording (a small LRU, like the filmstrip)                                                   | Reopening a recording in the same session is instant. Persisting across restarts is a follow-up if the first decode turns out slow on long takes.                               | none |
| Draw on one canvas sized to the visible part of the lane, bars on a fixed pixel pitch                                   | At 2000% zoom the lane is 20 viewports wide; a canvas that wide would exceed browser limits. Bars anchored to content pixels do not shimmer while scrolling.                    | none |
| Loudness on a decibel scale relative to the take's 99th-percentile peak                                                 | Speech peaks are often a fifth of full scale; a linear scale would draw them as stubs. One loud click must not flatten everything else.                                         | none |
| Muted ranges keep their hatched blocks; the bars under them are dimmed                                                  | The mock: silence in the export should look like silence in the lane.                                                                                                           | none |
| No feature flag: on for everyone                                                                                        | The owner tested it in dev and chose to ship it directly; there is no kill switch, a revert is the rollback.                                                                    | none |

## Out of scope

- Volume per range (the "-18 dB" block in the mock). A separate feature.
- Separate mic and system-audio waveforms. The recording has one mixed track.
- Persisting peaks across app restarts.
- Pausing the decode while the Audio lane is hidden: a decode cancelled halfway would start
  over from 0 when the lane comes back, so it keeps running.
- A waveform legend row in the Audio entry of the Timeline guide (`track-guide.ts`). The
  entry's intro already says the bars show loudness.
