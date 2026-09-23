---
title: "Video editor v2 — camera box UX notes"
description: "Findings from hands-on validation of the preview camera (v2 PR 7): the camera box only responds on its border, and switching between the box and the timeline loses the working context. Symptoms, the code decisions behind them, and proposed fixes for a follow-up."
---

# Video editor v2 — camera box UX notes

> **Status: 🟢 Ready to validate** — implemented in
> [#152](https://github.com/csdev19/kaipu-record-monorepo/pull/152) (2026-09-23); the body-drag
> needs a hardware pass, see that PR's checklist. Written 2026-09-22 as notes taken while validating
> [v2 PR 7 — preview camera](https://github.com/csdev19/kaipu-record-monorepo/pull/138)
> on hardware. The camera works ("está hermoso"); these are interaction problems to fix
> in a follow-up, not blockers for the remaining v2 PRs. Parent:
> [video editor v2](./video-editor-zoom-blur-cover) · design:
> [plan 09 — preview compositing](/plans/video-editor-v2/09-preview-compositing/).

## 1. Clicking inside the box does nothing — only the border works

### Observed

With a zoom selected, clicking anywhere inside the camera box neither selects nor drags
it. The box only reacts on its edges. Users expect a box to be grabbable by its body.

### Why it is like this

Deliberate, and documented in `camera-box.tsx`'s header: the box is
`pointer-events: none` and only four 14 px edge strips are hit-testable
(`camera-box.module.css`). The reason was plan 09's finding D6: the box covers `1/scale`
of the frame at a z-index above the annotation layer, so a hit-testable interior would
make every annotation under it unreachable while a zoom is selected. The trade-off was
resolved in favour of annotations, and the manual checklist even tells the tester to
"click an annotation that sits inside the box: it selects; only the box's frame drags".

In practice the trade-off is backwards: while a zoom is selected the user is editing the
**camera**, and grabbing it is the main gesture. Reaching an annotation under it is the
rare case, and there is already a way to do it (deselect the zoom, or select the
annotation from the lane).

### Proposal

Make the box body grab the camera, and keep annotations reachable a different way:

| Option                                                                                      | Behaviour                                                                                                                                                                                               | Cost                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **A — body drags, edges too** (recommended)                                                 | Interior `pointer-events: auto`; pointerdown anywhere on the box starts the drag. Annotations under the box are reachable by deselecting the zoom (Esc / background click) or from the annotation lane. | One CSS change + the existing drag handlers already receive bubbled events. Update the manual checklist.                                  |
| B — body drags, but a short click (no move, < 200 ms) falls through to whatever is under it | Drag = camera; click = select the thing beneath.                                                                                                                                                        | Needs a click-vs-drag threshold and a manual hit-test of the annotation layer; two gestures on one surface tends to misfire on trackpads. |
| C — hold a modifier (⌥) to reach annotations under the box                                  | Interior grabs the camera; ⌥-click passes through.                                                                                                                                                      | Discoverable only with a hint; fine as an addition to A, not as the only path.                                                            |

Also worth doing with A: change the cursor to `grab` / `grabbing` over the whole box
(today only the edges show it), which is what tells the user the body is draggable.

## 2. Switching between the box and the timeline loses the working context

### Observed (as reported)

Select a zoom by clicking the camera box, then click its block on the timeline, then
make a change (Level, Smoothness, or drag) — "the focus is lost": the editor stops
reflecting what the user was working on.

The exact symptom still needs a precise repro; two candidates are documented here so
whoever picks this up starts from the code, not from scratch.

### Candidate cause A — the timeline click seeks the playhead

`handleSelectZoom` (`video-editor-page.tsx`) does two things on a block click: it
selects the zoom **and** `playback.seek(...)` to the middle of the block (spec § 6.3
"moves the playhead to its center"). If the user had scrubbed to a specific frame
while positioning the box, that frame is gone the moment they touch the timeline, and
the box is re-drawn for a different instant. From the user's side the camera "jumped".

Fix options: only seek when the playhead is **outside** the segment (inside it, keep
the frame the user chose); or seek only on a double-click.

### Candidate cause B — keyboard focus lands on the block button

Timeline blocks are `<button>`s; clicking one gives it keyboard focus. After that,
keys the editor handles globally (Space for play/pause, Delete, arrows if any are
added) may be swallowed or re-targeted by the focused button, and the inspector's
sliders do not have focus although the user's attention is there. This matches the
words "the focus is lost" literally.

Fix options: after selecting a zoom from the timeline, move focus to the inspector's
first control (Level) — that is where the user is going next; or keep focus on the
block but make sure the global key handlers ignore `event.target` being a lane button
only for keys the button itself uses.

### To pin it down

Record a short screen capture of the sequence and note, at the moment it "loses
focus": (1) did the playhead move? (2) which element is `document.activeElement`
(DevTools: `$0` after clicking, or `document.activeElement` in the console)? (3) did
the inspector switch back to Detection (i.e. the selection was cleared) or stay on
the zoom?

## Scope for the follow-up

- **In:** option A for the box (interior grabs, `grab` cursor), the seek-only-when-outside
  rule, focus moved to the inspector after a timeline selection, tests for the three, and
  an updated manual checklist in plan 09.
- **Out:** annotation reachability through the box body (B/C), body-drag to _retime_ a
  zoom on the lane (plan 06 non-goal), any change to the camera path or the transform.

## Reopen if

Users edit annotations under zooms often enough that deselecting first becomes a
complaint — then add option C on top of A.
