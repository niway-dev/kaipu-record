---
title: "Background music — a music bed under the recording, mixed at export"
description: "Proposal: put a music file under an edited recording on its own audio lane, muted and mixed independently of the voice, as phase E of the editor timeline v2. Not designed; it builds on phase D's per-source audio lanes and export mixing."
---

# Background music

> **Status: 🔵 Proposed** (2026-10-31). Owner decision 7 of the
> [editor timeline v2 design](/specs/2026-10-31-editor-timeline-v2-design/): backlog only, no
> design decisions yet. Phase E of that design. Builds on
> [ADR 0040](/architecture/decisions/0040-typed-tracks-on-demand-and-stackable-media-lanes/)
> (per-source audio lanes, export mixing). No Linear ticket (free issue limit).
> Effort: Medium, once phase D has shipped.

## The problem

A tutorial or a launch video often wants a quiet music bed under the voice. Today the only
audio in an export is the recording's (and, after phase D, the audio of overlay videos). There
is no way to add a sound file that has no picture.

## What phase D already gives it

- A per-source audio lane with its own mute, and an export that decodes, resamples to 48 kHz,
  sums and soft-clips every audible source (`export/audio-mix.ts` in the design).
- Timeline-anchored media items, so a music bed would play continuously across cuts.

## What a design would have to decide

- **The item.** An audio-only media item on an audio lane of its own (no picture, no
  placement), or a separate `scene.music` field. The media model is the cheaper fit.
- **Import.** The compose design's import accepts `mp4`, `mov`, `png`, `jpg`, `webp`; music needs
  `mp3`, `m4a`, `wav` at least, and the Library would hold audio-only items for the first time.
- **Level and ducking.** A bed at full scale buries the voice. Options: a fixed volume per item;
  automatic ducking under speech (a sidechain on the recording's level); fades in and out.
  Each needs volume, which timeline v2 leaves out.
- **Length.** Loop a short track to the end of the video, or stop it and fade out.
- **Licensing.** Kaipu ships no music. Whether to link to a royalty-free library, and the copy
  that makes clear the user owns the rights, belongs here.

## Dependencies

- [Editor timeline v2](/specs/2026-10-31-editor-timeline-v2-design/) phase D (audio lanes and
  mixing).
- The editor compose design's import path ([PR #279](https://github.com/niway-dev/kaipu-record/pull/279)),
  extended to audio formats.
