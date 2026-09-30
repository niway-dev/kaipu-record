---
title: "Bug — the main window is ordered out by macOS whenever the app loses focus"
description: "Reported as 'the app disappears when I switch the camera on'. Instrumented: the camera is not the cause. The main window emits hide right after every blur, from native code, and comes back on the next activation. Hypotheses ranked and the next experiment written down."
---

# The main window disappears when the app loses focus

> **Status: 🔵 Proposed — diagnosed, not fixed** (2026-09-30). Owner report: "cuando
> activo la camara mi app desaparece cosa que no tiene sentido porque desaparecería?"
> The camera turned out to be the trigger that made it visible, not the cause.

## Symptom

Switching **Camera ON** on the Record page makes the Kaipu window vanish. The app is
still running — it comes back when brought forward again (Dock, ⌘-Tab, or the `⌘⌃O`
rescue shortcut). It is disorienting: the user pressed a toggle inside the app and the
app left.

## What was measured

Three listeners were added temporarily to the main window in `main/index.ts`
(`hide` with a stack trace, `blur`, `show`), plus logs around `cameraBubble.show()` and
`applyDockPolicy()` in `recording/recording-hub.ts`. One session, owner's machine,
`bun run dev`:

```
[diag] main window show
[diag] main window blur — visible: true
[diag] main window hide
 Error: hide
    at BrowserWindow.<anonymous> (.../out/main/index.js:7882:46)
    at BrowserWindow.emit (node:events:531:35)
[diag] main window show
[diag] camera on: before bubble.show, main visible: true
[diag] camera on: after bubble.show, main visible: true
[diag] camera on: after applyDockPolicy, main visible: true
[diag] main window blur — visible: true
[diag] main window hide
 ...same stack...
[diag] main window show
[diag] main window blur — visible: true
[diag] main window hide
 ...same stack...
```

Three findings, all of them narrowing the search:

1. **The camera is not the cause.** The first `blur → hide → show` cycle happens before
   the camera is ever touched, and the window is still visible immediately after both
   `cameraBubble.show()` and `applyDockPolicy()` return. The bubble merely steals focus,
   which is what makes an already-existing bug happen at a moment the user notices.
2. **No JavaScript calls `hide()`.** The stack ends at `BrowserWindow.emit` with no
   frame above it, so the event was emitted from native code, not from a synchronous
   `win.hide()` in our main process. A repo-wide search confirms it: nothing registers a
   hide-on-blur on the main window (`capture-panel-window.ts:90` does, but that is the
   capture panel, a different window).
3. **The pattern is always `blur → hide`, then `show` on the next activation.** macOS is
   ordering the app's windows out on deactivation and back in on activation — the
   behaviour of an app whose windows are not meant to stay on screen while another app
   is frontmost.

## Hypotheses, most likely first

1. **Activation-policy churn.** `applyDockPolicy()` calls
   `app.setActivationPolicy(...)` plus `app.dock.show()` on every invocation, including
   when the policy is already the one being set. On macOS an activation-policy
   transition makes AppKit rebuild the app's window list, which orders windows out and
   back in — exactly the observed `hide` / `show` pair. `applyDockPolicy()` is called
   from `applySideEffects()` on every settings change, from `bringAppToFront()`, from
   the recording hub's camera branch and from the recording stop path. The same session
   logged `Unable to set login item: Operation not permitted`, which comes from
   `applySideEffects()` — so that function does run during normal use.
2. **`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`** on the camera
   bubble and the control bar. This one cannot explain the cycle that happened before
   the camera was switched on, so it is secondary — but it may compound the effect when
   the frontmost app is in a full-screen Space.
3. **A dev-only artefact of `electron-vite`.** Not yet ruled out; the session was
   `bun run dev`. Worth one run of a packaged build before spending effort on 1.

## Next experiment

Log every policy change with its caller, then reproduce for ~30 seconds of ordinary
window switching:

```ts
// main/infrastructure/settings-store.ts
export function applyDockPolicy(): void {
  if (process.platform !== "darwin") return;
  console.log("[diag] applyDockPolicy", settings.showInDock, new Error().stack);
  app.setActivationPolicy(settings.showInDock ? "regular" : "accessory");
  if (settings.showInDock) app.dock?.show();
}
```

If a policy call lands right before each `blur → hide`, hypothesis 1 is confirmed and
the fix is small: remember the last applied policy in the module and return early when
it has not changed, so `setActivationPolicy` and `dock.show()` run only on an actual
transition. If no policy call precedes the cycles, drop to hypothesis 3 and re-test on
a packaged build (`bun run build:unpack`).

## Why it matters

The `⌘⌃O` "show app" rescue shortcut exists precisely because the app can get lost.
That shortcut is a workaround for this class of problem; fixing the cause is what makes
it unnecessary in normal use.

## Related

- [Dock and app switcher — one toggle, by necessity](./dock-and-app-switcher) — why
  `showInDock` maps to the activation policy at all.
