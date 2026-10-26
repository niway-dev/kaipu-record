---
title: "Camera bubble — shape and size"
description: "The camera toggle becomes configurable without weighing more: a split Camera tile opens shape, size and device settings (a popover on the Record page, an inline drawer in the capture panel), and the bubble resizes from its fixed corner with a hover grip."
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

Only these persist. The bubble's **position does not**: it is fixed at the bottom-left corner of
the recorded area (or of the display's work area when the whole screen records) and grows up and
to the right. The bubble is **not draggable** any more: the old drag region is gone and the
window is created with `movable: false` and `resizable: false`.

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
  segment on its right opens a 272 px popover (`role="dialog"`) anchored right under the row.
- **Capture panel.** The panel hides when it loses focus, so there is no popover: the 22 px
  chevron expands an inline **drawer** inside the panel, the panel grows downward and focus never
  leaves the window. Esc or the chevron closes it. Same content, compact (26 px chips, short
  labels).
- **Content.** Header with the camera icon, "Camera" and the device selector chip; Shape (Circle |
  Rounded); Size (S · M · L · Custom, where Custom shows the value when it is not a preset and is
  not clickable otherwise); a 120–480 px slider with ticks at the three presets.
- **States.** Camera off: the controls work, with "Camera is off. These apply when you turn it
  on." During a recording: the controls work, with the pink live note "Changes apply live and
  will show in the recording." Access blocked: the tile shows a lock and BLOCKED and cannot turn
  the camera on; the settings are replaced by "Camera access is blocked" and an "Open System
  Settings" button.
- **Bubble.** Outside a recording, hovering shows a 2 px pink outline, a size label
  ("240 px · M") above it and a resize grip (a white dot on the rim at 45° for the circle, a
  white L at the top-right corner for the rounded square). Dragging the grip resizes diagonally
  from the fixed corner, clamped to 120–480 and to the area; the release persists the size that
  is on screen. **While recording none of this renders** (no outline, no label, no grip): the
  bubble on screen is exactly the one in the video.

"Blocked" comes from a new tri-state `getCameraAccessStatus()` (`granted` / `blocked` /
`unknown`), not from `checkPermissions().camera`, which reads `false` before the user was ever
asked; treating "not asked yet" as blocked would have made the camera impossible to turn on.

## Accessibility contract

- Focus order: Mic → Audio → Camera (toggle) → Camera settings (chevron) → Start Recording. The
  popover and the drawer sit right after the chevron in the DOM, so Tab continues into them.
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

1. Record page: chevron opens the popover under the row; Esc returns focus; shape, chips, slider
   and device change a showing bubble at once.
2. Capture panel: the drawer grows the panel, the panel does not hide while using it (including
   the native device `<select>`), Esc closes it.
3. Bubble hover chrome and grip outside a recording; nothing of it during a recording or in the
   recorded file; a drag never moves the bubble's bottom-left corner.
4. A small area (under 232 px) hides the bubble; a medium one shrinks it.
5. Camera access denied in System Settings: BLOCKED tile, blocked card, the button opens the pane.
6. Windows: same checks (the bubble's hover events on an inactive always-on-top window).

## Deferred

- **Right-click context menu** on the bubble (Circle / Rounded square · Small / Medium / Large ·
  Turn camera off): marked "next iteration" in the design, not built.
- The fox-nocam illustration for the blocked card: the app has no such asset, the lock icon is
  used.
- Analytics: the app does not track camera toggles, so no shape or size event was added.
