---
title: Debug capture — one shortcut freezes what Kaipu shows and knows
description: A developer-only shortcut that saves every visible Kaipu window, each display, the app state and recent console lines to a local folder an agent can read.
---

> 🔵 Proposed: [NIW2-785](https://linear.app/niway/issue/NIW2-785/debug-capture-one-shortcut-saves-every-visible-kaipu-window-the-screen).
> Design agreed with the owner in chat on 2026-11-14; this page is the build's source.

## Summary (one minute)

When something odd happens in Kaipu, the owner presses **⌃⌥⌘D**. Kaipu saves one folder with
one image of every visible Kaipu window in its real place, each window alone, one full-screen
image per display, a `state.json` with what the app knows at that moment (version, OS, displays,
windows, route and UI-map areas, flags, settings, recording state), and the last console lines
of the main process and of every window. The file manager (Finder on macOS) then reveals the folder. The owner pastes its
path into a Claude session, and the agent debugs from the images and the JSON without
reproducing the bug.

It is a developer tool: on by default in `bun run dev`, and in signed builds only on the
owner's machines, through a PostHog flag matched by device id like the release flags. Nothing
is uploaded.

| #   | Decision                                                                                                                        | Why                                                                                                                                                                                                                                                                                      | ADR         |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | A bundle (images + `state.json` + `console.log`), not screenshots alone                                                         | A picture shows that a button is grey, not why; the state and the console lines usually do                                                                                                                                                                                               | —           |
| 2   | One composite image of every visible Kaipu window at its screen position, plus each window alone                                | The owner's request: see every widget in one picture. The composite shows how windows sit relative to each other; the singles keep full detail                                                                                                                                           | —           |
| 3   | Window images come from `webContents.capturePage()`, composited in pure JS from `nativeImage` bitmaps                           | Electron API on both platforms, needs no permission and no native dependency (no `postinstall`, see `CLAUDE.md`)                                                                                                                                                                         | —           |
| 4   | Plus one full-screen image per display through `desktopCapturer`                                                                | Shows the native parts `capturePage` cannot see (menus, system dialogs, other apps around the widget). Uses the Screen Recording permission Kaipu already holds                                                                                                                          | —           |
| 5   | Console lines come from a ring buffer in main: main's own `console.*` plus every window's `console-message` event               | No renderer change and no file logger; the bundle still carries the recent past                                                                                                                                                                                                          | —           |
| 6   | Gate: `is.dev` OR the new `debug-capture` flag (added to `FLAG_NAMES`, `FLAG_DEFAULTS` false); the renderer reports it to main  | Main has no PostHog client; this is the existing `reportCaptureWhileRecording` / `reportImageText` pattern. The flag stays off by default and in PostHog matches only the owner's device ids                                                                                             | reuses 0049 |
| 7   | The folder stays on the Mac and holds settings and paths as they are                                                            | Only the owner uses it now. Uploading or redacting belongs to a later user-facing bug report                                                                                                                                                                                             | —           |
| 8   | ⌃⌥⌘D on macOS (`Control+Alt+Shift+D` on Windows), hard-coded, not in Settings → Shortcuts, held through `holdTemporaryShortcut` | A debug key is not a user feature. No Kaipu shortcut uses it (checked `shared/types/ipc.ts`). `applyGlobalShortcuts` calls `unregisterAll` on every settings write and re-registers only the user shortcuts and the held ones, so a bare `globalShortcut.register` would vanish silently | —           |

No new ADR: every decision above is reversible by editing one module, and none changes how the
app's parts fit together. Flags follow
[the typed flag registry ADR](/architecture/decisions/0049-flags-are-a-typed-registry-with-state-in-our-api-labs-is-user-opt-in/).

### Open questions

1. Does `capturePage()` return the camera bubble's live video, or a black frame? If black, the
   full-screen image (decision 4) still shows it; the build records which one happens.
2. Does `capturePage()` keep transparency for the rounded, frameless windows (tray popover,
   preview card)? The composite needs it to not draw black corners over the window below.
3. Is ⌃⌥⌘D taken by another app the owner runs? `globalShortcut.register` returns `false` in that
   case; the build logs it and the owner picks another key.

### Out of scope

- Proof on Windows. The code paths are cross-platform and Windows gets its own accelerator,
  but the owner's machines are Macs: Windows stays unverified until someone runs it there.
- Uploading the bundle, or any "Report a bug" flow for users.
- Redacting settings or paths.
- Video of the seconds before the shortcut.
- A visible "captured" toast: it would be one more window in the next capture. Finder revealing
  the folder is the confirmation.
- A log file on disk. The ring buffer only lives while the app runs.

### Failures this must protect against

- **A hidden window ends up in the composite.** Kaipu pre-creates windows (the tray popover is
  prewarmed and hidden). Only windows that are visible, not minimized and not destroyed are
  captured; hidden ones are listed in `state.json` as `"captured": false`.
- **One window fails and the whole capture is lost.** A destroyed or crashed window must not
  throw away the rest: each window is captured on its own, a failure goes into `state.json` and
  `console.log`, and the folder is still written.
- **The capture changes what it is capturing.** The shortcut must not focus a Kaipu window,
  because the tray popover hides on blur; images are taken before Finder opens.
- **Wrong placement on a Retina or mixed-DPI setup.** Window bounds are in points and bitmaps in
  pixels; the composite scales each window by its display's `scaleFactor`, and the singles keep
  their native pixels.
- **Shipping it to users by mistake.** In a packaged build with the flag off or unresolved
  (offline, Send diagnostics off), the shortcut is not registered at all.
- **No Screen Recording permission.** `bun run dev` runs as the Electron binary, which may
  not hold the permission the signed app has. Then `desktopCapturer` returns blank or no
  sources: `screens/` is skipped, `state.json` says `"screens": "no permission"`, and the
  window images and the composite (which need no permission) are still written.
- **Holding the shortcut twice, or never.** The hold is idempotent: a flag report that is
  already applied does nothing. When `holdTemporaryShortcut` returns `false` (another app owns
  the key), main logs it once and tries again on the next flag report.
- **The shortcut silently stops working.** Every settings write unregisters all global
  shortcuts. The debug key is held with `holdTemporaryShortcut` (re-applied after
  `unregisterAll`), and released with `releaseTemporaryShortcut` when the reported flag turns off.
- **The console buffer grows without bound.** Fixed size (500 lines per source), oldest first out.
- **A secret in the console lands in the folder.** Accepted for now (decision 7): the folder
  never leaves the Mac. Reopen before any upload exists.

## Acceptance criteria

- [ ] In `bun run dev`, ⌃⌥⌘D writes
      `<userData>/debug-captures/<YYYY-MM-DD_HH-mm-ss>/` and reveals it in Finder.
- [ ] With the main window, the tray popover and the screenshot preview card open, the folder
      holds `composite.png` showing all three at their screen positions, plus one PNG per
      window under `windows/`.
- [ ] The folder holds one `screens/display-<n>.png` per connected display.
- [ ] `state.json` holds: app version and channel (dev or packaged), Electron/Chrome/Node
      versions, OS release and arch, displays (bounds, scale factor), every Kaipu window (kind,
      bounds, visible, focused, captured, route, visible UI-map areas), resolved flags and
      overrides, settings, and the recording state.
- [ ] `console.log` holds the last lines of main and of each window, each line tagged with its
      source and a timestamp.
- [ ] A hidden window is listed in `state.json` with `"captured": false` and is absent from the
      composite.
- [ ] In a packaged build without the flag, ⌃⌥⌘D does nothing (the shortcut is not registered).
- [ ] ⌃⌥⌘D still captures after a settings write (change any setting, press it again).
- [ ] Turning the flag off at runtime releases the shortcut; turning it on holds it again.
- [ ] With the `debug-capture` flag on for the owner's device id, the signed build captures.
- [ ] Unit tests cover: the composite placement and scaling (pure function over bitmaps and
      bounds), the ring buffer bound, the gate (dev / flag / neither), the shortcut surviving
      `applyGlobalShortcuts`, and a failing window
      not aborting the bundle.
- [ ] Real-app proof on the Mac mini: one bundle from the built app, its `composite.png` in the
      PR.

## Detail

### The folder

```text
<userData>/debug-captures/2026-11-14_15-32-10/
  composite.png          every visible Kaipu window, placed as on screen
  windows/
    main.png
    capture-panel.png    the tray popover
    capture-toast.png    the screenshot preview card
    …                    one per visible window
  screens/
    display-1.png
    display-2.png
  state.json
  console.log
```

`<userData>` is already per flavor (`kaipu-record-dev` in dev), so dev and prod captures do not
mix.

### The windows it knows

The app creates these windows today (`new BrowserWindow` in `apps/kaipu-record/src/main`):

| Kind              | Module                                        | What the owner calls it               |
| ----------------- | --------------------------------------------- | ------------------------------------- |
| `main`            | `main/index.ts`                               | the main window                       |
| `capture-panel`   | `main/capture-panel-window.ts`                | the menu-bar (tray) popover           |
| `capture-overlay` | `main/screenshots/capture-overlay-windows.ts` | the capture selector, one per display |
| `capture-toast`   | `main/screenshots/capture-toast-window.ts`    | the screenshot preview card           |
| `recording-ready` | `main/recording/recording-ready-window.ts`    | the "your video is ready" card        |
| `recording-shade` | `main/recording/recording-shade-window.ts`    | the countdown shade                   |
| `control-bar`     | `main/recording/control-bar-window.ts`        | the recording control bar             |
| `camera-bubble`   | `main/recording/camera-bubble-window.ts`      | the camera bubble                     |

The dev-only cursor diagnostic window is captured like any other when it is open. Rather than
each module registering itself, the capture walks `BrowserWindow.getAllWindows()` and names each
one from a small kind registry the modules fill when they create their window; an unnamed
window is still captured, as `window-<id>`.

### Route and UI-map areas

For each captured window, main runs `webContents.executeJavaScript` to read `location.hash` and
the visible elements carrying the UI-map area attribute (`uiArea()`, see the
[UI map ADR](/architecture/decisions/0046-a-typed-ui-map-declares-every-screen-area-and-state/)).
This needs no new IPC channel; a window that does not answer within 1 s gets `"route": null`.

### The composite

1. Union of the bounds of the captured windows, in points.
2. Canvas size = union × the largest `scaleFactor` among their displays.
3. Each window's `capturePage()` bitmap (`toBitmap()`, BGRA) is resized to its bounds × that
   factor and alpha-blended at its offset, back to front. Electron exposes no z-order, so the
   order is an approximation in two groups: normal windows first, then always-on-top windows;
   inside each group the focused window, if any, goes last.
4. Background is a neutral dark grey, so transparent corners stay visible as such.
5. `nativeImage.createFromBitmap` → PNG.

Windows on two displays far apart give a large, mostly empty canvas. Acceptable for a debug tool.

### Prior art in the repo

- `main/diagnostics/cursor-capture.ts` — a dev-only diagnostic surface behind a launch flag.
- `ui-catalog/` and `verify/` — screenshots of prepared states of the real app. Debug capture
  is the opposite: whatever state the app is in right now.
- `marketing/product-direction.md`, "Bug Report mode" — a user-facing product idea; this tool
  could feed it later.
