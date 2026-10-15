---
title: "24 · Recording start latency"
description: "Closes REC-A6 and REC-A9: the start path is fully serial (screen gUM → compositor → mic gUM → output.start → thumbnail with a 150 ms sleep) and main re-enumerates desktopCapturer sources twice per start for a display the renderer could pass."
---

# Recording start latency — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Status flips to "recording" roughly 0.4–0.7 s sooner with a built-in mic (up to ~1.3 s with a slow Bluetooth mic), and main does not enumerate sources during its busiest second.

**Architecture:** The engine opens the mic **in parallel** with the screen capture (screen call first — tests rely on the order; `acquireMicrophone` never rejects) and still awaits it before `output.start()` so the first spoken words are never lost. The poster thumbnail is no longer awaited on the start path: `EngineHandle.thumbnail` becomes a `Promise<ArrayBuffer | null>`, `stop()` waits for it (capped at 2 s) before releasing tracks, and the store awaits it at finalize. For REC-A9 the renderer does not actually have the display id today, so an optional `displayId` is threaded through `ScreenSource → SelectedSource → StartInput → RecordingStartInfo / cursorTrackStart`; main uses it and keeps `getSources` only as the fallback. Timing table (estimates, not measured): today `G + C + M + S + T`; after `max(G + C, M) + S`.

**Tech Stack:** `getUserMedia`, mediabunny, vitest (engine fakes, store harness, hub electron mock).

**Spec:** [Audit report](/audits/2026-10-15/report/) → REC-A6, REC-A9 in [record lens A](/audits/2026-10-15/findings/record-a/). Closes: **REC-A6, REC-A9**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- Several engine tests read `getUserMedia.mock.calls[0][0]` as the screen call: the screen call must stay the first one issued.
- Do **not** start the output before the mic resolves (the brief's "as soon as the video track exists"); silent first words are the worst failure for a screen recorder.
- Do not defer the thumbnail with a longer timer: with `showBarInRecording` on, the bar would end up in the poster. It samples ~150 ms after `output.start()` as today, just not awaited.
- Plan 01 (telemetry) sets `stats.gumMs` after the screen stream resolves — keep it screen-only after this change. Plan 20 (`releaseAll`) must await the pending `micPromise` before iterating `inputStreams`; its `stop()` try/finally keeps the poster wait **before** the `try`. Land 01 → 20 → 24.
- The display-id hint is as old as the source id the engine already trusts; if a monitor was unplugged since, `pickCapturedDisplay` falls back as today.
- Commit messages in English, conventional-commit style.

## Review Focus

1. The mic `getUserMedia` is issued before the screen promise resolves (parallel), screen first — Task 1 test.
2. Screen capture fails on both attempts → the already-opened mic is stopped — Task 1 test.
3. `startEngine` resolves even if `toBlob` never calls back; `handle.thumbnail` is a promise — Task 1 test.
4. `stop()` waits for the poster before releasing the screen track — Task 1 test.
5. `cursorTrackStart` with a `displayId` hint never calls `desktopCapturer.getSources`; without it, once — Task 3 tests.

---

### Task 1: Engine — parallel mic, deferred poster

**Files:**

- Modify: `renderer/src/features/recording/recorder-engine.ts:27-28` (handle type), `:134-149` (screen gUM), `:182`, `:200-216` (mic), `:305-309` (thumbnail), `:353-361` (`stop`)
- Test: `renderer/src/features/recording/recorder-engine.test.tsx`

**Interfaces:**

- Produces: `EngineHandle.thumbnail: Promise<ArrayBuffer | null>`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("opens the mic in parallel with the screen capture, screen first", async () => {
  let resolveScreen!: (s: MediaStream) => void;
  getUserMedia.mockImplementation((constraints: MediaStreamConstraints) =>
    constraints.video ? new Promise<MediaStream>((r) => (resolveScreen = r)) : Promise.resolve(fakeStream([], [micTrack])),
  );
  const starting = startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
  await Promise.resolve();
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect((getUserMedia.mock.calls[0][0] as MediaStreamConstraints).video).toBeTruthy();
  resolveScreen(fakeStream([screenVideoTrack], []));
  await starting;
});

it("releases the mic when the screen capture fails", async () => {
  getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
    if (constraints.video) throw new Error("denied");
    return fakeStream([], [micTrack]);
  });
  await expect(startEngine(baseOptions({ microphoneDeviceId: "mic-1" }))).rejects.toThrow("denied");
  expect(micTrack.stop).toHaveBeenCalled();
});

it("returns before the poster is encoded", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(() => {}); // never calls back
  const handle = await startEngine(baseOptions());
  expect(handle.thumbnail).toBeInstanceOf(Promise);
});

it("resolves the poster to the encoded bytes", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob([new Uint8Array([1, 2, 3])])));
  const handle = await startEngine(baseOptions());
  expect((await handle.thumbnail)!.byteLength).toBe(3);
});

it("stop() waits for the poster before releasing tracks", async () => {
  let resolveBlob!: (b: Blob | null) => void;
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => { resolveBlob = cb; });
  const handle = await startEngine(baseOptions());
  const stopping = handle.stop();
  await Promise.resolve();
  expect(screenVideoTrack.stop).not.toHaveBeenCalled();
  resolveBlob(null);
  await stopping;
  expect(screenVideoTrack.stop).toHaveBeenCalled();
});
```

(Use fake timers if the 150 ms thumbnail sleep makes the last test slow: `vi.useFakeTimers()` + `advanceTimersByTimeAsync(150)`.)

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

Handle type:

```ts
  /**
   * A still JPEG frame of the screen, taken off the start path. Never rejects;
   * resolves `null` when the frame could not be encoded.
   */
  thumbnail: Promise<ArrayBuffer | null>;
```

Replace the screen gUM block (hoisting `inputStreams` and `acquireMicrophone` above it; delete their later declarations):

```ts
  const inputStreams: MediaStream[] = [];
  const acquireMicrophone = async (deviceId: string): Promise<MediaStream | null> => {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { ideal: deviceId } } });
      inputStreams.push(mic);
      return mic;
    } catch {
      return null; // mic unavailable — continue without it
    }
  };

  const acquireScreen = async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "desktop" } } as MediaTrackConstraints,
        video: videoConstraints,
      });
    } catch (error) {
      console.warn("system audio capture unavailable — recording without it", error);
    }
    return navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  };
  // Screen call first (tests rely on the order), then the mic IMMEDIATELY, in parallel: opening a
  // Bluetooth mic can take up to ~1 s and used to sit behind the screen capture and the compositor.
  // `acquireMicrophone` never rejects, so `micPromise` cannot cause an unhandled rejection.
  const screenPromise = acquireScreen();
  const micPromise = options.microphoneDeviceId ? acquireMicrophone(options.microphoneDeviceId) : Promise.resolve(null);
  let screenStream: MediaStream;
  try {
    screenStream = await screenPromise;
  } catch (error) {
    // Do not leave the mic open (and its OS indicator on) when the screen capture fails.
    (await micPromise)?.getTracks().forEach((t) => t.stop());
    throw error;
  }
  inputStreams.push(screenStream);
  const screenTrack = screenStream.getVideoTracks()[0];
```

Replace the mic block after the compositor:

```ts
  let micGain: GainNode | null = null;
  const mic = await micPromise; // opened in parallel with the screen capture and the compositor
  if (mic) micGain = connectThroughGain(mic, true);
```

(With plan 23 landed, keep its `ended` listener and `micAcquireError` inside `acquireMicrophone`.) Thumbnail:

```ts
  // 5. Poster thumbnail, taken in the background so it never delays "recording".
  const thumbnail = captureThumbnail(screenStream, target);
```

`stop()` — first lines:

```ts
    async stop() {
      stopped = true;
      teardownStarted = true;
      // The poster reads the screen track; let it finish (bounded) before tracks stop.
      await Promise.race([thumbnail, new Promise((r) => setTimeout(r, 2000))]);
      // ...finalize + release as today (or plan 20's try/finally)
```

- [ ] **Step 4: Run and commit** — `node_modules/.bin/vitest run src/renderer/src/features/recording/recorder-engine.test.tsx` → PASS.

```bash
git add src/renderer/src/features/recording/recorder-engine.ts src/renderer/src/features/recording/recorder-engine.test.tsx
git commit -m "perf(desktop): open the mic in parallel and take the poster off the recording start path"
```

### Task 2: Store awaits the poster at finalize

**Files:**

- Modify: `renderer/src/features/recording/recorder-store.ts:355`
- Test: `renderer/src/features/recording/recorder-store.test.ts`

- [ ] **Step 1: Write the failing test** (change `fakeEngine`'s `thumbnail: null` to `thumbnail: Promise.resolve(null)`)

```ts
it("finalizes with the resolved poster bytes", async () => {
  const buf = new ArrayBuffer(4);
  startEngineMock.mockResolvedValue(fakeEngine({ thumbnail: Promise.resolve(buf) }));
  store.requestStartRecording(() => input);
  await vi.advanceTimersByTimeAsync(3000);
  await stopAndSettle();
  expect(window.electronAPI.recordingFinalize).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ thumbnail: buf }));
});
```

- [ ] **Step 2: Run to verify it fails** — the type check fails first (`thumbnail` is a promise).

- [ ] **Step 3: Implement** — in `stopRecording`'s IIFE after `await activeEngine.stop()`: `thumbnail: await activeEngine.thumbnail,`.

- [ ] **Step 4: Run and commit**

```bash
git add src/renderer/src/features/recording/recorder-store.ts src/renderer/src/features/recording/recorder-store.test.ts
git commit -m "fix(desktop): finalize awaits the deferred poster"
```

### Task 3: Display id through the chain (REC-A9)

**Files:**

- Modify: `shared/types/electron-api.ts:30-35` (`ScreenSource`), `:214` (`cursorTrackStart`); `shared/types/ipc.ts:498-513` (`RecordingStartInfo`, `RecordingSettings.selectedSource`)
- Modify: `main/recording-sources.ts:38-43`; `main/recording/recording-hub.ts:239-252`, `:267-279`, `:331-343`
- Modify: `preload/index.ts:98-99`
- Modify: `renderer/src/features/recording/types.ts`, `hooks/use-source-selection.ts:35`, `pages/record/record-page.tsx:190`, `hooks/use-recording-setup.ts:124-137`, `recorder-store.ts:26`, `:168`, `:177`, `cursor-track-session.ts:16-18`, `:30-35`, `:49-59`
- Test: `cursor-track-session.test.ts`, `recorder-store.test.ts`, `main/recording/recording-hub.test.ts`

**Interfaces:**

- Produces: optional `displayId?: string` on `ScreenSource`, `SelectedSource`, `StartInput`, `RecordingStartInfo`, `RecordingSettings.selectedSource`; `cursorTrackStart(sessionId, sourceId, displayId?)`; hub `resolveDisplayId(sourceId, hint?)`.

- [ ] **Step 1: Write the failing tests**

`cursor-track-session.test.ts`:

```ts
it("forwards the display id to main", async () => {
  const { api, now } = fakeApi(true, 0);
  const calls: unknown[][] = [];
  api.cursorTrackStart = async (...args) => { calls.push(args); return { enabled: true }; };
  await beginCursorTrackSession(api, "s", "screen:1:0", { now, displayId: "123" });
  expect(calls[0]).toEqual(["s", "screen:1:0", "123"]);
});
```

`recorder-store.test.ts`:

```ts
it("passes the display id to recordingStart and cursorTrackStart", async () => {
  window.electronAPI.cursorTrackStart = vi.fn(async () => ({ enabled: false }));
  store.requestStartRecording(() => ({ ...input, displayId: "123" }));
  await vi.advanceTimersByTimeAsync(3000);
  expect(window.electronAPI.recordingStart).toHaveBeenCalledWith(expect.objectContaining({ displayId: "123" }));
  expect(window.electronAPI.cursorTrackStart).toHaveBeenCalledWith(expect.any(String), input.sourceId, "123");
  await stopAndSettle();
});
```

`recording-hub.test.ts` (add `screen.getAllDisplays: () => [{ id: 123, bounds: { x: 0, y: 0, width: 100, height: 100 }, scaleFactor: 2 }]` to the mock; mock `./click-hook` if the real hook misbehaves):

```ts
it("cursorTrackStart with a display id hint never enumerates sources", async () => {
  await registerHub();
  expect(await ipcHandle(IPC_CHANNELS.cursorTrackStart)({}, "s1", "screen:1:0", "123")).toEqual({ enabled: true });
  expect(mockState.getSources).not.toHaveBeenCalled();
  await ipcHandle(IPC_CHANNELS.recordingAbort)({}, "s1");
});
it("cursorTrackStart without a hint enumerates sources once", async () => {
  await registerHub();
  mockState.getSources.mockResolvedValueOnce([{ id: "screen:1:0", display_id: "123" }]);
  await ipcHandle(IPC_CHANNELS.cursorTrackStart)({}, "s1", "screen:1:0");
  expect(mockState.getSources).toHaveBeenCalledTimes(1);
  await ipcHandle(IPC_CHANNELS.recordingAbort)({}, "s1");
});
it("recordingStart with a display id shows the bar without enumerating sources", async () => {
  await registerHub();
  ipcOn(IPC_CHANNELS.recordingStart)({}, { sourceId: "screen:1:0", sourceName: "s", displayId: "123" });
  await Promise.resolve();
  expect(mockState.bar.show).toHaveBeenCalledWith("123", expect.anything());
  expect(mockState.getSources).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

Types: `ScreenSource.displayId?: string` ("desktopCapturer display_id; absent for windows or when the platform reports none"); `RecordingStartInfo.displayId?: string`; `RecordingSettings.selectedSource.displayId?: string`; `SelectedSource.displayId?: string`; `StartInput.displayId?: string`; `cursorTrackStart(sessionId: string, sourceId: string, displayId?: string)`.

`main/recording-sources.ts` map: `displayId: source.display_id || undefined,`. Both `selectSource({ id, name, type })` call sites add `displayId: source.displayId`. `use-recording-setup.ts` StartInput: `displayId: source.displayId,`. `recorder-store.ts`: `recordingStart({ sourceId: input.sourceId, sourceName: input.sourceName, displayId: input.displayId })` and `beginCursorTrackSession(window.electronAPI, id, input.sourceId, { displayId: input.displayId })`. `cursor-track-session.ts`: `CursorTrackApi.cursorTrackStart(sessionId, sourceId, displayId?)`, `CursorTrackSessionOptions.displayId?: string`, call `api.cursorTrackStart(sessionId, sourceId, options.displayId)`; update the header comment. `preload/index.ts`: `cursorTrackStart: (sessionId, sourceId, displayId) => ipcRenderer.invoke(IPC_CHANNELS.cursorTrackStart, sessionId, sourceId, displayId),`.

Hub:

```ts
  /** The renderer already knows the display id of the source it picked; ask the OS only without it. */
  async function resolveDisplayId(sourceId: string, hint?: string): Promise<string | undefined> {
    if (typeof hint === "string" && hint !== "") return hint;
    return displayIdForSource(sourceId);
  }
```

`cursorTrackStart` handler: `async (_e, sessionId: string, sourceId: string, displayId?: string)` using `await resolveDisplayId(sourceId, displayId)`. `recordingStart`: `void resolveDisplayId(info.sourceId, info.displayId).then((displayId) => bar.show(displayId, { includeInRecording }));` (keep plan 21's generation guard if present). Check `applySettingsPatch` keeps unknown fields so `selectedSource.displayId` survives the mirror.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/recording src/main/recording && bun run check-types` → PASS.

```bash
git add src/shared/types src/main/recording-sources.ts src/main/recording/recording-hub.ts src/main/recording/recording-hub.test.ts src/preload/index.ts src/renderer/src/features/recording src/renderer/src/pages/record/record-page.tsx
git commit -m "perf(desktop): the renderer passes the display id so main stops re-enumerating sources at start"
```

### Task 4: Ship

- [ ] Open a PR titled `perf(desktop): faster recording start — parallel mic, deferred poster, no source re-enumeration (audit REC-A6, REC-A9)` linking this plan and both findings; include the timing table and say the numbers are estimates. End with **How to test it yourself** (`bun run dev`):
  1. Record with the built-in mic and note the gap from "1" to the bar clock starting; repeat with a Bluetooth headset as the mic → both shorter than before (with plan 01, compare `recording_completed.startMs`).
  2. The saved clip has a poster in the Library; the first spoken word after the countdown is present.
  3. A take with the mic off works; a **window** source records (no cursor track); a screen take still has its cursor track.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
