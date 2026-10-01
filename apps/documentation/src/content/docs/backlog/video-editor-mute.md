---
title: "Video editor — mute audio, whole video or a range"
description: "Proposal: a Mute tool in the video editor that silences the audio for the whole video or for chosen ranges of the timeline, previewed live and burned into the export as real silence, in the same source-anchored model the zooms and redactions use."
---

# Video editor — mute

> **Status: 🟢 Ready to validate — implemented in
> [#199](https://github.com/csdev19/kaipu-record-monorepo/pull/199) (2026-10-01).** The owner
> exercised it by hand on a real recording the same day: add a range, drag its edges, hear it
> go silent in the preview, delete it from the inspector. Export validation on a packaged build
> is the remaining step. Original request after the v2 wave: "an option to remove the sound —
> for the whole video or for a section". Parent: [video editor v2](./video-editor-zoom-blur-cover)
> · sibling: [live recording controls](./live-recording-controls) (mute _while_ recording; this
> doc is mute _after_ recording).

## What shipped

- **Model** — `audio-edits.ts`: muted ranges anchored to SOURCE time like zooms and redactions,
  so a cut moves a mute with the sound it covers. Overlaps are allowed and never merged on
  input (zero over zero is zero; an undo restores what was drawn); they are merged only at
  export, where the worker walks them in order. `audioMuted` is a separate whole-video flag,
  not "a range covering everything": inferring that from ranges is never exact once cuts and
  fractional seconds exist.
- **Export** — a muted sample is zeroed in place, never dropped (dropping shortens the audio
  and drifts it against the video). A whole-video mute drops the audio track entirely: smaller
  file, no dead volume control. `mute-export.e2e.ts` is the only check that can tell "no
  stream" from "a stream of zeros"; it needs an idle machine to run.
- **Session** — the two fields are additive; a reversed or zero-width range is rejected on load,
  not repaired (it would silence nothing while still drawing a handle).
- **UI** — an AUDIO lane under the timeline (grey, not brand pink: silence is an absence), two
  controls in the tool rail (mute a section at the playhead; mute the whole recording, one
  button carrying both states), and a side-panel inspector with the range's position and
  Delete. The mute joins the shared editor selection, so picking one deselects a zoom.
- **Preview** — the player's muted state is decided per frame from BOTH the user's toggle and
  the scene's muting at that instant; the element plays the original file, so `currentTime`
  is source time. Toggling or dragging a range over a paused playhead is heard at once.

## Decided, do not reopen

- **Boost audio is dropped.** Mute ships alone and stays binary (owner: "solo mute, nada de
  multiplicador"). The landing's pill reads "Mute audio".
- **Ranges may overlap.** Owner's call; it removed a failure mode rather than adding one.
- **No export dialog.** The timeline is the single source; the Export button is unchanged.

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
