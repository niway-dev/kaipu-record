---
title: "36 · Screenshot toast window"
description: "Closes SHOT-B7: pressing the screenshot shortcut during a recording shows the 'finish the recording first' toast in the main window, which is hidden during a take."
---

# Screenshot toast window — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A capture requested during an active recording is refused with feedback the user can actually see.

**Architecture:** Main already knows the recording is active (`hub.isActive()`), and `triggerStartRecording` already handles the same situation with a macOS `Notification`. `triggerCaptureScreenshot` gets the same gate: a pure `routeCaptureRequest(deps)` in `main/screenshots/capture-request.ts` (testable; `main/index.ts` is not) that calls `notifyBusy()` when recording and `forwardToRenderer()` otherwise. The renderer's own guard stays as the fallback for the countdown phase (hub not yet active, window still visible). The control-bar "notice" alternative was rejected: new IPC + bar UI, and the bar can be included in the video.

**Tech Stack:** Electron `Notification`, `@kaipu/i18n/main` translator, vitest (pure test).

**Spec:** [Audit report](/audits/2026-10-15/report/) → SHOT-B7 in [screenshot lens B](/audits/2026-10-15/findings/screenshot-b/). Closes: **SHOT-B7**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- The refusal returns before `createWindow(false)`, so a closed window is not recreated just to refuse.
- Notifications need macOS permission; if denied, feedback is silent (same limitation as the existing already-recording notification). Repeated presses stack banners; no throttling.
- The `packages/i18n` parity test enforces identical key sets in `en`/`es`; add the new key to both.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Recording active → `notifyBusy` once, `forwardToRenderer` never — Task 1 test.
2. Recording inactive → `forwardToRenderer` once, `notifyBusy` never — Task 1 test.
3. The countdown phase (hub inactive, window visible) still reaches the renderer guard's toast — manual step.
4. ⌘⌃X during a take → macOS notification, no region selector, recording continues — manual step.

---

### Task 1: Pure router and the main wiring

**Files:**

- Create: `main/screenshots/capture-request.ts`, `main/screenshots/capture-request.test.ts`
- Modify: `main/index.ts:295-309` (`triggerCaptureScreenshot`), import near line 38
- Modify: `packages/i18n/messages/en.json`, `es.json` (`dialogs` namespace, after `alreadyRecordingBody`)

**Interfaces:**

- Produces: `routeCaptureRequest(deps: { isRecordingActive: () => boolean; notifyBusy: () => void; forwardToRenderer: () => void }): void`; i18n `dialogs.captureWhileRecordingTitle`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { routeCaptureRequest } from "./capture-request";

describe("routeCaptureRequest", () => {
  it("notifies and does not forward while a recording is active", () => {
    const notifyBusy = vi.fn();
    const forwardToRenderer = vi.fn();
    routeCaptureRequest({ isRecordingActive: () => true, notifyBusy, forwardToRenderer });
    expect(notifyBusy).toHaveBeenCalledTimes(1);
    expect(forwardToRenderer).not.toHaveBeenCalled();
  });
  it("forwards to the renderer when no recording is active", () => {
    const notifyBusy = vi.fn();
    const forwardToRenderer = vi.fn();
    routeCaptureRequest({ isRecordingActive: () => false, notifyBusy, forwardToRenderer });
    expect(forwardToRenderer).toHaveBeenCalledTimes(1);
    expect(notifyBusy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — module missing.

- [ ] **Step 3: Implement**

```ts
// main/screenshots/capture-request.ts
/**
 * What ⌘⌃X / the panel's "Capture Screen" does when asked to capture.
 *
 * During a recording the main window is hidden, so the renderer's own guard
 * ("finish the recording first") would toast into an invisible window. Main
 * knows the recording is active, so it refuses here and tells the user with a
 * system notification instead. Outside a recording it forwards the request to
 * the renderer, which keeps its own guard for the countdown phase (the hub is
 * not active yet, but the window is still visible).
 */
export interface CaptureRequestDeps {
  isRecordingActive: () => boolean;
  notifyBusy: () => void;
  forwardToRenderer: () => void;
}

export function routeCaptureRequest(deps: CaptureRequestDeps): void {
  if (deps.isRecordingActive()) {
    deps.notifyBusy();
    return;
  }
  deps.forwardToRenderer();
}
```

`main/index.ts` — `import { routeCaptureRequest } from "./screenshots/capture-request";` and (keep the doc comment, adding one sentence that a recording in progress is refused here):

```ts
function triggerCaptureScreenshot(): void {
  routeCaptureRequest({
    isRecordingActive: () => hub?.isActive() ?? false,
    notifyBusy: () => {
      // The main window is hidden during a take, so the renderer cannot show
      // its "finish the recording first" toast — use a system notification.
      if (!Notification.isSupported()) return;
      const t = createMainTranslator(getAppSettings().locale);
      new Notification({
        title: t("dialogs.captureWhileRecordingTitle"),
        body: t("screenshots.captureWhileRecording"),
      }).show();
    },
    forwardToRenderer: () => {
      // The capture flow runs in the renderer, so the window must exist. If it was
      // closed (macOS keeps the app alive in the tray), recreate it HIDDEN — never
      // show a hidden one: the capture handler hides the window anyway, and bringing
      // it forward here would put the app back in the shot. The renderer reveals it
      // after a successful capture.
      if (!mainWindow || mainWindow.isDestroyed()) createWindow(false);
      sendToRenderer(IPC_CHANNELS.screenshotHotkey);
    },
  });
}
```

i18n `dialogs` — en: `"captureWhileRecordingTitle": "Finish the recording first",`; es: `"captureWhileRecordingTitle": "Termina la grabación primero",`.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/screenshots/capture-request.test.ts && bun run check-types`, and from `packages/i18n` its local vitest on `src/__tests__/parity.test.ts` → PASS.

```bash
git add src/main/screenshots/capture-request.ts src/main/screenshots/capture-request.test.ts src/main/index.ts ../../packages/i18n/messages/en.json ../../packages/i18n/messages/es.json
git commit -m "fix(desktop): refuse a screenshot during a recording with a system notification"
```

### Task 2: Ship

- [ ] Open a PR titled `fix(desktop): screenshot shortcut during a take notifies instead of toasting a hidden window (audit SHOT-B7)` linking this plan and the finding. End with **How to test it yourself**:
  1. Start a recording; press ⌘⌃X → a macOS notification "Finish the recording first" appears, no region selector opens, the recording continues.
  2. Stop the recording; press ⌘⌃X → the normal capture works.
  3. Press Record and, during the 3-2-1 countdown, press ⌘⌃X → the in-window toast appears (fallback path).
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
