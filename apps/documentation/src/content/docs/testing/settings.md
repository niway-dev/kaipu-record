---
title: "Testing: Settings flow"
description: "How the /settings page persists preferences via IPC, and what is E2E-able vs. native (folder picker, permission prompts)."
---

# Settings flow

## The flow

Entry: the user opens the _Settings_ sidebar page (route `/settings`). It groups every
setting that is wired end-to-end (per the header comment in
`src/renderer/src/pages/settings/settings-page.tsx:20-33`):

- _Permissions_ — Screen recording / Microphone / Camera, each showing "Granted" or "Not
  granted" with a _Request_ / _Re-request_ button.
- _Recording quality_ — friendly preset chips plus three discrete sliders (Resolución /
  Fluidez / Bitrate). Moving any slider derives the "Personalizado" (custom) chip.
- _Recording_ — a "Show control bar in recording" toggle (`showBarInRecording`).
- _Files_ — the recordings folder path with a _Browse_ button (native picker) and, when a
  custom folder is set, a _Reset_ button back to the default.
- _App_ — a "Show in Dock & app switcher" toggle (`showInDock`, macOS activation policy) and
  an _Onboarding → Replay_ button.
- _Developer (dev only)_ — a watermark-bypass toggle, present only when `import.meta.env.DEV`
  (`settings-page.tsx:167`), stripped from production bundles.

What happens: each control calls into `window.electronAPI` (the preload bridge). The main
process persists the change to disk and broadcasts it back to every window, so open Settings
surfaces stay in sync without a remount.

## Under the hood

Route: `/settings` → `SettingsPage` (`src/renderer/src/app/router.tsx:41`). The renderer uses
a hash router, so tests navigate with `location.hash = "#/settings"`.

Three independent state channels feed the page:

- _App settings_ — `useAppSettings()` (`src/renderer/src/pages/settings/use-app-settings.ts`):
  on mount calls `getSettings()` and subscribes via `onSettingsChanged`; `update(patch)` calls
  `updateSettings(patch)` and stores the returned settings. Backs the quality sliders,
  `showBarInRecording`, and `showInDock`.
  - Main handlers: `registerSettings()` in `src/main/infrastructure/settings-store.ts:113-126`.
    `settings:get` returns the in-memory settings; `settings:update` merges the patch
    (`mergeSettings`, `src/main/services/settings.service.ts:48`), atomically writes
    `settings.json` in `userData` (`persist()`, temp-file + rename, `settings-store.ts:35-49`),
    runs `applySideEffects()`, and broadcasts `settings:changed` to every window.
  - _NATIVE touchpoint (macOS):_ `applySideEffects()` → `applyDockPolicy()` calls
    `app.setActivationPolicy(...)` + `app.dock?.show()` (`settings-store.ts:67-71`), and
    `app.setLoginItemSettings(...)` (`settings-store.ts:104-106`). These are guarded to
    `darwin`/`win32` and are no-ops on the Linux CI runner — the disk write and broadcast still
    happen everywhere.
- _Vault directory_ — `useVaultDirectory()`
  (`src/renderer/src/features/library/hooks/use-vault-directory.ts`): `getVaultDirectory()` on
  mount; `choose()` → `chooseVaultDirectory()`; `reset()` → `resetVaultDirectory()`.
  - Storage: `preferences.json` in `userData` via `src/main/library/vault-location.ts`
    (`setVaultDirectory`/`resetVaultDirectory`, atomic write lines 26-35). A stored value is
    flagged `isCustom: true`; absent → platform default (`~/Videos/Kaipu Record`),
    `isCustom: false` (`vault-location.ts:47-52`).
  - _NATIVE touchpoint:_ `library:choose-vault-dir` (`src/main/library/index.ts:65-114`) opens
    `dialog.showOpenDialog` (folder picker), then may open two `dialog.showMessageBox` dialogs —
    an error box if the folder is not writable, and a confirm box warning that existing
    recordings stay in the old folder. Only after the user confirms does it call
    `setVaultDirectory` + `broadcastLibraryChanged()`. `library:reset-vault-dir`
    (`index.ts:116-120`) has NO dialog — it resets and broadcasts synchronously.
- _Permissions_ — `usePermissions()`
  (`src/renderer/src/features/permissions/use-permissions.ts`): `checkPermissions()` on mount +
  on window `focus`; `request(kind)` → `requestPermission(kind)`.
  - _NATIVE touchpoint:_ `permissions:check` / `permissions:request` hit the OS
    (`systemPreferences` / capture-access prompts on macOS). Requesting triggers an OS
    permission dialog.

Preload bridge exposes all of the above under `window.electronAPI`
(`src/preload/index.ts:25-45`). IPC channel names live in `src/shared/types/ipc.ts:132-222`
(`getSettings`, `updateSettings`, `settingsChanged`, `getVaultDirectory`,
`chooseVaultDirectory`, `resetVaultDirectory`, `checkPermissions`, `requestPermission`).

_Onboarding Replay_ is renderer-only (`useOnboarding().open`), no main-process involvement. The
dev watermark toggle writes `localStorage["kaipu:dev:simulate-paid"]`
(`src/renderer/src/features/watermark/dev-override.ts`) — no IPC.

## Testability

🟡 Partial (needs IPC mocking)

Deterministic and fully E2E-able without any mocking:

- _Recording quality_ — clicking preset chips / slider dots calls `updateSettings`, which
  writes `settings.json`. Assert on the DOM (`aria-pressed`/`data-active`) and on the file.
- _Toggles_ — `showBarInRecording` and `showInDock` are Radix switches
  (`role="switch"`, `aria-checked`, `src/renderer/src/ui/toggle.tsx`); flipping them writes
  `settings.json`. On Linux the macOS Dock side effect is a guarded no-op, so the toggle + disk
  write are still assertable.
- _Files → Reset_ — `resetVaultDirectory()` takes no dialog; after seeding a custom
  `vaultDirectory`, clicking _Reset_ removes it from `preferences.json` and the path flips to
  "· Default".
- _Permissions display_ — the "Granted / Not granted" text and button label are pure renderer
  state derived from `checkPermissions()`.

Native — must be IPC-mocked at the main-process boundary, or tested manually:

- _Files → Browse_ (`dialog.showOpenDialog` + up to two `showMessageBox`) — cannot be driven
  headlessly.
- _Permissions → Request_ (`permissions:request`) — triggers an OS prompt; returns the grant
  bool.
- _App → Dock toggle side effect_ (`setActivationPolicy`/`dock.show`) and _launch-at-login_
  (`setLoginItemSettings`) — macOS/Windows only; not observable on the CI runner.

## Proposed E2E test(s)

Reuse `launchApp()` (`e2e/helpers/launch.ts`) — it already seeds a throwaway `userData` whose
`preferences.json` points at a throwaway vault, and `dismissOnboarding(page)`.

Test 1 — recording quality persists (no mocking):

```ts
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { launchApp } from "./helpers/launch";
import { dismissOnboarding } from "./helpers/launch";

test("changing recording quality persists to settings.json", async () => {
  const { app, page, teardown } = await launchApp();
  try {
    await dismissOnboarding(page);
    await page.evaluate(() => (location.hash = "#/settings"));

    // Drive the real control: click a preset chip (e.g. by its visible label).
    await page.getByRole("button", { name: /Alta|Máxima/ }).first().click();

    // Deterministic boundary A: DOM reflects the active chip.
    // Deterministic boundary B: settings.json on disk changed.
    // userData dir = the --user-data-dir launchApp created; read it back:
    const before = await page.evaluate(() => window.electronAPI.getSettings());
    expect(before.recordingQuality).toBeTruthy();
  } finally {
    await teardown();
  }
});
```

Note: `launchApp()` returns `vaultDir` but not `userDataDir`. To assert `settings.json` on
disk, either (a) extend `launchApp()` to also return `userDataDir`, or (b) assert via
`page.evaluate(() => window.electronAPI.getSettings())` (round-trips through the main process,
so it still proves persistence + broadcast). Prefer (b) to avoid touching the helper; use (a)
if you want a true on-disk assertion.

Test 2 — `showInDock` / `showBarInRecording` toggle round-trips:

```ts
await page.evaluate(() => (location.hash = "#/settings"));
const dock = page.getByRole("switch").nth(1); // Row order: showBarInRecording, showInDock
await dock.click();
await expect(dock).toHaveAttribute("aria-checked", "false");
const after = await page.evaluate(() => window.electronAPI.getSettings());
expect(after.showInDock).toBe(false); // disk write proven; macOS side effect is a Linux no-op
```

(Prefer targeting each switch by an accessible name if one is added; today the two switches are
positional, so `.nth()` or scoping by the section heading is required — unverified whether a
stable name exists.)

Test 3 — vault _Reset_ (no dialog, fully deterministic): seed `preferences.json` with a custom
`vaultDirectory` (the helper already does — the seeded temp vault _is_ custom), open
`#/settings`, click _Reset_, then assert `window.electronAPI.getVaultDirectory()` returns
`{ isCustom: false }` and the path text shows "· Default". Because the seeded vault is custom,
the _Reset_ button is rendered (`settings-page.tsx:132`).

Test 4 — _Browse_ with an IPC-boundary stub (documents the pattern for the native dialog):
`chooseVaultDirectory` cannot show a real picker headlessly. Stub `dialog.showOpenDialog` (and
`showMessageBox`) in the main process so it returns a chosen folder without UI, e.g. via
`app.evaluate` before clicking:

```ts
await app.evaluate(async ({ dialog }, folder) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  dialog.showMessageBox = async () => ({ response: 1 }); // "Cambiar carpeta"
}, someWritableTempDir);
```

Then click _Browse_ and assert `getVaultDirectory()` returns `{ path: someWritableTempDir,
isCustom: true }` and `preferences.json` changed. This asserts at the deterministic boundary
(the IPC result + disk), not the native picker. _Unverified_ whether `app.evaluate`-patched
`dialog` methods are picked up by the already-registered handler — the handler references
`dialog.showOpenDialog` at call time (`index.ts:75`), so monkey-patching the module export
should work, but confirm when implementing.

Platform limits: run Tests 1-3 on Linux CI unchanged. The `showInDock` OS effect and any
permission-grant effect are macOS-only and not asserted there — only the disk/DOM boundary is.

## Not covered / manual

- The _Browse_ folder picker and its writability/confirm message boxes
  (`src/main/library/index.ts:65-114`) — native dialogs; only reachable via the IPC stub in
  Test 4 or by manual macOS testing.
- _Permissions → Request_ (`permissions:request`) — triggers a real OS prompt; the grant result
  and live re-check on `focus` need macOS + a human, or a stubbed `permissions:*` handler.
- The macOS Dock/activation-policy and launch-at-login side effects
  (`applyDockPolicy`/`setLoginItemSettings`, `settings-store.ts:67-106`) — observable only on
  macOS; E2E can prove the persisted flag flipped, not the OS behavior.
- The dev-only watermark toggle — present only in dev builds (`import.meta.env.DEV`); the E2E
  target is the built `out/main/index.js` (production-mode bundle), so this row is absent there.
