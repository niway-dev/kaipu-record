---
title: "Widget — Record / Capture tabs"
description: "Two-mode tray widget: a segmented tab bar switches the Capture Panel between recording controls (tab 1) and a one-button screenshot action (tab 2), making the app dual-purpose from the menu bar."
---

# Widget — Record / Capture tabs

> **Status: 🟢 Built locally** (on `feat/widget-capture-tabs`). The menu-bar **Capture
> Panel** now has two tabs: **Record** (the existing recording controls) and **Capture**
> (a single _Capture Screen_ button that runs the interactive region select and lands you
> in the editor). This turns the tray widget into a dual-mode launcher — recording _and_
> screenshots — without opening the main window.

## Model — two modes, one panel

The panel gains a `PanelTab = "record" | "capture"` (`as const`, no TS enum) held in local
state, defaulting to `"record"` on every open. A segmented **`PanelTabs`** control switches
between:

- **Record tab** — the existing block unchanged: source card, mic/system/camera toggles, mic
  picker, and the Start/Stop `RecordButton`.
- **Capture tab** — a single **Capture Screen** button (camera icon + the `⌃⌘X` shortcut hint),
  nothing else.

## Interaction

- **Capture Screen** → `requestCaptureScreenshot()` (new IPC). Main dismisses the panel and
  runs `triggerCaptureScreenshot()` — the **same flow as the `⌘⌃X` hotkey** (region select →
  editor). No new capture logic; it's a second entry point to the existing screenshot flow.
- **Default tab:** Record, every time the panel opens.
- **Locked during recording:** while a recording is in progress the tab bar is **disabled and
  forced to Record** (`activeTab = isBusy ? "record" : tab`), matching how the controls already
  lock. Screenshot-during-recording is deliberately out of scope for now.

## Non-blocking principle

Recording and screenshot are **independent** — starting one never interrupts the other (they
run in different windows / a separate native process). The recording-locks-tabs rule is only a
UI guard for now; the future direction is to allow a screenshot mid-recording without stopping
it.

## Implementation

| File                                                    | Change                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `capture-panel/components/panel-tabs.tsx` (+ css, test) | New segmented `Record · Capture` tablist (presentational; `disabled` when locked)                    |
| `capture-panel/capture-panel.tsx` (+ css, test)         | Tab state, conditional Record vs Capture body, lock-to-Record while recording, Capture Screen button |
| `shared/types/ipc.ts`                                   | New `screenshotRequestCapture` channel                                                               |
| `preload/index.ts` + `shared/types/electron-api.ts`     | `requestCaptureScreenshot()`                                                                         |
| `main/index.ts`                                         | Handler → `capturePanel.hide()` + `triggerCaptureScreenshot()` (mirrors `recordingRequestStart`)     |

## Decisions

- **Reuse the hotkey flow** rather than a new capture path — one source of truth for
  region-capture → editor; the panel button and the global shortcut converge on
  `triggerCaptureScreenshot`.
- **English labels** (`Record` / `Capture`, `Capture Screen`) to match the widget's existing
  copy (`Start Recording`, `Entire screen`, …).
- **Lock, don't hide, the tabs while recording** — keeps the layout stable and the mode obvious.

## Follow-ups

- Screenshot **during** a recording (drop the tab lock; keep them non-blocking).
- Remember the last-used tab across opens (currently always resets to Record).
