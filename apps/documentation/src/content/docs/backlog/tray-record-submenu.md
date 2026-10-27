---
title: "Tray menu: Record submenu"
description: "The tray icon's right-click menu gains a Record submenu (screen, area, window), a Stop recording item while a recording runs, a screenshot item, Library and Settings. Design: Kaipu Record Modes v2, section 5."
---

# Tray menu: Record submenu

> **Status: 🟢 Ready to validate (prod review pending)** — PR #381, integrated with the rest of
> task 5 on `feat/record-modes-integration` (2026-10-26). Unit tests and type checks pass;
> nothing has been run in Electron yet (native menu rendering, accelerators and the hash
> navigation are unverified at runtime), and owner QA is pending. Part of
> [Record capture modes](./record-capture-modes).

## What changed

Left click still toggles the capture panel. Right click now shows:

- **Idle:** Open Kaipu Record, **Record** (Record screen, Record area, Record window…),
  Take screenshot, Library, Settings…, Quit.
- **While recording or paused:** **Stop recording** appears right after Record, and the three
  Record items are disabled. Pausing keeps Stop enabled.
- **During a countdown** (no recording yet): the Record items are disabled and **Cancel
  countdown** appears in Stop's place. It sends the same stop command, which cancels a pending
  start; the hub reports the pending take through `onPendingChange`.
- **Each Record item opens the selector in its own mode**, like the Record page's chips, and makes
  it the last used one: Record screen → Screen, Record area → Frame, Record window… → the
  thumbnail picker while the overlay's Window mode is off (NIW2-469), where a pick starts the
  countdown.

The menu is a plain template (`apps/kaipu-record/src/main/tray-menu.ts`), so it is unit-tested
without Electron. `tray.ts` builds it from main's translator and rebuilds it on a locale change
and when the recording hub reports that a recording started or stopped.

## Decisions

- **Accelerators are display-only.** Items show the configured binding from settings with
  `registerAccelerator: false`, so the menu never registers a second copy of a global shortcut.
  "Open" shows `CommandOrControl+O`, also display-only.
- **Record screen shows no accelerator.** `startRecording` opens the selector in the last used
  mode, which is not always Screen, so showing it there would promise something else. Record
  area shows `recordArea`, which does open Frame.
- **Library and Settings** navigate by setting the main window's URL hash (the renderer uses a
  hash router), since main has no navigation channel to the renderer.
- **"Highlighted" Stop** is not possible on a native menu; Stop is simply the extra item.

## To validate

- macOS and Windows: right-click the tray idle, start a recording, right-click again (Stop
  present, Record items grey), pause and resume (Stop stays enabled), stop.
- Start a take from the selector and right-click during the countdown: Record items grey,
  Cancel countdown present and cancelling.
- Change the language in Settings and right-click: labels follow.
- Library and Settings from the tray, with the main window open, hidden, and closed.
