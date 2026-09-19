import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types";
import type { ControlCommand } from "@shared/types/ipc";
import { startEngine, type EngineHandle } from "@renderer/features/recording/recorder-engine";
import { reportError } from "@renderer/features/analytics";
import { DEFAULT_LOCALE } from "@kaipu/i18n";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";

// Assert the copy the store actually emits, resolved for whatever locale the app
// falls back to — hard-coding a Spanish word here broke the moment the default
// became English.
const messages = DEFAULT_LOCALE === "es" ? es : en;

vi.mock("@renderer/features/recording/recorder-engine", () => ({ startEngine: vi.fn() }));
vi.mock("@renderer/features/analytics", () => ({ reportError: vi.fn() }));

const startEngineMock = vi.mocked(startEngine);
const reportErrorMock = vi.mocked(reportError);

const callOrder: string[] = [];
const commands: Array<(command: ControlCommand) => void> = [];
const recordingCreateMock = vi.fn(async () => {
  callOrder.push("recordingCreate");
  return { tempPath: "/tmp/s" };
});
const recordingStartMock = vi.fn(() => callOrder.push("recordingStart"));
const recordingStopMock = vi.fn(() => callOrder.push("recordingStop"));
window.electronAPI.recordingCreate = recordingCreateMock;
window.electronAPI.recordingStart = recordingStartMock;
window.electronAPI.recordingStop = recordingStopMock;
window.electronAPI.onRecordingCommand = vi.fn((callback) => {
  commands.push(callback);
  return () => {};
});

// The store registers its command listener as a MODULE-LEVEL side effect at
// import time (that's the whole point — it must outlive any page's mount), so
// the `window.electronAPI.onRecordingCommand` mock above MUST be in place
// before this import runs. Vitest supports top-level await for exactly this.
const store = await import("./recorder-store");

const RECORDING: LocalRecording = {
  id: "recording-x",
  assetId: "00000000-0000-0000-0000-000000000001",
  title: "T",
  filePath: "/vault/recording-x.mp4",
  createdAt: 1,
  sizeBytes: 10,
  durationSeconds: 5,
  thumbnailUrl: null,
  kind: "recording",
  derivedFromAssetId: null,
  contentSha256: null,
};

const input = {
  sourceId: "screen:1",
  sourceName: "Screen 1",
  microphoneDeviceId: "mic-1",
  systemAudio: false,
};

function fakeEngine(): EngineHandle {
  return {
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => {}),
    readLevels: vi.fn(() => [0, 0, 0, 0, 0]),
    thumbnail: null,
  };
}

describe("recorder-store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    callOrder.length = 0;
    recordingCreateMock.mockClear();
    recordingStartMock.mockClear();
    recordingStopMock.mockClear();
    startEngineMock.mockReset();
    startEngineMock.mockResolvedValue(fakeEngine());
    reportErrorMock.mockClear();
    window.electronAPI.recordingWrite = vi.fn();
    window.electronAPI.recordingFinalize = vi.fn(async () => RECORDING);
    window.electronAPI.recordingAbort = vi.fn(async () => {});
    window.electronAPI.recordingReportTick = vi.fn();
    // Every test must leave the store idle for the next one — assert that
    // invariant up front so a leaky test fails loudly instead of silently
    // breaking an unrelated later test via a stuck non-idle status.
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down 3 → 2 → 1, hides the window BEFORE the engine acquires streams, then records", async () => {
    startEngineMock.mockImplementation(async () => {
      callOrder.push("startEngine");
      return fakeEngine();
    });

    store.requestStartRecording(() => input);
    expect(store.getRecorderSnapshot()).toEqual({ status: "counting", countdown: 3 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getRecorderSnapshot().countdown).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getRecorderSnapshot().countdown).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.getRecorderSnapshot().status).toBe("recording");
    expect(window.electronAPI.recordingCreate).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingStart).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "screen:1", sourceName: "Screen 1" }),
    );
    // The window-hide (recordingStart) must precede the engine acquiring streams.
    expect(callOrder).toEqual(["recordingStart", "recordingCreate", "startEngine"]);

    await stopAndSettle();
  });

  it("cancelling during the countdown never starts the engine", async () => {
    store.requestStartRecording(() => input);
    store.stopOrCancelRecording();

    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    await vi.advanceTimersByTimeAsync(5000);
    expect(startEngineMock).not.toHaveBeenCalled();
    expect(window.electronAPI.recordingCreate).not.toHaveBeenCalled();
  });

  it("a 'stop' command relayed from the bar cancels a pending countdown instead of being ignored", async () => {
    store.requestStartRecording(() => input);
    commands[0]("stop");

    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    await vi.advanceTimersByTimeAsync(5000);
    expect(startEngineMock).not.toHaveBeenCalled();
  });

  it("cancelling during the 'starting' gap (engine acquiring) aborts once the engine resolves", async () => {
    let resolveEngine!: (handle: EngineHandle) => void;
    const engine = fakeEngine();
    startEngineMock.mockImplementation(() => new Promise((resolve) => (resolveEngine = resolve)));

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("starting");

    store.stopOrCancelRecording(); // arrives during the acquire gap — no engine yet
    resolveEngine(engine);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.stop).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  it("pause and resume drive the engine and the status", async () => {
    const engine = fakeEngine();
    startEngineMock.mockResolvedValue(engine);
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);

    store.pauseRecording();
    expect(engine.pause).toHaveBeenCalledOnce();
    expect(store.getRecorderSnapshot().status).toBe("paused");

    store.resumeRecording();
    expect(engine.resume).toHaveBeenCalledOnce();
    expect(store.getRecorderSnapshot().status).toBe("recording");

    await stopAndSettle();
  });

  it("stop shows Saving, finalizes, notifies completion listeners, restores the window", async () => {
    const engine = fakeEngine();
    startEngineMock.mockResolvedValue(engine);
    const onComplete = vi.fn();
    const unsubscribe = store.subscribeRecordingComplete(onComplete);

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("recording");

    store.stopOrCancelRecording();
    await vi.advanceTimersByTimeAsync(700); // clear the MIN_SAVING_MS dwell

    expect(window.electronAPI.recordingReportTick).toHaveBeenCalledWith(
      expect.objectContaining({ status: "saving" }),
    );
    expect(engine.stop).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(RECORDING);
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    unsubscribe();
  });

  it("tears down and restores the window when the engine fails mid-recording", async () => {
    let onError: ((error: unknown) => void) | undefined;
    startEngineMock.mockImplementation(async (opts) => {
      onError = opts.onError;
      return fakeEngine();
    });
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("recording");

    onError?.(new Error("screen capture ended"));
    await vi.advanceTimersByTimeAsync(700);

    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(reportErrorMock).toHaveBeenCalledWith(
      messages.record.errorStopped,
      expect.any(Error),
      expect.objectContaining({ retry: expect.any(Function) }),
    );
  });

  it("aborts the session, undoes the early window-hide, and returns to idle when the engine fails to start", async () => {
    startEngineMock.mockRejectedValue(new Error("getDisplayMedia denied"));

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);

    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce(); // undoes the hide
    // Idle (not a stuck "error" state) — the Start button is usable right away.
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  it("ignores a second start request while one is already in progress", async () => {
    store.requestStartRecording(() => input);
    store.requestStartRecording(() => input); // must no-op — already counting

    await vi.advanceTimersByTimeAsync(3000);
    expect(window.electronAPI.recordingCreate).toHaveBeenCalledOnce();

    await stopAndSettle();
  });
});

/** Drives an active recording back to idle so the next test starts clean. */
async function stopAndSettle(): Promise<void> {
  store.stopOrCancelRecording();
  await vi.advanceTimersByTimeAsync(700);
}
