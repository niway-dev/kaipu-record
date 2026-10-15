---
title: "23 · Mic failure feedback"
description: "Closes REC-A5: when the mic fails to open at start (or dies mid-take) the take records without voice while every surface still shows the mic as on."
---

# Mic failure feedback — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A take whose microphone is not capturing says so: every mic toggle shows "off", the control bar shows a muted-mic icon instead of the level meter, and a toast with Retry explains it.

**Architecture:** The engine exposes `hasMicrophone` / `microphoneStartError` on the handle and an `onMicrophoneLost` option (fired once when the acquired mic's track `ended`; the gain is released so a later enable re-acquires). The store's `forwardLiveSettings` writes `isMicrophoneEnabled: false` back through the existing `updateRecordingSettings` channel (the real contract — there is no `recording:settings-update { microphone }`), reports `record.micUnavailable` with a Retry that flips the setting back on, and sets a `microphoneUnavailable` flag that rides on the existing `RecordingTick` to the control bar. The bar swaps `MicLevel` for a `MicOff` icon. No hub or `RecordingActivity` change.

**Tech Stack:** WebRTC `MediaStreamTrack` `ended`, existing settings mirror + tick channel, lucide `MicOff`, vitest (engine fakes, store live-settings harness, control-bar RTL).

**Spec:** [Audit report](/audits/2026-10-15/report/) → REC-A5 in [record lens A](/audits/2026-10-15/findings/record-a/). Closes: **REC-A5**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- A toast fired mid-take is **invisible**: the main window is hidden during a take and `ToastHost` renders only there (5 s). The bar icon is the cue the user actually sees; the toast + Retry matter once the window is back. Say so in the PR.
- `EngineHandle` gains two required members: update the fake in `recorder-store.test.ts` (`hasMicrophone: true, microphoneStartError: null`) or the type check fails.
- `let stopped` moves above the mic block (the `ended` handler reads it); delete the later declaration or it fails to compile.
- An unplugged device is not an error at start (`deviceId: { ideal }` falls back to the default mic); it surfaces as an `ended` track mid-take. `NotAllowedError`/`NotReadableError` are the real start triggers.
- Not in scope: the late-acquire failure (user turns the mic on mid-take) still writes back silently; follow-up is to call `failMicrophone` from that branch.
- Plans 20 and 24 edit the same engine region (`releaseAll`, parallel mic open); land 20 → 24 → 23 or rebase: keep `acquireMicrophone`'s `ended` listener and `micAcquireError` whichever shape the mic open has.
- i18n keys go in `packages/i18n/messages/{en,es}.json` (`record` and `panel` namespaces), neutral Spanish.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Mic denied at start → `handle.hasMicrophone === false`, `microphoneStartError` is the thrown error, the take still starts — Task 1 test.
2. Mic track `ended` mid-take → `onMicrophoneLost` once; a later `setMicrophoneEnabled(true)` re-acquires (third `getUserMedia`) — Task 1 test.
3. Store: start with a failed mic → `updateSettings({ isMicrophoneEnabled: false })` and one `micUnavailable` report with `phase: "mic-start"`; no mic requested → nothing — Task 2 tests.
4. Tick carries `microphoneUnavailable: true` after a failure and `false` after a successful retry — Task 2 test.
5. Bar renders the muted-mic icon with an accessible name when the tick says so — Task 3 test.

---

### Task 1: Engine reports the mic's state

**Files:**

- Modify: `renderer/src/features/recording/recorder-engine.ts:20-47` (`EngineHandle`, `EngineOptions`), `:200-216` (mic acquisition), `:292-294` (`stopped`), the returned handle (`:324+`)
- Test: `renderer/src/features/recording/recorder-engine.test.tsx`

**Interfaces:**

- Produces: `EngineHandle.hasMicrophone: boolean`, `EngineHandle.microphoneStartError: unknown`, `EngineOptions.onMicrophoneLost?(error: unknown): void`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("exposes hasMicrophone=false and the error when the mic cannot be opened at start", async () => {
  const err = new Error("NotAllowedError");
  getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
    if (constraints.video) return fakeStream([screenVideoTrack], []);
    throw err;
  });
  const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
  expect(handle.hasMicrophone).toBe(false);
  expect(handle.microphoneStartError).toBe(err);
  expect(lastOutput().addVideoTrack).toHaveBeenCalled();
});

it("exposes hasMicrophone=true and no error when the mic opens", async () => {
  const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
  expect(handle.hasMicrophone).toBe(true);
  expect(handle.microphoneStartError).toBeNull();
});

it("reports hasMicrophone=false with no error when no mic was requested", async () => {
  const handle = await startEngine(baseOptions({ microphoneDeviceId: null }));
  expect(handle.hasMicrophone).toBe(false);
  expect(handle.microphoneStartError).toBeNull();
});

it("calls onMicrophoneLost once when the mic track ends mid-take, then re-acquires on re-enable", async () => {
  const onMicrophoneLost = vi.fn();
  const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1", onMicrophoneLost }));
  const ended = micTrack.addEventListener.mock.calls.find((c) => c[0] === "ended")![1] as () => void;
  ended();
  ended();
  expect(onMicrophoneLost).toHaveBeenCalledTimes(1);
  expect(await handle.setMicrophoneEnabled(true, "mic-1")).toBe("ok");
  expect(getUserMedia).toHaveBeenCalledTimes(3); // screen, mic, mic again
});

it("ignores a mic track ended event after stop", async () => {
  const onMicrophoneLost = vi.fn();
  const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1", onMicrophoneLost }));
  const ended = micTrack.addEventListener.mock.calls.find((c) => c[0] === "ended")![1] as () => void;
  await handle.stop();
  ended();
  expect(onMicrophoneLost).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/recording/recorder-engine.test.tsx` → type errors / `undefined`.

- [ ] **Step 3: Implement**

`EngineHandle`, after `hasSystemAudio`:

```ts
  /** True when the microphone requested at start was acquired. False if none was requested or it failed. */
  hasMicrophone: boolean;
  /** The error that stopped the microphone opening at start, or `null`. */
  microphoneStartError: unknown;
```

`EngineOptions`, after `onError`:

```ts
  /**
   * Fires once when an acquired microphone dies mid-take (its track `ended`:
   * device unplugged, permission revoked). The take keeps running; the mic's
   * gain is released so a later `setMicrophoneEnabled(true)` re-acquires it.
   */
  onMicrophoneLost?(error: unknown): void;
```

Replace the mic block (and move `let stopped` above it, deleting the later declaration):

```ts
  /** Set by stop(); a live toggle arriving after it is answered "unavailable". */
  let stopped = false;
  let micGain: GainNode | null = null;
  /** The error from the most recent failed mic acquisition. */
  let micAcquireError: unknown = null;
  const acquireMicrophone = async (deviceId: string): Promise<MediaStream | null> => {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { ideal: deviceId } } });
      inputStreams.push(mic);
      // A track that dies mid-take (unplugged / permission revoked) fires `ended`;
      // our own stop() uses track.stop(), which does not fire it.
      mic.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (stopped || !micGain) return;
        micGain = null; // a later enable re-acquires instead of ramping a dead source
        options.onMicrophoneLost?.(new Error("microphone track ended"));
      });
      return mic;
    } catch (error) {
      micAcquireError = error;
      return null; // mic unavailable — continue without it
    }
  };

  if (options.microphoneDeviceId) {
    const mic = await acquireMicrophone(options.microphoneDeviceId);
    if (mic) micGain = connectThroughGain(mic, true);
  }
  const microphoneStartError = micGain ? null : micAcquireError;
```

Handle literal, after `hasSystemAudio: sysGain !== null,`: `hasMicrophone: micGain !== null, microphoneStartError,`.

- [ ] **Step 4: Run and commit** — PASS.

```bash
git add src/renderer/src/features/recording/recorder-engine.ts src/renderer/src/features/recording/recorder-engine.test.tsx
git commit -m "feat(desktop): the recorder engine reports whether the microphone is capturing"
```

### Task 2: Store writes back, reports, and flags the tick

**Files:**

- Modify: `shared/types/ipc.ts:415-431` (`RecordingTick`)
- Modify: `renderer/src/features/recording/recorder-store.ts:70-77` (state), `:178-200` (options), `:224-233` (tick), `:262-303` (`forwardLiveSettings`)
- Modify: `packages/i18n/messages/en.json`, `es.json`
- Test: `renderer/src/features/recording/recorder-store.test.ts`

**Interfaces:**

- Produces: `RecordingTick.microphoneUnavailable?: boolean`; i18n `record.micUnavailable`, `panel.micUnavailable`.

- [ ] **Step 1: Write the failing tests** (live-settings describe: `startWith(engine, over)`, `broadcast(patch)`, `updateSettings`, `stopAndSettle()`; add `hasMicrophone: true, microphoneStartError: null` to `fakeEngine`)

```ts
it("writes the mic back to off and reports it when the mic failed to open at start", async () => {
  const boom = new Error("NotReadableError");
  await startWith(fakeEngine({ hasMicrophone: false, microphoneStartError: boom }));
  expect(updateSettings).toHaveBeenCalledWith({ isMicrophoneEnabled: false });
  expect(reportErrorMock).toHaveBeenCalledWith(
    messages.record.micUnavailable, boom,
    expect.objectContaining({ context: expect.objectContaining({ phase: "mic-start" }) }),
  );
  await stopAndSettle();
});

it("does not touch the mic when none was requested", async () => {
  await startWith(fakeEngine({ hasMicrophone: false }), { microphoneDeviceId: null });
  expect(updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ isMicrophoneEnabled: false }));
  expect(reportErrorMock).not.toHaveBeenCalled();
  await stopAndSettle();
});

it("retry re-enables the mic through the settings channel", async () => {
  await startWith(fakeEngine({ hasMicrophone: false, microphoneStartError: new Error("x") }));
  reportErrorMock.mock.calls.at(-1)![2]!.retry!();
  expect(updateSettings).toHaveBeenCalledWith({ isMicrophoneEnabled: true });
  await stopAndSettle();
});

it("a mic lost mid-take is written back and reported once", async () => {
  let lost: ((e: unknown) => void) | undefined;
  startEngineMock.mockImplementation(async (opts) => { lost = opts.onMicrophoneLost; return fakeEngine(); });
  await startWith(fakeEngine());
  lost!(new Error("ended"));
  lost!(new Error("ended"));
  expect(updateSettings).toHaveBeenCalledWith({ isMicrophoneEnabled: false });
  expect(reportErrorMock).toHaveBeenCalledTimes(1);
  expect(reportErrorMock.mock.calls[0][2]).toMatchObject({ context: { phase: "mic-ended" } });
  await stopAndSettle();
});

it("tick carries microphoneUnavailable after a failure and clears when a retry succeeds", async () => {
  await startWith(fakeEngine({ hasMicrophone: false, microphoneStartError: new Error("x"), setMicrophoneEnabled: vi.fn(async () => "ok" as const) }));
  await vi.advanceTimersByTimeAsync(100);
  expect(window.electronAPI.recordingReportTick).toHaveBeenCalledWith(expect.objectContaining({ microphoneUnavailable: true }));
  broadcast({ isMicrophoneEnabled: true });
  await vi.advanceTimersByTimeAsync(100);
  expect(window.electronAPI.recordingReportTick).toHaveBeenLastCalledWith(expect.objectContaining({ microphoneUnavailable: false }));
  await stopAndSettle();
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`shared/types/ipc.ts` `RecordingTick`, after `systemAudioAvailable?: boolean;`:

```ts
  /**
   * True when the microphone was requested for this take but is not capturing
   * (failed to open, or its track ended). The bar swaps the level meter for a
   * muted-mic icon so the user can see the take has no voice.
   */
  microphoneUnavailable?: boolean;
```

`recorder-store.ts` — after the `stopLiveSettings` declaration:

```ts
/** Routes an engine "mic died mid-take" event to the active take's forwarder. */
let onMicrophoneLost: ((error: unknown) => void) | null = null;
/** The take asked for a mic that is not capturing (drives the bar's muted-mic icon). */
let microphoneUnavailable = false;
```

`startEngine({ … })` options: `onMicrophoneLost: (error) => onMicrophoneLost?.(error),`. Tick: `microphoneUnavailable,` after `systemAudioAvailable`. In `forwardLiveSettings`, after the `writeBack` const and before the system-audio block:

```ts
  microphoneUnavailable = false;
  const failMicrophone = (error: unknown, phase: "mic-start" | "mic-ended"): void => {
    micOn = false;
    microphoneUnavailable = true;
    writeBack({ isMicrophoneEnabled: false }); // every toggle shows "off"
    reportError(runtimeT()("record.micUnavailable"), error, {
      context: { sourceId: input.sourceId, phase },
      // Flipping the setting back on goes through the normal late-acquire path below.
      retry: () => {
        if (active) window.electronAPI.updateRecordingSettings({ isMicrophoneEnabled: true });
      },
    });
  };
  // Mic requested but not capturing: do not let the toggles claim "on".
  if (input.microphoneDeviceId !== null && !handle.hasMicrophone) {
    failMicrophone(handle.microphoneStartError ?? new Error("microphone unavailable"), "mic-start");
  }
  onMicrophoneLost = (error) => {
    if (micOn) failMicrophone(error, "mic-ended");
  };
```

In the queue callback add `else if (result === "ok" && on) microphoneUnavailable = false;` after the `unavailable` branch. In the returned cleanup add `onMicrophoneLost = null; microphoneUnavailable = false;`. (`failMicrophone` sets `micOn = false` before the listener registers, so the echo of our own write-back is a no-op.)

i18n — `record` (after `errorSave`): en `"micUnavailable": "The microphone isn't available, so this recording has no voice. Check the microphone permission and that no other app is using it."`; es `"micUnavailable": "El micrófono no está disponible, así que esta grabación no tiene voz. Revisa el permiso del micrófono y que ninguna otra aplicación lo esté usando."`. `panel` (after `captureScreen`): en `"micUnavailable": "Microphone unavailable"`, es `"micUnavailable": "Micrófono no disponible"`.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/recording/recorder-store.test.ts && bun run check-types` → PASS.

```bash
git add src/shared/types/ipc.ts src/renderer/src/features/recording/recorder-store.ts src/renderer/src/features/recording/recorder-store.test.ts ../../packages/i18n/messages/en.json ../../packages/i18n/messages/es.json
git commit -m "fix(desktop): a take without a working mic says so everywhere and offers a retry"
```

### Task 3: Control bar icon

**Files:**

- Modify: `renderer/src/features/control-bar/control-bar.tsx:2`, `:43-48`; `control-bar.module.css`
- Test: `renderer/src/features/control-bar/control-bar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("swaps the level meter for a muted-mic icon when the mic is unavailable", () => {
  render(<ControlBar tick={{ ...baseTick, microphoneUnavailable: true }} onPause={vi.fn()} onResume={vi.fn()} onStop={vi.fn()} />);
  expect(screen.getByRole("img", { name: /microphone unavailable/i })).toBeInTheDocument();
});
it("shows the level meter when the mic is fine", () => {
  render(<ControlBar tick={baseTick} onPause={vi.fn()} onResume={vi.fn()} onStop={vi.fn()} />);
  expect(screen.queryByRole("img", { name: /microphone unavailable/i })).toBeNull();
});
```

- [ ] **Step 2: Run to verify the first fails.**

- [ ] **Step 3: Implement**

`import { Loader2, MicOff, Pause, Play, Square } from "lucide-react";` and (the component already has `t` for the `panel` namespace — check; otherwise add `const t = useTranslations("panel")`):

```tsx
      {!paused && (
        <>
          <span className={styles.divider} />
          {tick.microphoneUnavailable ? (
            <MicOff size={16} className={styles.micOff} role="img" aria-label={t("micUnavailable")} />
          ) : (
            <MicLevel levels={tick.levels} />
          )}
        </>
      )}
```

CSS next to `.meter` (use the stylesheet's existing danger/warning token if there is one):

```css
.micOff {
  -webkit-app-region: no-drag;
  color: var(--danger, #e5484d);
}
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/control-bar && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/control-bar
git commit -m "feat(desktop): the control bar shows a muted-mic icon when the take has no voice"
```

### Task 4: Ship

- [ ] Open a PR titled `fix(desktop): tell the user when a take has no microphone (audit REC-A5)` linking this plan and the finding; state that the toast is only visible once the window is back and name the late-acquire follow-up. End with **How to test it yourself**:
  1. System Settings → Privacy → Microphone: revoke Kaipu. Start a take with the mic on → the bar shows the muted-mic icon instead of the meter; after Stop, the Record page mic toggle is off and the toast with Retry appears.
  2. Re-grant the permission, press Retry → the toggle turns on.
  3. With a USB mic selected, unplug it mid-take → the icon appears; the take finishes normally.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
