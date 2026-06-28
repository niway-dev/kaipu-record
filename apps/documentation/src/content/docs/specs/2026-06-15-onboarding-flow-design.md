---
title: "Onboarding Flow — Design"
description: "First-run onboarding that introduces Kaipu Recorder and requests the macOS permissions it needs, replayable from Settings."
---

Date: 2026-06-15
App: `apps/kaipu-record`

## Goal

A first-run onboarding experience that introduces what Kaipu Recorder does and
requests the macOS permissions it needs. Shown automatically the first time the
app is used, and replayable on demand from Settings.

## Shape

A full-window overlay (takeover, covers the sidebar) with three steps:

1. **Welcome** — what the app does, with feature tiles (Screen / Voice / Audio / Camera).
2. **Grant permissions** — Screen Recording (required), Microphone (required),
   Camera (optional). Each row requests the real macOS permission.
3. **You're all set** — confirmation + the ⌘⇧P hint.

Footer chrome: Back, progress dots, primary CTA (`Get started` → `Continue` →
`Start recording`), and a `Skip setup` link on the first two steps. Keyboard
navigation: Enter advances, ← / → navigate, Esc skips.

## Decisions

- **Permissions: real macOS checks** via Electron `systemPreferences` +
  `desktopCapturer`, not mocked toggles.
- **First-run flag: renderer `localStorage`** (MVP, per the repo's "MVP first"
  rule). No settings-persistence rework in this pass.
- **Presentation: full-window overlay** mounted above the router, not a route.

## Architecture

### 1. Main process — real permissions

New `src/main/permissions.ts` exporting `registerPermissionHandlers()`,
mirroring the existing `recording-sources.ts` (same location, same `register*`
convention, same `ipcMain.handle` style). It wraps:

- `systemPreferences.getMediaAccessStatus(kind)` — check status of screen / mic / camera.
- `systemPreferences.askForMediaAccess("microphone" | "camera")` — request mic / camera.
- `desktopCapturer.getSources({ types: ["screen"], thumbnailSize: {width:1,height:1} })`
  — trigger the screen-recording prompt (macOS has no async screen request API),
  then re-check status.
- `shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_…")`
  — deep-link System Settings for a permission that is already **denied** (macOS
  will not re-prompt once denied).

Registered from `main/index.ts` alongside `registerRecordingSourceHandlers()`.

Errors are caught per call and resolved to `false` / no-op (matching the legacy
`PermissionsService` behaviour) so the renderer never throws on a permission call.

### 2. Shared IPC contract + preload

`shared/types/electron-api.ts`:

```ts
export type PermissionKind = "screen" | "microphone" | "camera";
export type PermissionStatus = Record<PermissionKind, boolean>;
```

Add to `KaipuElectronAPI`:

- `checkPermissions(): Promise<PermissionStatus>`
- `requestPermission(kind: PermissionKind): Promise<boolean>`
- `openSystemSettings(kind: PermissionKind): Promise<void>`

`shared/types/ipc.ts`: add the corresponding channel names to `IPC_CHANNELS`
(`checkPermissions`, `requestPermission`, `openSystemSettings`).

`preload/index.ts`: wire the three methods via `ipcRenderer.invoke`.

### 3. Renderer — onboarding feature (`features/onboarding/`)

Matches the app's CSS-modules + UI-primitive style (`Card`, `Button`, `Badge`,
etc.), not the inline-styled mockup.

- `onboarding-store.ts` — `hasCompletedOnboarding()`, `markOnboardingComplete()`,
  `resetOnboarding()` over `localStorage` key `kaipu.onboarding.completed`,
  wrapped in try/catch (localStorage may be unavailable in restricted contexts).
- `permissions.ts` — pure helper `requiredPermissionsMet(status)` →
  `status.screen && status.microphone`. Plus the `PermissionKind` step metadata
  (label, required flag, description, icon) for the permissions step.
- `use-permissions.ts` — hook holding live `PermissionStatus`, exposing `check()`
  and `request(kind)` that call `window.electronAPI`. Re-checks after each request.
- `onboarding-overlay.tsx` (+ `.module.css`) — overlay container owning the
  current step index, keyboard handling, and the chrome (titlebar with TRAY
  badge, footer with Back / dots / CTA / Skip). Continue on the permissions step
  is disabled until `requiredPermissionsMet` is true.
- Step components: `welcome-step.tsx`, `permissions-step.tsx`, `done-step.tsx`.
  The permissions step renders one row per permission with Grant / Granted /
  Open System Settings (when denied) affordances.

### 4. Mounting + replay trigger

An `OnboardingProvider` (in `features/onboarding/onboarding-provider.tsx`),
wrapped around the router in `app.tsx`. It:

- owns `isOpen` state;
- on first mount, opens automatically when `!hasCompletedOnboarding()`;
- exposes `openOnboarding()` through `OnboardingContext`;
- renders `<OnboardingOverlay>` above the router when open;
- on close (finish or skip), calls `markOnboardingComplete()` and closes.

Settings consumes `useOnboarding()` for its Replay button.

Rejected alternatives: a `/onboarding` route (overlay was chosen, and sidebar
suppression on a route is awkward); a global `window` event for replay (context
is cleaner and unit-testable).

### 5. Settings entry point

Add an **Onboarding** row (label "Onboarding", description "Replay the welcome &
permissions flow", `Replay` button) to the existing "App" section of
`settings-page.tsx`, calling `openOnboarding()` from the context.

## Testing

- `onboarding-store.test.ts` — flag get / set / reset, including the
  localStorage-unavailable path.
- `permissions.test.ts` — `requiredPermissionsMet` truth table.
- `onboarding-overlay.test.tsx` — step navigation, required-gating (Continue
  disabled until screen + mic granted), and Skip, with `window.electronAPI` mocked.

The main-process `permissions.ts` is thin Electron side-effecting wiring and is
left untested (consistent with `recording-sources.ts`), with the testable logic
extracted into the pure `requiredPermissionsMet` helper.

## Scope guard (YAGNI)

- No theme/appearance work.
- No settings-persistence rework — the onboarding flag stays in localStorage.
- "Open System Settings" fallback appears only when a permission is denied.
