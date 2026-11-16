---
title: "Camera parts, created by dragging the bubble — design"
description: Refines the first version of camera sections. No button creates a camera change any more - the user drags the bubble, drops it, and answers whether the new place is for this part or for the whole video. A new part lasts 10 seconds, the slide follows a curved route that the preview draws, the Camera lane names every stretch, and the panel splits into This part and Whole video.
---

# Camera parts, created by dragging the bubble — design

**Status: 🔵 Proposed · owner decisions taken in chat on 2026-11-16.** Nothing here is
implemented. It refines the
[first testable version](/specs/2026-11-15-camera-sections-first-version-design/), whose code
sits on a three-pull-request stack that is not merged; this work goes on top of that stack.
No Linear ticket (free issue limit), so this page is the build's starting point.

The reference is the owner's interactive mock:
[/mockups/camera-parts-v6.html](/mockups/camera-parts-v6.html). Its chips load every state
named below. Where this page and the mock disagree, this page wins, and the
[differences](#where-this-page-departs-from-the-mock) are listed.

## Summary (one minute)

The first version works, and the owner tested it. One thing failed: the tool-rail button
"Change camera from here" creates a section on every click, before the camera has moved, so
the Camera lane fills with sections that do nothing and are removed one at a time. The owner:
"we will get rid of that horrible button".

In this design **the movement creates the change**. The user drags the bubble and drops it.
If the playhead is not inside a part, a small card asks whether the new place is "Only for
this part" or "For the whole video". The interface calls a camera section a **part** and the
default camera position the **original position**; the code keeps `WebcamSegment` and
`layout`.

| #   | Decision                                                                                                                                                                                                              | Why                                                                                                                                   | Record                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | No button creates a part. The rail's "Change camera from here", its copy in the inspector and the split it performs are removed                                                                                       | Owner, 2026-11-16. A click that writes a part before anything moved is what filled the lane                                           | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 2   | Dropping the bubble outside every part asks "Only for this part" or "For the whole video". Closing the card, Escape or any other action puts the bubble back. Dropping inside a part updates that part without asking | Owner's mock. Today the same drag silently moves the camera for the whole video                                                       | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 3   | A new part lasts 10 seconds, or less if another block or the end of the recording comes sooner. "Hide camera from here" also hides 10 seconds                                                                         | Owner's mock. A part to the end of the video made every later drag edit that part                                                     | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 4   | The slide follows a curved route. One function gives the route the preview draws and the path the preview, the MP4 and the GIF play                                                                                   | Owner's mock: "what you see drawn is what plays"                                                                                      | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 5   | A new part is Slide, 0.7 s, Smooth. The panel offers 0.4, 0.7 and 1.2 s, and Smooth, Bounce and Linear                                                                                                                | Owner's mock. Open: the first version defaulted to Bounce                                                                             | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 6   | When a part ends and nothing starts there, the camera returns to the original position with that part's own slide                                                                                                     | Already how the first version works; the mock's text agrees                                                                           | none                                                                                                      |
| 7   | The Camera lane draws every stretch, original ones included, with a small frame showing where the camera is and a name computed from that place                                                                       | Owner's mock. Today a block says "Custom" and nothing about where the camera is                                                       | none                                                                                                      |
| 8   | The bubble carries a label saying what a drag will edit. A part shows where the camera comes from: a ghost bubble, a dotted route and a chip. These show only while paused and are never exported                     | Owner's mock                                                                                                                          | none                                                                                                      |
| 9   | The panel has two tabs. "This part" holds the part's place, how it arrives, and "Remove this part". "Whole video" holds every control the inspector has today                                                         | Owner's mock for the layout. Nothing the app can do today is lost                                                                     | none                                                                                                      |
| 10  | Size keeps today's slider, restyled. The mock's S, M, L are not adopted                                                                                                                                               | Proposal. The slider reaches any size from 10 to 90 %; three presets would drop that. The mock drew them without seeing the inspector | none                                                                                                      |
| 11  | The route bends toward the centre of the frame. Bounce's travel past the target keeps the first version's per-axis limit                                                                                              | Proposal. The mock bends to a fixed side, so a move along an edge presses against that edge one way and arcs the other                | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 12  | The 56 px minimum width of a part on the lane never covers the next block                                                                                                                                             | Proposal. On a long video a 10-second part is a few pixels wide; a fixed 56 px would hide its neighbour                               | none                                                                                                      |
| 13  | A part saved earlier with its own shape or size keeps them. "This part" says so and offers "Use the whole-video look"                                                                                                 | Proposal. Released sessions have such blocks, and the new tab has no shape or size controls                                           | none                                                                                                      |
| 14  | While the bubble is dragged, only the bubble element moves. The scene is written once, on the drop or on the card's answer, as one undo step                                                                          | Owner's mock: "it must feel like dragging a real object". Today every pointer move writes the scene and re-renders the editor         | none                                                                                                      |

Decisions 1 to 9 and 14 are the owner's, through the mock and the chat. Decisions 10 to 13
are proposals the owner has not seen.

## Open questions

1. **Smooth or Bounce by default.** The owner first asked for a playful motion and the first
   version shipped Bounce. The mock defaults to Smooth and its author asked the owner to
   confirm. This page follows the mock. It is one constant.
2. **Size as a slider or as S, M, L** (decision 10).
3. **Hiding inside a part.** The mock disables "Hide camera from here" there. The owner hides
   the camera for privacy, so having to shorten a part first may be too slow. Cutting the part
   around the hidden range is model work this page leaves out.

## Out of scope

- Dragging a part by its body on the lane, multi-select, and bulk removal. With decision 1
  nothing floods the lane.
- Animating size or shape, the hide fade, and a custom easing curve. They stay deferred in
  ADR 0039.
- The other lanes, the rail's other tools and the editor chrome. The mock draws them as
  decoration.
- Motion for floating images and other overlays.

## Failures this must protect against

- A click, or many, leaves parts on the lane. Only a drop that the user confirms writes one.
- The exported video plays a different path than the route the preview drew.
- A drag moves the camera for the whole video without the user being told.
- The camera leaves the frame on an arc or on Bounce's overshoot.
- An unanswered card leaves the bubble in a place the scene does not hold.
- An editor-only mark (ghost, route, label, hidden outline) appears while playing or in an
  export.
- A session saved by the first version, or by a released version, opens with a part moved,
  resized or dropped.

## Behavior

### Moving the bubble

- Free drag, no grid and no snapping, 1:1 with the pointer, stopped by the frame edge. While
  held, the ring is thicker and the shadow deeper.
- A press that moves less than 3 px is a click: it selects the bubble and opens the panel.
- Playhead inside a part: the drop sets that part's position. One undo step.
- Playhead outside every part: the drop opens the card. Until it is answered the scene is
  unchanged.
- No drag in a hidden range or over a slide clip, as today.

### The card

Title "Keep the camera here…", attached to the bubble, kept inside the preview.

| Choice                             | Sub-line                                                            | Effect                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| "Only for this part" (primary)     | "10 s from 0:24. You can stretch it." with the real length and time | Creates a part at the playhead with the dropped position, Slide, 0.7 s, Smooth, and selects it |
| "For the whole video"              | "Becomes the original position."                                    | Sets the default layout's position. No part                                                    |
| Close, tooltip "Put it back (Esc)" |                                                                     | The bubble returns to where the scene has it                                                   |

- With less than 1 second before the next block or the end of the recording, "Only for this
  part" is disabled and reads
  "No room left here."
- Seeking, playing, selecting something else, undo and redo close the card as Close does.
- While the card is open the lane shows a dashed block "New part · 8 s" where the part would
  go, and the preview shows the route from the current place ("Now") to the dropped one
  ("New position").

### A part

- 10 seconds, or up to the next block or the end of the recording, whichever comes first.
  Minimum 1 second, as today. Parts and hidden ranges
  never overlap; two parts may touch.
- A selected part has a white handle on each edge. Limits as today: the neighbour and the
  1-second minimum.
- Removed with "Remove this part" in the panel or with Delete or Backspace, as today.
- Selecting a part on the lane moves the playhead just past its slide, so the preview shows
  it settled.

### The slide

- The route from A to B is a quadratic curve. Its control point is the midpoint of A and B
  moved sideways by 0.18 of the distance, on the side nearer the centre of the frame; when
  both sides are equally near, the side the mock uses. The sideways move is measured in frame
  pixels, not in normalised units, so the arc is the same on any aspect ratio.
- The eased progress is the curve's parameter. Smooth is the `ease-in-out` preset, Bounce is
  `back`, Linear is `linear`. The `ease-out` preset stays in the model with no button.
- A part saved with a duration or a motion that no button offers (500 ms, `ease-out`) keeps
  it and plays it. The panel shows no option selected until the user picks one.
- The control point is clamped into the range the bubble's centre can reach. Between A and B
  the curve then stays inside the frame, because A, B and the control point are inside it.
- Bounce goes past B, and the curve is not used there. While the eased progress `p` is above
  1, the centre is `B + (p − 1) × T`, where `T` is the curve's direction and speed as it
  arrives: twice the vector from the control point to B. The bubble so leaves B the way it
  came in, in a straight line, and comes back along it.
- That travel past B keeps the first version's rule (its decision 10), with `T` in the place
  of the straight distance. On each axis, the farthest the bubble would go is the easing's
  peak above 1 times that axis of `T`; the room is the space between the bubble's box at B
  and the frame edge `T` points to on that axis. When the farthest point does not fit, the
  whole travel on that axis is multiplied by room divided by farthest, so the peak lands on
  the edge and the motion keeps its shape instead of stopping flat. An axis with no room
  does not go past B at all; the other axis still does.
- A clamp to the frame, with the rule a drag uses, stays only as a last guard. For the three
  motions the panel offers it changes no point.
- A, the start, is still static: the place of the stretch that ends where the part starts.
  The half-the-part cap, the Cut and the return to the original position are unchanged.
- The preview's route and the played path call the same function. The composer revision in
  `export/export-reuse.ts` moves to its next value, because the same scene now draws
  different frames.

### The preview's marks

Shown only while paused, never in an export:

- **Label on the bubble**: "Original position", or "This part · 0:10 – 0:20" in the accent
  color. "Sliding…" if the playhead is paused inside a slide.
- **Where it comes from**, when the playhead is in a part or a part is selected, and the part
  moves the camera more than a few pixels: a faded ghost bubble at the start place, a dotted
  route with an arrowhead, and a chip "Slide 0.7 s" or "Cut". The ghost is labelled "Before"
  when a part ends exactly where this one starts, otherwise "Original".
- **Hidden range**: a dashed outline with an eye-off icon and "HIDDEN" where the camera would
  be.

### The Camera lane

- **Original stretch**: dashed outline, not selectable. A small frame with a dot where the
  camera is, the name, and "ORIGINAL", each only when there is room.
- **Part**: accent block with the small frame and the name, and "SLIDE 0.7 s" or "CUT" when
  there is room. A slide shows a light diagonal wedge at its start, as wide as the slide
  lasts; a cut shows a thin white bar.
- **Hidden range**: striped grey block with the eye-off icon and "Hidden". It keeps today's
  edge handles.
- **Name**: Top, Middle or Bottom with left, middle or right, and "Center" for the middle of
  both. It comes from which third the bubble's centre is in, over the range the centre can
  reach. It is a description, never a choice.
- A part is drawn at least 56 px wide on the lane, so its name fits and it is easy to grab,
  but never wider than the room before the next block. With less than 56 px of room the part
  is drawn as wide as that room, and it is still the same part: a click on it selects it, and
  moving the playhead into it and clicking the bubble opens the panel on it. "Remove this part" and the
  panel's controls work at any width. To drag its edges the user zooms the timeline in with
  the transport bar's zoom, which widens every block. A part too narrow to grab at the
  current zoom is an accepted limit; nothing else is built for it.

### The rail

- "Change camera from here" is removed. The mock's "Move camera from here", in the rail and in
  the panel's empty state, is not built.
- "Hide camera from here" stays. It hides 10 seconds, or up to the next block or the end of
  the recording. Inside a part
  or a hidden range, or with less than 1 second of room, it is disabled with the reason in its
  tooltip.

### The panel

Header "Camera", tabs "This part" and "Whole video".

- **This part**, with a part selected or under the playhead: the time range and length; a
  small frame with a dashed dot (before), a solid dot (now) and the line between them; the
  name; "Drag the bubble on the video to put it anywhere."; "How it arrives" Slide or Cut;
  for a slide, Duration and Motion and "Play the slide", which starts a little before the part
  and plays; "When it ends"; "Remove this part".
- **This part**, with no part there: "No change at 0:04" and "Here the camera is in its
  original position. Drag the bubble and Kaipu asks if the new spot is for this part or for the
  whole video." No button.
- **Whole video**: the original position as a small frame, then every control of today's
  inspector in the mock's style: shape, corners for Square and Rectangle, size, mirror,
  shadow, shrink during a zoom and its size.
- **Hidden range selected**: "Camera hidden", its range, "The camera is not drawn here, in
  the preview or in the export. It hides at once, with no fade.", and "Show the camera again",
  which removes the range.

## Where this page departs from the mock

| Mock                                                                                                    | This page                                  | Why                                                          |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| "Move camera from here" in the rail and the panel creates a 10 s part at the playhead, or splits a part | Not built                                  | Owner's decision 1. It is the same click that fills the lane |
| Size is S, M, L                                                                                         | Today's slider                             | Decision 10                                                  |
| The route always bends to the same side                                                                 | Toward the centre of the frame             | Decision 11                                                  |
| A part is always 56 px wide                                                                             | Never over its neighbour                   | Decision 12                                                  |
| The return to the original position is always 0.7 s, Smooth                                             | The ended part's own slide                 | The mock's own text says "the same slide"                    |
| Hidden blocks have no handles; no keyboard                                                              | Handles, Delete, Backspace and Escape work | Kept from today; the mock's text names Escape                |
| "Whole video" controls do nothing                                                                       | They work as today                         | The mock's author had not seen the inspector                 |

## Acceptance criteria

1. No control creates a part by a click. `changeWebcamFrom`, its split and its three reason
   texts have no caller left, and are removed with their tests, catalog scenario and strings.
2. Dropping the bubble outside every part opens the card and leaves the scene unchanged until
   an answer. Each of the three answers does what the card table says, as one undo step or
   none.
3. Dropping the bubble inside a part changes only that part.
4. A part created at 0:24 with a free lane ends at 0:34. With a block starting at 0:30 it ends
   at 0:30. With a block starting at 0:24.5 the choice is disabled with its text. In a recording that
   ends at 0:28 it ends at 0:28.
5. A test evaluates the route at several times and finds every point inside the frame, for
   Smooth, Bounce and Linear, including a move along an edge. For Bounce into a corner and
   along an edge, the test reads the points before the last-guard clamp: they are already
   inside the frame, and around the peak the bubble is past B on every axis that has room,
   so the motion is not flat against an edge. The preview's drawn route and the played
   position come from one function.
6. An exported MP4 and GIF show the bubble on the same route as the preview at the same
   source times.
7. While the video plays, no ghost, route, label or hidden outline is drawn.
8. A session saved by the first version, and one from a released version with a "Custom"
   block that changes size or shape, open with every block in place. A part with a 500 ms
   `ease-out` slide plays as saved and shows no duration or motion selected.
9. A pointer move during a drag does not commit or live-update the scene.
10. The UI map and the catalog gain the card, the lane's stretches and the panel's two tabs,
    and lose the removed button's state. Strings exist in `en.json` and `es.json`.

## What the code has today

On the stack's top branch, `feature/camera-sections-3-editor-ui`. `VE` is
`apps/kaipu-record/src/renderer/src/features/video-editor`.

- `VE/webcam/webcam-edits.ts`: `changeWebcamFrom`, `createWebcamBlock` (to the next block or
  the end), `splitWebcamBlock`.
- `VE/webcam/use-webcam-editing.ts`: `changeAtPlayhead`, `changeBlockedReason`, and
  `patchWebcamAt`, which sends a drag to the block under the playhead or to the default
  layout.
- `VE/webcam/webcam-model.ts`: `webcamStateAt`, the transition defaults (slide, 700 ms,
  `back`); `VE/webcam/webcam-layout.ts`: `webcamStateRect`, `clampWebcamCenter`.
- `VE/components/webcam-layer.tsx`: the drag calls `liveLayout` on every pointer move, which
  sets the scene.
- `VE/components/webcam-lane.tsx`, `VE/components/inspector/webcam-inspector.tsx`,
  `VE/components/editor-toolbar.tsx` (the two camera buttons).
- `VE/export/compose-webcam.ts` and `VE/export/export-reuse.ts` (the composer revision).

## Shape of the change

Three layers on top of the stack, in this order, each its own pull request:

1. **Model and route.** The route function and its tests; the 10-second window for a new part
   and a new hidden range; the new defaults; `changeWebcamFrom` and the split removed.
2. **Preview and export.** `webcamStateRect` and the composer use the route; the revision
   moves.
3. **Editor.** The drag without scene writes, the card, the preview's marks, the lane, the
   rail and the panel, with strings, UI map and catalog.

## Sources and unverified claims

- The mock and its text were read from the file, not run. Its numbers (0.18, the 3 px click,
  the 56 px width, the name thresholds) come from its code.
- "Every pointer move writes the scene" is read from `webcam-layer.tsx` and
  `use-video-scene.ts`; how much of the editor re-renders was not measured.
- That released sessions hold blocks with their own shape or size is inferred from the
  released webcam lane, which allowed them. No such session was opened for this page.
