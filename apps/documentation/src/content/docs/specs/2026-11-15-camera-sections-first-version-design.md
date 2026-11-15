---
title: "Camera sections, first testable version — design"
description: The camera bubble can sit in a different place at different moments of a video and slides there with a playful motion. A block on the Camera lane holds the new position and its transition. Position only, source-anchored, one stateless function of source time for preview and export. Narrows the camera-sections ADR to a version the owner can test, and changes its default duration and easing.
---

# Camera sections, first testable version — design

**Status: 🔵 Proposed · owner decisions taken in chat on 2026-11-15.** Nothing is implemented.
No Linear ticket: creating one failed on 2026-11-15 with "You've exceeded the free issue limit
for this workspace", so this page is the build's starting point.

## Summary (one minute)

Today the camera bubble in the video editor has one position for the whole video. The owner
wants it to move at chosen moments: in a 10-minute video, top-left from 0:00 to 5:00 and
bottom-right from 5:00 to 10:00, many times per video, with a motion that slides and is
"juguetón", not a blink.

The repository already decided most of this in the
[camera-sections ADR](/architecture/decisions/0039-camera-sections-with-eased-transitions/)
(Proposed since 2026-10-31, nothing implemented), and the code already stores camera segments
with their own position. This design takes the smallest part of that ADR the owner can test and
keep using: a block on the Camera lane that changes the position, and a slide at its start.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                               | Why                                                                                                                                                        | ADR                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | The user creates a change as a block on the Camera lane with the action "Change camera from here". The block runs from the playhead to the next block or the end of the recording. Dragging the bubble while the playhead is inside a block edits that block only.                                                                                                     | The timeline shows how long each change lasts, and the Camera lane already draws Custom blocks. Screen Studio, Tella and Canvid work this way.             | reuses the camera-sections ADR (0039), consequence "Move from here"                                  |
| 2   | This version animates position only. Size and shape do not change per block in the UI.                                                                                                                                                                                                                                                                                 | Owner, 2026-11-15: position only for the first version.                                                                                                    | narrower than 0039 decision 1 (position and size); size stays in the ADR and is deferred             |
| 3   | The transition is a slide that plays inside the block, at its start. Duration is per block, default 700 ms; the control offers at least 500 to 1000 ms. Default easing is the `back` preset (one overshoot). A block can be set to Cut.                                                                                                                                | Owner, 2026-11-15: half a second to one second, configurable, a playful motion.                                                                            | amends the defaults of 0039 decision 2 (was 400 ms, ease-in-out); recorded in its Status line        |
| 4   | Blocks stay anchored to the recording's source time. Cutting the recording cuts the camera with it. A hidden range stops showing the camera at once, with no fade in this version.                                                                                                                                                                                     | Owner, 2026-11-15: the camera always goes with the recording, and hiding must hide, in case something private was on camera.                               | reuses 0039 (source anchoring); defers its decision 5 (200 ms fade)                                  |
| 5   | A transition never bridges a cut or a join between two recordings. After a cut, the camera state is whatever the kept source time gives.                                                                                                                                                                                                                               | The state stays a pure function of source time, so preview, MP4 and GIF agree.                                                                             | reuses 0039 decision 3 and its consequence "a cut through a transition shows a partial transition"   |
| 6   | The export emits frames while a transition is active.                                                                                                                                                                                                                                                                                                                  | The export skips a fill when the webcam frame due is the one already drawn, so a slide over a still screen would freeze.                                   | reuses 0039 decision 6                                                                               |
| 7   | Motion for floating images or other overlays is not part of this. The easing module is generic so they can use it later.                                                                                                                                                                                                                                               | The camera and floating images measure size and time differently; their motion is excluded in the typed-tracks ADR (0040) and the clips-levels ADR (0057). | —                                                                                                    |
| 8   | A drag while the playhead is outside every block edits the default position, which applies to every stretch no block covers. The inspector names the scope being edited: "Default camera" outside a block, the block's time range inside one.                                                                                                                          | That is what the editor does today; the scope label makes it visible instead of adding a confirmation.                                                     | —                                                                                                    |
| 9   | An existing block that already carries size, shape or other layout fields keeps them. They apply at once at the block's start, with no animation, and the session parser does not drop them. A block created by this version writes position only.                                                                                                                     | No saved data is lost, and the first version adds no rule for fields it does not animate.                                                                  | narrower than 0039 decision 1, which drops those fields in the parser; deferred with size            |
| 10  | The frame always wins over the overshoot. The overshoot of `back` is limited, on each axis separately, to the room between the target and the frame edge, so the bubble never leaves the frame and never stops flat in the middle of the curve. With a target that touches the edge, the overshoot is zero.                                                            | A clamp applied after the easing would turn the overshoot into a hard stop in the owner's own example, which moves toward a corner.                        | amends 0039 decision 4 ("after easing, the rectangle is clamped to the frame") for the `back` preset |
| 11  | "Change camera from here" is unavailable when less than the minimum segment length is left before the next block or the end, and inside a hidden range. Inside an existing block it splits that block at the playhead; the right part is the new block and starts with the same position. The split is unavailable when either part would be shorter than the minimum. | Shorter segments are dropped on reload, a hidden range has no camera to move, and a split keeps the rule that blocks never overlap.                        | reuses 0039, consequence "split"                                                                     |

## Open questions

1. **Does `back` at 700 ms feel right on a real take?** Default if unanswered: ship it, and the
   owner tunes the default after testing; the value is one constant. A target in a corner has
   little or no room, so its overshoot is small or absent (decision 10). If that reads as too
   flat, the alternative is to let the bubble cross the frame edge during the transition.
2. **Size per block.** The ADR allows it; the owner left it out of this version. Default: a
   follow-up once position is in use. Animating size makes the shadow difference between preview
   (fixed CSS pixels) and export (scaled with the bubble) visible, which has to be fixed first.
3. **Shape per block.** The owner asked for it, then deferred it. It is a non-goal of the
   camera-sections ADR and of the camera-shape ADR (0041), so it needs a new ADR. The three
   current shapes are one rounded rectangle with a different aspect and radius, so a geometric
   morph is possible; the cost is that the face crop, the outline and the shadow must change
   together in both renderers.

## Out of scope

- Size or shape per block, shape morphing, mirror or framing per block.
- The 200 ms hide and show fade, and the composer revision bump it will need.
- A custom cubic-bezier editor.
- Motion for floating images, text or any other overlay.
- Fullscreen-camera or camera-only scenes ([camera-only clips](/backlog/camera-only-clips/)).

## Failures this must protect against

- The slide freezes or stutters in the exported MP4 or GIF when the screen is still.
- Preview and export disagree on where the bubble is at the same source time.
- Scrubbing backwards shows a different position than playing forwards to the same time.
- A drag outside any block changes every uncovered stretch without the user seeing that scope.
- An older session loses data or changes look when opened and saved.
- The overshoot of `back` pushes the bubble outside the frame.

## Acceptance criteria

- [ ] With the playhead at 5:00, "Change camera from here" creates a block from 5:00 to the next
      block or the end; dragging the bubble then moves it only inside that block.
- [ ] Playing across the block's start shows the bubble sliding from the previous position to
      the new one over the configured duration, with one overshoot by default when the target
      has room before the frame edge.
- [ ] A unit test evaluates the state function at the start, the midpoint and the end of a
      transition, and at the same times after seeking backwards, and gets the same values.
- [ ] A unit test shows the transition is capped at half of a short block.
- [ ] A unit test shows the bubble rectangle stays inside the frame at every sampled time of a
      `back` transition toward a corner, and that a target with room keeps a visible overshoot.
- [ ] With the playhead outside every block, the inspector shows "Default camera" and a drag
      moves the bubble in every stretch no block covers; inside a block it shows that block's
      time range.
- [ ] A session whose block carries a size or a shape opens, draws that size or shape from the
      block's start, and saves with those fields intact.
- [ ] "Change camera from here" is disabled inside a hidden range and when less than the minimum
      segment length is left; inside a block it splits the block at the playhead, and is
      disabled when either part would be shorter than the minimum.
- [ ] A block's Slide or Cut, duration and easing survive save and reopen; an invalid value
      loads as the default.
- [ ] An export test over a still screen produces distinct bubble positions on consecutive
      frames during a transition.
- [ ] The exported MP4 of the owner's example shows the same motion as the preview, checked on
      the real app.
- [ ] Setting a block to Cut makes the change instant.
- [ ] A test shows that changing a block's transition changes the export's edit fingerprint.
- [ ] Trimming 30 seconds before the block makes the change happen 30 seconds earlier in the
      output.
- [ ] A session saved before this change opens with every block as a Cut, and saving it does not
      alter its other fields.
- [ ] Undo after creating a block removes it; undo after a drag restores the previous position
      in one step.

## What the code has today

Paths are under `apps/kaipu-record/src/renderer/src/features/video-editor/`. Read on
2026-11-15 on the branch of NIW2-782; line numbers may have moved.

- `webcam/webcam-model.ts`: `WebcamScene` is one global `WebcamLayout` plus non-overlapping
  `WebcamSegment`s in source seconds, each `hidden` or `override` with a
  `layout?: Partial<WebcamLayout>`. `webcamAt(t)` merges the active override onto the global
  layout and switches in one frame.
- `webcam/use-webcam-editing.ts`: a drag already writes to the override under the playhead,
  otherwise to the global layout. `use-video-scene.ts` collapses a drag into one undo step.
- `components/webcam-lane.tsx`: the Camera lane already draws selectable Hidden and Custom
  blocks with edge handles. `components/inspector/webcam-inspector.tsx` edits and deletes a
  selected segment.
- Preview (`components/webcam-layer.tsx`) and export (`export/compose-webcam.ts`,
  `export/export-clip-frames.ts`) call the same `webcamAt` and `webcamRect`, and draw
  separately: DOM and CSS in the preview, Canvas paths in the export.
- `export/webcam-lockstep.ts` fills gaps between screen frames, and skips a fill when the webcam
  frame due is the one already drawn. Its state tracks the last webcam frame, not the layout it
  was drawn with. On the NIW2-782 branch a live floating image also forces a fill; `main` did
  not have that on 2026-11-15.
- The editor has no easing code. The zoom uses a precomputed spring (`zoom/camera-path.ts`),
  which the camera-sections ADR rejects for sections because a spring has state.
- `session.ts` rebuilds each segment from the fields it knows (`id`, `start`, `end`, `mode`,
  `layout`), clamps them and drops overlaps and segments under the minimum length. A field it
  does not know is dropped on load. No migration runs and the session version does not change
  for an added optional field.

## Shape of the change

- `webcam/webcam-model.ts`: an optional `transition` on an override segment, with `kind`
  (`slide` or `cut`), `ms` and `easing`. One stateless function of source time replaces
  the direct use of `webcamAt` in the preview and the export. It has no frame knowledge: during
  a transition it returns the two layouts and the eased progress, which passes 1 for `back`. An
  absent transition is a Cut.
- `session.ts`: the segment parser reads and writes `transition`, validates `kind`, clamps `ms`
  and accepts only known easing presets. Without this the field is dropped on load and every
  block reopens as a Cut.
- `webcam/webcam-edits.ts`: creating a block from the playhead, splitting a block, and editing a
  block's transition.
- `webcam/easing.ts`: the presets `ease-in-out`, `linear`, `ease-out` and `back`. Worker-safe,
  no DOM.
- `webcam/webcam-layout.ts`, which knows the frame: it computes the rectangle of each of the two
  layouts, interpolates between them, and limits the part of the progress beyond 1 on each axis
  separately to the room that axis has before the frame edge (decision 10). A target with room
  on x and none on y overshoots on x only.
- The effective duration is the smaller of `ms` and half the block. A block that ends into a gap
  returns to the default layout with its own transition, capped at half the gap.
- The "from" of a transition is static: the previous block's position if that block ends exactly
  where this one starts, otherwise the default layout.
- No CSS transition drives the motion; the preview reads the same function at the media time.
- `export/webcam-lockstep.ts`: a fill is also due while a transition is active, which means the
  comparison has to cover the layout drawn and not only the webcam frame.
- Export reuse (`export/export-reuse.ts`): a block's transition is part of what the edit
  fingerprint covers, so changing it never reuses an older export. The composer revision is
  already `wc2`; it is bumped only if the fingerprint cannot cover the new field otherwise.
- Camera lane: the action "Change camera from here", and a striped band at the start of a block
  as long as its transition.
- Inspector for a selected block: position, Slide or Cut, duration, easing preset.
- New blocks store their position explicitly, so a later change of the default position does
  not move them.
- UI map and catalog states for the new areas and states (the typed UI map ADR, 0046).
- The camera-sections ADR's Status line records the implementation state when the build lands.

## How this was analysed

On 2026-11-15 the idea was read from five sides: a sweep of the repository's ADRs, specs and
code; a survey of how other editors do it; and three independent analyses (data model and
render, interaction in the editor, and an attack on the idea).

What other editors do:

- [Screen Studio](https://screen.studio/guide/dynamic-camera-layouts-): a Layouts track of
  segments, added the way zooms are added.
- [Tella](https://www.tella.com/help/editing/use-multi-layouts.md): layout cards over a base
  layout; each card's intro and outro is Smooth or Hard cut.
- [Canvid](https://www.canvid.com/support/editing/camera-layout): camera layout segments holding
  visibility, size, offset and roundness.
- [Descript](https://help.descript.com/getting-started/scenes): a layout per scene, with an
  automatic transition at each boundary.
- [Camtasia](https://www.techsmith.com/learn/tutorials/camtasia/animations/): animation arrows
  on the media, with the duration set by the arrow's length.
- DaVinci Resolve and other general editors: per-property keyframes.

None of the pages read states a default duration in milliseconds.

Three interaction models were compared for the owner's example. Splitting the Camera lane (five
clicks and a drag) reads as cutting the video. Automatic markers created by dragging the bubble
at another time (three clicks and a drag) are the fastest and create changes the user did not
ask for. Layout blocks (four clicks and a drag) show the affected stretch and reuse the existing
lane; the owner chose them.

Per-property keyframes for any object were considered and not chosen: no screen-recorder editor
surveyed uses them for the camera, each property needs its own keys, and the camera and floating
images differ in how they measure size (a fraction of the picture height against a width with a
natural aspect) and time (source time against an anchor plus a timeline duration).

## Sources and unverified claims

- The export freezing during a slide over a still screen is a risk read from the skip condition
  in `export/webcam-lockstep.ts`. It has not been observed, because no transition exists yet.
- The preview's smoothness over sparse screen frames is unverified: it updates on presented
  video frames (`use-video-frame-clock.ts`).
- Performance and memory of the slide at 1440p and 4K were not measured.
- The click counts above are counted from proposed steps, not from a usability test.
