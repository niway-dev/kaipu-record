---
title: "Capture page and tray popover"
description: "Record and Screenshot merge into one Capture page; the menu-bar popover shrinks to two entries, three switches and a recording state."
---

> Status: 🟡 In progress. Source: the owner's design "Kaipu Capture Home" (2026-11-13).

## In one minute

The rail loses one icon: **Record** and **Screenshot** become one **Capture** page. At the top,
two cards of equal weight, Screenshot (⇧⌘1) and Recording (⇧⌘2); the whole card is the button and
opens the selector (the capture widget). Below, only what is set once: Microphone, System audio
and Camera, each with its settings panel. The menu-bar popover becomes the shortest view of the
same state: two rows that open the selector, the Instant line, three on/off switches without
settings, and the workspace. While recording it shows the time, a large Stop and the switches
read-only.

| Decision                                                                               | Why                                                                                                        | ADR  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---- |
| One Capture page at `/`, `/screenshots` redirects to it                                | Both entries live in one place; an old link or restored navigation to `/screenshots` still lands somewhere | none |
| The card opens the selector; no "Start recording" button                               | A start button that only opens a picker reads like a confirmation                                          | none |
| The card shows the last used mode ("Last used · Frame")                                | Replaces the "Last used" chip row; the selector remembers the mode                                         | none |
| ⌃⌘X Instant is a line, not a button                                                    | It opens nothing                                                                                           | none |
| Screenshot recents leave the page                                                      | They live in Library                                                                                       | none |
| Settings live on the page, on/off lives in both places                                 | One thing lives in one place; the switch is the same state everywhere                                      | none |
| The popover has no tabs, no mode chips, no settings arrows                             | The selector picks the area; settings live on the page behind "Setup"                                      | none |
| While recording, the popover shows time, Stop ⇧⌘2 and read-only inputs with the reason | Its own job is the second state                                                                            | none |

Rejected: keep Record as a settings page and delete Screenshot. It works, but capture loses its
entry point in the app and the name "Record" stops telling the truth.

**Out of scope:** the capture widget itself (the docked toolbar, NIW2-751), renaming the
`record` route constants and files (follow-up once the widget PR lands, to avoid conflicts),
and the app shell's status strip, which already lists the shortcuts on every page.

## Capture page

- Heading: **Capture**, then "to {workspace}" and a **Switch** link that opens the workspace menu.
- Two entry cards side by side. Each: accent icon tile, title, one-line description, the
  shortcut keycap, a chevron, and "Last used · {mode}".
  - Screenshot: "Pick an area, then annotate or copy it." Opens the selector with the capture
    intent in the stored screenshot mode; main resolves the mode, as for ⇧⌘1.
  - Recording: "Pick an area, then record with sound and camera." Opens the selector with the
    record intent in the last used recording mode. Frame with a remembered area adds its aspect
    ratio ("Frame · 16:9", or "Frame · Free"); Frame with no area yet shows just "Frame".
- Instant line: ⌃⌘X keycap, **Instant**, "captures the screen under the cursor at once, without the selector." (the mock said "the last area again"; ⌃⌘X captures the whole display under the cursor, so the copy says what it does)
- Divider, then **Recording setup** with "Set once. In the selector you only turn these on or
  off." and the Microphone, System audio and Camera split tiles; a chevron opens one settings
  panel at a time under the row (unchanged behaviour).
- No footer of its own: the app shell's status strip already shows the shortcuts on every page.
- While a take runs, the page keeps today's recording layout (indicator, Pause/Resume, Stop).

## Tray popover

Idle:

1. Header: Kaipu Record and **Open ↗** (shows the main window).
2. Two rows: Screenshot ⇧⌘1 and Recording ⇧⌘2. Each opens the selector, like the page cards.
3. Instant line: ⌃⌘X "Instant, whole screen".
4. **Record with**: three switches, Mic, Audio, Camera, each showing ON or OFF. No arrows.
5. Footer: the workspace the next take lands in (clicking it shows the main window, where the
   title bar switches it) and **Setup** (shows the main window on the Capture page).

While recording (countdown included):

1. Header as above.
2. A status box: "Recording · {mode}" and the elapsed time (paused shows "Paused").
3. **Stop** with ⇧⌘2.
4. **Recording with**: the three switches read-only, and "Finish the recording to change these."
5. Footer as above.
