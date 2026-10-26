---
title: "22 · Recording crash writer"
description: "Closes REC-A4 and REC-B7 (Known: fable-audit #10, partially fixed): after a renderer crash the writer session stays open with its FD, the next renderer reuses session-1 and truncates the crashed take's .part, and the crash is not sent to PostHog."
---

# Recording crash writer — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A renderer crash mid-take closes the writer's file handle but keeps the `.part`, a new renderer can never truncate it, and the crash reaches PostHog with the recording phase.

**Architecture:** The renderer mints `session-${crypto.randomUUID()}` (as the export path already does) — no IPC change. `RecordingWriter.create` validates the id with a regex (it is interpolated into a filename), refuses a duplicate open session, and opens with `"wx"` so a leftover `.part` can never be truncated. New `sessionIds()` and `release(id)` (close the handle, **keep** the `.part`). `forceReset` releases recorder sessions and aborts `export-` sessions (an unfinished export is junk), and returns `wasActive`. `main/index.ts`'s `render-process-gone` calls `captureMainException` with reason, exit code and phase (skipping `clean-exit`). The kept `.part` is recovered by plan 02's launch sweep; it is probably not playable (moov is written at the end), which that sweep's copy already does not promise.

**Tech Stack:** Node fs (`open` flags), Electron `render-process-gone`, vitest (real temp dirs in `recording-writer.test.ts`; `vi.doMock("./recording-writer")` for the hub test).

**Spec:** [Audit report](/audits/2026-10-15/report/) → REC-A4 in [record lens A](/audits/2026-10-15/findings/record-a/), REC-B7 in [record lens B](/audits/2026-10-15/findings/record-b/). Closes: **REC-A4, REC-B7**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- Plan 02 rewrites `create` (staging dir) and `abort` (stranded guard): whoever lands second adapts the `open(…)` line; keep `"wx"` and the validation. Plan 21 also edits `forceReset`: this plan's per-prefix handling supersedes plan 21's plain `abortAll()`.
- `"wx"` makes `create` fail where it used to succeed: a collision now means a real bug; the take fails with the existing start-error toast and the foreign file is preserved. Stale `kaipu-rec-session-1.mp4.part` files from older builds cannot collide with UUID ids.
- `captureMainException` no-ops without a PostHog key; dev cannot assert it.
- Follow-up, not here: after a crash the main window stays blank until relaunch (reloading the dead window is out of scope).
- Commit messages in English, conventional-commit style.

## Review Focus

1. `create("s1")` after `release("s1")` rejects with `EEXIST` and the `.part` bytes are untouched — Task 1 test.
2. `create("../evil")` and `create("")` reject before touching the filesystem — Task 1 test.
3. `release` flushes queued writes, closes the handle, keeps the file, and a later `write` rejects — Task 1 test.
4. `forceReset` releases `session-*`, aborts `export-*`, returns `false` idle / `true` after a start — Task 2 test.
5. Two takes in one renderer get distinct UUID session ids — Task 3 test.

---

### Task 1: Writer — validated ids, `"wx"`, `sessionIds`, `release`

**Files:**

- Modify: `main/recording/recording-writer.ts:54-59` (`create`), after `abort`
- Test: `main/recording/recording-writer.test.ts`

**Interfaces:**

- Produces: `sessionIds(): string[]`, `release(sessionId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests** (the suite's `setup()` gives fresh `vaultDir`/`tempDir`)

```ts
it("create refuses an id whose .part already exists and leaves its bytes untouched", async () => {
  const { writer, tempDir } = await setup();
  await writer.create("s1");
  await writer.write("s1", new TextEncoder().encode("KEEP").buffer, 0);
  await writer.release("s1");
  await expect(writer.create("s1")).rejects.toThrow(/EEXIST/);
  expect(await readFile(join(tempDir, "kaipu-rec-s1.mp4.part"), "utf-8")).toBe("KEEP");
});

it("create rejects a second create for an open session", async () => {
  const { writer } = await setup();
  await writer.create("s1");
  await expect(writer.create("s1")).rejects.toThrow(/already exists/);
  await writer.write("s1", new TextEncoder().encode("x").buffer, 0); // the first session still works
});

it("create rejects ids that could escape the temp dir", async () => {
  const { writer, tempDir } = await setup();
  await expect(writer.create("../evil")).rejects.toThrow(/Invalid recording session id/);
  await expect(writer.create("")).rejects.toThrow(/Invalid recording session id/);
  expect(await readdir(tempDir)).toEqual([]);
});

it("release closes the handle but keeps the .part, flushing queued writes first", async () => {
  const { writer, tempDir } = await setup();
  const { tempPath } = await writer.create("s1");
  void writer.write("s1", new TextEncoder().encode("AAAA").buffer, 0);
  await writer.release("s1");
  expect(await readFile(tempPath, "utf-8")).toBe("AAAA");
  expect(writer.sessionIds()).toEqual([]);
  await expect(writer.write("s1", new TextEncoder().encode("B").buffer, 4)).rejects.toThrow(/session/i);
  expect(await readdir(tempDir)).toEqual(["kaipu-rec-s1.mp4.part"]);
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

```ts
  async create(sessionId: string): Promise<{ tempPath: string }> {
    // The id becomes part of a filename and arrives from the renderer: refuse
    // anything that could escape the temp dir.
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)) {
      throw new Error(`Invalid recording session id "${sessionId}"`);
    }
    if (this.sessions.has(sessionId)) {
      throw new Error(`Recording session "${sessionId}" already exists`);
    }
    const tempPath = join(this.tempDir, `kaipu-rec-${sessionId}.mp4.part`); // plan 02: await this.stagingDir()
    // "wx": fail with EEXIST instead of truncating. A leftover `.part` from a
    // crashed take is the only copy of that take until the launch sweep recovers it.
    const handle = await open(tempPath, "wx");
    this.sessions.set(sessionId, { handle, tempPath, queue: Promise.resolve() });
    return { tempPath };
  }
```

After `abort`:

```ts
  /** Ids of every open session (used to clean up after a renderer crash). */
  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Close a session's handle but KEEP its `.part` on disk. Used when the renderer
   * died mid-take: the file holds everything written so far and the launch sweep
   * can recover it. Unlike `abort` this never unlinks.
   */
  async release(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId); // drop first so a late write fails fast
    await session.queue; // queued writes still land before the close
    await session.handle.close().catch(() => {});
  }
```

(If plan 21 landed, `ids()` already exists — keep one name, `sessionIds`, and update plan 21's callers.)

- [ ] **Step 4: Run and commit** — `node_modules/.bin/vitest run src/main/recording/recording-writer.test.ts src/main/recording/recording-writer.write-failure.test.ts` → PASS (the write-failure mock ignores the flag argument).

```bash
git add src/main/recording/recording-writer.ts src/main/recording/recording-writer.test.ts
git commit -m "fix(desktop): recording sessions open with wx, validate their id, and can be released without unlinking"
```

### Task 2: Hub `forceReset` and the crash report

**Files:**

- Modify: `main/recording/recording-hub.ts:53-59` (interface), `:321-327` (`forceReset`)
- Modify: `main/index.ts:36` (import), `:218-222` (`render-process-gone`)
- Test: `main/recording/recording-hub.test.ts`

**Interfaces:**

- Produces: `RecordingHubHandle.forceReset(): boolean`.

- [ ] **Step 1: Write the failing test** (new `describe` with `vi.doMock("./recording-writer", …)` returning `{ timestampId: () => "x", RecordingWriter: class { sessionIds = () => ["session-a", "export-b"]; release = mockState.release; abort = mockState.abort; create = vi.fn(); } }`, spies hoisted into `mockState`)

```ts
it("forceReset releases recorder sessions, aborts exports, and reports whether a recording was active", async () => {
  const { registerSettings } = await import("../infrastructure/settings-store");
  const { registerRecordingHub } = await import("./recording-hub");
  registerSettings();
  const mainWindow = fakeMainWindow();
  const hub = registerRecordingHub(() => mainWindow as never);
  expect(hub.forceReset()).toBe(false);
  expect(mockState.release).toHaveBeenCalledWith("session-a");
  expect(mockState.abort).toHaveBeenCalledWith("export-b");
  mockState.ipcOn.get(IPC_CHANNELS.recordingStart)!({}, { sourceId: "window:1", sourceName: "w" });
  expect(hub.forceReset()).toBe(true);
  expect(mainWindow.show).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails** — returns `undefined`; `release`/`abort` not called.

- [ ] **Step 3: Implement**

Interface doc + signature:

```ts
  /**
   * Best-effort recovery when the recorder renderer is gone (crash, or the
   * main window destroyed) mid-recording: resets activity, hides the bar, and
   * restores the Dock policy without waiting on IPC that will never arrive
   * from a dead renderer. Also closes every open writer session: recorder takes
   * keep their `.part` on disk (the launch sweep recovers it), export sessions
   * are deleted. Returns whether a recording was active.
   */
  forceReset(): boolean;
```

```ts
    forceReset: () => {
      cursorTracks.discardAll();
      clickSessions.clear();
      clickHook.stop();
      // The dead renderer will never finalize or abort these. Close the handles
      // (they would otherwise leak for the life of the process) and keep the
      // recorder's `.part`; an unfinished export is worthless, so delete it.
      for (const id of writer.sessionIds()) {
        const done = id.startsWith("export-") ? writer.abort(id) : writer.release(id);
        void done.catch((error) => console.error("writer cleanup after renderer crash failed", error));
      }
      const wasActive = activity.active;
      if (wasActive) applyStopWindowState();
      return wasActive;
    },
```

(With plan 21: keep its `markEnded(id)` loop before this one.)

`main/index.ts`:

```ts
import { captureMainException, initMainAnalytics, shutdownMainAnalytics } from "./services/analytics.service";
// ...
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("main renderer process gone", details.reason);
    const wasRecording = hub?.forceReset() ?? false;
    // "clean-exit" is a normal shutdown, not a crash.
    if (details.reason !== "clean-exit") {
      captureMainException(new Error(`renderer process gone: ${details.reason}`), "render-process-gone", {
        reason: details.reason,
        exitCode: details.exitCode,
        phase: wasRecording ? "recording" : exportActive ? "export" : "idle",
      });
    }
    // The renderer that owned the export is gone; nothing is left to cancel.
    exportActive = false;
  });
```

(`exportActive` must be read before it is reset.)

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/recording/recording-hub.test.ts && bun run check-types` → PASS.

```bash
git add src/main/recording/recording-hub.ts src/main/recording/recording-hub.test.ts src/main/index.ts
git commit -m "fix(desktop): a renderer crash closes writer handles, keeps the take's .part, and is reported"
```

### Task 3: Renderer mints UUID session ids

**Files:**

- Modify: `renderer/src/features/recording/recorder-store.ts:74`, `:162-164`
- Test: `renderer/src/features/recording/recorder-store.test.ts`

- [ ] **Step 1: Write the failing test** (declare `recordingCreateMock` as `vi.fn(async (_id: string) => …)` so the calls can be indexed; run two takes with the suite's `stopAndSettle()`)

```ts
it("mints a distinct session id for every take", async () => {
  store.requestStartRecording(() => input);
  await vi.advanceTimersByTimeAsync(3000);
  await stopAndSettle();
  store.requestStartRecording(() => input);
  await vi.advanceTimersByTimeAsync(3000);
  await stopAndSettle();
  const [first, second] = recordingCreateMock.mock.calls.map(([id]) => id);
  expect(first).toMatch(/^session-[0-9a-f-]{36}$/);
  expect(second).toMatch(/^session-[0-9a-f-]{36}$/);
  expect(first).not.toBe(second);
});
```

- [ ] **Step 2: Run to verify it fails** — ids are `session-1`, `session-2`.

- [ ] **Step 3: Implement** — delete `let sessionCounter = 0;` and in `beginEngine`:

```ts
  // Unique per take for the life of the app: a module counter restarts at 1 on
  // every renderer load, which collided with a crashed take's leftover `.part`.
  const id = `session-${crypto.randomUUID()}`;
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/recording/recorder-store.test.ts && bun run check-types` → PASS (existing `toHaveBeenCalledOnce()` assertions still hold).

```bash
git add src/renderer/src/features/recording/recorder-store.ts src/renderer/src/features/recording/recorder-store.test.ts
git commit -m "fix(desktop): recording session ids are UUIDs, never reused after a reload"
```

### Task 4: Ship

- [ ] Open a PR titled `fix(desktop): renderer crash never truncates a take; writer handles are closed (audit REC-A4, REC-B7)` linking this plan, both findings and fable-audit #10; note that recovery of the kept `.part` is plan 02's sweep and that it is likely unplayable. End with **How to test it yourself** (dev build):
  1. Start a recording, then crash the renderer (DevTools console: `process.crash()`) → the bar disappears and the main window shows; `ls $TMPDIR/kaipu-rec-session-*.mp4.part` still lists the file with a non-zero size; `lsof -p <main pid> | grep kaipu-rec` shows no open handle.
  2. Relaunch, record again → a second, different `kaipu-rec-session-<uuid>.mp4.part` appears; the first keeps its size.
  3. With a PostHog key set, an exception with `origin: render-process-gone`, `phase: recording` appears in Live events.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
