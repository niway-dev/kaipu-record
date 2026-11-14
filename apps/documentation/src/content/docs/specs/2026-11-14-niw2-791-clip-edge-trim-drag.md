---
title: Video editor — clip edge trim that shows what it cuts
description: Dragging a clip's edge on the Clips row keeps the clip's box and the timeline still, greys out the part being trimmed, and recalculates the length on release. Each handle shows whether footage on that side can be dragged back.
---

# Video editor — clip edge trim that shows what it cuts

**Status: 🔵 Proposed · 2026-11-14.** Decided by the owner in chat, from their sketches. Tracked in
[NIW2-791](https://linear.app/niway/issue/NIW2-791/video-editor-clip-edge-trim-shows-the-removed-part-greyed-out-during).

## Summary

During QA of the joined-recordings stack, the owner dragged a clip's start edge on the Clips row and
reported that it trimmed the end. It does not. `trimClip` moves the clip's source in-point, in
single and joined scenes. It looks like an end cut for three reasons:

- Timeline positions are derived by summing durations, so a start trim never moves the clip's left
  edge. Its handle stays put while the right edge and everything after it move left.
- The timeline scale follows the total duration and re-fits on every pointer move. With one clip at
  fit zoom, the clip fills the lane before and after the trim.
- Thumbnails are resampled over the new range, and the preview does not show the edge frame.

This spec changes the presentation only. The trim model, its clamps, the saved scene and the export
stay as they are.

| Decision                                                                           | Why                                                                                                                                                                                      | ADR  |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Keep edge trim with ripple (the timeline closes up)                                | Every comparable editor has it (Final Cut, Screen Studio, CapCut). Removing it would also lose the only way to win back footage deleted earlier: split and delete can only shrink a clip | none |
| During a drag only the handle moves; the trimmed part stays in the box, greyed out | The user sees which end is being cut, at the place they are pulling                                                                                                                      | none |
| The length is recalculated on release                                              | The close-up happens once, after the user has seen what goes                                                                                                                             | none |
| Extending an edge is the same effect in reverse                                    | One rule for both directions                                                                                                                                                             | none |
| Each handle shows "at the limit" or "footage hidden"                               | The user knows whether there is anything to drag back, and in which direction                                                                                                            | none |
| No confirmation dialog                                                             | None of the comparable editors asks; the whole drag is one undo step                                                                                                                     | none |
| The Timeline guide explains both handle states                                     | The guide says "drag it back to recover" but not how to tell whether there is anything to recover                                                                                        | none |

**Open questions:** none blocking. The defaults below are the owner's to veto.

**Out of scope:** "trim start/end to playhead" commands (Final Cut's Option-[ and Option-]),
non-ripple trims that leave a gap (the sequence has no gap item), reordering clips by drag
([NIW2-789](https://linear.app/niway/issue/NIW2-789/video-editor-drag-a-clip-on-the-clips-row-to-reorder-the-sequence)),
and slides (their right handle sets a duration and has no hidden footage).

No ADR: none of these decisions is structural. The model they rely on is recorded in the
joined-recordings decisions (one source axis, each recording on its own range).

## Behavior

### Trimming inward

Sketch, a start trim in progress (`░` greyed out, `█` kept, `┃` handle):

```text
at rest      ┃████████████████████████████┃
dragging     ░░░░░░░┃█████████████████████┃     the box, the scale and later items stay still
released     ┃█████████████████████┃            the length is recalculated, later items close up
```

1. On pointerdown the timeline freezes: scale, scroll, the clip's box and every other item stay
   where they are until release.
2. The handle follows the pointer, on either edge. The kept part keeps the clip colour. The part
   being trimmed away stays inside the original box, greyed out.
3. The preview shows the frame at the dragged edge: the first kept frame for a start trim, the last
   kept frame for an end trim. For a joined clip, that is the frame of that clip's recording.
4. On release the greyed part disappears, the clip takes its new length, and later items close the
   gap. One undo restores the original, as today.

### Extending outward

Pulling an edge outward to win back footage is the same effect in reverse. The reclaimed footage is
drawn past the original edge and takes the clip colour as the handle passes over it. Neighbours stay
still until release. For the start of a clip in the middle of the sequence, the reclaimed part draws
over the previous item, semi-transparent. On release the length is recalculated and later items move
right.

### Handle indicator

At rest, each handle of the selected clip shows one of two states:

- **At the limit**: a stop mark on the handle. There is no footage left on that side.
- **Footage hidden**: arrows pointing outward (`<<` on the start handle, `>>` on the end handle).
  Footage on that side was trimmed or deleted and can be dragged back.

The state comes from the same limits the drag obeys: the recording's range (`clipBounds`), the
minimum item duration, and the footage other clips already show. Cases:

| Situation                                                      | Start handle                                                    | End handle                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| A whole recording, untrimmed                                   | at the limit                                                    | at the limit                                    |
| The head was trimmed                                           | footage hidden                                                  | at the limit                                    |
| First half of a split clip, second half kept (in either order) | at the limit                                                    | at the limit: the other half shows that footage |
| First half of a split clip, second half deleted                | at the limit                                                    | footage hidden                                  |
| Second half of a split clip, first half deleted                | footage hidden                                                  | at the limit                                    |
| A joined clip at the start of its own recording                | at the limit, even though the scene has other footage before it |                                                 |

### Timeline guide

The Clips tab of the in-app Timeline guide (`guideClipsLegend2`) adds both handle states to its
legend, and its sample timeline shows them. Every locale is updated.

## Defaults the owner may veto

1. **The greyed part shows its frames, dimmed**, not a flat grey. The user sees what is being cut.
2. **The indicator appears only on the selected clip**, where the handles already appear. Unselected
   clips stay clean.
3. **On release, the preview goes back to the playhead's frame.** The edge frame is only shown
   during the drag.
4. **No feature flag.** It changes an existing interaction and adds no new capability.

## Failures this must protect against

- The indicator promising footage the drag cannot reach, or the reverse. Mitigation: one pure helper
  computes the room on each side, and both `trimClip` and the indicator use it. It is tested on split
  halves, reordered halves, a deleted middle piece and a joined clip at its recording's start.
- The release jump being read as "the app rejected my drop". Mitigation: the greyed part makes the
  removed footage visible before release; animate the close-up if it is cheap.
- Overlays, zooms or floating items flickering during the drag. Mitigation: the drag renders from a
  drag-local state, and the committed scene changes only on release.
- An edge preview that shows the wrong recording or the next clip. Mitigation: map the edge time
  through the source axis, and show the last kept frame for an end trim.

## Implementation notes

Facts at the top of the joined-recordings stack (commit 1056d682):

- `trimClip`: `apps/kaipu-record/src/renderer/src/features/video-editor/timeline.ts`, the start edge
  sets `sourceStart` only and the end edge `sourceEnd`.
- Positions come from `toLayout` (same file). The scale is `scaleOf` in
  `components/timeline-view.ts`, and `setDuration` in `use-timeline-view.ts` re-fits on every live
  update.
- The drag uses a frozen pointerdown baseline in `components/timeline-strip.tsx`. The page handler
  `handleTrim` in `pages/video-editor/video-editor-page.tsx` calls `updateLive` on every move and
  does not seek the preview.

Likely approach: keep the committed scene untouched during the drag and draw the dragged clip from a
drag-local state (original range plus pending edge), so the layout, the duration and the scale do
not change mid-drag. Commit `trimClip` on release.

Before code, render the four handle states (at the limit, footage hidden, trimming, extending) in the
real app styles and get the owner's approval. The UI catalog cannot drag: prove the mid-drag states
with a verify scenario that uses `page.mouse` down, move and up, and add catalog states for the two
resting handle states.

Ships off main, after the joined-recordings stack merges.
