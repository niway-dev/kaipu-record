---
title: "30 · Export runner token"
description: "Closes VID-B4, VID-A9, VID-A10: cancel during export prep followed by a new export runs two workers and leaks a writer session; an export write failure sends 'stop' to the live recorder; ImageBitmaps are not closed on cancel and lastStart retains the last editor."
---

# Export runner token — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every async continuation of an export belongs to one run and can never touch a newer run; an export's disk failure fails that export only; bitmaps and the last start args are freed when a run ends.

**Architecture:** In `export-runner.ts` a per-run object `ExportRun { cancelled, worker, sessionId, genericError, fail }` held in a module `current` replaces `active`/`sessionId`/`worker`. `cancelled` is set on cancel, failure **and** success, so "not cancelled" means "this run is still the live one"; every `await` re-checks its own run. Prep bitmaps go in an `owned` list closed in a `finally` (transferred ones are detached by `postMessage`, so `close()` is a no-op for them). `lastStart` is cleared on cancel and success (Retry exists only on the error card). Main gets a per-session `failedWriteSessions` set and sends `export:command "write-failed", sessionId` for `export-` sessions instead of the recorder-wide `recording:command "stop"`; the renderer's `failVideoExportWrite(sessionId)` fails only the live run with that id.

**Tech Stack:** Web Workers, Electron IPC, vitest (`export-runner.test.ts` `FakeWorker` harness; `recording-hub.test.ts` electron mock).

**Spec:** [Audit report](/audits/2026-10-15/report/) → VID-B4 in [video lens B](/audits/2026-10-15/findings/video-b/), VID-A9/A10 in [video lens A](/audits/2026-10-15/findings/video-a/). Closes: **VID-B4, VID-A9, VID-A10**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `startVideoExport` must still resolve only after `launch` spawned the worker (existing tests `await` it then read `workers[0]`).
- `writer.abort` of an unknown session is a silent no-op, so an abort that overtakes an in-flight `recordingCreate` would leak the `.part`: keep the second abort after `recordingCreate` resolves.
- Keep the "yield once so a cancel wins" `await Promise.resolve()` and both `run.cancelled` re-checks in the `done` branch — the highest-risk rewrite; the existing Ready-card and cancel tests cover it.
- `bitmap.close()` in `finally` relies on the transfer list: if a future change structured-clones instead of transferring, it would break the worker's copy.
- Not changed: cancel during `recordingFinalize` can still leave the finished file in the vault (pre-existing); `rasterizeOverlays` uses `Promise.all` so sibling bitmaps leak if one overlay fails (follow-up inside `overlay-raster.ts`).
- Plan 21 adds `endedSessions`/`markEnded` to the same hub handlers; plan 22 switches recorder ids to UUIDs (still `session-` prefixed). Independent; rebase around the `recordingCreate`/`recordingWrite` handlers.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Cancel during a deferred fetch, start B, then release A → one worker, one `recordingCreate`, B's job, `exporting` — Task 2 test (VID-B4).
2. Cancel while `recordingCreate` is pending → `recordingAbort` with the `export-` id, no worker — Task 2 test.
3. Cancel mid-prep with one overlay and one slide → every bitmap `close()`d, no worker — Task 2 test (VID-A10).
4. A write failure for `export-x` sends `export:command "write-failed" "export-x"` and never `recording:command "stop"`; `session-1` twice → exactly one `"stop"` — Task 1 test (VID-A9).
5. Retry is gone after success and after closing the error card — Task 2 tests.

---

### Task 1: Main routes export write failures to the export

**Files:**

- Modify: `shared/types/ipc.ts` (after `IPC_CHANNELS`), `shared/types/electron-api.ts:174-175`, `preload/index.ts:70-74`
- Modify: `main/recording/recording-hub.ts:170-194`, abort/finalize handlers
- Modify: `renderer/src/shell/app-root.tsx:70`
- Test: `main/recording/recording-hub.test.ts`

**Interfaces:**

- Produces: `EXPORT_SESSION_PREFIX = "export-"`; `onExportCommand(callback: (command: "cancel" | "write-failed", sessionId?: string) => void)`; renderer `failVideoExportWrite(sessionId)` (Task 2).

- [ ] **Step 1: Write the failing hub tests** (the real `RecordingWriter` rejects a write to an unknown session with "No recording session", which reaches the same `.catch`)

```ts
it("an export write failure tells the export, never the recorder", async () => {
  const mainWindow = await registerHubWith(fakeMainWindow());
  ipcOn(IPC_CHANNELS.recordingWrite)({}, "export-x", new ArrayBuffer(1), 0);
  await new Promise((r) => setTimeout(r, 0));
  expect(mainWindow.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.exportCommand, "write-failed", "export-x");
  expect(mainWindow.webContents.send).not.toHaveBeenCalledWith(IPC_CHANNELS.recordingCommand, "stop");
});

it("a recorder write failure stops the recorder once per session, independently of exports", async () => {
  const mainWindow = await registerHubWith(fakeMainWindow());
  ipcOn(IPC_CHANNELS.recordingWrite)({}, "export-x", new ArrayBuffer(1), 0);
  ipcOn(IPC_CHANNELS.recordingWrite)({}, "session-1", new ArrayBuffer(1), 0);
  ipcOn(IPC_CHANNELS.recordingWrite)({}, "session-1", new ArrayBuffer(1), 0);
  await new Promise((r) => setTimeout(r, 0));
  const stops = mainWindow.webContents.send.mock.calls.filter(([c, cmd]) => c === IPC_CHANNELS.recordingCommand && cmd === "stop");
  expect(stops).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify they fail** — the export write sends `recordingCommand "stop"`.

- [ ] **Step 3: Implement**

`shared/types/ipc.ts`: `/** Writer-session id prefix of the video export (the recorder's ids are `session-…`). */ export const EXPORT_SESSION_PREFIX = "export-";`. `electron-api.ts`:

```ts
  /** Main asks the export to stop: the user confirmed close/quit, or an export write failed. */
  onExportCommand(callback: (command: "cancel" | "write-failed", sessionId?: string) => void): () => void;
```

`preload/index.ts`: the listener becomes `(_e: IpcRendererEvent, command: "cancel" | "write-failed", sessionId?: string): void => callback(command, sessionId)`.

Hub (import `EXPORT_SESSION_PREFIX`):

```ts
  // Sessions already reacted to for a failed write: writes are fire-and-forget and keep
  // arriving after the first failure, so react once PER SESSION (the recorder's and a
  // background export's are independent).
  const failedWriteSessions = new Set<string>();
  ipcMain.handle(IPC_CHANNELS.recordingCreate, (_e, sessionId: string) => {
    failedWriteSessions.delete(sessionId);
    return writer.create(sessionId);
  });
  ipcMain.on(IPC_CHANNELS.recordingWrite, (_e, sessionId: string, data: ArrayBuffer, position: number) => {
    void writer.write(sessionId, data, position).catch((error) => {
      console.error("recording write failed", error);
      if (failedWriteSessions.has(sessionId)) return;
      failedWriteSessions.add(sessionId);
      if (sessionId.startsWith(EXPORT_SESSION_PREFIX)) {
        // An export's disk error ends THAT export; it must never stop a live recording.
        getMainWindow()?.webContents.send(IPC_CHANNELS.exportCommand, "write-failed", sessionId);
      } else {
        // (keep the existing comment about stopping the recorder)
        getMainWindow()?.webContents.send(IPC_CHANNELS.recordingCommand, "stop");
      }
    });
  });
```

Add `failedWriteSessions.delete(sessionId);` at the top of the abort and finalize handlers (keeps the set small; ids are unique so correctness does not depend on it). Delete `stoppedForWriteFailure`.

`app-root.tsx` (import `failVideoExportWrite` beside `cancelVideoExport`):

```ts
  useEffect(
    () =>
      window.electronAPI.onExportCommand((command, sessionId) => {
        if (command === "write-failed") {
          if (sessionId) failVideoExportWrite(sessionId);
        } else {
          cancelVideoExport();
        }
      }),
    [],
  );
```

(`failVideoExportWrite` is added in Task 2; add a temporary export in the runner or do Task 2 first before the type check.)

- [ ] **Step 4: Run and commit** (after Task 2 for the type check)

```bash
git add src/shared/types/ipc.ts src/shared/types/electron-api.ts src/preload/index.ts src/main/recording/recording-hub.ts src/main/recording/recording-hub.test.ts src/renderer/src/shell/app-root.tsx
git commit -m "fix(desktop): an export's write failure fails the export, not the live recording"
```

### Task 2: Per-run token in the runner

**Files:**

- Modify: `renderer/src/features/video-editor/export/export-runner.ts:138-147`, `:172-199`, `:224-230`, `:247-480`, `:483-493`
- Test: `renderer/src/features/video-editor/export/export-runner.test.ts`

**Interfaces:**

- Produces: `failVideoExportWrite(failedSessionId: string): void`; `isVideoExportBusy()` = `current !== null`.

- [ ] **Step 1: Write the failing tests** (make `fetch` controllable: `let release!: () => void; vi.mocked(fetch).mockImplementationOnce(() => new Promise((r) => { release = () => r({ blob: async () => new Blob(["mp4"]) } as never); }));`)

```ts
it("a cancelled prep that resumes after a new export started spawns no second worker", async () => {
  const a = startVideoExport(args(), t); // deferred fetch
  cancelVideoExport();
  await startVideoExport(args({ presetId: "youtube" }), t);
  release();
  await a;
  expect(workers).toHaveLength(1);
  expect(window.electronAPI.recordingCreate).toHaveBeenCalledTimes(1);
  expect(getExportSnapshot().job?.presetId).toBe("youtube");
  expect(workers[0]!.terminate).not.toHaveBeenCalled();
  expect(getExportSnapshot().status).toBe("exporting");
});

it("cancel during the fetch spawns nothing and opens no session", async () => {
  const a = startVideoExport(args(), t);
  cancelVideoExport();
  release();
  await a;
  expect(workers).toHaveLength(0);
  expect(window.electronAPI.recordingCreate).not.toHaveBeenCalled();
  expect(getExportSnapshot().status).toBe("idle");
});

it("cancel while the session is being created aborts it and spawns no worker", async () => {
  let resolveCreate!: () => void;
  window.electronAPI.recordingCreate = vi.fn(() => new Promise((r) => (resolveCreate = () => r({ tempPath: "/t" }))));
  const a = startVideoExport(args(), t);
  await waitFor(() => expect(window.electronAPI.recordingCreate).toHaveBeenCalled());
  cancelVideoExport();
  resolveCreate();
  await a;
  expect(vi.mocked(window.electronAPI.recordingAbort).mock.calls.some(([id]) => String(id).startsWith("export-"))).toBe(true);
  expect(workers).toHaveLength(0);
});

it("closes the overlay and slide bitmaps when cancelled mid-prep", async () => {
  const close = vi.fn();
  rasterizeOverlays.mockImplementation(async (overlays) => overlays.map((o) => ({ overlayId: o.id, bitmap: { close } })));
  let releaseSlide!: () => void;
  vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise((r) => (releaseSlide = () => r({ close })))));
  const a = startVideoExport(args({ scene: sceneWithOverlayAndSlide }), t);
  await waitFor(() => expect(createImageBitmap).toHaveBeenCalled());
  cancelVideoExport();
  releaseSlide();
  await a;
  expect(close).toHaveBeenCalledTimes(2);
  expect(workers).toHaveLength(0);
});

it("an export write failure fails the export, not the recorder", async () => {
  await startVideoExport(args(), t);
  const id = vi.mocked(window.electronAPI.recordingCreate).mock.calls[0][0];
  failVideoExportWrite(id);
  expect(getExportSnapshot().status).toBe("error");
  expect(workers[0]!.terminate).toHaveBeenCalled();
  expect(window.electronAPI.recordingAbort).toHaveBeenCalledWith(id);
});

it("a late write failure from a cancelled run does not fail the next export", async () => {
  await startVideoExport(args(), t);
  const oldId = vi.mocked(window.electronAPI.recordingCreate).mock.calls[0][0];
  cancelVideoExport();
  await startVideoExport(args(), t);
  failVideoExportWrite(oldId);
  expect(getExportSnapshot().status).toBe("exporting");
});

it("Retry is gone once the export finished, and after closing the error card", async () => {
  await startVideoExport(args(), t);
  finish(workers[0]!);
  await waitFor(() => expect(getExportSnapshot().ready).toBeTruthy());
  retryVideoExport();
  expect(workers).toHaveLength(1);
  await startVideoExport(args(), t);
  workers[1]!.onerror?.(new ErrorEvent("error", { message: "boom" }));
  await waitFor(() => expect(getExportSnapshot().status).toBe("error"));
  cancelVideoExport();
  retryVideoExport();
  expect(workers).toHaveLength(2);
});
```

(`rasterizeOverlays` mocked via `vi.mock("./overlay-raster")` with a hoisted fn whose default mirrors the real behaviour for `overlays: []`.)

- [ ] **Step 2: Run to verify they fail** — two workers / two creates in the first test; bitmaps not closed; export write stops the recorder.

- [ ] **Step 3: Implement**

State:

```ts
/** One start of an export. Every async continuation captures its own run. */
interface ExportRun {
  /** Set on cancel, failure and success: a continuation that sees it true must do nothing. */
  cancelled: boolean;
  worker: Worker | null;
  sessionId: string | null;
  genericError: string;
  /** Fails THIS run (error card); a no-op once the run is over. */
  fail: (message: string, error?: unknown) => void;
}

let snapshot: ExportRunnerSnapshot = IDLE;
const listeners = new Set<() => void>();
// The live run, or null. A run cancelled while its prep (fetch, rasterize, session create)
// was awaiting may resume AFTER a newer run started: it checks its own `cancelled`, not a
// module flag, so it can never touch the newer run's worker or session.
let current: ExportRun | null = null;
// What Retry re-runs; cleared when the export ends (success, cancel, dismiss).
let lastStart: { args: StartExportArgs; t: Translator<"videoEditor"> } | null = null;
```

```ts
export function isVideoExportBusy(): boolean {
  return current !== null;
}

function teardownRun(run: ExportRun): void {
  run.worker?.terminate();
  run.worker = null;
  const id = run.sessionId;
  run.sessionId = null;
  if (id) void window.electronAPI.recordingAbort(id).catch(() => {});
}

export function cancelVideoExport(): void {
  const run = current;
  current = null;
  lastStart = null; // Retry only exists on the error card this just dismissed
  if (run) {
    run.cancelled = true;
    teardownRun(run);
  }
  set({ ...IDLE, ready: snapshot.ready });
}

/**
 * Main reports a failed disk write for an export session: that export fails (error card,
 * worker terminated, session aborted). Ignored when the session is not the live run's, so
 * late chunks of a cancelled run cannot fail its successor.
 */
export function failVideoExportWrite(failedSessionId: string): void {
  const run = current;
  if (!run || run.sessionId !== failedSessionId) return;
  run.fail(run.genericError, new Error("export write failed"));
}
```

`retryVideoExport`: `if (!lastStart || current) return;`. In `startVideoExport`: `if (current) return false;` and, from `active = true;` on:

```ts
  const run: ExportRun = {
    cancelled: false,
    worker: null,
    sessionId: null,
    genericError: GENERIC_ERROR,
    fail: (message, error) => {
      if (run.cancelled) return;
      run.cancelled = true;
      if (current === run) current = null;
      if (error !== undefined) captureException(error, { context: "video-export" });
      teardownRun(run);
      set({ status: "error", fraction: 0, error: message, attemptStartedAt: null });
    },
  };
  current = run;
  set({ status: "exporting", fraction: 0, error: null, job, attemptStartedAt: Date.now(), ready: null });

  // (usedAssetIds / slideAssets block unchanged)

  let sourceBlob: Blob;
  try {
    const sourceResponse = await fetch(`kaipu-media://recording/${args.sourceId}`);
    sourceBlob = await sourceResponse.blob();
  } catch (error) {
    run.fail(GENERIC_ERROR, error); // no-op when cancelled meanwhile
    return true;
  }
  if (run.cancelled) return true; // cancelled during the fetch: spawn nothing

  const launch = async (runTarget: ResolvedExportTarget): Promise<void> => {
    let poster: ArrayBuffer | null = null;
    // Bitmaps this attempt created. Transferred ones are detached by postMessage, so close()
    // is then a no-op; the rest (cancel / error paths) are freed here instead of waiting for GC.
    const owned: ImageBitmap[] = [];
    try {
      const rasterized = await rasterizeOverlays(args.scene.overlays, args.videoWidth, args.videoHeight, args.previewWidth);
      owned.push(...rasterized.map((r) => r.bitmap));
      const bitmapByOverlayId = new Map(rasterized.map((r) => [r.overlayId, r.bitmap]));
      const overlays = args.scene.overlays.map((o) => ({ overlayId: o.id, start: o.start, end: o.end, bitmap: bitmapByOverlayId.get(o.id)! }));

      const settled = await Promise.allSettled(
        slideAssets.map(async (asset) => {
          const bitmap = await createImageBitmap(new Blob([asset.bytes], { type: asset.mimeType }));
          owned.push(bitmap);
          return { assetId: asset.assetId, bitmap };
        }),
      );
      const rejected = settled.find((s) => s.status === "rejected");
      if (rejected) throw (rejected as PromiseRejectedResult).reason;
      const slides = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));

      if (run.cancelled) return; // cancelled while the above was in flight

      const id = `${EXPORT_SESSION_PREFIX}${crypto.randomUUID()}`;
      run.sessionId = id;
      await window.electronAPI.recordingCreate(id);
      if (run.cancelled) {
        // cancel() aborted `id`, but that abort may have overtaken the create in main
        // (aborting an unknown session is a no-op): abort again now that it exists.
        void window.electronAPI.recordingAbort(id).catch(() => {});
        return;
      }

      const runWorker = new Worker(new URL("./export-worker.ts", import.meta.url), { type: "module" });
      run.worker = runWorker;
      runWorker.onmessage = (event: MessageEvent<ExportWorkerMessage>) => {
        const msg = event.data;
        if (run.cancelled || run.worker !== runWorker) return;
        // chunk / poster / encoder / progress branches: unchanged.
        // error branch: `teardown(id); sessionId = null;` -> `teardownRun(run);`
        //   relaunch catch -> `run.fail(GENERIC_ERROR, error)`; final -> `run.fail(GENERIC_ERROR, new Error(msg.message))`.
        // done branch: both `if (!active) return;` -> `if (run.cancelled) return;`, and the
        //   success teardown becomes:
        //     run.cancelled = true; current = null; lastStart = null;
        //     run.worker?.terminate(); run.worker = null; run.sessionId = null;
        //   keep `set({ ...IDLE, ready: { job, recording } })` and the onSaved try/catch;
        //   `catch (error) { if (!active) return; fail(...) }` -> `catch (error) { run.fail(GENERIC_ERROR, error); }`
      };
      runWorker.onerror = (event: ErrorEvent) => {
        if (run.worker !== runWorker) return;
        run.fail(GENERIC_ERROR, event.error ?? new Error(event.message));
      };

      // camera copy + startMessage unchanged
      runWorker.postMessage(startMessage, [/* unchanged transfer list */]);
    } finally {
      for (const bitmap of owned) bitmap.close();
    }
  };

  try {
    await launch(target);
  } catch (error) {
    run.fail(GENERIC_ERROR, error);
  }
  return true;
```

`__resetExportRunnerForTests`: replace its first lines with `const run = current; current = null; if (run) { run.cancelled = true; teardownRun(run); }`, keeping `lastStart = null; snapshot = IDLE; …`. Import `EXPORT_SESSION_PREFIX` from `@shared/types/ipc`.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/video-editor/export/export-runner.test.ts src/renderer/src/features/video-editor/export/use-video-export.test.ts src/renderer/src/features/library/components/share-recording.test.tsx src/main/recording/recording-hub.test.ts && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/video-editor/export/export-runner.ts src/renderer/src/features/video-editor/export/export-runner.test.ts
git commit -m "fix(desktop): each export run owns its continuations; cancelled prep never spawns a worker"
```

### Task 3: Ship

- [ ] Open a PR titled `fix(desktop): export runs cannot leak into each other or stop the recorder (audit VID-B4, VID-A9, VID-A10)` linking this plan and the findings; note the two pre-existing gaps left (finalize cancel; `rasterizeOverlays` sibling leak). End with **How to test it yourself**:
  1. Start an export of a long recording, press Cancel within the first seconds, immediately start another preset → Activity Monitor shows one encode; the temp/staging dir holds one `kaipu-rec-export-*.part`.
  2. Record while an export runs; make the export's temp file unwritable (`chflags uchg` on its `.part`) → the recording keeps running while the export card shows the error.
  3. Export successfully → the Ready card has no Retry; trigger an export error, close the card → no Retry.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
