---
title: "20 · Recording engine cleanup"
description: "Closes REC-A1, REC-B2, REC-B1: an encoder error leaves the mic, screen capture, compositor and AudioContext running; a partial start releases nothing; a failure in the first ~200 ms is swallowed and the take continues as a zombie."
---

# Recording engine cleanup — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every device the recorder acquires is released on every exit path — clean stop, encoder failure at stop, partial start — and an error during the start window fails the start instead of being swallowed.

**Architecture:** `startEngine` gets one idempotent, never-throwing `releaseAll()` (compositor stop, every captured track, the mix destination, `AudioContext.close`) created right after the screen stream exists; the rest of the start runs inside `try { … } catch { await releaseAll(); throw }`; `stop()` becomes `try { await output.finalize() } finally { await releaseAll() }`. In the store, an `onError` that fires before the handle exists is remembered (`startWindowError`); once `Promise.all` resolves, the store stops the handle and throws the error into the existing start `catch` (report, abort, restore window) — "route to `onError`" was rejected because `onError` → `stopRecording()` no-ops with no engine. No IPC or `EngineHandle` interface change.

**Tech Stack:** mediabunny 1.61.4 (`Output.cancel()` exists; not called in `stop()` because its behaviour on a failed output was not verified), vitest with the existing fakes in `recorder-engine.test.tsx` (`getUserMedia`, `FakeAudioContext`, mocked `Output`, mocked compositor).

**Spec:** [Audit report](/audits/2026-10-15/report/) → REC-A1 in [record lens A](/audits/2026-10-15/findings/record-a/), REC-B1/B2 in [record lens B](/audits/2026-10-15/findings/record-b/). Closes: **REC-A1, REC-B2, REC-B1**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/features/recording/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- The `try` re-indents most of `startEngine`: review the diff with `git diff -w`.
- `AudioContext` is created before the compositor (it was after); it is synchronous and independent.
- `releaseAll` memoizes its promise: a second real `AudioContext.close()` rejects with `InvalidStateError`.
- Plan 24 parallelises the mic `getUserMedia` and defers the thumbnail; its cleanup must await the pending mic promise inside `releaseAll`. Plan 01 adds `stats` to the handle. Land 20 before 24.
- The cursor-track session leak on a failed start is plan 21, not this one.
- Commit messages in English, conventional-commit style.

## Review Focus

1. `finalize()` rejects at stop → every track stopped, compositor stopped, AudioContext closed, and `stop()` still rejects — Task 1 test.
2. `output.start()` rejects → screen, mic and destination tracks stopped, AudioContext closed, `startEngine` rejects — Task 1 test.
3. Compositor fails to start → screen track stopped — Task 1 test.
4. `stop()` twice → `AudioContext.close` once — Task 1 test.
5. Engine `onError` fires before the handle resolves → `handle.stop` once, `recordingAbort` once, `recordingStop` once, status idle, **one** `errorStart` report — Task 2 test.

---

### Task 1: `releaseAll()` in `startEngine`

**Files:**

- Modify: `recorder-engine.ts:134-186`, `:283-307`, `:353-363`
- Test: `recorder-engine.test.tsx`

- [ ] **Step 1: Write the failing tests** (in `describe("startEngine")`; `lastOutput()` returns the latest mocked `Output`; force the compositor path with `screenVideoTrack.getSettings = vi.fn(() => ({ width: 3024, height: 1964 }))`)

```tsx
it("releases every device and the audio context even when finalize rejects", async () => {
  screenVideoTrack.getSettings = vi.fn(() => ({ width: 3024, height: 1964 }));
  const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1", systemAudio: true }));
  lastOutput().finalize.mockRejectedValueOnce(new Error("encoder failed"));
  await expect(handle.stop()).rejects.toThrow("encoder failed");
  expect(screenVideoTrack.stop).toHaveBeenCalled();
  expect(micTrack.stop).toHaveBeenCalled();
  expect(destinationTrack.stop).toHaveBeenCalled();
  expect(audioContextClose).toHaveBeenCalled();
  const compositor = await vi.mocked(startRecordingCompositor).mock.results.at(-1)!.value;
  expect(compositor.stop).toHaveBeenCalled();
});

it("releases the screen, mic and audio context when output.start fails", async () => {
  vi.mocked(Output).mockImplementationOnce(function () {
    return { addVideoTrack: vi.fn(), addAudioTrack: vi.fn(), start: vi.fn(async () => { throw new Error("boom"); }), finalize: vi.fn(async () => {}) } as never;
  });
  await expect(startEngine(baseOptions({ microphoneDeviceId: "mic-1" }))).rejects.toThrow("boom");
  expect(screenVideoTrack.stop).toHaveBeenCalled();
  expect(micTrack.stop).toHaveBeenCalled();
  expect(destinationTrack.stop).toHaveBeenCalled();
  expect(audioContextClose).toHaveBeenCalled();
});

it("releases the screen when the compositor fails to start", async () => {
  screenVideoTrack.getSettings = vi.fn(() => ({ width: 3024, height: 1964 }));
  vi.mocked(startRecordingCompositor).mockRejectedValueOnce(new Error("no 2d"));
  await expect(startEngine(baseOptions())).rejects.toThrow("no 2d");
  expect(screenVideoTrack.stop).toHaveBeenCalled();
  expect(audioContextClose).toHaveBeenCalled();
});

it("releases devices once when stop is called twice", async () => {
  const handle = await startEngine(baseOptions());
  await handle.stop();
  await handle.stop();
  expect(audioContextClose).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/recording/recorder-engine.test.tsx` → the first three FAIL (tracks not stopped), the fourth sees two closes.

- [ ] **Step 3: Implement**

After the `if (!screenStream) {…}` block and before `const screenTrack = …`, insert the shared state and open a `try` (re-bind the stream to a const so TS keeps it non-null inside closures):

```ts
  const screen: MediaStream = screenStream;
  // Every acquired stream is tracked so releaseAll() frees the OS devices (closing
  // the AudioContext alone does NOT stop the underlying tracks — the mic light would
  // stay on).
  const inputStreams: MediaStream[] = [screen];
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  let compositor: RecordingCompositor | null = null;
  let teardownStarted = false;
  /** Set by stop(); a live toggle arriving after it is answered "unavailable". */
  let stopped = false;
  let releasing: Promise<void> | null = null;
  /**
   * Free everything this engine holds: compositor loop, every captured track, the
   * mix destination and the AudioContext. Idempotent and never throws, so it is safe
   * in a `finally` and on a partial-start failure.
   */
  const releaseAll = (): Promise<void> => {
    releasing ??= (async () => {
      teardownStarted = true; // stopping tracks must not fire onError
      try {
        compositor?.stop(); // cancel the draw loop + release the canvas track
      } catch (error) {
        console.warn("[recorder] compositor stop failed", error);
      }
      for (const stream of inputStreams) stream.getTracks().forEach((t) => t.stop());
      destination.stream.getTracks().forEach((t) => t.stop());
      try {
        await audioContext.close();
      } catch (error) {
        console.warn("[recorder] audio context close failed", error);
      }
    })();
    return releasing;
  };

  try {
```

Inside the `try`: replace later uses of `screenStream` with `screen` (`getVideoTracks`, the `startRecordingCompositor` argument, `getAudioTracks`, `captureThumbnail`); delete the old declarations of `compositor`, `inputStreams`, `audioContext`, `destination`, `teardownStarted` and `stopped` (keep `acquiringMic` and the `compositor = await startRecordingCompositor(…)` assignment). Replace `stop()`:

```ts
    async stop() {
      stopped = true;
      teardownStarted = true; // stopping the tracks would otherwise fire onError
      try {
        await output.finalize();
      } finally {
        // An encoder error makes finalize() reject; the mic, the screen capture and
        // the AudioContext must still be released or the OS indicators stay on.
        await releaseAll();
      }
    },
```

Close the `try` after the `return { … };` and add before the function's closing brace:

```ts
  } catch (error) {
    // Partial start: no handle is ever returned, so the acquired devices would
    // otherwise leak.
    await releaseAll();
    throw error;
  }
}
```

Run the formatter; review with `git diff -w`.

- [ ] **Step 4: Run and commit** — the whole engine suite → PASS, including "releases every device and closes the audio context on stop".

```bash
git add src/renderer/src/features/recording/recorder-engine.ts src/renderer/src/features/recording/recorder-engine.test.tsx
git commit -m "fix(desktop): the recorder releases every device on failed stops and partial starts"
```

### Task 2: Start-window errors fail the start (REC-B1)

**Files:**

- Modify: `recorder-store.ts:162-253` (`beginEngine`)
- Test: `recorder-store.test.ts`

- [ ] **Step 1: Write the failing test** (uses the suite's `fakeEngine()`, `input`, fake timers and `window.electronAPI.*` mocks)

```ts
it("fails the start when the engine errors before its handle resolves", async () => {
  const handle = fakeEngine();
  startEngineMock.mockImplementation(async (opts) => {
    opts.onError?.(new Error("encoder rejected config"));
    return handle;
  });
  store.requestStartRecording(() => input);
  await vi.advanceTimersByTimeAsync(3000);
  expect(handle.stop).toHaveBeenCalledTimes(1);
  expect(window.electronAPI.recordingAbort).toHaveBeenCalledTimes(1);
  expect(window.electronAPI.recordingStop).toHaveBeenCalledTimes(1);
  expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  expect(reportErrorMock).toHaveBeenCalledTimes(1);
  expect(reportErrorMock).toHaveBeenCalledWith(messages.record.errorStart, expect.any(Error), expect.anything());
});
```

- [ ] **Step 2: Run to verify it fails** — status ends "recording" (the error was swallowed).

- [ ] **Step 3: Implement**

Inside `beginEngine`'s `try`, before `const [track, handle] = await Promise.all(…)`:

```ts
    // The engine can fail while still starting (the encoder rejects its config on
    // the first frame, the screen track ends): no handle exists yet, so
    // stopRecording() would silently no-op. Remember the error and fail the start
    // once the engine resolves.
    let engineReady = false;
    let startWindowError = null as { error: unknown } | null;
```

Replace the `onError` body:

```ts
        onError: (error) => {
          if (!engineReady) {
            startWindowError = { error };
            return;
          }
          reportError(runtimeT()("record.errorStopped"), error, {
            context: { sourceId: input.sourceId, phase: "mid-recording" },
            retry: () => {
              if (lastResolveInput) requestStartRecording(lastResolveInput);
            },
          });
          void stopRecording();
        },
```

After `]);` and before `cursorTrack = track;`:

```ts
    if (startWindowError) {
      // stop() now releases the devices even when finalize rejects; the catch
      // below then reports, aborts the session and restores the window.
      await handle.stop().catch(() => {});
      throw startWindowError.error;
    }
```

Set `engineReady = true;` immediately before `engine = handle;`. In the `cancelRequested` branch use `await handle.stop().catch(() => {});` so a rejecting finalize cannot strand the store in "starting". The existing `catch` (report `errorStart`, `recordingAbort`, `recordingStop`, idle) is the right outcome; no second teardown path.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/recording && bun run check-types` → PASS (`beforeEach` asserts the store is idle, so a leaking test fails the next one).

```bash
git add src/renderer/src/features/recording/recorder-store.ts src/renderer/src/features/recording/recorder-store.test.ts
git commit -m "fix(desktop): an engine error during the start window fails the start instead of a zombie take"
```

### Task 3: Ship

- [ ] Open a PR titled `fix(desktop): release recorder devices on every exit path (audit REC-A1, REC-B1, REC-B2)` linking this plan and the findings. End with **How to test it yourself** (a real encoder failure cannot be unit-tested):
  1. Start a take with mic on; in Activity Monitor force-quit the Electron **GPU helper** process mid-take → the error toast appears and the macOS mic and screen-recording indicators turn off (before: they stayed on until quit).
  2. Start a take and press Stop normally → indicators off, file in the Library (regression).
  3. Deny screen capture in System Settings and press Record → the start fails with the usual toast; no indicator stays on.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
