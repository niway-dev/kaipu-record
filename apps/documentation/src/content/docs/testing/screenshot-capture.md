---
title: "Testing: Screenshot capture flow"
description: "How a screenshot is captured via the native macOS screencapture CLI, and why only the page UI plus post-capture handling are headless-testable."
---

# Screenshot capture flow

## The flow

The Screenshots page is the `#/screenshots` route (`ScreenshotsPage`). The capture
journey:

- The user clicks **Capturar pantalla** on the capture card, or fires the global
  shortcut **⌃⌘X** (`captureScreenshot`) from anywhere.
- The app window hides, and the native macOS region-select overlay (crosshair)
  appears. The user drags a region — or presses Esc to cancel.
- On a successful drag, the app reappears **already on the screenshot editor**
  (`#/screenshot-editor`) with the captured PNG loaded as an in-memory blob source,
  ready to annotate.
- The user annotates and saves; the shot lands in the unified vault as `<id>.png`
  (plus a `.kaipu/<id>.json` sidecar) and then shows up in the **Recientes** strip
  under the capture card and in the library.

On cancel (Esc), nothing is captured and the window is restored to its prior
visibility — no editor, no navigation.

## Under the hood

**Page components.**

- `src/renderer/src/pages/screenshots/screenshots-page.tsx:20` — the **Capturar
  pantalla** button calls `capture()` from `useScreenshotCapture`.
- `src/renderer/src/features/screenshots/use-screenshot-capture.ts` — orchestrates
  the renderer side: it first _guards against an in-progress recording_
  (`getRecorderSnapshot().status !== "idle"` → toast + abort, line 14), then calls
  `window.electronAPI.captureScreenshot()` (line 18). On a non-null result it builds
  a `blob` `ImageSource`, `navigate("/screenshot-editor", { state: source })`, then
  `window.electronAPI.revealAfterCapture()` (lines 23-33). Note the order: navigate
  first (synchronous in the hash router), _then_ reveal, so the app reappears on the
  editor rather than the previous page.
- `src/renderer/src/features/screenshots/recent-screenshots.tsx` +
  `use-recent-screenshots.ts` — the **Recientes** strip. It reuses
  `listLocalRecordings()` and filters `kind === "screenshot"`, re-reading on window
  `focus` so a just-saved shot appears on return. Hidden when empty.

**The capture IPC + main-process mechanism.**

- Preload bridge (`src/preload/index.ts:106-116`): `captureScreenshot` →
  `ipcRenderer.invoke("screenshot:capture")`; `revealAfterCapture` →
  `ipcRenderer.send("screenshot:reveal")`; plus a `screenshot:hotkey` listener for
  the ⌃⌘X path.
- Main handler (`src/main/screenshots/screenshot-ipc.ts:35-55`): the
  `screenshot:capture` handler is **darwin-only and re-entrancy-guarded** — it
  returns `null` immediately if `process.platform !== "darwin"` or a capture is
  already in flight (line 36). Otherwise it runs `windows.beforeCapture()` (hides
  the main window, capture panel, and camera bubble — `src/main/index.ts:238-246`),
  awaits `provider.captureInteractive()`, and on success returns
  `{ png: ArrayBuffer, width, height }` where the size comes from
  `nativeImage.createFromBuffer(png).getSize()`.

**Every NATIVE touchpoint.**

- **`screencapture -i -o` CLI (the actual capture).**
  `src/main/screenshots/screenshot-capture.ts:44` — `MacNativeProvider` shells out
  via `execFile("screencapture", ["-i", "-o", target])` to a temp PNG. This is the
  macOS system binary that draws the interactive crosshair region selector. **It is
  _not_ `desktopCapturer` and _not_ `getDisplayMedia`.** Cancel is detected by the
  temp file _not existing_ after the overlay closes (line 45 → returns `null`).
- **Screen Recording permission (macOS).** `screencapture` requires the OS Screen
  Recording grant; without it macOS silently blocks or degrades the capture (there
  is no prompt API for screen recording — see `permissions.ts:13`). Note the
  screenshot path itself does _not_ call the permission APIs; the permission check
  in `src/main/permissions.ts` (which _does_ use `desktopCapturer.getSources`, line 87) belongs to the _recording_ flow, not this one. _Unverified_ whether a missing
  grant makes `screencapture` fail or produce an empty region on this macOS version.
- **`nativeImage` / `clipboard`** (`screenshot-ipc.ts:47,60,65`) — sizing the PNG
  and the copy-to-clipboard channels (`screenshot:copy`, `screenshot:copy-by-id`).
- **Global shortcut** ⌃⌘X → `sendToRenderer("screenshot:hotkey")`
  (`src/main/index.ts:230`), which drives the same renderer `capture()` flow.

**Post-capture save to vault.** Not part of the capture handler — it happens from
the editor. `src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:157`
calls `saveScreenshot(png, meta)` → `screenshot:save`
(`screenshot-ipc.ts:73-92`) → `vault.writeImage(id, …)` writes `<id>.png` in the
vault root (`src/main/library/library-vault.ts:122`) plus a title/`createdAt`
sidecar, and `describe(id)` returns the `LocalRecording`.

## Testability

**🟡 Partial (needs IPC mocking).** Split honestly:

- **The capture itself — 🔴 not headless-testable.** It is native
  `screencapture -i -o`, an interactive crosshair overlay that requires a real
  display and the macOS Screen Recording grant. Worse for CI: the handler is
  **darwin-guarded**, so on the Linux CI runner (`xvfb`, `--no-sandbox`)
  `screenshot:capture` returns `null` before any capture is even attempted. There is
  no way to exercise the real overlay in an automated run.
- **The page UI + post-capture handling — 🟡 / 🟢.** Everything _after_ capture
  returns bytes is deterministic and driveable:
  - The **Recientes** strip is pure listing (`listLocalRecordings` filtered to
    `kind === "screenshot"`). Seed the vault with a `<id>.png` + sidecar and it is
    **🟢 fully E2E-able** with no capture at all.
  - The **navigate-to-editor + reveal + save-to-vault** chain is 🟡 — testable only
    if `screenshot:capture` is stubbed at the main boundary to return a fixture PNG
    (see below).

So, answering _"en caso que se pueda"_: yes, the meaningful post-capture behavior
_can_ be tested, but only by mocking the native IPC. The crosshair capture and its
permission are inherently manual on macOS.

## Proposed E2E test(s)

**Test A — Recientes strip (🟢, no mock).** Extend the launch helper's `seedVault`
to also drop a screenshot: `<id>.png` in the vault root plus
`.kaipu/<id>.json` with `{ title, createdAt }` (the vault classifies any `.png` as
`kind: "screenshot"` — `library-vault.ts:80-84`). Then `location.hash =
"#/screenshots"`, dismiss onboarding, and assert the **Recientes** card renders with
the seeded title. This proves the page's read/list path end-to-end with zero native
dependency.

**Test B — post-capture chain (🟡, IPC-boundary mock).** Stub the native capture in
the **main process** so `screenshot:capture` resolves a fixture PNG instead of
running `screencapture`. The provider is created at module load
(`const provider = createScreenshotProvider()`), so the clean seam is to _re-register
the handler_ from the test via `app.evaluate` (main-process context):

```ts
// In the test, after launchApp():
await app.evaluate(({ ipcMain }, pngBytes) => {
  ipcMain.removeHandler("screenshot:capture"); // drop the real darwin-guarded one
  ipcMain.handle("screenshot:capture", () => ({
    png: pngBytes,           // ArrayBuffer of a fixture PNG
    width: 320,
    height: 200,
  }));
}, fixtureArrayBuffer);
```

`ipcMain.handle` throws if a channel is already registered, so the `removeHandler`
first is required. Then drive the renderer: navigate to `#/screenshots`, click
**Capturar pantalla**, and assert the deterministic boundary:

1. **Navigation:** `location.hash` becomes `#/screenshot-editor` and the editor
   canvas mounts at the fixture's 320×200 dimensions.
2. **Save-to-vault:** trigger the editor's save, then assert with `node:fs` that a
   `<id>.png` file now exists in the test's `vaultDir` (the launch helper already
   exposes `vaultDir`).
3. **Library appearance:** return to `#/screenshots`, fire a window `focus`, and
   assert the saved shot shows in **Recientes**.

Assert on IPC-invoked / file-written / hash-navigated — never on pixels from a real
capture. Add a small fixture PNG under `e2e/fixtures/` (e.g. `sample-shot.png`).

## Not covered / manual

- **Real screen capture** via `screencapture -i -o` — the crosshair region overlay
  needs a real display and cannot run headless; the handler short-circuits to `null`
  off macOS anyway. Verify manually on macOS: click **Capturar pantalla**, drag a
  region, confirm the editor opens with the real pixels.
- **Screen Recording permission** — no prompt API; must be granted in System
  Settings and verified by a human. A denied grant degrading/blocking `screencapture`
  is _unverified_ and manual-only.
- **Global ⌃⌘X hotkey** — relies on `globalShortcut` registration and OS focus;
  exercise the renderer `capture()` flow directly (Test B) rather than the hotkey.
- **Copy-to-clipboard** (`screenshot:copy` / `screenshot:copy-by-id`) — touches the
  native `clipboard`; out of scope for the capture flow, manual if needed.
