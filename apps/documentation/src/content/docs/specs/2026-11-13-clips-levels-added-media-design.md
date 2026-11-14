---
title: "Clips levels: added images and videos on the timeline — design"
description: The Clips section of the video editor becomes a section with levels. The bottom level is the gapless sequence, where a joined photo or video pushes the recording; upper levels hold floating images and videos with a box in the frame, a stacking order and fades, anchored to the footage under them. Three stages; stage 1 is floating images behind a release flag.
---

# Clips levels: added images and videos on the timeline — design

**Status: 🔵 Proposed · 2026-11-13.** Owner decisions taken in chat on 2026-11-13 over a sketch of
four timelines. Nothing is implemented. Ticket:
[NIW2-770](https://linear.app/niway/issue/NIW2-770/video-editor-clips-becomes-a-section-with-levels-added-images-and).
ADR: [0057](/architecture/decisions/0057-clips-is-one-section-with-levels-a-sequence-below-floating-items-above/)
(new; supersedes part of [0040](/architecture/decisions/0040-typed-tracks-on-demand-and-stackable-media-lanes/)).

## Summary (one minute)

Today **Add to timeline** inserts a frame capture as a 3 s full-frame slide in the single Clips
sequence ([PR #620](https://github.com/niway-dev/kaipu-record/pull/620)). The owner tested it and
does not want it shipped that way. Clips becomes one section with levels. The bottom level is the
sequence we have: items end to end, and whatever is inserted pushes the recording later, which is
how two videos are joined. The levels above hold floating items: an image or a video that sits
over the sequence for a while, in a box that can be moved and resized in the frame, with a
stacking order and a fade in and out. A floating item is tied to the footage under its start, so
it stays over the same moment when the sequence changes. It is built in three stages, and stage 1
(floating images, behind a release flag) is the first thing to try.

| #   | Decision                                                                                                                                                | Why                                                                                                                | ADR         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1   | Reuse the parked timeline v2 design where it serves: draw order, per-source audio mixed at export, at most two visible videos, sources from the Library | Already decided by the owner on 2026-10-31 and still right                                                         | reuses 0040 |
| 2   | One Clips section with levels; no separate Overlay lanes                                                                                                | The owner's sketch: added items are objects like clips                                                             | 0057 (new)  |
| 3   | The bottom level is a gapless sequence that pushes; the recording is never placed freely                                                                | Joins work with no new concept, and no empty seconds reach the export by accident                                  | 0057        |
| 4   | Upper levels float: a box in the frame, a stored stacking order `z`, both items drawn when they overlap                                                 | Owner: "depends on the size … also define a z-index"                                                               | 0057        |
| 5   | A floating item is anchored to the footage under its start                                                                                              | A join shifts the recording; a timeline-anchored item would end up over another moment                             | 0057        |
| 6   | Timeline rows are computed from time overlap and `z`; never stored                                                                                      | "If both fit on one level, use one", without packing ever changing what is in front                                | 0057        |
| 7   | Effects in order: fade in/out per floating item, fade through the background between sequence items, true crossfade last                                | Each step needs more of the engine than the one before                                                             | 0057        |
| 8   | An image defaults to 10 s floating and 5 s in the sequence                                                                                              | Over narration 10 s reads well; 10 s of silent still does not                                                      | 0057        |
| 9   | An added video's sound is on by default, mute per item, no volume                                                                                       | Owner took the default                                                                                             | reuses 0040 |
| 10  | Sources: the Library first; a file from disk, copied into the workspace, later                                                                          | Owner took the default; matches the compose design ([PR #279](https://github.com/niway-dev/kaipu-record/pull/279)) | reuses 0040 |
| 11  | Until stage 1 is accepted, **Add to timeline** and every way to create a floating item sit behind the release flag `timeline-levels`, off by default    | The owner does not want the current behaviour in desktop 0.19.0                                                    | reuses 0049 |
| 12  | Delivery in three stages: floating images; a second video in the sequence; floating videos with sound and the crossfade                                 | Stage 1 needs no second decoder and replaces the behaviour the owner rejected                                      | —           |

## Open questions

1. **Sketch 3.** An item on the upper level from 0 while the recording starts later and overlaps
   its end. With no gaps it cannot be drawn as is. It is either the crossfade of stage 3 (the
   overlap is the transition) or empty background before the recording (an explicit background
   block in the sequence). Not needed for stage 1. Default until the owner says: the crossfade.
2. **Annotations.** Boxes, arrows and text are stored in timeline seconds and are left over a
   different moment by any insert before them. The owner agreed to move them to the anchor of
   decision 5. It needs a migration of saved scenes and has no ticket yet.
3. **Two videos plus the camera in the preview** has not been measured on the owner's hardware.
   Stage 3 starts with that measurement.
4. **A cut under the start hides the whole item.** Deleting even one second of footage under a
   floating item's start removes all of it, although most of what it covered is still there. It is
   the rule the owner took by default and the simplest one to build first. The alternative is to
   move the start to the next surviving second and shorten the item. To judge in stage 1 with the
   real app.

## Out of scope

- Gaps and free positioning of the recording.
- Masks, rotation, crop, blend modes; zoom, privacy or cursor on added videos; volume and ducking.
- Camera sections and `removedTracks` from the timeline v2 design: still parked.
- Importing a file from disk (stage 2 or later, through the compose design's copy-into-workspace path).

## Failures this must protect against

- A floating item drawn in the preview at one time or place and exported at another.
- A floating item left over a different moment after a trim, a split, a reorder or an insert
  before it.
- A trim of the head of a clip moving the floating items over that clip.
- An edit to one item changing which of two other overlapping items is in front.
- A floating item extending the video past the end of the sequence, or surviving in the export
  after the footage under its start was deleted.
- A scene saved before this design failing to open, or opening with different content.
- A scene that holds floating items losing them when the flag is off.
- The video editor's preload-reachable `shared/` code taking a value import from a workspace
  package while adding the flag (see the repo's import rules).

## Acceptance criteria

Stage 1, [NIW2-771](https://linear.app/niway/issue/NIW2-771/video-editor-floating-images-on-levels-above-the-clips-sequence-stage) — floating images. With the flag
`timeline-levels` on:

- [ ] **Add to timeline** on a capture adds a floating image that starts at the playhead, lasts
      10 s (or to the end of the video), is fitted to the whole frame and is in front of every
      other floating item. The sequence does not change length.
- [ ] The Clips section draws the image on a row above the sequence. Two images that do not
      overlap in time share one row; two that overlap are on two rows, the one in front above.
- [ ] Dragging the item along the timeline moves it; dragging either edge changes its duration
      (minimum 0.5 s). Both are one undo step each.
- [ ] In the preview the selected image can be dragged and resized by its corners with the aspect
      locked; **Full** and **Box** set it to the whole frame and to a 40 % box at the bottom right.
- [ ] **Bring forward** and **Send backward** change which of two overlapping images is in front,
      in the preview and in the export.
- [ ] The image fades in and out over 200 ms by default; each fade can be set from 0 to 2000 ms.
- [ ] Trimming, splitting, deleting or reordering sequence items, and inserting a slide before the
      recording, leave the image over the same second of the recording. Deleting the footage under
      its start removes it from the timeline, the preview and the export; undo brings it back.
- [ ] The exported MP4 and GIF show the image at the same times, box, order and opacity as the
      preview.
- [ ] A saved scene with floating images reopens with them; a scene saved before this change
      opens unchanged.
- [ ] With the flag off, nothing in the editor creates a floating item, and a scene that already
      has them still shows and exports them.
- [ ] `bun run typecheck`, the desktop unit suite and the UI catalog pass; the new areas and
      states are in `ui-map.ts` and the catalog (ADR 0046).

Release flag, [NIW2-772](https://linear.app/niway/issue/NIW2-772/video-editor-hide-add-to-timeline-behind-the-release-flag-timeline):

- [ ] With `timeline-levels` off, the Captures panel shows no **Add to timeline** button.
- [ ] With it on, the button is there and does what it does on `main` today.

## Sources and unverified claims

- The owner's request and sketch, 2026-11-13 (NIW2-770 carries the text).
- State of the art: Final Cut's
  [primary storyline and connected clips](https://support.apple.com/guide/final-cut-pro/verb8fcfc133/mac)
  (a gapless main line, items above attached to a point in it), Descript's
  [layers that move with their scene](https://help.descript.com/visuals/working-with-layers-and-clips-overview.md),
  Tella's [media sections](https://www.tella.com/help/editing/use-media.md) (added sound mixed,
  mute per section), Final Cut's
  [transitions](https://support.apple.com/guide/final-cut-pro/ver761c7150/mac) (overlap and
  shorten when there is no spare footage).
- Not confirmed from a primary source: CapCut's track packing and picture-in-picture defaults,
  Screen Studio, Premiere and DaVinci gap behaviour.
- Verified in the repo: the top-bar **Add image** is in the tags `desktop-v0.17.0` and
  `desktop-v0.18.0` (`handleAddImage` in `video-editor-page.tsx`), and PR #620 removed it. So with
  `timeline-levels` off, desktop 0.19.0 has no way to add an image to a video, which 0.18.0 had.
  The owner chose the flag before this was checked; it is theirs to confirm.

---

## 1. The model

```ts
// scene.ts
type MediaAnchor =
  | { kind: "source"; time: number } // seconds into the recording, inside a clip
  | { kind: "item"; itemId: string; offset: number }; // seconds into a slide of the sequence

interface ImageMediaItem {
  id: string;
  kind: "image";
  assetId: string; // stored exactly as a slide's asset is today
  naturalWidth: number;
  naturalHeight: number;
  anchor: MediaAnchor;
  duration: number; // timeline seconds
  box: { x: number; y: number; width: number }; // centre and width, 0–1 of the picture
  z: number; // unique; higher is in front
  fadeInMs: number;
  fadeOutMs: number;
}

interface VideoScene {
  // …
  media?: ImageMediaItem[]; // absent = none
}
```

- **Start.** `sourceToTimeline(anchor.time)` for a source anchor; the slide's timeline start plus
  `offset` for an item anchor. `null` means the item is not placed: the anchor's second is in
  deleted footage, the slide was removed, or the slide is now shorter than `offset`. An anchor
  second belongs to a clip when it is in `[sourceStart, sourceEnd)`; the resolution uses that
  half-open range even where `sourceToTimeline` accepts a clip's end.
- **End.** `min(start + duration, end of the timeline)`.
- **Moving it** to timeline time `t` rewrites the anchor from the sequence entry at `t`. Dragging
  the left edge rewrites the anchor and the duration together; the right edge only the duration.
- **Box.** The same coordinate space as the webcam layer (ADR 0038, 0051): the picture, not the
  padded output. Height is `width × naturalHeight / naturalWidth` in picture pixels. "Fitted"
  is the largest box with that aspect inside the picture, centred.
- **Row.** Sort placed items by `z`; `row = 1 + max(row of the lower-z items it overlaps in
time)`, or 1. Row 0 is the sequence.
- **One function.** `mediaAt(scene, layout, t)` returns the placed items visible at `t` in `z`
  order, each with its opacity (the fade ramps, clamped so the two never cross). The preview and
  the export both draw from it.

## 2. Where it is drawn

`frame → redactions → annotations → zoom crop → framing → floating items → camera`, with the
background of ADR 0051 around all of it. Over a slide of the sequence the order is
`slide → annotations → framing → floating items`. In the preview the items are layers between the
picture and the webcam layer; in the export they are drawn in `compose-output-frame.ts` before the
webcam.

## 3. The stages

1. **Floating images** (NIW2-771). Sections 1 and 2, the Clips rows, the preview handles, the
   small panel (duration, Full, Box, fades, forward, backward, delete), **Add to timeline** adding
   a floating image. Behind `timeline-levels`.
2. **A second video in the sequence.** Clips and source anchors get a source id; the preview and
   the export open more than one recording; zooms, privacy, mutes, cursor and webcam are scoped
   to their source; an image dropped on the sequence is a 5 s slide; fade through the background
   between sequence items. Depends on the compose design's import path for files from disk.
3. **Floating videos and the crossfade.** A second decoder in the same window, per-item mute,
   audio mixed at export, the two-videos limit measured first; the crossfade overlaps two sequence
   items and shortens the video by its length.

Stage 1 leaves the item model, the anchor, the rows and `mediaAt` for the later stages. Stage 2's
multi-source work is its own; nothing in stage 1 does it in advance.

## 4. What the parked design keeps and loses

Kept from the [timeline v2 design](/specs/2026-10-31-editor-timeline-v2-design/) and ADR 0040:
the draw order, viewport-layer placement, per-source audio, the two-videos limit, Library-only
sources. Replaced: separate Overlay lanes, timeline anchoring, "a drop that overlaps goes to a new
lane" as stored state, one 5 s image default for every image (now 10 s floating, 5 s in the sequence), and transitions
as a non-goal. Still parked and
untouched: camera sections (ADR 0039) and `removedTracks` (see ADR 0050).
