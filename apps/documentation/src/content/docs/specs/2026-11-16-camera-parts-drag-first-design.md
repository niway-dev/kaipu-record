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

A later round, on 2026-11-16, fixes how the Camera lane reads. The owner saw that a short
part's box was wider than the space between its two handles, because the lane gave every part
a minimum width and pushed the next stretch to make room. Now every stretch is drawn as wide
as it lasts, and the detail a narrow box cannot show comes from a hover card (decisions 12 and
16 to 18).

| #   | Decision                                                                                                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                  | Record                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | No button creates a part. The rail's "Change camera from here", its copy in the inspector and the split it performs are removed                                                                                                                                                                | Owner, 2026-11-16, confirmed the same day for the mock's "Move camera from here" too: moving the camera is a deliberate drag. A click that writes a part before anything moved is what filled the lane                                                                                                                                                               | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 2   | Dropping the bubble outside every part asks "Only for this part" or "For the whole video". Closing the card, Escape or any other action puts the bubble back. Dropping inside a part updates that part without asking                                                                          | Owner's mock. Today the same drag silently moves the camera for the whole video                                                                                                                                                                                                                                                                                      | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 3   | A new part lasts 10 seconds, or less if another block or the end of the recording comes sooner. "Hide camera from here" also hides 10 seconds                                                                                                                                                  | Owner's mock. A part to the end of the video made every later drag edit that part                                                                                                                                                                                                                                                                                    | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 4   | The slide follows a curved route. One function gives the route the preview draws and the path the preview, the MP4 and the GIF play                                                                                                                                                            | Owner's mock: "what you see drawn is what plays"                                                                                                                                                                                                                                                                                                                     | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 5   | A new part is Slide, 0.7 s, Smooth. The panel offers 0.4, 0.7 and 1.2 s, and Smooth, Bounce and Linear                                                                                                                                                                                         | Owner's mock, confirmed by the owner on 2026-11-16: Smooth by default, with Bounce (it moves and bounces at the end) as an option. The first version defaulted to Bounce                                                                                                                                                                                             | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 6   | When a part ends and nothing starts there, the camera returns to the original position with that part's own slide                                                                                                                                                                              | Already how the first version works; the mock's text agrees                                                                                                                                                                                                                                                                                                          | none                                                                                                      |
| 7   | The Camera lane draws every stretch, original ones included, with a small frame showing where the camera is and a name computed from that place                                                                                                                                                | Owner's mock. Today a block says "Custom" and nothing about where the camera is                                                                                                                                                                                                                                                                                      | none                                                                                                      |
| 8   | The bubble carries a label saying what a drag will edit. A part shows where the camera comes from: a ghost bubble, a dotted route and a chip. These show only while paused and are never exported                                                                                              | Owner's mock                                                                                                                                                                                                                                                                                                                                                         | none                                                                                                      |
| 9   | The panel has two tabs. "This part" holds the part's place, how it arrives, and "Remove this part". "Whole video" holds the controls the inspector has today, except the two that decisions 10 and 15 change                                                                                   | Owner's mock for the layout                                                                                                                                                                                                                                                                                                                                          | none                                                                                                      |
| 10  | Size is three buttons, S, M and L, in place of the slider. M is today's default size (0.22 of the frame's height), S is 0.15 and L is 0.33. A size saved outside the three keeps playing and shows no button selected                                                                          | Owner, 2026-11-16, after seeing both controls. The mock gives the letters no values: S and L keep the proportions of the recorder bubble's S, M, L (`CAMERA_BUBBLE_PRESETS`: 160, 240, 360)                                                                                                                                                                          | none                                                                                                      |
| 11  | The route bends toward the centre of the frame. Bounce's travel past the target leaves along the curve's end tangent, with the first version's per-axis limit applied to it                                                                                                                    | Proposal. The mock bends to a fixed side, so a move along an edge presses against that edge one way and arcs the other                                                                                                                                                                                                                                               | [ADR 0039, amendment of 2026-11-16](/architecture/decisions/0039-camera-sections-with-eased-transitions/) |
| 12  | Every stretch in the Camera lane is drawn as wide as it lasts. A part never borrows width from the stretch after it. What does not fit is not drawn: the glyph, the name and the arrival word drop out in steps as the part narrows, and the hover card (decision 16) says what the box cannot | Owner, 2026-11-16. Width in a timeline means duration; the 56 px minimum made a short part claim time it did not have. Rejected: keeping 56 px with a duration rail inside; a floating name badge above the lane; a magnified loupe                                                                                                                                  | none                                                                                                      |
| 13  | A part saved earlier with its own shape or size keeps them. "This part" says so and offers "Use the whole-video look"                                                                                                                                                                          | Proposal. Released sessions have such blocks, and the new tab has no shape or size controls                                                                                                                                                                                                                                                                          | none                                                                                                      |
| 14  | While the bubble is dragged, only the bubble element moves. The scene is written once, on the drop or on the card's answer, as one undo step                                                                                                                                                   | Owner's mock: "it must feel like dragging a real object". Today every pointer move writes the scene and re-renders the editor                                                                                                                                                                                                                                        | none                                                                                                      |
| 15  | The panel has no Position grid. The nine preset positions are removed from both tabs; the bubble's place is set only by dragging it on the video                                                                                                                                               | Owner, 2026-11-16: "la posición tiene más rango que solo 9 puntos". The grid was what the owner disliked, and the mock already left it out                                                                                                                                                                                                                           | none                                                                                                      |
| 16  | Hovering the Camera lane shows a card with the details of the stretch under the pointer                                                                                                                                                                                                        | Owner, 2026-11-16: "que al pasar el mouse veamos qué dice con una especie de box tipo tooltip que dé detalles". On a 50-minute recording a 10-second part is about 3 px wide, so nothing can be read in the lane and the detail has to come from hovering                                                                                                            | none                                                                                                      |
| 17  | Dragging the camera bubble while the video plays pauses playback                                                                                                                                                                                                                               | Owner, 2026-11-16: "quiero que al mover la cámara y soltar la selección pausemos para que no desaparezca la caja". He said "on release"; pausing when the drag starts is the design thread's choice, so the part starts at the frame he grabbed and the pointer cannot move in or out of a part under the bubble during the drag. He may prefer the pause at release | none                                                                                                      |
| 18  | Double-clicking a part or a hidden range zooms the timeline to it                                                                                                                                                                                                                              | Proposal, shown in the option-A sketch the owner approved. At fit zoom on a long recording a short part cannot be dragged by its edges; zooming to it makes the edges reachable                                                                                                                                                                                      | none                                                                                                      |

Decisions 1 to 10, 12, 14, 15, 16 and 17 are the owner's, through the mock and the chat. Two
details inside them are the design thread's choice and the owner can change them: that the
pause of decision 17 starts with the drag (he said "on release"), and the numbers listed
under [The Camera lane](#the-camera-lane). Decisions 11, 13 and 18 are proposals: 11 and 13
were shown to the owner in chat on 2026-11-16 and neither approved nor rejected, and 18 was
shown in the option-A sketch he approved but he has not decided it on its own.

## Open questions

None. Answered by the owner on 2026-11-16:

- **Smooth or Bounce by default**: Smooth, with Bounce as an option in the panel (decision
  5). A motion the user shapes further is for later; a custom easing curve stays out of
  scope.
- **The mock's "Move camera from here" button**: not built (decision 1).
- **Hiding inside a part**: as the mock has it. "Hide camera from here" hides outside the
  parts and is disabled inside one. Cutting a part around a hidden range is not built.
- **Size as a slider or as S, M, L**: S, M, L (decision 10).
- **The Position grid**: removed (decision 15).

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
- **While the video plays**, a drag that has passed the 3 px click slop pauses playback
  (decision 17). It stays paused through the drop, while the card is open and after the
  answer; it never resumes by itself. This holds for a drop inside a part too. The pause lands
  before the drop is recorded, so a last time update that arrives after the pause does not
  move the pending part or close the card. Pressing play or seeking with the card open
  behaves as before: it closes the card.

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

#### True width

- Every stretch, original ones included, is drawn from its real start to its real end at the
  current zoom (decision 12). A part never borrows width from the stretch after it, so no
  Original stretch is moved or dropped, and no border or padding makes a box wider than its
  time. A hidden range has no minimum width either.
- One exception, a floor of **3 px**: a part or hidden range narrower than that is drawn 3 px
  wide so it never vanishes, and never past the start of the next part or hidden range.
- Content steps out as the box narrows: the arrival word, then the name, then the glyph. Below
  the glyph's width the part is the plain accent block. The widths where each drops out are
  the ones the lane already uses.
- The slide wedge is never wider than its part. Below the width where a wedge can be told
  from the block, it is not drawn.

#### Handles and click targets

- A selected part's handles still drag its real edges. When the part is narrower than **10 px**
  the two handles move apart symmetrically so there are always at least **4 px** between them:
  each is shifted outward by `max(0, (10 − width) / 2)` px. The change is continuous while the
  edge is dragged, with no jump. Grabbing a handle that is drawn shifted does not move the
  edge until the pointer moves: the drag keeps the offset between the pointer and the drawn
  handle.
- A part or hidden range drawn narrower than **12 px** has a click target 12 px wide, centred
  on it. Two targets never overlap: each stops at the midpoint of the gap to its neighbour.
  What is drawn stays the real width.

#### The hover card

- Moving the pointer over the lane shows a small card above it for the stretch under the
  pointer, of any kind. It uses the same target rule as the click, so a 3 px part is hit
  within its 12 px target. Keyboard focus on a part or hidden range shows the same card.
- A part: its position glyph and name ("Bottom left"), its range and length ("12:04.0 –
  12:14.0 · 10.0 s", the formatter the panel uses), and how it arrives ("Slide 0.7 s ·
  Smooth" or "Cut"). A hidden range: the eye-off icon, "Camera hidden", range and length. An
  original stretch: the glyph, the name, "Original", range and length.
- It appears after about **120 ms**, follows the pointer horizontally, stays inside the
  timeline's visible area and never takes pointer events. It is gone when the pointer leaves,
  while a handle is being dragged, and when the timeline scrolls or zooms. It reuses the
  editor's tooltip look; no new visual language.

#### Zoom to a part

- Double-clicking a part or a hidden range (decision 18) sets the timeline zoom so it fills
  about **40 %** of the visible lane, capped at the maximum zoom, and scrolls so it is
  centred. The first click still selects it.

The numbers 3 px, 4 px, 10 px, 12 px, 120 ms and 40 % are the design thread's choices, not
the owner's. The owner can change any of them.

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
- **Whole video**: the original position as a small frame with its name and "Drag the bubble
  on the video to put it anywhere.", then, in the mock's style: shape; corners for Square and
  Rectangle; size as S, M, L; mirror; shadow; shrink during a zoom, with today's slider for
  the size during a zoom.
- **Size**: S sets 0.15 of the frame's height, M 0.22 (today's default) and L 0.33. A video saved at
  any other size opens at that size with no button selected, and keeps it until the user
  picks one.
- **No Position grid** in either tab. The small frame shows where the camera is and is not a
  control.
- **Hidden range selected**: "Camera hidden", its range, "The camera is not drawn here, in
  the preview or in the export. It hides at once, with no fade.", and "Show the camera again",
  which removes the range.

## Where this page departs from the mock

| Mock                                                                                                    | This page                                    | Why                                                          |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| "Move camera from here" in the rail and the panel creates a 10 s part at the playhead, or splits a part | Not built                                    | Owner's decision 1. It is the same click that fills the lane |
| S, M and L have no values                                                                               | S 0.15, M 0.22, L 0.33 of the frame's height | Decision 10                                                  |
| The route always bends to the same side                                                                 | Toward the centre of the frame               | Decision 11                                                  |
| A part is always 56 px wide                                                                             | As wide as it lasts, with a 3 px floor       | Decision 12                                                  |
| The return to the original position is always 0.7 s, Smooth                                             | The ended part's own slide                   | The mock's own text says "the same slide"                    |
| Hidden blocks have no handles; no keyboard                                                              | Handles, Delete, Backspace and Escape work   | Kept from today; the mock's text names Escape                |
| "Whole video" controls do nothing                                                                       | They work as today                           | The mock's author had not seen the inspector                 |

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
11. Neither tab has a Position grid, and its strings and tests are removed. Size shows S, M
    and L: picking one stores 0.15, 0.22 or 0.33. A session saved at another size opens at
    that size with no button selected.
12. For every part and hidden range, the drawn left and right equal its real start and end at
    the current zoom, except the 3 px floor. No Original stretch is moved or dropped.
13. The handles of a selected part of any width are at least 4 px apart, and each drags its
    own real edge with no jump on grab.
14. A part drawn 3 px wide is selected by a click anywhere in its 12 px target. Two adjacent
    short parts each get their own target.
15. Hovering each kind of stretch (part, hidden range, Original) shows the card with the
    content under "The hover card". It is absent while a handle is dragged. The UI map and
    the catalog gain the card and a part narrower than its glyph, selected, with its handles.
16. Dragging the bubble during playback pauses it. After the drop outside a part, one time
    update later the card is still open and the pending part starts at the paused time.
17. Double-click zoom, if built: the part's drawn width after the zoom is about 40 % of the
    visible lane, or the zoom is at its maximum.

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

Four layers on top of the stack, in this order, each its own pull request:

1. **Model and route.** The route function and its tests; the 10-second window for a new part
   and a new hidden range; the new defaults; `changeWebcamFrom` and the split removed.
2. **Preview and export.** `webcamStateRect` and the composer use the route; the revision
   moves.
3. **Editor.** The drag without scene writes, the card, the preview's marks, the lane, the
   rail and the panel, with strings, UI map and catalog.
4. **Lane detail.** True width, the handles and click targets of narrow parts, the hover card,
   the pause while a drag plays, and double-click zoom (decisions 12 and 16 to 18). It goes in
   its own pull request on top of the editor layer, which the owner has already tested.

## Sources and unverified claims

- The mock and its text were read from the file, not run. Its numbers (0.18, the 3 px click,
  its old minimum part width, the name thresholds) come from its code.
- "Every pointer move writes the scene" is read from `webcam-layer.tsx` and
  `use-video-scene.ts`; how much of the editor re-renders was not measured.
- That released sessions hold blocks with their own shape or size is inferred from the
  released webcam lane, which allowed them. No such session was opened for this page.
