---
title: "Tray menu: Record submenu"
description: "The tray icon's right-click menu gains a Record submenu (screen, area, window), a Stop recording item while a recording runs, a screenshot item, Library and Settings. Design: Kaipu Record Modes v2, section 5."
---

# Tray menu: Record submenu

> **Status: 🟢 Ready to validate (prod review pending)** — branch `feat/tray-record-submenu`
> (2026-10-26). Part of [Record capture modes](./record-capture-modes).

## What changed

Left click still toggles the capture panel. Right click now shows:

- **Idle:** Open Kaipu Record, **Record** (Record screen, Record area, Record window…),
  Take screenshot, Library, Settings…, Quit.
- **While recording or paused:** **Stop recording** appears right after Record, and the three
  Record items are disabled. Pausing keeps Stop enabled.

The menu is a plain template (`apps/kaipu-record/src/main/tray-menu.ts`), so it is unit-tested
without Electron. `tray.ts` builds it from main's translator and rebuilds it on a locale change
and when the recording hub reports that a recording started or stopped.

## Decisions

- **Accelerators are display-only.** Items show the configured binding from settings with
  `registerAccelerator: false`, so the menu never registers a second copy of a global shortcut.
  "Open" shows `CommandOrControl+O`, also display-only.
- **Record window…** opens the main window on the Record page with the source picker
  (screens and windows), the same path as the capture panel's "Change". There is no direct
  window-thumbnail trigger from main.
- **Library and Settings** navigate by setting the main window's URL hash (the renderer uses a
  hash router), since main has no navigation channel to the renderer.
- **"Highlighted" Stop** is not possible on a native menu; Stop is simply the extra item.

## To validate

- macOS and Windows: right-click the tray idle, start a recording, right-click again (Stop
  present, Record items grey), pause and resume (Stop stays enabled), stop.
- Change the language in Settings and right-click: labels follow.
- Library and Settings from the tray, with the main window open, hidden, and closed.
