---
title: "Video editor v2 — 03 click hook, permissions and gating"
description: "Global click capture with uiohook-napi: the spike checklist, packaging with electron-builder, a hook that never triggers the macOS Accessibility prompt, runs only while recording and listens to mouse-down only, plus the accessibility IPC and the onboarding step that ships last. Fixes audit W7."
sidebar:
  order: 3
---

# 03 — Click hook, permissions and gating

> **Status: 🟡 In progress** (2026-09-22). PR 3 ("Click hook, gated") and the UI part of
> PR 10 in the [audit](/plans/video-editor-v2/00-audit/). Fixes W7. Requires PR 2
> ([02](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/)). PR 3 is
> implemented on `feat/video-editor-v2-click-hook`, the UI part on
> `feat/video-editor-v2-polish` — neither merged, neither validated in production
> (Spike B's real signed/notarized build check is still outstanding); see the
> [backlog PR table](/backlog/video-editor-zoom-blur-cover/).

## Problem

- **Sequencing bug.** libuiohook (the C library under `uiohook-napi`) checks Accessibility
  trust with the _prompt_ option when its hook starts. The overview adds the hook in PR 01
  and the onboarding that explains the permission in PR 06. Every macOS user would get an
  unexplained "Kaipu Record would like to control this computer" dialog on their first
  recording after PR 01 ships.
- **Packaging.** `electron-builder.yml` has `npmRebuild: false` and `asarUnpack` only for
  `resources/**`. A `.node` binary inside `app.asar` cannot be `dlopen`ed. Separately,
  `apps/kaipu-record/package.json` runs `"postinstall": "electron-builder install-app-deps"`,
  which walks the app's native dependencies on **every** `bun install` — adding the first
  native module to this app makes that hook do real work for the first time, on every
  machine and in CI.
- **Privacy surface.** `uIOhook.start()` installs a **process-wide input tap**: libuiohook
  receives every keyboard and mouse event the OS delivers, and the only thing we control
  is which of them we subscribe to and keep. The plan does not say what is subscribed to,
  or when the hook runs, and the promise we can honestly make to users is "we only keep
  mouse clicks", not "the app never sees the keyboard".
- **Coordinates.** uiohook reports physical pixels on Windows and points on macOS; mixing
  them with the poller's DIP is a bug source.

## Decisions

| Topic         | Decision                                                                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library       | `uiohook-napi@^1.5.5` (N-API, ships prebuilds for darwin/win32/linux × x64/arm64 loaded by `node-gyp-build` at runtime → no rebuild per Electron version).                                                                                                                                                          |
| Gate on macOS | Start the hook **only if** `systemPreferences.isTrustedAccessibilityClient(false)` is already `true`. Never call it with `true` from the recording path. Untrusted → `clicksAvailable: false`, dwell-only detection.                                                                                                |
| Windows       | No permission; runs.                                                                                                                                                                                                                                                                                                |
| Linux         | Off in v2 (untested; X11/Wayland differences).                                                                                                                                                                                                                                                                      |
| When          | Started when the first tracker starts, stopped when the last finishes/discards. Never at idle.                                                                                                                                                                                                                      |
| What          | `mousedown` only. `uIOhook.start()` taps the whole input stream — that is what the OS permission is for — so the guarantee is about what we **keep**: no `keydown`/`keyup`/`input` listener is ever registered, and no keyboard event leaves `click-hook.ts` (enforced in code review; comment in `click-hook.ts`). |
| Position      | Ignore uiohook's `x/y`. Use the poller's `screen.getCursorScreenPoint()` at the moment of the event (same DIP space as every sample).                                                                                                                                                                               |
| Button map    | libuiohook 1 → 0 (primary), 2 → 2 (secondary), 3 → 1 (middle); others ignored.                                                                                                                                                                                                                                      |
| Failure       | Module fails to load or `start()` throws → log once, never retry in this app run, `clicksAvailable: false`.                                                                                                                                                                                                         |
| Prompt        | Shown **only** from the UI (PR 10): an onboarding step and a Settings row, both calling `requestAccessibility`, which uses `isTrustedAccessibilityClient(true)` and then deep-links the pane.                                                                                                                       |

## Task 0 — Spike B (do first, report before coding the rest)

Time-box: half a day. Write results into this section (a table) in the same PR.

- [ ] `cd apps/kaipu-record && bun add uiohook-napi@^1.5.5`.
- [ ] Add to `electron-builder.yml` under `asarUnpack:` → `- "**/node_modules/uiohook-napi/**"`.
- [ ] Throwaway script in main (not committed): on app ready,
      `const { uIOhook } = require("uiohook-napi"); uIOhook.on("mousedown", e => console.log(e.button)); uIOhook.start();`
- [ ] Check, recording each answer:

  | Question                                                                                  | macOS arm64 | Windows x64 |
  | ----------------------------------------------------------------------------------------- | ----------- | ----------- |
  | `bun run dev`: module loads, clicks print                                                 |             |             |
  | `rm -rf node_modules && bun install` from a clean checkout succeeds (postinstall runs)    |             |             |
  | `bun run build:unpack` → launch the unpacked app: module loads from `app.asar.unpacked`   |             |             |
  | Signed + notarized build (`build:mac`): launches, no library-validation crash             |             | n/a         |
  | Untrusted app: does `start()` show the Accessibility prompt? (expected: yes)              |             | n/a         |
  | With `isTrustedAccessibilityClient(false) === false` and **no** `start()`: no prompt      |             | n/a         |
  | After granting Accessibility **and restarting the app**: clicks print                     |             | n/a         |
  | Is Input Monitoring also listed/requested for the app? (expected: no — mouse events only) |             | n/a         |
  | Idle CPU of main with the hook running, Activity Monitor / Task Manager                   |             |             |

- [ ] If the notarized build crashes with a library-validation error, add
      `com.apple.security.cs.disable-library-validation` to `build/entitlements.mac.plist`
      (it is already listed there, commented, for exactly this case) and re-test.
- [ ] **Install branch.** `apps/kaipu-record/package.json` already runs
      `"postinstall": "electron-builder install-app-deps"`. `uiohook-napi` ships N-API
      prebuilds loaded by `node-gyp-build`, so nothing should have to be compiled — but
      this is the first native dependency the app has, so prove it: the clean-install row
      above must pass on **both** macOS and Windows, on a machine without Xcode CLT /
      MSVC build tools if you can find one. If `install-app-deps` tries to compile and
      fails, do **not** delete the hook script (other native deps may need it later);
      set `nodeGypRebuild: false` and, if that is not enough,
      `buildDependenciesFromSource: false` in `electron-builder.yml`, and re-run. Record
      which of the two was needed.
- [ ] **Input Monitoring branch.** If macOS also lists Kaipu Record under
      Privacy & Security → **Input Monitoring** (or prompts for it), **stop and report**.
      The onboarding copy below promises mouse clicks only, and a second permission row
      changes what we are asking for. The owner decides between extending the onboarding
      copy to cover Input Monitoring and cutting clicks from v2 — the detector already
      works on dwells, so cutting them is cheap.
- [ ] **Stop and report** if the module cannot load in the packaged app on either OS.
      Fallback then: ship PR 3 empty (no hook) — the detector already works on dwells.

## Files

| Action | Path (under `apps/kaipu-record/`)                                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modify | `package.json` (dependency), `electron-builder.yml` (`asarUnpack`, and `nodeGypRebuild` / `buildDependenciesFromSource` only if Spike B's install branch needs them) |
| Create | `src/main/recording/click-hook.ts` + `.test.ts`                                                                                                                      |
| Modify | `src/main/recording/recording-hub.ts`                                                                                                                                |
| Modify | `src/main/permissions.ts`                                                                                                                                            |
| Modify | `src/shared/types/ipc.ts`, `electron-api.ts`, `src/preload/index.ts`, test setup                                                                                     |

## Task 1 — gated wrapper

**`apps/kaipu-record/src/main/recording/click-hook.ts`**

```ts
/**
 * Global mouse-click hook for the cursor track (uiohook-napi), wrapped so that:
 *   - it NEVER triggers the macOS Accessibility prompt: libuiohook asks for
 *     Accessibility the moment it starts untrusted, so on macOS we start it only when
 *     `isTrustedAccessibilityClient(false)` already says yes. The prompt is shown only
 *     by the onboarding/settings UI (doc 03 § UI, PR 10).
 *   - it runs ONLY while a recording is sampling (started with the first tracker,
 *     stopped with the last), never at idle;
 *   - it subscribes to mouse-down ONLY. Be precise about what that buys: uIOhook.start()
 *     installs a PROCESS-WIDE input tap, and libuiohook receives every key and mouse
 *     event while it runs — that is exactly what the OS permission grants. What we
 *     control is what we keep. No keydown/keyup/input listener is registered here or
 *     anywhere else, and no keyboard event ever leaves this file. Keep it that way: the
 *     onboarding copy promises users that only mouse clicks are kept.
 *   - a missing/broken native binary degrades to "no clicks", never a crash.
 * Electron and the native module are injected so the policy is unit-tested.
 */
import type { CursorButton } from "@shared/cursor-track";

export interface HookLike {
  on(event: "mousedown", listener: (e: { button: unknown }) => void): unknown;
  start(): void;
  stop(): void;
}

export interface ClickHookDeps {
  platform: NodeJS.Platform;
  /** macOS: `systemPreferences.isTrustedAccessibilityClient(false)` — MUST NOT prompt. */
  isAccessibilityTrusted(): boolean;
  /** Lazily require the native module; null when it cannot load. */
  load(): HookLike | null;
}

/** libuiohook: 1 = left, 2 = right, 3 = middle. */
export function toCursorButton(raw: unknown): CursorButton | null {
  if (raw === 1) return 0;
  if (raw === 2) return 2;
  if (raw === 3) return 1;
  return null;
}

export class ClickHook {
  private hook: HookLike | null = null;
  private loadFailed = false;
  private running = false;

  constructor(
    private readonly deps: ClickHookDeps,
    private readonly onClick: (button: CursorButton) => void,
  ) {}

  /** Whether this platform + permission state allows the hook at all (no side effects). */
  allowed(): boolean {
    if (this.deps.platform === "darwin") return this.deps.isAccessibilityTrusted();
    return this.deps.platform === "win32";
  }

  /** Start if allowed; returns whether clicks are being captured. Idempotent. */
  ensureRunning(): boolean {
    if (this.running) return true;
    if (this.loadFailed || !this.allowed()) return false;
    try {
      if (!this.hook) {
        const hook = this.deps.load();
        if (!hook) {
          this.loadFailed = true;
          return false;
        }
        hook.on("mousedown", (e) => {
          const button = toCursorButton(e.button);
          if (button !== null) this.onClick(button);
        });
        this.hook = hook;
      }
      this.hook.start();
      this.running = true;
    } catch (error) {
      console.warn("click hook unavailable", error);
      this.loadFailed = true;
      this.running = false;
    }
    return this.running;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    try {
      this.hook?.stop();
    } catch (error) {
      console.warn("click hook stop failed", error);
    }
  }

  get isRunning(): boolean {
    return this.running;
  }
}
```

**`apps/kaipu-record/src/main/recording/click-hook.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ClickHook, type ClickHookDeps, type HookLike, toCursorButton } from "./click-hook";

function fakeHook() {
  let listener: ((e: { button: unknown }) => void) | null = null;
  const state = { starts: 0, stops: 0 };
  const hook: HookLike = {
    on: (_event, l) => {
      listener = l;
    },
    start: () => {
      state.starts++;
    },
    stop: () => {
      state.stops++;
    },
  };
  return { hook, state, fire: (button: unknown) => listener?.({ button }) };
}

function deps(partial: Partial<ClickHookDeps>, hook: HookLike | null): ClickHookDeps {
  return { platform: "darwin", isAccessibilityTrusted: () => true, load: () => hook, ...partial };
}

describe("toCursorButton", () => {
  it("maps libuiohook buttons to DOM buttons", () => {
    expect([1, 2, 3, 4, "x"].map(toCursorButton)).toEqual([0, 2, 1, null, null]);
  });
});

describe("ClickHook", () => {
  it("never loads or starts on macOS without Accessibility (no prompt)", () => {
    let loads = 0;
    const f = fakeHook();
    const hook = new ClickHook(
      deps({ isAccessibilityTrusted: () => false, load: () => (loads++, f.hook) }, f.hook),
      () => {},
    );
    expect(hook.ensureRunning()).toBe(false);
    expect(loads).toBe(0);
    expect(f.state.starts).toBe(0);
  });

  it("starts once, forwards mouse-downs, and stops", () => {
    const f = fakeHook();
    const clicks: number[] = [];
    const hook = new ClickHook(deps({}, f.hook), (b) => clicks.push(b));
    expect(hook.ensureRunning()).toBe(true);
    expect(hook.ensureRunning()).toBe(true);
    expect(f.state.starts).toBe(1);
    f.fire(1);
    f.fire(3);
    f.fire(9);
    expect(clicks).toEqual([0, 1]);
    hook.stop();
    hook.stop();
    expect(f.state.stops).toBe(1);
    expect(hook.isRunning).toBe(false);
  });

  it("runs on Windows without any permission check", () => {
    const f = fakeHook();
    const hook = new ClickHook(
      deps({ platform: "win32", isAccessibilityTrusted: () => false }, f.hook),
      () => {},
    );
    expect(hook.ensureRunning()).toBe(true);
  });

  it("is off on Linux", () => {
    const f = fakeHook();
    expect(new ClickHook(deps({ platform: "linux" }, f.hook), () => {}).ensureRunning()).toBe(
      false,
    );
  });

  it("degrades to no clicks when the native module fails, and stops retrying", () => {
    let loads = 0;
    const hook = new ClickHook(deps({ load: () => (loads++, null) }, null), () => {});
    expect(hook.ensureRunning()).toBe(false);
    expect(hook.ensureRunning()).toBe(false);
    expect(loads).toBe(1);
  });

  it("degrades when start throws", () => {
    const f = fakeHook();
    f.hook.start = () => {
      throw new Error("AX disabled");
    };
    expect(new ClickHook(deps({}, f.hook), () => {}).ensureRunning()).toBe(false);
  });
});
```

## Task 2 — wire into the hub

In `src/main/recording/recording-hub.ts` (after PR 2):

- [ ] Add `systemPreferences` to the `electron` import and
      `import { ClickHook, type HookLike } from "./click-hook";`.
- [ ] Replace `const clicksAvailable = (): boolean => false;` with:

  ```ts
  // Mouse-down only, and only while a recording samples (see plans/video-editor-v2/03).
  const clickHook = new ClickHook(
    {
      platform: process.platform,
      // `false` = check only. Passing true here would show the macOS prompt mid-recording.
      isAccessibilityTrusted: () =>
        process.platform === "darwin" && systemPreferences.isTrustedAccessibilityClient(false),
      load: () => {
        try {
          // Lazy require: a broken/missing native binary must not crash main at startup.
          return (require("uiohook-napi") as { uIOhook: HookLike }).uIOhook;
        } catch (error) {
          console.warn("uiohook-napi failed to load", error);
          return null;
        }
      },
    },
    (button) => {
      for (const tracker of cursorTracks.all()) tracker.addClick(button);
    },
  );
  // Sessions whose whole recording had the hook running.
  const clickSessions = new Set<string>();
  const stopHookIfIdle = (): void => {
    if (!cursorTracks.active) clickHook.stop();
  };
  ```

- [ ] In the `cursorTrackStart` handler, after `cursorTracks.start(sessionId, display);`:

  ```ts
  if (clickHook.ensureRunning()) clickSessions.add(sessionId);
  ```

- [ ] In `recordingFinalize`: replace the `clicksAvailable()` argument of
      `cursorTracks.finish(...)` with `clickSessions.delete(sessionId)` — keeping the
      third argument, `meta.durationSeconds * 1000`, which PR 2 added to cut the tail
      sampled after the last frame — and call `stopHookIfIdle();` right after it. The
      call no longer fits in 100 columns, so it wraps over four lines; see the diff. In
      its `catch` branch, after `cursorTracks.discard(sessionId);` add
      `clickSessions.delete(sessionId); stopHookIfIdle();`.
- [ ] In `recordingAbort`: after `cursorTracks.discard(sessionId);` add
      `clickSessions.delete(sessionId); stopHookIfIdle();`.
- [ ] In `forceReset`: after `cursorTracks.discardAll();` add
      `clickSessions.clear(); clickHook.stop();`.
- [ ] `package.json` has no `"type": "module"`, so electron-vite emits CommonJS for main and
      `require` is available. If `bun run build` or oxlint rejects the bare `require`, use
      `createRequire(__filename)` from `node:module`. Never switch to a top-level `import`
      of `uiohook-napi`: a missing binary would then crash main at startup.

`CursorTrackRegistry.all()` already exists (doc 02 Task 4).

## Task 3 — accessibility IPC (no UI yet)

Kept separate from `PermissionKind` on purpose: `PermissionStatus` is
`Record<PermissionKind, boolean>` and the onboarding renders every key, so adding a kind
would put an unexplained row in the UI before PR 10.

- [ ] `src/shared/types/ipc.ts`, inside `IPC_CHANNELS` directly after
      `openSystemSettings: "permissions:open-settings",` (the last `permissions:` entry,
      just before the `library:` group):

  ```ts
  // macOS Accessibility, for the click hook. Status never prompts; request does (PR 10).
  accessibilityStatus: "permissions:accessibility-status",
  accessibilityRequest: "permissions:accessibility-request",
  ```

- [ ] `src/shared/types/electron-api.ts`, directly after
      `requestPermission(kind: PermissionKind): Promise<boolean>;`:

  ```ts
  /** "not-required" off macOS. Never prompts. */
  getAccessibilityStatus(): Promise<"granted" | "denied" | "not-required">;
  /** macOS: registers the app in the Accessibility list, shows the system prompt once, and opens the pane. */
  requestAccessibility(): Promise<"granted" | "denied" | "not-required">;
  ```

- [ ] `src/main/permissions.ts`: add

  ```ts
  const ACCESSIBILITY_PANE =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

  type AccessibilityStatus = "granted" | "denied" | "not-required";

  function accessibilityStatus(): AccessibilityStatus {
    if (!isMac()) return "not-required";
    return systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied";
  }
  ```

  and as the **first** statements inside `registerPermissionHandlers()`, above the
  existing `checkPermissions` handler. The `accessibilityStatus` registration does not
  fit on one line at 100 columns, so it wraps — copy it exactly as below, which is the
  same text as the diff further down:

  ```ts
  ipcMain.handle(
    IPC_CHANNELS.accessibilityStatus,
    (): AccessibilityStatus => accessibilityStatus(),
  );
  ipcMain.handle(IPC_CHANNELS.accessibilityRequest, async (): Promise<AccessibilityStatus> => {
    if (!isMac()) return "not-required";
    // `true` adds the app to the list and shows the system prompt the first time.
    if (systemPreferences.isTrustedAccessibilityClient(true)) return "granted";
    await shell.openExternal(ACCESSIBILITY_PANE);
    return accessibilityStatus();
  });
  ```

- [ ] `src/preload/index.ts`, in the `kaipuApi` object directly after
      `requestPermission: (kind) => ipcRenderer.invoke(IPC_CHANNELS.requestPermission, kind),`
      (both are plain `invoke` bridges, the same shape as the surrounding entries):

  ```ts
  getAccessibilityStatus: () => ipcRenderer.invoke(IPC_CHANNELS.accessibilityStatus),
  requestAccessibility: () => ipcRenderer.invoke(IPC_CHANNELS.accessibilityRequest),
  ```

- [ ] `src/renderer/src/test/setup.ts`, in the `electronAPI` stub next to
      `requestPermission: async () => true,` (audit rule 5 — without it every renderer
      test that touches the bridge's type breaks):

  ```ts
  getAccessibilityStatus: async () => "not-required" as const,
  requestAccessibility: async () => "not-required" as const,
  ```

## Tasks 2 + 3 as diffs (authoritative)

On top of PR 2's hub, so the hunk offsets assume doc 02's diffs are already applied.
The bare `require` is accepted by the main build's CommonJS output. These were
regenerated after this plan was reviewed (the `finish(...)` call now carries PR 2's
`maxMs` argument and wraps), so after applying them re-run
`bun run check-types && bun run test`.

**Diff — `apps/kaipu-record/src/main/recording/recording-hub.ts`**

```diff
--- a/apps/kaipu-record/src/main/recording/recording-hub.ts
+++ b/apps/kaipu-record/src/main/recording/recording-hub.ts
@@ -1,4 +1,4 @@
-import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from "electron";
+import { app, BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences } from "electron";
 import { IPC_CHANNELS } from "@shared/types";
 import type {
   ControlCommand,
@@ -11,6 +11,7 @@
 import { serializeCursorTrack } from "@shared/cursor-track";
 import { LibraryVault } from "../library/library-vault";
 import { pickCapturedDisplay } from "./captured-display";
+import { ClickHook, type HookLike } from "./click-hook";
 import { CursorTrackRegistry } from "./cursor-tracker";
 import { ControlBarWindow } from "./control-bar-window";
 import { CameraBubbleWindow } from "./camera-bubble-window";
@@ -72,8 +73,32 @@
       return () => clearInterval(handle);
     },
   });
-  // PR 3 replaces this with the click hook's availability (doc 03).
-  const clicksAvailable = (): boolean => false;
+  // Mouse-down only, and only while a recording samples (see plans/video-editor-v2/03).
+  const clickHook = new ClickHook(
+    {
+      platform: process.platform,
+      // `false` = check only. Passing true here would show the macOS prompt mid-recording.
+      isAccessibilityTrusted: () =>
+        process.platform === "darwin" && systemPreferences.isTrustedAccessibilityClient(false),
+      load: () => {
+        try {
+          // Lazy require: a broken/missing native binary must not crash main at startup.
+          return (require("uiohook-napi") as { uIOhook: HookLike }).uIOhook;
+        } catch (error) {
+          console.warn("uiohook-napi failed to load", error);
+          return null;
+        }
+      },
+    },
+    (button) => {
+      for (const tracker of cursorTracks.all()) tracker.addClick(button);
+    },
+  );
+  // Sessions whose whole recording had the hook running.
+  const clickSessions = new Set<string>();
+  const stopHookIfIdle = (): void => {
+    if (!cursorTracks.active) clickHook.stop();
+  };

   // Single source of truth for "is a recording happening", broadcast to every
   // window so non-recorder windows (reopened Record page, Capture Panel) can
@@ -160,12 +185,19 @@
         recording = await writer.finalize(sessionId, meta);
       } catch (error) {
         cursorTracks.discard(sessionId);
+        clickSessions.delete(sessionId);
+        stopHookIfIdle();
         throw error;
       }
       // Best effort: a recording is never failed by its cursor track. The tracker
       // is still sampling here (finalize runs after the encoder stopped), so the
       // tail past the last frame is cut with the recording's duration.
-      const track = cursorTracks.finish(sessionId, clicksAvailable(), meta.durationSeconds * 1000);
+      const track = cursorTracks.finish(
+        sessionId,
+        clickSessions.delete(sessionId),
+        meta.durationSeconds * 1000,
+      );
+      stopHookIfIdle();
       if (track) {
         await new LibraryVault(vaultDirectory().path)
           .writeCursorTrack(recording.id, serializeCursorTrack(track))
@@ -176,6 +208,8 @@
   );
   ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => {
     cursorTracks.discard(sessionId);
+    clickSessions.delete(sessionId);
+    stopHookIfIdle();
     return writer.abort(sessionId);
   });
   ipcMain.handle(
@@ -188,6 +222,7 @@
       );
       if (!display) return { enabled: false };
       cursorTracks.start(sessionId, display);
+      if (clickHook.ensureRunning()) clickSessions.add(sessionId);
       return { enabled: true };
     },
   );
@@ -260,6 +295,8 @@
     },
     forceReset: () => {
       cursorTracks.discardAll();
+      clickSessions.clear();
+      clickHook.stop();
       if (!activity.active) return;
       applyStopWindowState();
     },
```

**Diff — `apps/kaipu-record/src/main/permissions.ts`**

```diff
--- a/apps/kaipu-record/src/main/permissions.ts
+++ b/apps/kaipu-record/src/main/permissions.ts
@@ -34,6 +34,11 @@
   // Windows does not gate screen capture, so there is no screen pane.
 };

+const ACCESSIBILITY_PANE =
+  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
+
+type AccessibilityStatus = "granted" | "denied" | "not-required";
+
 function isMac(): boolean {
   return process.platform === "darwin";
 }
@@ -48,6 +53,11 @@
   if (pane) await shell.openExternal(pane);
 }

+function accessibilityStatus(): AccessibilityStatus {
+  if (!isMac()) return "not-required";
+  return systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied";
+}
+
 function checkPermission(kind: PermissionKind): boolean {
   // Screen capture is only gated on macOS; elsewhere treat it as available.
   if (kind === "screen" && !isMac()) return true;
@@ -102,6 +112,18 @@
 }

 export function registerPermissionHandlers(): void {
+  ipcMain.handle(
+    IPC_CHANNELS.accessibilityStatus,
+    (): AccessibilityStatus => accessibilityStatus(),
+  );
+  ipcMain.handle(IPC_CHANNELS.accessibilityRequest, async (): Promise<AccessibilityStatus> => {
+    if (!isMac()) return "not-required";
+    // `true` adds the app to the list and shows the system prompt the first time.
+    if (systemPreferences.isTrustedAccessibilityClient(true)) return "granted";
+    await shell.openExternal(ACCESSIBILITY_PANE);
+    return accessibilityStatus();
+  });
+
   ipcMain.handle(IPC_CHANNELS.checkPermissions, async (): Promise<PermissionStatus> => {
     return checkAllPermissions();
   });
```

## Task 4 — verify

- [ ] Checks (audit rule 4).
- [ ] macOS, Accessibility **not** granted: record 10 s clicking around → **no prompt
      appears**, the sidecar has `"clicksAvailable": false`.
- [ ] Grant Accessibility in System Settings, **restart the app**, record → sidecar has
      clicks with plausible `x/y` (compare one click against where you clicked).
- [ ] Windows: sidecar has clicks without any prompt.
- [ ] Idle app (not recording): the hook is not running (add a temporary log in
      `ensureRunning`/`stop` while testing, remove before commit).

## UI (ships in PR 10, not PR 3)

- **Onboarding step** (macOS only, after the Screen Recording step), copy under
  `onboarding`:

  | Key                        | es                                                                                                                                  | en                                                                                                           |
  | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `accessibilityTitle`       | Zoom automático en los clics                                                                                                        | Auto-zoom on clicks                                                                                          |
  | `accessibilityBody`        | Para acercar la cámara donde haces clic, macOS pide permiso de Accesibilidad. Mientras grabas solo conservamos los clics del mouse. | To zoom in where you click, macOS asks for Accessibility access. While you record we only keep mouse clicks. |
  | `accessibilityGrant`       | Permitir                                                                                                                            | Allow                                                                                                        |
  | `accessibilitySkip`        | Ahora no                                                                                                                            | Not now                                                                                                      |
  | `accessibilityRestartHint` | Después de permitirlo, reinicia Kaipu Record para activarlo.                                                                        | After allowing it, restart Kaipu Record to turn it on.                                                       |

- The step is **optional**: "Ahora no" continues; zooms then come from pauses only.
- The copy says **"conservamos" / "keep"**, not "leemos" / "read", on purpose: the OS
  permission grants a process-wide input tap, so a claim that the app never _sees_ the
  keyboard would be false. What the app does is keep mouse clicks and nothing else
  (§ Decisions → What). If Spike B finds that macOS also asks for Input Monitoring, this
  copy no longer covers what we request — stop and report (Task 0).
- **Settings row** (Permissions section): label `settings.clickZoomLabel` "Zoom en clics
  (Accesibilidad)" / "Zoom on clicks (Accessibility)", status text from
  `getAccessibilityStatus()`, button calling `requestAccessibility()`. Hidden when the
  status is `"not-required"`.

  This doc originally placed the row in the **Recording** section, and PR 10 shipped it
  there. Validating it on a real machine showed the obvious failure: the app has a
  dedicated **Permissions** page listing Screen recording, Microphone and Camera with
  this exact row shape — same status text, same Request/Re-request button — and that is
  where a user goes looking for an OS permission. Accessibility now sits with them. The
  Recording section keeps only what `AppSettings` actually stores.

- **Editor empty-state hint** when the track has `clicksAvailable: false` on macOS:
  `videoEditor.clicksUnavailableHint` "Activa el permiso de Accesibilidad para que los
  clics también generen zoom." / "Turn on Accessibility access so clicks also create zooms."

## Acceptance criteria

- No code path outside the onboarding/settings UI can show the Accessibility prompt.
- The hook runs only between the first `cursorTrackStart` and the last finish/abort.
- A missing native binary produces recordings exactly like PR 2 (dwell-only).
- `rm -rf node_modules && bun install` from a clean checkout succeeds on macOS and
  Windows with the existing `postinstall` hook, or the `electron-builder.yml` fallback
  that made it succeed is committed and named in the PR.
- No keyboard event is subscribed to anywhere, and the shipped copy claims only that
  mouse clicks are _kept_ — not that the process never sees other input.

## Non-goals

Keyboard shortcuts in the track, scroll events, Linux support, click ripples in the render.

## Reopen if

Spike B fails on a platform, or Electron gains a first-party global mouse event API.
