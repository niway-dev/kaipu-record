---
title: Flow testability map
description: Every kaipu-record user flow, how it works, and how testable it is end-to-end — the map that guides where to grow the Playwright + Electron harness next.
---

# Flow testability map

This section documents each **user flow** in `kaipu-record` and — grounded in the real code
— how far it can be tested **end-to-end**. It exists to guide where to grow the E2E harness
next, and to be honest about what a headless test genuinely _cannot_ cover.

For the sharper, priority-driven view — which flows are _existential_ and how much of each we
can actually guarantee — see [Vital flows — what to secure and how](/testing/vital-flows).

The harness itself (Playwright + Electron, isolated vault) is described in
[PR checks — validation & E2E](/deployment/pr-checks); its rationale is in the
[E2E design spec](/specs/2026-07-06-e2e-testing-harness-design).

## The one axis that decides everything: renderer vs native

A flow is testable headless to the exact degree that it lives in the **renderer** and reads
**seeded state**. The moment it needs a **native macOS capability** — screen/mic/camera
capture, OS permission prompts, native file dialogs, global (OS-level) shortcuts, the tray, or
the WebCodecs **H.264 encoder** — it leaves what a headless CI runner can drive. Those parts
are tested by **mocking at the main-process IPC boundary**, or manually on macOS.

So the useful question is never "is this flow testable?" but **"where is the deterministic
boundary, and what's native beyond it?"**

## Testability matrix

| Flow                                              | Route                      | Verdict                   | Headless-testable part                                   | Native / manual part                                                  |
| ------------------------------------------------- | -------------------------- | ------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| [Library](/testing/library)                       | `/library`, `/library/:id` | 🟢 Fully                  | browse, open, playback, rename, delete                   | _Reveal in Finder_, screenshot _Copy_ (assert IPC)                    |
| [Edit screenshot](/testing/screenshot-editor)     | `/screenshot-editor`       | 🟢 Fully                  | load, edit, export (canvas → PNG)                        | pixel fidelity (unit + manual)                                        |
| [Settings](/testing/settings)                     | `/settings`                | 🟡 Partial                | quality, toggles, vault reset (persist via IPC)          | _Browse_ folder picker, permission _Request_, Dock/login side effects |
| [Shortcuts](/testing/shortcuts)                   | `/shortcuts`               | 🟡 Partial                | edit / validate / persist accelerators                   | actual **global** accelerator firing (OS-level)                       |
| [Screenshot capture](/testing/screenshot-capture) | `/screenshots`             | 🟡 Partial                | page UI + post-capture handling (stub the capture IPC)   | the capture itself — macOS `screencapture` CLI                        |
| [Recording](/testing/recording)                   | `/` (index)                | 🔴 Full flow / 🟡 options | options UI + IPC dispatch (with stubbed sources/devices) | live screen/mic/camera capture, permissions, floating control bar     |

Legend: 🟢 fully E2E-able headless · 🟡 partial (a slice is testable, often needing an IPC
stub) · 🔴 the core of the flow is native and not headless-testable.

## What each flow taught us

- **Library and the screenshot editor are the two clean wins** — pure renderer + local vault,
  no codec, no native dialog. The editor exports via `<canvas>.toBlob("image/png")` (no
  WebCodecs), so unlike the video export it runs fine headless.
- **Settings and Shortcuts are testable at the _page_ level** — editing and persistence go
  through real IPC to `settings.json`, no stubs needed. What's out of reach is the _effect_:
  the native folder picker, permission prompts, and OS-level global-shortcut firing.
- **Recording is the deep end.** The lifecycle is a main-process/module singleton driven
  entirely by native capture (`desktopCapturer`, `getUserMedia`, `systemPreferences`, plus the
  control-bar and camera-bubble windows). Only the options UI is reachable, and only with the
  source/device IPC stubbed.
- **Screenshot capture is native in a way we didn't expect** — it shells out to the macOS
  `screencapture -i -o` CLI (darwin-guarded), not `desktopCapturer`. The capture is manual;
  everything after it (save to vault, appears in library, opens in the editor) is testable.

## Harness enhancements these docs surfaced

To implement the 🟢/🟡 tests, the shared harness (`e2e/helpers/launch.ts`) needs a few
additions — do these once, reuse everywhere:

1. **Return `userDataDir` from `launchApp()`.** `settings.json` lives in userData, not the
   vault, so settings/shortcuts on-disk assertions need it (or assert via a
   `window.electronAPI.getSettings()` round-trip).
2. **Seed screenshots, not just video.** `seedVault` currently drops only an `.mp4`; add a
   helper to seed a `.png` + sidecar (`kind: "screenshot"`) for the library-copy, capture, and
   editor tests.
3. **A main-process IPC-stub pattern.** For native handlers (screen sources, screenshot
   capture, `shell.showItemInFolder`), re-register the handler from the test via
   `app.evaluate(({ ipcMain }) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, …) })` to
   return a fixture — the seam that unlocks the 🟡 slices.

## Suggested rollout order

1. ✅ **Screenshot editor (🟢) — done.** Implemented in `e2e/screenshot-editor.e2e.ts`: seeds a
   PNG, enters via the real _Edit_ button, saves a copy, and asserts a valid PNG lands in the
   vault. It also added the reusable harness bits (screenshot fixture + `seedVault` screenshot +
   `openScreenshotEditor`). This was the pattern-setter for the rest.
2. ✅ **Library additions (🟢) — done.** `e2e/library-actions.e2e.ts`: rename (assert the
   sidecar `title` changed), delete (assert the vault file is gone + navigated back to
   `/library`), and reveal (spy on `shell.showItemInFolder` in the main process via
   `app.evaluate` and assert the path).
3. ✅ **Settings + Shortcuts (🟡) — done.** `e2e/settings.e2e.ts` flips a native-free toggle
   (`showBarInRecording`) and `e2e/shortcuts.e2e.ts` rebinds a global accelerator; both assert
   persistence via a `window.electronAPI.getSettings()` round-trip (no `userDataDir` tweak
   needed after all — the IPC round-trip is the boundary). Only the native effects (folder
   picker, permission prompt, OS-level accelerator firing) stay manual.
4. **Screenshot capture + Recording options (🟡)** — require the IPC-stub pattern; more setup,
   still valuable for the post-capture and options paths.
5. **Live capture + global-shortcut firing (🔴)** — manual on macOS, or a future
   `macos-latest` CI job / OS-level input injection. Track as a known coverage gap, never a
   silent one.
