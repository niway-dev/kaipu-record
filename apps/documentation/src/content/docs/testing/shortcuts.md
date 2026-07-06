---
title: "Testing: Shortcuts flow"
description: "How the /shortcuts page edits and persists global accelerators via IPC, and why the actual OS-level firing is not headless-testable."
---

# Shortcuts flow

## The flow

Entry: the user opens the _Shortcuts_ sidebar page (route `/shortcuts`, registered at
`src/renderer/src/app/router.tsx:40`). The page lists every global keyboard shortcut in two
sections, _Recording_ and _App_, one row per action
(`src/renderer/src/pages/shortcuts/shortcuts-page.tsx:32-38`, `116-133`).

Each row shows a click-to-rebind control. The four actions and their default accelerators
(`src/shared/types/ipc.ts:54-88`):

- _Start recording_ — `Command+Control+C` (⌃⌘C) — begin a recording from anywhere.
- _Stop recording_ — `Command+Control+S` (⌃⌘S) — end the current recording from anywhere.
- _Bring Kaipu to front_ — `Command+Control+O` (⌃⌘O) — show the window if it slips out of
  reach (the "rescue" backstop).
- _Capture screenshot_ — `Command+Control+X` (⌃⌘X) — open the region-selection overlay.

These are _global_ (system-wide) shortcuts: they fire even when another app is focused,
which is the whole point — the user is usually inside the app being recorded. To rebind
one, the user clicks the control (it reads "Press keys…"), presses a `Command`/`Control`
combo, and the new binding is captured, validated, persisted, and re-registered
system-wide. Escape cancels. A binding that clashes with another Kaipu action is rejected
inline; a binding another _app_ already owns is flagged "in use by another app".

## Under the hood

**Page + capture control.** `ShortcutsPage` reads bindings from
`useAppSettings()` (`settings.shortcuts`, falling back to `DEFAULT_SHORTCUTS`) and renders a
`ShortcutInput` per row (`shortcuts-page.tsx:45-114`). `ShortcutInput`
(`src/renderer/src/features/shortcuts/shortcut-input.tsx`) is a button that, while
"listening", attaches a capture-phase `keydown` listener on `window` (`shortcut-input.tsx:30-55`).
On listen start it calls `window.electronAPI.suspendShortcuts()` so the pressed combo reaches
the renderer instead of firing the action being rebound; on cleanup it calls
`resumeShortcuts()` to re-register.

**Pure accelerator logic.** `src/renderer/src/features/shortcuts/keyboard-accelerator.ts`
holds no Electron imports and is fully unit-testable (see
`keyboard-accelerator.test.ts`): `captureShortcut` turns a `KeyboardEvent` into an Electron
accelerator string (requires `Command` or `Control` + a letter/digit, else returns null);
`conflictingAction` detects a duplicate against the other bindings _before_ saving;
`formatAccelerator` renders the macOS-symbol label (⌃⌘C).

**Persistence path.** A captured accelerator flows `onChange` → `handleChange`
(`shortcuts-page.tsx:69-79`): it rejects a `conflictingAction` clash, otherwise calls
`update({ shortcuts: { ...shortcuts, [action]: accelerator } })`. `useAppSettings.update`
(`src/renderer/src/pages/settings/use-app-settings.ts:21-23`) invokes
`window.electronAPI.updateSettings(patch)`. The main-process handler
(`src/main/infrastructure/settings-store.ts:117-118`) writes the merged settings to
`app.getPath("userData")/settings.json` (`settings-store.ts:18`, `44`) and broadcasts
`settingsChanged` to every window (`settings-store.ts:89`).

**IPC channels** (`src/shared/types/ipc.ts`, `src/preload/index.ts:87-89`,
`src/shared/types/electron-api.ts:140-144`):

- `getSettings` / `updateSettings` / `settingsChanged` — read, write, broadcast.
- `shortcutsGetStatus` (`getShortcutStatus()`) — per-action registration result
  (`false` = malformed or owned by another app), queried by the page whenever bindings
  change (`shortcuts-page.tsx:55-60`).
- `shortcutsSuspend` / `shortcutsResume` — release/re-register during a rebind capture.

**Main-process registration.** `src/main/shortcuts/global-shortcuts.ts` is the only place
that touches Electron's `globalShortcut`. `applyGlobalShortcuts()` calls
`globalShortcut.unregisterAll()` then `globalShortcut.register(accelerator, handler)` for
each action, recording success/failure in `status` (`global-shortcuts.ts:39-46`).
`src/main/index.ts:344-353` wires the handlers (`triggerStartRecording`, a `recordingCommand`
"stop" send, `bringAppToFront`, `triggerCaptureScreenshot`) and re-applies on every
`onSettingsChanged`, so a rebind on the page re-registers system-wide. The suspend/resume
IPC (`index.ts:318-334`) also re-registers as a backstop if the suspending window is
destroyed mid-capture.

**Key point:** the accelerator only _fires_ at the OS level via `globalShortcut`. That
firing is delivered by the operating system to the main process — it is not a renderer DOM
event, so in-page keyboard input never triggers it.

## Testability

🟡 **Partial (page fully E2E-able; global firing not headless-testable).**

Two clearly distinct concerns:

- **The page — config, validation, persistence:** renderer-only, driven entirely through
  real IPC against a throwaway `userData`. Fully E2E-able with the existing harness. No
  mocking required.
- **The global accelerator actually firing** (`⌘⌃C` starting a recording while another app
  is focused): **not headless-testable.** Electron's `globalShortcut` is an OS-level hotkey;
  Playwright's `page.keyboard` / `page.evaluate` dispatch DOM events inside the renderer and
  never reach the OS hotkey layer. Triggering a real global accelerator needs OS-level input
  injection, which the harness does not do.
- **Main-process registration** can be observed indirectly via `shortcutsGetStatus`, but
  whether `globalShortcut.register` returns `true` under Linux `xvfb` in CI is _unverified_ —
  treat status assertions as best-effort, not a hard gate.

## Proposed E2E test(s)

Reuse `launchApp()` + `dismissOnboarding()` (`e2e/helpers/launch.ts`). The deterministic
boundary is the persisted settings, readable back through the real `getSettings` IPC (no
file access needed, no stub needed — the whole path is genuine).

```ts
import { test, expect } from "@playwright/test";
import { launchApp, dismissOnboarding } from "./helpers/launch";

test("rebinding a shortcut on /shortcuts persists the new accelerator", async () => {
  const { page, teardown } = await launchApp();
  try {
    await dismissOnboarding(page);
    await page.evaluate(() => {
      location.hash = "#/shortcuts";
    });

    // The first "Start recording" row still shows the default ⌃⌘C.
    const control = page.getByRole("button", { name: "Change shortcut" }).first();
    await expect(control).toHaveText("⌃⌘C");

    // Enter capture mode, then press a valid Control+<letter> combo. Control (not
    // Command) is the more reliable modifier to synthesize under Linux xvfb, and
    // captureShortcut accepts either. Control+D does not clash with any default.
    await control.click();
    await expect(control).toHaveText("Press keys…");
    await page.keyboard.press("Control+D");

    // UI reflects the new binding…
    await expect(control).toHaveText("⌃D");

    // …and it round-trips through the real updateSettings IPC to settings.json.
    const persisted = await page.evaluate(() => window.electronAPI.getSettings());
    expect(persisted.shortcuts.startRecording).toBe("Control+D");
  } finally {
    await teardown();
  }
});
```

Notes:

- **Why not fire the accelerator:** after this rebind, main re-registers `Control+D` via
  `applyGlobalShortcuts` (`onSettingsChanged`). We do _not_ then assert that pressing
  `Control+D` starts a recording — that is the OS hotkey path Playwright cannot reach. The
  test asserts the observable renderer/IPC outcome (the accelerator string persisted) plus
  the label update, which is what the page is responsible for.
- **Optional duplicate-rejection test:** rebind one action to another's existing combo and
  assert the row surfaces the "already bound to …" copy _and_ that `getSettings` still shows
  the old accelerator (the clash is rejected by `conflictingAction` before saving —
  `shortcuts-page.tsx:69-79`). Seed via `launchApp`'s settings if a pre-set state is needed.
- **Optional status assertion (best-effort):** `await page.evaluate(() =>
window.electronAPI.getShortcutStatus())` should report the actions; do not hard-assert
  `true` values (xvfb behavior of `globalShortcut.register` is unverified).
- **No IPC stub required.** `suspendShortcuts`/`resumeShortcuts` and `updateSettings` all run
  for real against the isolated `userData`; nothing native (dialog/permission/capture) is on
  this path. `launchApp` does not currently expose `userDataDir`, so read back via
  `getSettings` rather than the raw `settings.json` file (or extend the helper to return
  `userDataDir` if a file-level assertion is preferred).

## Not covered / manual

- **Actual global-accelerator firing** (`⌘⌃C` start, `⌘⌃S` stop, `⌘⌃O` show app, `⌘⌃X`
  capture) while another app is focused — verify manually on macOS, ideally in a packaged
  build, because Electron `globalShortcut` is an OS-level hotkey Playwright's in-page input
  cannot invoke.
- **"In use by another app" surfacing** — requires a second process owning the combo at the
  OS level; not reproducible headless. Manual.
- **The downstream handlers** the accelerators invoke (start/stop recording, screenshot
  region capture, tray/bring-to-front) involve native capture, permissions, and dialogs —
  see the recording/screenshot testing docs; not exercised from this page's tests.
