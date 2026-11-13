---
title: "Capture widget: one toolbar docked to the work area"
description: One toolbar, docked to the bottom of the display's work area, replaces the four pieces that followed the selection box in the screenshot and recording intents. Layout, placement and jump rule, keys, countdown, and what is out of scope.
---

# Capture widget: one toolbar docked to the work area

Status: 🟢 Ready to validate. Tracker: [NIW2-751](https://linear.app/niway/issue/NIW2-751/capture-widget-one-toolbar-docked-to-the-bottom-of-the-work-area-for).
Decision record: [ADR 0056](/architecture/decisions/0056-the-capture-widget-docks-to-the-work-area-not-to-the-selection/).
The owner chose direction A ("Dock fijo") of the commissioned mock on 2026-11-13.

## Summary

Today the capture overlay draws four pieces that follow the selection box: an action bar under
the box (screenshot), a vertical panel on its right edge and a ratio bar above it (recording),
and a hint line pinned to the screen bottom. The owner tested it and rejected it: the pieces
spread out, overlap the content and each other, and the important control gets lost.

One toolbar replaces all four, in both intents. It is docked to the bottom of the display's
work area, not to the selection.

## Decisions

| Decision                                                                                               | Why                                                               | ADR                 |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------- |
| One toolbar for both intents, docked to the work area                                                  | The owner can find the controls without following the box         | creates 0056        |
| Centred, 16 px above the work area's bottom edge; jumps to the top (16 px below) if the box reaches it | A free edge always exists unless the box fills the area           | 0056                |
| No free edge (Screen mode, full-height box): stays at the bottom and covers that strip                 | The widget hides before capture, so the strip is in the image     | 0056                |
| Ratios show in both intents                                                                            | The owner wants one layout; the box locks to the ratio either way | none                |
| Keys `M` / `A` / `W` toggle mic / system audio / camera, Recording only                                | `C` would clash with ⌘C and with an accidental camera toggle      | none                |
| Countdown runs inside the widget; the widget stays visible and dims                                    | The owner sees what will start and can cancel with Esc            | 0030 (reused)       |
| The old pieces are deleted, not restyled                                                               | Restyling in place was already tried and rejected                 | 0056 (alternatives) |

## Open questions

None blocking. Window mode stays disabled ("soon"), so its picker keeps the capability but
shows no live entry in the widget.

## Out of scope

- Window mode (stays disabled), editable W × H, size presets.
- A compact or collapsed widget (possible later).
- Directions B (side panel) and C (compact bar) of the mock.

## Placement

- The widget is centred horizontally in the display's work area (`screen.getDisplayMatching(...).workArea`,
  which already excludes the Dock, taskbar and menu bar), 16 px above its bottom edge.
- If the selection box reaches the band the widget would occupy, the widget moves to the top of
  the work area, 16 px below its top edge, and returns to the bottom when the box leaves the band.
- When neither edge is free (Screen mode, or a Frame box spanning the full height), the widget
  stays at the bottom. The widget hides before capture (ADR 0022), so the strip under it is in
  the image or video.
- The widget appears on the display that holds the selection. In Screen mode every display shows
  its own widget, as every display showed its own card before.
- The widget is at most 1120 px wide. When the work area is narrower than 1152 px, it shrinks to keep a 16 px margin on each side.

## Layout

Same structure in both intents.

- **Row 1:** CAPTURE AS (Screenshot `P` / Recording `V`) · AREA (Frame `1` / Screen `2` / Window,
  disabled, "soon") · RATIO (Free / 16:9 / 9:16 / 1:1) and a read-only live `W × H px` readout.
- **Row 2, Recording:** Microphone (device chevron, On/Off word, `M`) · System audio (`A`) ·
  Camera (device chevron, `W`) · Cancel `Esc` · **Record ↵** with "N s countdown".
- **Row 2, Screenshot:** one wide "Copy to clipboard" button (shows `⌘C`, `Ctrl+C` on Windows) ·
  Cancel `Esc` · **Capture ↵**.
- **Row 3:** key hints grouped BOX / SWITCH / GO, inside the widget; Recording adds a
  "More settings" link that opens the Record settings in the main window.
- One selected style (soft pink fill, pink border, white text), from the Kaipu Black tokens.

## Keys

Unchanged: `P` / `V` intent, `1` / `2` area, `Enter` start, `Esc` cancel, `⌘C` copy (Screenshot
only), `R` record (Recording only).

New, Recording only: `M`, `A`, `W`. They ignore key repeat, any press with a modifier and events
from editable controls. A key toggle shows a toast above the widget ("✓ Microphone on [M]",
1.5 s) with a halo on the control; a click shows no toast.

## Countdown

After Record the widget stays. Everything dims to about 35 % except Cancel and the confirm
button, which becomes an outline "Starting in 3…". A large number disc counts down centred on
the selection. `Esc` cancels the countdown and returns to the widget; no recording starts and
no file is created. At zero the overlay sends the record answer and main starts the take
without a second countdown.

## Home and widget

One state, two views (`recording-hub` in main is the single owner). Home is how I always record;
the widget is what I capture now. The Home start button opens the widget and reads
"New recording"; the only Record button is the widget's.

## Acceptance criteria

The criteria are the checklist of NIW2-751; the PR's Evidence table has one row per criterion.
