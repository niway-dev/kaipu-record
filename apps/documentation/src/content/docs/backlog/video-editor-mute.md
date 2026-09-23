---
title: "Video editor — mute audio, whole video or a range"
description: "Proposal: a Mute tool in the video editor that silences the audio for the whole video or for chosen ranges of the timeline, previewed live and burned into the export as real silence, in the same source-anchored model the zooms and redactions use."
---

# Video editor — mute

> **Status: 🔵 Proposed** (2026-09-23). Owner request after the v2 wave: "an option to
> remove the sound — for the whole video or for a section". Parent:
> [video editor v2](./video-editor-zoom-blur-cover) · sibling proposal:
> [live recording controls](./live-recording-controls) (mute _while recording_; this doc
> is mute _after_ recording).

## Problem

A take often has audio you want gone: a phone ringing for ten seconds, a name said out
loud, a whole screen-only demo recorded with the mic on by mistake. Today the editor has
no audio operation at all — the only way to silence a section is to cut it, which also
removes the picture, and the only way to silence the whole video is a third-party tool,
which throws away every zoom and redaction the editor added.

## What exists already

- **The scene is source-anchored ranges.** `zoomSegments` and `redactions` are lists of
  `{ start, end }` in source seconds; the timeline already renders them as lanes and the
  inspector already edits a selected range. A mute range is the same shape.
- **The export already writes silence.** The audio pass in `export-worker.ts` decodes each
  clip's samples, trims them to the clip's exact source range, and rebases them onto a
  contiguous cursor; slides are emitted as zeroed `AudioSample`s of the right sample rate
  and channel count so the muxer sees equal track lengths. Silencing a range is the same
  operation applied to a decoded sample instead of a slide.
- **Sessions are versioned with optional fields** (`version: 1`, v2 fields optional), so
  a `mutes` field is additive and older builds ignore it.

## Proposal

### Model

```ts
interface MuteRange {
  id: string;
  /** Source seconds, like zoom segments and redactions. */
  start: number;
  end: number;
}

interface VideoScene {
  // …
  /** Source-anchored; sorted, may overlap (overlaps just mute once). */
  mutes: MuteRange[];
  /** Whole-video mute; wins over ranges. */
  muteAll: boolean;
}
```

Two fields rather than "a range from 0 to duration" for the whole video: `muteAll` is a
single toggle that survives cuts and re-detection, and it reads as intent in the session
file. Both are optional in `VideoEditSession` (default `[]` / `false`).

### UI

- **Whole video**: a speaker toggle in the toolbar next to the play controls
  (`Volume2` / `VolumeX`), tooltip "Mute audio". When on, the timeline's audio lane
  dims and every range control is disabled with "Audio is muted for the whole video".
- **A range**: a **Mute** tool beside Zoom / Blur / Cover. Drag on the timeline to
  create a range, exactly like a redaction; it shows on a **Sound** lane (or on the
  Privacy lane if a fifth lane is too much — decide in the PR by looking at the timeline
  at the default window size). Selecting a range opens the inspector with start / end
  and Delete, the same panel shape the redactions use.
- **Selection shortcut**: with a clip range selected on the main track, `M` mutes that
  range — the common case is "silence what I just found while scrubbing".
- **Preview**: the player's audio goes through a `GainNode`; the frame loop sets gain 0
  while the playhead is inside a mute range or `muteAll` is on, with a ≈ 20 ms ramp to
  avoid clicks. The level meter (if shown) reflects the muted state.

### Export

In the audio pass, for every decoded sample of a clip segment: if `muteAll` or the
sample's source range intersects a mute range, zero the intersecting portion of the
sample's data before `add()`. A sample fully inside a range is replaced by a zeroed
sample of the same duration/rate/channels (reuse the slide-silence helper); a sample
that straddles a boundary is split at the boundary, since `trimAudioSample` already
knows how to cut a sample at a source time. Timestamps and the output cursor are
untouched, so A/V sync and cut boundaries stay exactly as they are today.

Muting must produce **real silence in the file** — not a volume flag — because the
promise is the same as the redactions': what is muted cannot come back when the file
leaves the app. The leak-check pass in the handoff applies: play the exported file in a
frame-accurate player and confirm nothing is audible inside the range.

## Non-goals

- Volume adjustment, fades, ducking, or replacing audio. Mute is binary.
- Muting only the mic or only the system audio. The recording has a single mixed track
  (see [live recording controls](./live-recording-controls#what-exists-already)); the
  inputs are not separable after the fact. If per-input mute matters, it has to be
  recorded as separate tracks — a recorder change, not an editor one.
- Waveform rendering. Useful, separate.

## Acceptance

- [ ] Mute 3–8 s of a 20 s take: preview is silent in that window with no click at the
      edges; the export has silence exactly there (± one audio sample) and audio
      elsewhere; duration and A/V sync unchanged.
- [ ] Mute a range that spans a cut: silence on both sides of the cut, nothing else.
- [ ] `muteAll`: the export's audio track exists and is all zeros (screen-only exports
      keep having no track).
- [ ] The session round-trips: close, reopen, ranges and the toggle are back; a pre-mute
      build opens the session and ignores them.
- [ ] Overlapping ranges export as one silence; deleting one of two overlapping ranges
      leaves the other's silence intact.
