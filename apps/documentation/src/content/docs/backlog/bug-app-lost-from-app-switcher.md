---
title: "Bug — Kaipu disappears from the Dock and ⌘-Tab after recording or toggling the camera (macOS)"
description: "Reported as 'at some point I lose my icon in ⌘-Tab; the app works but it is gone; I have to toggle Show in Dock off and on'. Cause: the control bar and camera bubble let Electron hide the Dock icon to float over full-screen apps, and the activation-policy setter, trusting its cache, never restored it. Fixed by ADR 0029."
---

# Kaipu disappears from the Dock and ⌘-Tab after a recording or a camera toggle

> **Status: 🟢 Ready to validate** (fix 2026-10-24, reported 2026-10-24 on desktop 0.14.1).
> Owner report: "cuando hago captura, cuando hago copy en lugar de guardar, cuando hago
> grabación continuamente... en algún momento pierdo mi ícono en el command + tab. La app
> funciona pero se pierde. Tengo que ocultar y reactivar para que funcione."
> Decision record: [ADR 0029](/architecture/decisions/0029-floating-windows-never-change-the-activation-policy/).

## Symptom

After a recording, or after switching the camera on, Kaipu is no longer listed in ⌘-Tab and
has no Dock icon. The app keeps working. Toggling **Settings → App → Show in Dock & app
switcher** off and on brings it back; `⌘⌃O` (show app) does not.

Captures and "copy instead of save" do not cause it. They are where the owner noticed it,
because they move focus between apps right after a recording.

## Cause

Two things together — see the ADR for the full chain and the Electron source references.

1. `recording/control-bar-window.ts` and `recording/camera-bubble-window.ts` called
   `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` **without**
   `skipTransformProcessType`. Electron then runs `app.dock.hide()` to get a plain window
   over a full-screen app, which turns the process into a UI-element app: no Dock icon, no
   ⌘-Tab. The bar is created once per session (first recording); the bubble is destroyed and
   recreated on every camera toggle.
2. Since the 2026-10-07 fix for [the main window hiding on blur](./bug-main-window-hides-on-blur),
   the activation-policy setter in `infrastructure/settings-store.ts` skips any call whose
   policy matches its own cache. The cache said "regular" the whole time, so `forceRegularPolicy()`
   at recording start, `applyDockPolicy()` at stop, after the camera toggle and from `⌘⌃O` were
   all no-ops. Before that fix the same calls happened to mask the bug: `app.dock.show()` ran
   less than a second before the bar was created, and Electron ignores a `DockHide` that soon
   after a `DockShow`.

The blur bug's page had listed `setVisibleOnAllWorkspaces` as its hypothesis 2, "secondary".
It was the other half.

## Fix

- Both recording panels are `type: "panel"` on macOS and pass `skipTransformProcessType: true`,
  the recipe the capture panel, overlays and toast already use.
- The setter treats a call as unchanged only when its cache **and** `app.dock.isVisible()`
  agree; a Dock dropped behind its back is restored at the next re-assertion (stop, camera
  toggle, settings change, `⌘⌃O`), and a re-assertion that matches reality still touches no
  AppKit state.

Regression tests: `recording/floating-window-policy.test.ts` (window type and workspace
options for both panels, and the new tests fail on the previous sources),
`infrastructure/settings-store.test.ts` (an externally hidden Dock is restored, then idempotent
again) and `recording/recording-hub.test.ts` (stop restores the Dock the bar dropped; camera on
restores the Dock the bubble dropped without hiding the main window).

## To validate (owner, packaged build)

1. Launch, record once, stop. Kaipu is still in ⌘-Tab and the Dock. Repeat with the camera on
   and off a few times during the session.
2. Put another app in full screen, start a recording of that screen: the control bar and the
   camera bubble appear over it, can be dragged, and the bar's buttons respond. Clicking them
   should not pull Kaipu's main window forward.
3. With **Show in Dock & app switcher** off: record and stop; the app stays menu-bar only
   during and after (the preference is respected, nothing forces it back).
4. `⌘⌃O` brings the main window forward in every state above.

If step 2 fails (panels not over the full-screen app), the ADR's first reopen condition is
met; do not fix it by removing `skipTransformProcessType`.

## Related

- [ADR 0029](/architecture/decisions/0029-floating-windows-never-change-the-activation-policy/)
- [The main window disappears when it loses focus](./bug-main-window-hides-on-blur) — the
  fix whose cache made this one permanent.
- [Dock and app switcher — one toggle, by necessity](./dock-and-app-switcher)
