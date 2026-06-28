# Shortcuts + window reachability

Design notes for three related changes shipped together on
`feat/shortcuts-and-window-reachability`.

## 1. Control bar in the recording (Bug 2)

The floating control bar is created with `setContentProtection(true)`
(`NSWindowSharingNone`), which excludes it from every OS screen capture. That is
the right default (a clean recording without our own UI), but some users want it
in the video.

- New setting `AppSettings.showBarInRecording` (default `false` → current
  behavior). The control bar reads it via `ControlBarWindow.show(displayId, { includeInRecording })`
  and applies `setContentProtection(!includeInRecording)`.
- The value flows main → bar from the recording hub (`getAppSettings()`), so the
  bar window never imports the settings store (keeps the layering clean).
- Limitation (v1): applied when the bar is shown. Toggling it _during_ an active
  recording is not live — documented follow-up.

## 2. App reachability invariant (Bug 1)

Symptom: turning the camera on (even without recording) could drop the app from
the Dock / Cmd+Tab on the packaged build. Root principle: **the app's
Dock/switcher presence must never depend on which window is visible.**

Three layers, defense in depth:

- **A — re-assert on panel show.** After `cameraBubble.show()` and `bar.show()`,
  call `applyDockPolicy()` so showing a floating panel can't leave the app
  orphaned.
- **B — force `regular` while recording.** On `recording:start` the main window
  hides; force `regular` activation policy (`forceRegularPolicy()`) so the app
  stays in Cmd+Tab with only panels visible, and restore the user's preference
  via `applyDockPolicy()` on stop.
- **C — global rescue shortcut.** "Bring Kaipu to front" (below) is the
  guaranteed recovery: it shows + focuses the main window and re-asserts the
  policy regardless of state.

## 3. Global keyboard shortcuts

New `src/main/shortcuts/global-shortcuts.ts` registers three `globalShortcut`s
from persisted, rebindable settings (`AppSettings.shortcuts`). Defaults use the
`⌘⌃` (Command+Control) base — distinctive, not a macOS reserved combo
(avoids `F/Q/D/Space`), and unlikely to collide with browser/editor shortcuts
while recording:

| Action            | Default | Mnemonic |
| ----------------- | ------- | -------- |
| Start recording   | `⌘⌃C`   | Capture  |
| Stop recording    | `⌘⌃S`   | Stop     |
| Bring Kaipu front | `⌘⌃O`   | Open     |

Wiring reuses existing paths:

- **Start** → the same flow as the Capture Panel's start (`recordingRequestStart`
  → record page `startRecording()`, which guards on a selected source / not
  already recording).
- **Stop** → sends `recordingCommand("stop")` to the main window, the same
  command the control bar's Stop button relays.
- **Bring to front** → `showMainWindow()` + `applyDockPolicy()` + `app.focus`.

Bindings are rebound from the dedicated **Shortcuts page** (its own sidebar
entry, alongside Record/Library/Settings). The renderer captures a combo
(`keyboard-accelerator.ts`, requires Command/Control + a letter/digit), persists
it, and the main process re-registers. Registration results are exposed via
`shortcuts:get-status` so the UI can flag a binding another app already owns
(guarded so a stale preload degrades gracefully instead of crashing the page).
`globalShortcut.unregisterAll()` runs on quit.

The "Show control bar in recording" toggle stays in **Settings → Recording**
(it's recording configuration, not a shortcut).
