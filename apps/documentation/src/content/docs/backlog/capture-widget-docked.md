---
title: "Capture widget: one toolbar docked to the work area"
description: "The screenshot action bar, the recording panel, the ratio bar and the hint pill become one toolbar docked to the bottom of the work area, with the recording countdown inside it."
---

# Capture widget: one toolbar docked to the work area

> **Status: 🟢 Ready to validate** — branch `feature/niw2-751-capture-widget-one-toolbar-docked-to-the` (2026-11-13).
> Design: [spec](/specs/2026-11-13-capture-widget-one-toolbar-design/) and
> [ADR 0056](/architecture/decisions/0056-the-capture-widget-docks-to-the-work-area-not-to-the-selection/).
> Tracker: [NIW2-751](https://linear.app/niway/issue/NIW2-751).

## What shipped

- One `CaptureWidget` in Frame, Screen and Window modes. It sits 16 px above the bottom of the work area, jumps to the top when the box reaches that band, and stays at the bottom (covering a strip) when neither edge is free.
- Screenshot row: Copy to clipboard, Cancel, Capture. Recording row: Microphone, System audio, Camera (device chevrons), Cancel, Record with the countdown seconds.
- `M`, `A` and `W` toggle the inputs in the recording intent only, with a 1.5 s toast and a halo.
- Ratio chips work in both intents and resize the box; a read-only `W × H px` readout.
- The countdown runs in the widget: `countdownDone` on the record answer makes main and the recorder skip their own. Esc cancels only the countdown.
- "More settings" cancels the overlay and opens the Record settings; Home's button reads "New recording".

## Still to validate by hand

- A real Dock (visible and hidden) and a Windows taskbar.
- Two displays: Screen mode shows one widget per display.
- The widget over a full-screen app, and the captured image under the widget in Screen mode.
