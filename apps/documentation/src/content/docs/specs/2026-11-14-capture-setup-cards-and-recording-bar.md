---
title: "Capture page: setup cards and recording bar"
description: "The Capture page's Recording setup row and panels follow the design, keeping every control the app has; during a take the page stays Capture with a recording bar on top."
---

> Status: 🟡 In progress. Ticket: [NIW2-814](https://linear.app/niway/issue/NIW2-814). Follows
> [Capture page and tray popover](./2026-11-13-capture-page-and-tray-popover-design/), which
> shipped the page with the old Record page's setup row and recording view. The owner approved
> the mocks below on 2026-11-14.

## In one minute

The **Recording setup** row becomes three cards (Microphone, System audio, Camera). Each card shows
its name, the current choice, an ON/OFF switch and a separate chevron that opens its panel. The
panel has two labelled columns, as in the design, and keeps every control the app has today: the
design is a reference, and where it shows fewer controls the app's features win. The camera source
becomes a radio list instead of a dropdown.

**During a recording** the page no longer swaps to a separate view. It stays the Capture page: a
bar under the header shows the recording state, the source, the clock, Pause/Resume and Stop. The
Screenshot and Recording cards and the Instant line are disabled; the setup row stays live.

| Decision                                                                                                      | Why                                                                                     | ADR  |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---- |
| Keep every existing panel control (input level, volume, custom size, mirror, framing) under the design's rows | They are shipped features; the design did not decide to remove them (owner, 2026-11-14) | none |
| Camera source as a radio list                                                                                 | Matches the microphone list and the design; every device visible at once                | none |
| Recording bar above disabled capture cards, setup live                                                        | One page in every state; Pause stays reachable outside the floating bar                 | none |
| Rail stays icons only                                                                                         | Owner decision NIW2-626, confirmed 2026-11-14; labels are a separate change if wanted   | none |

**Open questions:** none.

**Out of scope:** the tray popover's layout, the capture widget, rail labels, renaming the `record`
route and files.

## Setup cards

- Icon, bold name, and a secondary line with the current choice: the selected microphone's name;
  "All sound" for system audio; the camera's name, shape and size ("iPhone Camera · circle, M",
  or the pixel size when the size is custom).
- An "ON"/"OFF" label and a switch. The switch writes the same recording settings the capture
  widget and the tray popover read; nothing new is stored.
- A separate chevron segment opens and closes the card's panel; one panel is open at a time. The
  open card has the accent border and tint, and its chevron points up.
- System audio unavailable during a take keeps today's unavailable state.

## Panels

Two columns, small uppercase section labels.

| Panel        | Left column                                                          | Right column                                                                            | Below both                                                                                      |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Microphone   | INPUT: radio list of devices, live level meter in the selected row   | SOUND: Input level slider, Reduce background noise                                      | —                                                                                               |
| System audio | WHAT TO CAPTURE: All sound / One app (disabled, "not available yet") | MIX: Lower it while I talk, Volume in the recording                                     | —                                                                                               |
| Camera       | SOURCE: radio list of cameras (default camera first)                 | SHAPE: Circle / Square / Rectangle; SIZE: S / M / L / Custom with the 120–480 px slider | Mirror image, Framing (and its zoom/position controls when on), corners when the shape has them |

Every state the panels have today (no devices, permission blocked, camera off note, live note
during a take) keeps working in the new layout.

## During a recording

- The header ("Capture to <workspace>") stays.
- Under it, one bar: red dot, "Recording" or "Paused", the source name, the clock, Pause/Resume and
  Stop recording.
- The Screenshot and Recording cards and the Instant line render disabled (dimmed, not clickable).
- The setup row and its panels stay live, as today.
- Countdown and the source picker overlay behave as today.
