---
title: "Camera bubble — shape and size"
description: "The camera toggle becomes configurable without weighing more: a split Camera tile opens shape, size and device settings (an inline drawer on both the Record page and the capture panel), and the bubble resizes from its fixed corner with a hover grip."
---

# Camera bubble — shape and size

> **Status: 🟢 Ready to validate (prod review pending)** (2026-10-26). PR #380, integrated with
> the rest of task 5 on `feat/record-modes-integration`, where the split tile sits in the new
> Record page and tray layouts and the overlay's Camera toggle honours a blocked camera; unit
> tests and type checks pass, nothing has been checked yet in a running app with a real camera. Design: Claude Design project "Kaipu Camera Controls",
> direction **1a — split toggle + popover**. Builds on
> [Record capture modes](/specs/2026-10-26-record-capture-modes-design/) decision 6 (the bubble
> lives at the bottom-left corner of the recorded area).

## The rule

The Mic · Audio · Camera row stays one line and looks the same for someone who never touches the
camera. Direction 1b (an inline strip) was rejected because it moved the Start button 48 px on
every toggle; 1c (a camera card) because it doubled the camera's visual weight.

## The setting

`AppSettings.cameraBubble` (persisted in `settings.json`, merged over defaults field by field in
`mergeSettings` through `sanitizeCameraBubble`, `apps/kaipu-record/src/shared/camera-bubble.ts`):

| Field      | Values                      | Default  | Notes                                                    |
| ---------- | --------------------------- | -------- | -------------------------------------------------------- |
| `shape`    | `"circle"` \| `"rounded"`   | `circle` | An unknown value falls back alone.                       |
| `size`     | 120–480 DIP                 | 240 (M)  | Presets S = 160, M = 240, L = 360. Clamped, not dropped. |
| `deviceId` | a `videoinput` id or `null` | `null`   | `null` opens the OS default camera.                      |

Only these persist. The bubble's **position does not**: it starts at the bottom-left corner of
the recorded area (or of the display's work area when the whole screen records), the user can
drag it elsewhere (see [Moving the bubble](#moving-the-bubble)), and it grows up and to the right
from wherever it sits.

### Moving the bubble

The first version of this feature made the bubble fixed (`movable: false` and no drag region,
commit `96447be3`), which the owner reported as a regression: before it, the bubble could be
dragged anywhere. Pressing anywhere on the bubble and dragging moves it again:

- The drag is driven by pointer events in the renderer, not by `-webkit-app-region: drag`. An OS
  drag region would swallow the pointer events the resize grip and the hover controls need, and
  could not keep the bubble inside a recorded area. The renderer sends the pointer's offset since
  the press (`beginCameraBubbleMove`, `moveCameraBubble`); `CameraBubbleWindow.moveBy` moves the
  window and clamps it inside the recorded area, or inside the work area of the display it is
  dragged onto. The window stays `movable: false` for the OS.
- It works during a recording too: nothing is drawn for it, so the video only shows the bubble
  moving.
- The window's bottom-left corner is the bubble's anchor, so a resize (grip or settings) grows it
  up and to the right from where it was dropped, pushed back inside the container if needed.
- The position lives in main's memory: on the display, for the app session (across camera
  toggles); inside an area, for the take. Each area recording starts at the area's bottom-left
  corner, which is where the overlay's placeholder shows it, and the bubble returns to its
  dropped spot on the display when the take ends.
- The overlay's placeholder is not draggable: the bubble window is hidden while the overlay is up,
  and moving the placeholder would need a per-area remembered offset. Drag the real bubble once
  the take starts instead.

Every change applies live, mid-take included. Main listens to settings changes and resizes the
bubble window from its anchored corner (`CameraBubbleWindow.applySize`). The renderer reads the
shape and the device from the same broadcast; a device change reopens the stream, and a device
that is gone falls back to the default camera.

Fitting inside the area: the window is the bubble plus a 24 px transparent pad (shadow, hover
label, grip) and sits 32 px from the area's left and bottom edges, so the bubble's visible edge
stays 56 px in, as before. A size the area cannot hold is shrunk to what fits; when not even
120 px fits (an area under 232 × 232), the bubble is not shown, as decision 6 requires.

## The UI

- **Record page.** The Camera tile splits: the body toggles the camera as before; a 28 px chevron
  segment on its right opens an inline drawer (`role="region"`) right under the row, in the page's flow. It replaced a floating popover, which was clipped at the bottom of the window; the content area scrolls, so the drawer pushes the page instead. Full-size tiles and chips here.
- **Capture panel.** The panel hides when it loses focus, so there is no popover either: the 22 px
  chevron expands an inline **drawer** inside the panel, the panel grows downward and focus never
  leaves the window. Esc or the chevron closes it. Compact content (26 px chips), without the
  Size section: the bubble's hover grip sizes it there, and the panel stays under its 600 px
  ceiling with framing open. The Mirror and Framing hints are screen-reader descriptions and
  hover tooltips there, not visible lines. The Record page keeps Size, which is also the
  keyboard's way to size the bubble (the grip is pointer-only); `e2e/capture-panel-height.e2e.ts` checks the
  panel height with framing open.
- **Content.** Header with the camera icon, "Camera" and the device selector chip; Shape (Circle |
  Rounded); Size (S · M · L · Custom, where Custom shows the value when it is not a preset and is
  not clickable otherwise); a 120–480 px slider with ticks at the three presets.
- **States.** Camera off: the controls work, with "Camera is off. These apply when you turn it
  on." During a recording: the controls work, with the pink live note "Changes apply live and
  will show in the recording." Access blocked: the tile shows a lock and BLOCKED and cannot turn
  the camera on; the settings are replaced by "Camera access is blocked" and an "Open System
  Settings" button.
- **Bubble.** Outside a recording, hovering shows a 2 px pink outline, a size label
  ("240 px · M") above it, a resize grip (a white dot on the rim at 45° for the circle, a
  white L at the top-right corner for the rounded square) and a **Turn camera off** button
  opposite the grip (a dark dot with a white ×, on the rim at 45° top-left, or inside the
  rounded square's top-left corner). Dragging the grip resizes diagonally
  from the fixed corner, clamped to 120–480 and to the area; the release persists the size that
  is on screen. **While recording none of this renders** (no outline, no label, no grip, no ×):
  the bubble on screen is exactly the one in the video.
- **Control bar.** While a take runs and the camera is on, the bar shows a **Turn camera off**
  button (camera-off icon) between the mode chip and Pause. The bar is content-protected, so the
  button is never in the video; it disappears once the camera is off. The bar window grew from
  480 to 528 DIP to hold it.

### Turning the camera off: placement

The owner asked for a quick way to turn the camera off once the bubble is showing. Both new
controls write the same global `isCameraEnabled` toggle the Record page, the tray, the overlay
widget and the `toggleCamera` shortcut write, so main destroys the bubble and releases the device
whichever one is used.

- **Chosen: on the bubble itself, in its hover chrome**, outside a take. The bubble is the thing
  the user wants gone, the hover chrome already holds its other direct controls (size label,
  grip), and a hover × is the convention of other floating camera bubbles (Loom). It costs
  nothing for someone who never hovers.
- **Chosen too: the control bar, during a take.** The bubble's chrome never renders while
  recording (it would be in the video), so the bubble alone would leave no quick way off
  mid-take. The bar is already the mid-take control surface and is not recorded.
- **Rejected: the overlay's Camera toggle.** It already exists (Mic · System audio · Camera on
  the record widget), but it is only on screen while choosing an area, not while the bubble
  floats over other apps.
- **Rejected: a right-click menu on the bubble** (Circle / Rounded · S / M / L · Turn camera
  off, deferred below). Not discoverable as the only way off; it can still come later.
- **Rejected: a permanent badge on the bubble.** Anything always drawn on the bubble ends up in
  every recording.

"Blocked" comes from a new tri-state `getCameraAccessStatus()` (`granted` / `blocked` /
`unknown`), not from `checkPermissions().camera`, which reads `false` before the user was ever
asked; treating "not asked yet" as blocked would have made the camera impossible to turn on.

## Accessibility contract

- Focus order: Mic → Audio → Camera (toggle) → Camera settings (chevron) → Start Recording. The
  drawer sits right after the chevron in the DOM, so Tab continues into them.
- Opening moves focus to the Shape group (its checked radio), or to "Open System Settings" when
  blocked. Inside: Shape → Size chips → slider → device selector (the device chip is drawn in the
  header but comes last in the DOM). Esc closes and returns focus to the chevron.
- Shape and Size are radiogroups with one tab stop; ←/→ (and ↑/↓) move the selection, wrapping
  and skipping the disabled Custom chip. Chips are named "Medium, 240 pixels"; the group names
  "Size" and the position ("2 of 4") come from the radiogroup semantics.
- Slider: ←/→ 10 px, Shift 40 px; a Shift step that would jump over a preset stops on it, so the
  preset's name is always announced. `aria-valuetext` is "300 pixels, Custom" or "240 pixels,
  Medium".
- Chevron: `aria-label="Camera settings"` with `aria-expanded` (read as collapsed / expanded);
  `aria-haspopup="dialog"` on the Record page only (the drawer is a region).
- The note is one `aria-live="polite"` status element present from the start, so a change is
  announced once.
- Blocked tile: named "Camera, blocked", `aria-disabled` while the camera is off.

## What to validate

1. Record page: chevron opens the drawer under the row; Esc returns focus; shape, chips, slider
   and device change a showing bubble at once.
2. Capture panel: the drawer grows the panel, the panel does not hide while using it (including
   the native device `<select>`), Esc closes it.
3. Bubble hover chrome and grip outside a recording; nothing of it during a recording or in the
   recorded file; a grip drag never moves the bubble's bottom-left corner.
4. Turn camera off: the hover × on the bubble outside a take, and the control bar button during
   one, turn the camera off (bubble gone, camera light off); neither shows in the recorded file.
5. Drag-to-move: pressing on the bubble and dragging moves it, before and during a take, on macOS
   and Windows; it stops at the edges of a recorded area; the grip still resizes from the dropped
   spot.
6. A small area (under 232 px) hides the bubble; a medium one shrinks it.
7. Camera access denied in System Settings: BLOCKED tile, blocked card, the button opens the pane.
8. Windows: same checks (the bubble's hover events on an inactive always-on-top window).

## Deferred

- **Right-click context menu** on the bubble (Circle / Rounded square · Small / Medium / Large ·
  Turn camera off): marked "next iteration" in the design, not built. "Turn camera off" is
  covered by the hover × and the control bar button.
- The fox-nocam illustration for the blocked card: the app has no such asset, the lock icon is
  used.
- Analytics: the app does not track camera toggles, so no shape or size event was added.

## Mirror image

Status: 🟡 In progress (implemented; pending owner validation on the real app).

The bubble used to be always flipped horizontally, like a selfie cam. The bubble is
captured into the recording as part of the screen, so with a rear-facing camera (for
example an iPhone through Continuity Camera) or any text in view, the text came out
reversed in the video.

`CameraBubbleSettings.mirrored` (default `true`, today's behaviour) turns the flip on or
off. The Camera settings have a "Mirror image" switch after the size controls, in both the
panel and the full variant, and it is allowed during a take like the other camera fields.
The bubble applies the flip through a `data-mirrored` attribute, so it follows the setting
live, including mid-recording. A stored non-boolean falls back to `true`.

To validate: turn the switch off with text in front of the camera and check that the
bubble and the exported video read correctly; turn it on and check the selfie flip returns.

## Framing

Status: 🟢 Ready to validate (prod review pending) — implemented; pending owner validation on the real app.

"I need to be able to frame myself when I need it." The bubble used to show whatever the
camera sees, centered. The Camera settings now have a "Framing" switch after "Mirror image":
when on, a zoom slider (100–300 %, arrows ±5, Shift ±25), a small position pad (a draggable
dot; arrows move 0.1, Shift 0.25) and a "Reset" button (recenters, zoom back to 100 %) appear.
The pad is dimmed and not focusable at 100 % zoom, where there is nothing to pan. It works in
both variants and mid-take: the bubble is captured into the recording, so the framing shows
in the video as it changes.

`CameraBubbleSettings.framing` is `{ enabled, zoom, x, y }`, default
`{ enabled: false, zoom: 1, x: 0, y: 0 }`. `zoom` is 1–3 in steps of 0.05; `x` and `y` are
-1..1, how far the visible window is panned toward each edge (0 centered, ±1 touching that
edge of the camera image). Each field is sanitized on its own: clamped, and a non-number
falls back to its default. With `enabled` false the bubble renders exactly as before.

**Transform.** `framingTransform` returns `scale(z) translate(tx%, ty%)` plus `scaleX(-1)`
when mirrored. With `object-fit: cover` the largest pan that keeps the image covering the
bubble is `(z-1)/(2z)` of its side, so `x = ±1` reaches an edge and never shows an empty
one. The flip is the innermost function, so the translate is always in screen space:
positive `x` moves the view toward the right of what the bubble shows, mirrored or not
(the image slides left), and dragging the dot or pressing Right does the same thing you see.

**Capture-resolution rule.** The stream used to be a fixed 640×480. Zooming in only crops
that image, so a small stream would be upscaled and look soft. With framing on, the camera
is asked for `size × 2 (Retina) × zoom` lines, rounded up to 480, 720 or 1080 and capped at
1080 (width 4:3). With framing off it stays 480. The stream is reopened only when the line
count changes and then stays put for 400 ms, so dragging the slider does not restart the
camera on every tick. Reopening shows the placeholder for a moment; that is the one visible
cost of crossing a step.

**Frozen during a take.** That blink would be recorded, so while a take runs the bubble keeps
the line count it had when the take started (`takeLines` in `camera-bubble.tsx`) and catches
up when the take ends. Zoom and position still apply at once, mid-take; the trade-off is that
zooming in during a take shows a softer image in the video until it ends.

Persistence follows the size slider: changes show at once and reach disk at most every 60 ms.

To validate: turn Framing on, zoom to 200 % and drag the dot; check the bubble pans without
empty edges and the picture stays sharp after a second; check both Mirror on and off move the
same way you drag; change the framing during a take and check the exported video.
