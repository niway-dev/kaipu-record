---
title: "21 · Recording main-side resources"
description: "Closes REC-A2, REC-B4, REC-B3, REC-B5: a start that fails before cursor-track:start resolves leaves the 125 Hz sampler and the global mouse hook running for the app's life; the control bar can appear after the take ended; the close/quit guard's timeout leaves the hub 'recording' and a stale once-listener closes the next window."
---

# Recording main-side resources — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing main starts for a take outlives it: a late `cursor-track:start` for an ended session is refused, the control bar never shows for a take that already stopped, and a hung renderer at close/quit time resets the hub instead of leaving it "recording" with a stale listener.

**Architecture:** The hub keeps an `endedSessions` set (filled on abort/finalize/forced reset, cleared by `recordingCreate` for that id because the renderer's counter can repeat ids after a reload, capped at 64 — a TTL is unnecessary). `cursor-track:start` checks it before and after its `getSources` await. The bar gets a `barGeneration` counter (start/stop carry no session id) plus an `activity.active` check before the delayed `bar.show`, and `ControlBarWindow` honours a `wanted` flag in `ready-to-show`. `forceReset` aborts every open writer session (`RecordingWriter.ids()`/`abortAll()`). A new pure `stop-guard.ts` (`proceedWhenRecordingStops`) replaces the duplicated timeout + `ipcMain.once` blocks in `main/index.ts`: exactly one path runs, the other is cancelled, and the timeout path calls `hub.forceReset()`.

**Tech Stack:** Electron IPC, vitest (`recording-hub.test.ts` electron mock with `ipcOn`/`ipcHandle` maps; `capture-panel-window.test.ts`'s `FakeWindow` pattern).

**Spec:** [Audit report](/audits/2026-10-15/report/) → REC-A2 in [record lens A](/audits/2026-10-15/findings/record-a/), REC-B3/B4/B5 in [record lens B](/audits/2026-10-15/findings/record-b/). Closes: **REC-A2, REC-B4, REC-B3, REC-B5**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `RecordingStartInfo` carries no session id; the bar guard is a generation counter, not an id check.
- `RecordingWriter.abort` deletes from `sessions` only after `await session.queue`, so a bare `writer.has(id)` is racy during an abort — hence the explicit ended set.
- Plan 22 also edits `forceReset` (release recorder sessions, abort exports) — merge: plan 22's per-prefix handling supersedes the plain `abortAll()` here if both land. Plan 02 edits `abort` (stranded guard); independent.
- Marking ended at `recordingFinalize` entry would block a retried finalize's tracker start; the renderer never retries (it aborts), so accepted.
- Follow-up, not here: the quit-path timeout can still cut a slow `copyFile` mid-finalize (needs a `finalizeInFlight` counter that re-arms the timeout).
- Commit messages in English, conventional-commit style.

## Review Focus

1. `cursor-track:start` whose `getSources` resolves after `recording:abort` → `{ enabled: false }` and no interval timer — Task 2 test.
2. `recordingCreate` for a reused id re-enables `cursor-track:start` — Task 2 test.
3. `recording:stop` before the display lookup resolves → `bar.show` never called; a newer `recording:start` still shows it once — Task 2 tests.
4. `hide()` before `ready-to-show` → `showInactive` never called — Task 3 test.
5. Stop guard: the timeout path removes its listener, so a later `recording:stop` cannot call `proceed` again — Task 4 test.

---

### Task 1: `RecordingWriter.ids()` / `abortAll()`

**Files:**

- Modify: `main/recording/recording-writer.ts` (after `abort`)
- Test: `main/recording/recording-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("abortAll closes and deletes every open session", async () => {
  const { writer, tempDir } = await setup();
  await writer.create("s1");
  await writer.create("s2");
  await writer.abortAll();
  expect(writer.ids()).toEqual([]);
  expect(await readdir(tempDir)).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify it fails** — methods missing.

- [ ] **Step 3: Implement**

```ts
  /** Ids of currently open sessions (used to tear everything down when the renderer is gone). */
  ids(): string[] {
    return [...this.sessions.keys()];
  }

  /** Abort every open session. Sessions already finalizing are not in the map, so they are untouched. */
  async abortAll(): Promise<void> {
    await Promise.all(this.ids().map((id) => this.abort(id)));
  }
```

- [ ] **Step 4: Run and commit**

```bash
git add src/main/recording/recording-writer.ts src/main/recording/recording-writer.test.ts
git commit -m "feat(desktop): RecordingWriter.ids and abortAll"
```

### Task 2: Hub — ended sessions, bar generation, forceReset aborts

**Files:**

- Modify: `main/recording/recording-hub.ts:110-114` (after `stopHookIfIdle`), `:174-178` (create), `:196-207` (finalize), `:233-252` (abort, cursorTrackStart), `:267-293` (start/stop), `:321-327` (`forceReset`)
- Test: `main/recording/recording-hub.test.ts`

- [ ] **Step 1: Write the failing tests** (new `describe`; extend the electron mock with `screen.getAllDisplays: () => mockState.displays` where `displays: [{ id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, scaleFactor: 1 }]`, and make `desktopCapturer.getSources` a hoisted `vi.fn` so a test can return a deferred promise resolving `[{ id: "screen:1:0", display_id: "1" }]`; `vi.useFakeTimers()` and assert `vi.getTimerCount()` — the tracker is a `setInterval`)

```ts
it("cursor-track:start resolved after recording:abort does not start a sampler", async () => {
  const hub = await registerHub();
  let release!: (v: unknown) => void;
  mockState.getSources.mockImplementationOnce(() => new Promise((r) => (release = r)));
  await ipcHandle(IPC_CHANNELS.recordingCreate)({}, "s1");
  const start = ipcHandle(IPC_CHANNELS.cursorTrackStart)({}, "s1", "screen:1:0");
  await ipcHandle(IPC_CHANNELS.recordingAbort)({}, "s1");
  release([{ id: "screen:1:0", display_id: "1" }]);
  expect(await start).toEqual({ enabled: false });
  expect(vi.getTimerCount()).toBe(0);
});

it("cursor-track:start for an id that already aborted is refused immediately", async () => {
  await registerHub();
  await ipcHandle(IPC_CHANNELS.recordingCreate)({}, "s1");
  await ipcHandle(IPC_CHANNELS.recordingAbort)({}, "s1");
  expect(await ipcHandle(IPC_CHANNELS.cursorTrackStart)({}, "s1", "screen:1:0")).toEqual({ enabled: false });
  expect(mockState.getSources).not.toHaveBeenCalled();
});

it("recordingCreate for a reused id re-enables cursor-track:start", async () => {
  await registerHub();
  await ipcHandle(IPC_CHANNELS.recordingCreate)({}, "s1");
  await ipcHandle(IPC_CHANNELS.recordingAbort)({}, "s1");
  await ipcHandle(IPC_CHANNELS.recordingCreate)({}, "s1");
  mockState.getSources.mockResolvedValueOnce([{ id: "screen:1:0", display_id: "1" }]);
  expect(await ipcHandle(IPC_CHANNELS.cursorTrackStart)({}, "s1", "screen:1:0")).toEqual({ enabled: true });
  expect(vi.getTimerCount()).toBe(1);
  await ipcHandle(IPC_CHANNELS.recordingAbort)({}, "s1");
});

it("recording:stop before the display lookup resolves keeps the bar hidden", async () => {
  await registerHub();
  let release!: (v: unknown) => void;
  mockState.getSources.mockImplementationOnce(() => new Promise((r) => (release = r)));
  ipcOn(IPC_CHANNELS.recordingStart)({}, { sourceId: "screen:1:0", sourceName: "s" });
  ipcOn(IPC_CHANNELS.recordingStop)({});
  release([{ id: "screen:1:0", display_id: "1" }]);
  await Promise.resolve();
  expect(mockState.bar.show).not.toHaveBeenCalled();
});

it("a newer recording:start still shows the bar once", async () => {
  await registerHub();
  mockState.getSources.mockResolvedValue([{ id: "screen:1:0", display_id: "1" }]);
  ipcOn(IPC_CHANNELS.recordingStart)({}, { sourceId: "screen:1:0", sourceName: "s" });
  ipcOn(IPC_CHANNELS.recordingStop)({});
  ipcOn(IPC_CHANNELS.recordingStart)({}, { sourceId: "screen:1:0", sourceName: "s" });
  await vi.runAllTimersAsync();
  expect(mockState.bar.show).toHaveBeenCalledTimes(1);
});

it("forceReset aborts open writer sessions and refuses later tracker starts", async () => {
  const hub = await registerHub();
  const { tempPath } = await ipcHandle(IPC_CHANNELS.recordingCreate)({}, "s1");
  hub.forceReset();
  await vi.runAllTimersAsync();
  expect(existsSync(tempPath)).toBe(false);
  expect(await ipcHandle(IPC_CHANNELS.cursorTrackStart)({}, "s1", "screen:1:0")).toEqual({ enabled: false });
});
```

(Write `registerHub()`, `ipcHandle(channel)`, `ipcOn(channel)` helpers over the suite's existing `beforeEach` setup.)

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

After `stopHookIfIdle`:

```ts
  // Session ids whose take already ended (abort/finalize/forced reset). A late
  // `cursor-track:start` for one of them must not start a sampler nobody will
  // ever stop. Cleared by `recordingCreate` because the renderer's counter
  // restarts after a reload; capped so it cannot grow without bound.
  const endedSessions = new Set<string>();
  const markEnded = (sessionId: string): void => {
    endedSessions.add(sessionId);
    if (endedSessions.size > 64) {
      const oldest = endedSessions.values().next().value;
      if (oldest !== undefined) endedSessions.delete(oldest);
    }
  };
  // Bumped on every recording start/stop/reset; a delayed `bar.show` only runs
  // if no stop or newer start happened while it waited on desktopCapturer.
  let barGeneration = 0;
```

Create handler: `endedSessions.delete(sessionId);` before `return writer.create(sessionId);`. Finalize handler: first line of the async body `markEnded(sessionId);`. Abort handler: first line `markEnded(sessionId);`. `cursorTrackStart`:

```ts
    async (_e, sessionId: string, sourceId: string): Promise<{ enabled: boolean }> => {
      if (endedSessions.has(sessionId)) return { enabled: false };
      const display = pickCapturedDisplay(sourceId, await displayIdForSource(sourceId), screen.getAllDisplays());
      // The take may have been aborted/finalized while getSources() was pending.
      if (!display || endedSessions.has(sessionId)) return { enabled: false };
      cursorTracks.start(sessionId, display);
      if (clickHook.ensureRunning()) clickSessions.add(sessionId);
      return { enabled: true };
    },
```

`recordingStart` tail:

```ts
    const generation = ++barGeneration;
    const includeInRecording = getAppSettings().showBarInRecording;
    void displayIdForSource(info.sourceId).then((displayId) => {
      if (generation !== barGeneration || !activity.active) return; // the take ended while we waited
      bar.show(displayId, { includeInRecording });
    });
```

`applyStopWindowState`: first line `barGeneration++;`. `forceReset`:

```ts
    forceReset: () => {
      for (const id of writer.ids()) markEnded(id);
      void writer.abortAll().catch((error) => console.error("recording abortAll failed", error));
      cursorTracks.discardAll();
      clickSessions.clear();
      clickHook.stop();
      if (!activity.active) return;
      applyStopWindowState();
    },
```

- [ ] **Step 4: Run and commit** — `node_modules/.bin/vitest run src/main/recording/recording-hub.test.ts` → PASS.

```bash
git add src/main/recording/recording-hub.ts src/main/recording/recording-hub.test.ts
git commit -m "fix(desktop): the hub refuses late cursor starts, never shows the bar for an ended take, and aborts writers on reset"
```

### Task 3: `ControlBarWindow` honours hide-before-ready

**Files:**

- Modify: `main/recording/control-bar-window.ts:21-25`, `:27-80`, `:98-105`
- Create: `main/recording/control-bar-window.test.ts`

- [ ] **Step 1: Write the failing test** (imitate `capture-panel-window.test.ts`: `class FakeWindow` whose `once` stores the `ready-to-show` callback and a `paint()` that fires it; mock `electron` incl. `screen.getAllDisplays/getDisplayNearestPoint/getCursorScreenPoint`, and `@electron-toolkit/utils` → `{ is: { dev: false } }`)

```ts
it("does not show when hidden before the page was ready", async () => {
  const { ControlBarWindow } = await import("./control-bar-window");
  const bar = new ControlBarWindow();
  bar.show(null, { includeInRecording: false });
  bar.hide();
  lastWindow().paint();
  expect(lastWindow().showInactive).not.toHaveBeenCalled();
});

it("shows once when it was still wanted at ready-to-show", async () => {
  const { ControlBarWindow } = await import("./control-bar-window");
  const bar = new ControlBarWindow();
  bar.show(null, { includeInRecording: false });
  lastWindow().paint();
  expect(lastWindow().showInactive).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify the first fails.**

- [ ] **Step 3: Implement** — add `private wanted = false;`; first line of `show()`: `this.wanted = true;`; `hide()`: `this.wanted = false; this.window?.hide();`; `destroy()`: also `this.wanted = false;`; ready handler:

```ts
    this.window.once("ready-to-show", () => {
      if (!this.wanted) return; // hide() ran while the page was still loading
      this.position();
      this.window?.showInactive();
    });
```

- [ ] **Step 4: Run and commit**

```bash
git add src/main/recording/control-bar-window.ts src/main/recording/control-bar-window.test.ts
git commit -m "fix(desktop): the control bar stays hidden when the take ends before it painted"
```

### Task 4: Stop guard for close and quit

**Files:**

- Create: `main/recording/stop-guard.ts`, `main/recording/stop-guard.test.ts`
- Modify: `main/index.ts:184-191` (close guard), `:632-640` (quit guard)

**Interfaces:**

- Produces: `proceedWhenRecordingStops({ ipc: { once; removeListener }, channel, timeoutMs, proceed, onTimeout })`.

- [ ] **Step 1: Write the failing tests** (fake timers; fake ipc over a `Map` with `once`/`removeListener`/`emit`)

```ts
it("proceeds once when the stop arrives, without the timeout", () => {
  const ipc = fakeIpc();
  const proceed = vi.fn();
  const onTimeout = vi.fn();
  proceedWhenRecordingStops({ ipc, channel: "recording:stop", timeoutMs: 5000, proceed, onTimeout });
  ipc.emit("recording:stop");
  vi.advanceTimersByTime(6000);
  expect(proceed).toHaveBeenCalledTimes(1);
  expect(onTimeout).not.toHaveBeenCalled();
});

it("on timeout runs onTimeout then proceed and removes its listener", () => {
  const ipc = fakeIpc();
  const order: string[] = [];
  proceedWhenRecordingStops({
    ipc, channel: "recording:stop", timeoutMs: 5000,
    proceed: () => order.push("proceed"), onTimeout: () => order.push("timeout"),
  });
  vi.advanceTimersByTime(5000);
  ipc.emit("recording:stop"); // a later stop must not proceed again
  expect(order).toEqual(["timeout", "proceed"]);
  expect(ipc.listeners("recording:stop")).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify they fail** — module missing.

- [ ] **Step 3: Implement**

```ts
// main/recording/stop-guard.ts
export interface StopGuardIpc {
  once(channel: string, listener: () => void): unknown;
  removeListener(channel: string, listener: () => void): unknown;
}

/**
 * Run `proceed` once the recorder reports `channel`, or after `timeoutMs`. Exactly one path
 * runs and the other is cancelled, so no listener outlives the guard and a later recording
 * stop cannot close the window the user got back. `onTimeout` runs before `proceed`, on the
 * timeout path only.
 */
export function proceedWhenRecordingStops(opts: {
  ipc: StopGuardIpc;
  channel: string;
  timeoutMs: number;
  proceed: () => void;
  onTimeout: () => void;
}): void {
  const onStop = (): void => {
    clearTimeout(timer);
    opts.proceed();
  };
  const timer = setTimeout(() => {
    opts.ipc.removeListener(opts.channel, onStop);
    opts.onTimeout();
    opts.proceed();
  }, opts.timeoutMs);
  opts.ipc.once(opts.channel, onStop);
}
```

`main/index.ts` — `import { proceedWhenRecordingStops } from "./recording/stop-guard";`. Close guard (replace the `finishClose`/timeout/`once` lines):

```ts
    proceedWhenRecordingStops({
      ipc: ipcMain,
      channel: IPC_CHANNELS.recordingStop,
      timeoutMs: 5000,
      onTimeout: () => hub?.forceReset(), // renderer hung: no recording:stop will ever come
      proceed: () => mainWindow?.close(),
    });
```

Quit guard (replace `finishQuit`/timeout/`once`, keep `return;`):

```ts
    proceedWhenRecordingStops({
      ipc: ipcMain,
      channel: IPC_CHANNELS.recordingStop,
      timeoutMs: 5000,
      onTimeout: () => hub?.forceReset(),
      proceed: () => app.quit(),
    });
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/recording && bun run check-types` → PASS.

```bash
git add src/main/recording/stop-guard.ts src/main/recording/stop-guard.test.ts src/main/index.ts
git commit -m "fix(desktop): close/quit guards reset the hub on timeout and never leave a stale stop listener"
```

### Task 5: Ship

- [ ] Open a PR titled `fix(desktop): main-side recording resources end with the take (audit REC-A2/B3/B4/B5)` linking this plan and the findings; note the follow-up (quit timeout vs slow finalize copy). End with **How to test it yourself**:
  1. `bun run dev`; deny screen capture (or unplug the selected display) and press Record → the start fails, the bar never appears, and main-process CPU stays idle (no 125 Hz sampler: check Activity Monitor).
  2. Vault on a slow USB volume: start a take, ⌘W → "Stop and close"; after 5 s the window closes and the bar is gone. Relaunch, record again and stop → the window does **not** close by itself.
  3. Record and stop normally → bar hidden, main window back (regression).
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
