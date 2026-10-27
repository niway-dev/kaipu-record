import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LocalRecording, RecordingSettings } from "@shared/types";
import type { AppSettings, ControlCommand } from "@shared/types/ipc";
import {
  prepareEngine,
  type EngineHandle,
  type EngineOptions,
} from "@renderer/features/recording/recorder-engine";
// Type-only (erased at runtime), so it does not run the store's import-time side effect early.
import type { StartInput } from "./recorder-store";
import { reportError } from "@renderer/features/analytics";
import { DEFAULT_LOCALE } from "@kaipu/i18n";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";

// Assert the copy the store actually emits, resolved for whatever locale the app
// falls back to — hard-coding a Spanish word here broke the moment the default
// became English.
const messages = DEFAULT_LOCALE === "es" ? es : en;

vi.mock("@renderer/features/recording/recorder-engine", () => ({ prepareEngine: vi.fn() }));
vi.mock("@renderer/features/analytics", () => ({ reportError: vi.fn() }));

const prepareEngineMock = vi.mocked(prepareEngine);
const reportErrorMock = vi.mocked(reportError);

const callOrder: string[] = [];
const appSettingsListeners: Array<(settings: AppSettings) => void> = [];
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
// The countdown length is read live: the store primes it with getSettings and follows the
// settings broadcast, both at import time.
window.electronAPI.onSettingsChanged = vi.fn((callback) => {
  appSettingsListeners.push(callback);
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

function fakeEngine(over: Partial<EngineHandle> = {}): EngineHandle {
  return {
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => {}),
    readLevels: vi.fn(() => [0, 0, 0, 0, 0]),
    thumbnail: Promise.resolve(null),
    outputSize: { width: 1662, height: 1080 },
    firstMediaTimestamp: Promise.resolve({ rendererMs: 0, quality: "estimated" as const }),
    hasSystemAudio: true,
    setMicrophoneEnabled: vi.fn(async () => "ok" as const),
    setSystemAudioEnabled: vi.fn(() => "ok" as const),
    ...over,
  };
}

/** A take acquired but not begun (`prepareEngine`): `begin` hands out `handle`. */
interface FakePrepared {
  begin: Mock<() => Promise<EngineHandle>>;
  release: Mock<() => void>;
}
function fakePrepared(handle: EngineHandle = fakeEngine()): FakePrepared {
  return {
    begin: vi.fn(async () => {
      callOrder.push("begin");
      return handle;
    }),
    release: vi.fn(),
  };
}

/** A `prepareEngine` that settles when the test says so, and the options it was given. */
function pendingPrepare(): {
  resolve: (prepared: FakePrepared) => void;
  reject: (error: unknown) => void;
  options: () => EngineOptions;
} {
  let resolve!: (prepared: FakePrepared) => void;
  let reject!: (error: unknown) => void;
  let options: EngineOptions | null = null;
  prepareEngineMock.mockImplementation((opts) => {
    options = opts;
    return new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return {
    resolve: (prepared) => resolve(prepared),
    reject: (error) => reject(error),
    options: () => options!,
  };
}

describe("recorder-store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    callOrder.length = 0;
    recordingCreateMock.mockClear();
    recordingStartMock.mockClear();
    recordingStopMock.mockClear();
    prepareEngineMock.mockReset();
    prepareEngineMock.mockImplementation(async () => fakePrepared());
    reportErrorMock.mockClear();
    window.electronAPI.recordingWrite = vi.fn();
    window.electronAPI.recordingFinalize = vi.fn(async () => RECORDING);
    window.electronAPI.recordingAbort = vi.fn(async () => {});
    window.electronAPI.recordingReportTick = vi.fn();
    window.electronAPI.waitForCountdownVisible = vi.fn(async () => {});
    // The app is already out of sight (a region countdown) unless a test says otherwise.
    window.electronAPI.recordingHideMainWindow = vi.fn(async () => false);
    window.electronAPI.reportRecordTiming = vi.fn();
    // Every test must leave the store idle for the next one — assert that
    // invariant up front so a leaky test fails loudly instead of silently
    // breaking an unrelated later test via a stuck non-idle status.
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down 3 → 2 → 1 while acquiring the take, then hides the window before it encodes", async () => {
    prepareEngineMock.mockImplementation(async () => {
      callOrder.push("prepareEngine");
      return fakePrepared();
    });

    store.requestStartRecording(() => input);
    expect(store.getRecorderSnapshot()).toEqual({ status: "counting", countdown: 3 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getRecorderSnapshot().countdown).toBe(2);
    // Acquired during the countdown; the app is left where it is and nothing is encoded.
    expect(callOrder).toEqual(["recordingCreate", "prepareEngine"]);
    expect(window.electronAPI.recordingStart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getRecorderSnapshot().countdown).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.getRecorderSnapshot().status).toBe("recording");
    expect(window.electronAPI.recordingCreate).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingStart).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "screen:1", sourceName: "Screen 1" }),
    );
    // The window-hide (recordingStart) must precede the first encoded frame (begin).
    expect(callOrder).toEqual(["recordingCreate", "prepareEngine", "recordingStart", "begin"]);

    await stopAndSettle();
  });

  it("holds the first tick until main says the countdown is on screen", async () => {
    let visible!: () => void;
    window.electronAPI.waitForCountdownVisible = vi.fn(
      () => new Promise<void>((resolve) => (visible = resolve)),
    );
    store.requestStartRecording(() => input);
    // The shade is still loading: "3" stays, however long that takes (up to the cap).
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getRecorderSnapshot().countdown).toBe(3);

    visible();
    await vi.advanceTimersByTimeAsync(999);
    expect(store.getRecorderSnapshot().countdown).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getRecorderSnapshot().countdown).toBe(2);
    store.stopOrCancelRecording();
  });

  it("runs the countdown anyway when main never says it is visible", async () => {
    window.electronAPI.waitForCountdownVisible = vi.fn(() => new Promise<void>(() => {}));
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getRecorderSnapshot().countdown).toBe(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getRecorderSnapshot().countdown).toBe(2);
    store.stopOrCancelRecording();
  });

  it("stays cancelled when cancelled while waiting for the countdown to show", async () => {
    let visible!: () => void;
    window.electronAPI.waitForCountdownVisible = vi.fn(
      () => new Promise<void>((resolve) => (visible = resolve)),
    );
    store.requestStartRecording(() => input);
    store.stopOrCancelRecording();
    visible();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.getRecorderSnapshot().status).toBe("idle");
    expect(window.electronAPI.recordingCreate).not.toHaveBeenCalled();
  });

  it("reports each pending phase to main so the countdown can be drawn on the region", async () => {
    const reports = vi.fn();
    window.electronAPI.reportRecorderPhase = reports;
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(1000);
    store.stopOrCancelRecording();
    expect(reports.mock.calls.map(([report]) => report)).toEqual([
      { phase: "counting", value: 3 },
      { phase: "counting", value: 2 },
      { phase: "idle" },
    ]);

    reports.mockClear();
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("recording");
    expect(reports.mock.calls.map(([report]) => report)).toEqual([
      { phase: "counting", value: 3 },
      { phase: "counting", value: 2 },
      { phase: "counting", value: 1 },
      { phase: "starting" },
    ]);
    await stopAndSettle();
  });

  it("resolves the take's input again when the countdown ends, and acquires again when it changed", async () => {
    // Main starts a take chosen on the overlay by broadcasting the new source and area, then
    // requesting a start; the broadcast may reach React after the request. The take records
    // what the input says when the countdown ends (see applyRecordTarget): an acquisition made
    // during the countdown with an older input is released, not recorded.
    let current: StartInput = input;
    const early = fakePrepared();
    const fresh = fakePrepared();
    prepareEngineMock.mockResolvedValueOnce(early).mockResolvedValueOnce(fresh);
    store.requestStartRecording(() => current);
    await vi.advanceTimersByTimeAsync(1000);
    expect(prepareEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "screen:1" }),
    );

    const area = {
      displayId: 2,
      rect: { x: 0, y: 0, width: 640, height: 360 },
      displaySize: { width: 1512, height: 982 },
    };
    current = { ...input, sourceId: "screen:2", sourceName: "Area", area };
    await vi.advanceTimersByTimeAsync(2000);

    expect(window.electronAPI.recordingStart).toHaveBeenCalledWith({
      sourceId: "screen:2",
      sourceName: "Area",
      area,
    });
    expect(prepareEngineMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceId: "screen:2", area }),
    );
    expect(early.begin).not.toHaveBeenCalled();
    expect(early.release).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce(); // the early take's file
    expect(fresh.begin).toHaveBeenCalledOnce();
    expect(store.getRecorderSnapshot().status).toBe("recording");

    await stopAndSettle();
  });

  it("cancelling during the countdown never starts the engine", async () => {
    store.requestStartRecording(() => input);
    store.stopOrCancelRecording();

    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    await vi.advanceTimersByTimeAsync(5000);
    expect(prepareEngineMock).not.toHaveBeenCalled();
    expect(window.electronAPI.recordingCreate).not.toHaveBeenCalled();
  });

  it("a 'stop' command relayed from the bar cancels a pending countdown instead of being ignored", async () => {
    store.requestStartRecording(() => input);
    commands[0]("stop");

    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    await vi.advanceTimersByTimeAsync(5000);
    expect(prepareEngineMock).not.toHaveBeenCalled();
  });

  it("cancelling during the 'starting' gap restores the app at once and releases the engine when it resolves", async () => {
    const acquisition = pendingPrepare();
    const prepared = fakePrepared();

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("starting");

    store.stopOrCancelRecording(); // arrives during the acquire gap — no engine yet
    // Not deferred to the engine: the window comes back and the store is idle right away.
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce();

    acquisition.resolve(prepared);
    await vi.advanceTimersByTimeAsync(0);

    expect(prepared.release).toHaveBeenCalledOnce();
    expect(prepared.begin).not.toHaveBeenCalled();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce();
  });

  it("a cancel before main confirms the session never starts the engine", async () => {
    // The take's file is created first (IPC). A cancel landing in that gap must not let the
    // engine acquire the screen and mic afterwards.
    let resolveCreate!: (value: { tempPath: string }) => void;
    window.electronAPI.recordingCreate = vi.fn(
      () => new Promise<{ tempPath: string }>((resolve) => (resolveCreate = resolve)),
    );
    try {
      store.requestStartRecording(() => input);
      await vi.advanceTimersByTimeAsync(3000);
      expect(store.getRecorderSnapshot().status).toBe("starting");

      store.stopOrCancelRecording(); // recordingCreate still pending
      resolveCreate({ tempPath: "/tmp/late" });
      await vi.advanceTimersByTimeAsync(0);

      expect(prepareEngineMock).not.toHaveBeenCalled();
      expect(window.electronAPI.recordingAbort).toHaveBeenCalledWith(
        expect.stringMatching(/^session-/),
      );
      expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    } finally {
      window.electronAPI.recordingCreate = recordingCreateMock;
    }
  });

  it("a cancel during 'starting' works even when the engine never settles", async () => {
    pendingPrepare();

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("starting");

    commands[0]("stop"); // the bar's Stop, the tray, the stop shortcut
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledWith(
      expect.stringMatching(/^session-/),
    );

    // Nothing is left blocking: a new start is accepted, and the hung one never reports.
    store.requestStartRecording(() => input);
    expect(store.getRecorderSnapshot().status).toBe("counting");
    store.stopOrCancelRecording();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  it("fails a start that hangs, restores the app, and releases an engine that resolves late", async () => {
    const acquisition = pendingPrepare();
    const late = fakePrepared();

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("starting");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(reportErrorMock).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();

    acquisition.resolve(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.release).toHaveBeenCalledOnce();
    expect(late.begin).not.toHaveBeenCalled();
    // The chunk sink is cut off for the discarded take.
    acquisition.options().onChunk(new ArrayBuffer(4), 0);
    expect(window.electronAPI.recordingWrite).not.toHaveBeenCalled();
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  it("pause and resume drive the engine and the status", async () => {
    const engine = fakeEngine();
    prepareEngineMock.mockResolvedValue(fakePrepared(engine));
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

  it("pause and resume are ignored while the take is finalizing", async () => {
    const engine = fakeEngine();
    let finishStop!: () => void;
    engine.stop = vi.fn(() => new Promise<void>((resolve) => (finishStop = resolve)));
    prepareEngineMock.mockResolvedValue(fakePrepared(engine));
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);

    store.stopOrCancelRecording();
    try {
      expect(store.getRecorderSnapshot().status).toBe("finalizing");

      store.pauseRecording();
      store.resumeRecording();
      expect(engine.pause).not.toHaveBeenCalled();
      expect(engine.resume).not.toHaveBeenCalled();
      expect(store.getRecorderSnapshot().status).toBe("finalizing");
    } finally {
      finishStop();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  it("stop shows Saving, finalizes, notifies completion listeners, restores the window", async () => {
    const engine = fakeEngine();
    prepareEngineMock.mockResolvedValue(fakePrepared(engine));
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

  it("finalizes with the unfloored elapsed time in durationMs, not durationSeconds * 1000", async () => {
    const engine = fakeEngine();
    prepareEngineMock.mockResolvedValue(fakePrepared(engine));

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000); // countdown → recording starts
    // Recording for 2.4 s: durationSeconds floors to 2, but durationMs must carry
    // the real 2400 ms — the cursor tracker's tail cut needs the unfloored value
    // (bug fix: RecordingFinalizeMeta.durationMs).
    await vi.advanceTimersByTimeAsync(2400);

    await stopAndSettle();

    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ durationSeconds: 2, durationMs: 2400 }),
    );
  });

  it("finalizes with the capture metadata: mode from the target, size from the engine", async () => {
    prepareEngineMock.mockResolvedValue(
      fakePrepared(fakeEngine({ outputSize: { width: 1280, height: 720 } })),
    );
    store.requestStartRecording(() => ({
      ...input,
      area: {
        displayId: 4,
        rect: { x: 0, y: 0, width: 640, height: 360 },
        displaySize: { width: 1512, height: 982 },
      },
    }));
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(1000);

    await stopAndSettle();

    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        capture: {
          mode: "area",
          width: 1280,
          height: 720,
          ratio: "16:9",
          displayId: 4,
        },
      }),
    );
  });

  it("tears down and restores the window when the engine fails mid-recording", async () => {
    let onError: ((error: unknown) => void) | undefined;
    prepareEngineMock.mockImplementation(async (opts) => {
      onError = opts.onError;
      return fakePrepared();
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

  it("an engine that fails during the countdown fails the start when it ends instead of recording", async () => {
    const prepared = fakePrepared();
    prepareEngineMock.mockImplementation(async (opts) => {
      // The screen capture ends before the take is set up (the cursor session still opens):
      // there is no take to stop yet, so this error used to be dropped.
      opts.onError?.(new Error("screen capture ended"));
      return prepared;
    });
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(prepared.begin).not.toHaveBeenCalled();
    expect(prepared.release).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce(); // undoes the hide
    expect(reportErrorMock).toHaveBeenCalledOnce();
    expect(reportErrorMock).toHaveBeenCalledWith(
      messages.record.errorStart,
      expect.any(Error),
      expect.objectContaining({ retry: expect.any(Function) }),
    );
  });

  it("a pause or resume that lands while the take is saving is ignored", async () => {
    let finishStop!: () => void;
    const engine = fakeEngine({ stop: vi.fn(() => new Promise<void>((r) => (finishStop = r))) });
    prepareEngineMock.mockResolvedValue(fakePrepared(engine));
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    store.pauseRecording();
    store.stopOrCancelRecording();
    expect(store.getRecorderSnapshot().status).toBe("finalizing");

    // The bar's Resume/Pause clicked just as the Stop shortcut fired: the engine is flushing.
    store.resumeRecording();
    store.pauseRecording();
    expect(engine.resume).not.toHaveBeenCalled();
    expect(engine.pause).toHaveBeenCalledOnce(); // the pause before the stop
    expect(store.getRecorderSnapshot().status).toBe("finalizing");

    finishStop();
    await vi.advanceTimersByTimeAsync(700);
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  it("aborts the session, undoes the early window-hide, and returns to idle when the engine fails to start", async () => {
    prepareEngineMock.mockRejectedValue(new Error("getDisplayMedia denied"));

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);

    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce(); // undoes the hide
    // Idle (not a stuck "error" state) — the Start button is usable right away.
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  it("goes back to idle, never 'starting', when the take's input cannot be resolved", async () => {
    const reports = vi.fn();
    window.electronAPI.reportRecorderPhase = reports;
    store.requestStartRecording(() => {
      throw new Error("startRecording: no source selected");
    });
    await vi.advanceTimersByTimeAsync(3000);

    // Idle is what tells main to take the countdown down, release Esc and reveal the app.
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(reports).toHaveBeenLastCalledWith({ phase: "idle" });
    expect(reports).not.toHaveBeenCalledWith({ phase: "starting" });
    expect(window.electronAPI.recordingStart).not.toHaveBeenCalled();
    expect(prepareEngineMock).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledOnce();
  });

  it("starts the clock the moment the countdown ends when the take was acquired during it", async () => {
    const engine = fakeEngine();
    const prepared = fakePrepared(engine);
    prepareEngineMock.mockResolvedValue(prepared);
    store.requestStartRecording(() => input);

    await vi.advanceTimersByTimeAsync(2999);
    expect(store.getRecorderSnapshot()).toEqual({ status: "counting", countdown: 1 });
    expect(prepared.begin).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    // No timer step in between: acquired already, the take encodes at once.
    expect(store.getRecorderSnapshot().status).toBe("recording");
    expect(prepared.begin).toHaveBeenCalledOnce();
    // The bar leaves "Starting…" with the first tick, sent at once rather than 100 ms later.
    expect(window.electronAPI.recordingReportTick).toHaveBeenCalledWith(
      expect.objectContaining({ elapsedSeconds: 0, status: "recording" }),
    );
    const marks = vi.mocked(window.electronAPI.reportRecordTiming).mock.calls.map(([l]) => l);
    expect(marks).toContain("acquired during countdown");
    expect(marks.some((label) => label.startsWith("clock started at countdown end"))).toBe(true);

    await stopAndSettle();
  });

  it("writes no media before the countdown ends", async () => {
    const acquisition = pendingPrepare();
    const prepared = fakePrepared();
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(0);
    acquisition.resolve(prepared);
    await vi.advanceTimersByTimeAsync(2000);

    // Nothing has begun encoding; a chunk would have nowhere to go.
    expect(prepared.begin).not.toHaveBeenCalled();
    acquisition.options().onChunk(new ArrayBuffer(4), 0);
    expect(window.electronAPI.recordingWrite).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(prepared.begin).toHaveBeenCalledOnce();
    acquisition.options().onChunk(new ArrayBuffer(4), 0);
    expect(window.electronAPI.recordingWrite).toHaveBeenCalledOnce();

    await stopAndSettle();
  });

  it("waits for the app window to leave the screen before the take encodes", async () => {
    // The Record page's countdown: the app is on screen until the countdown ends.
    window.electronAPI.recordingHideMainWindow = vi.fn(async () => true);
    const prepared = fakePrepared();
    prepareEngineMock.mockResolvedValue(prepared);
    store.requestStartRecording(() => input);

    await vi.advanceTimersByTimeAsync(3000);
    expect(window.electronAPI.recordingHideMainWindow).toHaveBeenCalledOnce();
    expect(
      vi.mocked(window.electronAPI.recordingHideMainWindow).mock.invocationCallOrder[0],
    ).toBeLessThan(recordingStartMock.mock.invocationCallOrder[0]);
    expect(prepared.begin).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(store.WINDOW_HIDE_SETTLE_MS - 1);
    expect(prepared.begin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(prepared.begin).toHaveBeenCalledOnce();
    expect(store.getRecorderSnapshot().status).toBe("recording");

    await stopAndSettle();
  });

  it("shows 'starting' when the acquisition is still running as the countdown ends", async () => {
    const acquisition = pendingPrepare();
    const prepared = fakePrepared();
    store.requestStartRecording(() => input);

    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot()).toEqual({ status: "starting", countdown: null });
    expect(window.electronAPI.recordingStart).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(400);
    acquisition.resolve(prepared);
    await vi.advanceTimersByTimeAsync(0);
    expect(prepared.begin).toHaveBeenCalledOnce();
    expect(store.getRecorderSnapshot().status).toBe("recording");

    await stopAndSettle();
  });

  it("cancelling during the countdown releases everything acquired for the take", async () => {
    const prepared = fakePrepared();
    prepareEngineMock.mockResolvedValue(prepared);
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(1000);
    expect(prepareEngineMock).toHaveBeenCalledOnce();

    store.stopOrCancelRecording();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(prepared.release).toHaveBeenCalledOnce(); // screen, mic, encoder
    // The take's file goes, and with it main's cursor track for the session.
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledWith(
      expect.stringMatching(/^session-/),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(prepared.begin).not.toHaveBeenCalled();
    // The app was never hidden for this take: nothing to restore.
    expect(window.electronAPI.recordingStart).not.toHaveBeenCalled();
    expect(window.electronAPI.recordingStop).not.toHaveBeenCalled();
  });

  it("a cancel during the countdown releases an acquisition that finishes after it", async () => {
    const acquisition = pendingPrepare();
    const prepared = fakePrepared();
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(1000);

    commands[0]("stop"); // Esc on the region, the bar, the stop shortcut
    acquisition.resolve(prepared);
    await vi.advanceTimersByTimeAsync(5000);

    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(prepared.release).toHaveBeenCalledOnce();
    expect(prepared.begin).not.toHaveBeenCalled();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it("an acquisition that fails during the countdown fails the start when it ends", async () => {
    const acquisition = pendingPrepare();
    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(1000);
    acquisition.reject(new Error("NotAllowedError"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getRecorderSnapshot().status).toBe("counting");

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(reportErrorMock).toHaveBeenCalledWith(
      messages.record.errorStart,
      expect.any(Error),
      expect.objectContaining({ retry: expect.any(Function) }),
    );
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce(); // undoes the hide
  });

  describe("countdown length setting", () => {
    // The settings broadcast the store follows (Settings → Recording → Countdown).
    const setCountdown = (seconds: unknown): void => {
      for (const listener of appSettingsListeners) {
        listener({ recordingCountdownSeconds: seconds } as AppSettings);
      }
    };
    afterEach(() => setCountdown(3));

    it("with 0 skips the counting state and the visible-wait and starts the engine at once", async () => {
      setCountdown(0);
      const reports = vi.fn();
      window.electronAPI.reportRecorderPhase = reports;
      window.electronAPI.waitForCountdownVisible = vi.fn(() => new Promise<void>(() => {}));
      prepareEngineMock.mockImplementation(async () => {
        callOrder.push("prepareEngine");
        return fakePrepared();
      });

      store.requestStartRecording(() => input);

      // No "counting" at any point, and nothing was waited for: already acquiring.
      expect(store.getRecorderSnapshot()).toEqual({ status: "starting", countdown: null });
      expect(window.electronAPI.waitForCountdownVisible).not.toHaveBeenCalled();
      expect(window.electronAPI.recordingStart).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: "screen:1" }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getRecorderSnapshot().status).toBe("recording");
      expect(callOrder).toEqual(["recordingStart", "recordingCreate", "prepareEngine", "begin"]);
      expect(reports.mock.calls.map(([report]) => report)).toEqual([{ phase: "starting" }]);

      await stopAndSettle();
    });

    it("with 0 resolves the input at once, and a throw goes back to idle without starting", () => {
      setCountdown(0);
      const reports = vi.fn();
      window.electronAPI.reportRecorderPhase = reports;
      store.requestStartRecording(() => {
        throw new Error("no source selected");
      });

      expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
      // Main is told the start is dead, so a hidden app is not left waiting for it.
      expect(reports.mock.calls.map(([report]) => report)).toEqual([{ phase: "idle" }]);
      expect(reportErrorMock).toHaveBeenCalledOnce();
      expect(window.electronAPI.recordingStart).not.toHaveBeenCalled();
      expect(prepareEngineMock).not.toHaveBeenCalled();
    });

    it("with 5 counts 5 → 1 and starts after five seconds", async () => {
      setCountdown(5);
      store.requestStartRecording(() => input);
      expect(store.getRecorderSnapshot()).toEqual({ status: "counting", countdown: 5 });

      for (const expected of [4, 3, 2, 1]) {
        await vi.advanceTimersByTimeAsync(1000);
        expect(store.getRecorderSnapshot()).toEqual({ status: "counting", countdown: expected });
      }
      expect(window.electronAPI.recordingStart).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(store.getRecorderSnapshot().status).toBe("recording");

      await stopAndSettle();
    });

    it("reads the length when the start is requested, so a change applies to the next take", async () => {
      setCountdown(5);
      setCountdown(0);
      store.requestStartRecording(() => input);
      expect(store.getRecorderSnapshot().status).toBe("starting");
      await vi.advanceTimersByTimeAsync(0);
      await stopAndSettle();

      setCountdown(3);
      store.requestStartRecording(() => input);
      expect(store.getRecorderSnapshot()).toEqual({ status: "counting", countdown: 3 });
      store.stopOrCancelRecording();
    });

    it("falls back to 3 for a value that is not an offered length", () => {
      setCountdown(7);
      store.requestStartRecording(() => input);
      expect(store.getRecorderSnapshot()).toEqual({ status: "counting", countdown: 3 });
      store.stopOrCancelRecording();
    });
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

describe("recorder-store live settings", () => {
  const settingsListeners = new Set<(settings: RecordingSettings) => void>();
  const updateSettings = vi.fn();
  const base: RecordingSettings = {
    selectedSource: null,
    selectedMicrophone: { deviceId: "mic-1", label: "Mic" },
    isMicrophoneEnabled: true,
    isSystemAudioEnabled: false,
    isCameraEnabled: false,
    area: null,
  };
  const broadcast = (patch: Partial<RecordingSettings>): void => {
    for (const listener of settingsListeners) listener({ ...base, ...patch });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    settingsListeners.clear();
    updateSettings.mockClear();
    window.electronAPI.updateRecordingSettings = updateSettings;
    window.electronAPI.onRecordingSettingsChanged = vi.fn((listener) => {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    });
    window.electronAPI.recordingWrite = vi.fn();
    window.electronAPI.recordingFinalize = vi.fn(async () => RECORDING);
    window.electronAPI.recordingAbort = vi.fn(async () => {});
    window.electronAPI.recordingReportTick = vi.fn();
    prepareEngineMock.mockReset();
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function startWith(engine: EngineHandle, over: Partial<StartInput> = {}): Promise<void> {
    prepareEngineMock.mockResolvedValue(fakePrepared(engine));
    store.requestStartRecording(() => ({ ...input, ...over }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("recording");
  }

  it("forwards mic and system-audio changes to the engine during a take", async () => {
    const engine = fakeEngine();
    await startWith(engine);

    broadcast({ isMicrophoneEnabled: false });
    await vi.advanceTimersByTimeAsync(0);
    broadcast({ isMicrophoneEnabled: false, isSystemAudioEnabled: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
    expect(engine.setMicrophoneEnabled).toHaveBeenCalledWith(false, "mic-1");
    expect(engine.setSystemAudioEnabled).toHaveBeenCalledTimes(1);
    expect(engine.setSystemAudioEnabled).toHaveBeenCalledWith(true);
    expect(updateSettings).not.toHaveBeenCalled();

    await stopAndSettle();
  });

  it("writes the mic back to off when a late acquisition is unavailable", async () => {
    const engine = fakeEngine({ setMicrophoneEnabled: vi.fn(async () => "unavailable" as const) });
    await startWith(engine, { microphoneDeviceId: null });

    broadcast({ isMicrophoneEnabled: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.setMicrophoneEnabled).toHaveBeenCalledWith(true, "mic-1");
    expect(updateSettings).toHaveBeenCalledWith({ isMicrophoneEnabled: false });

    await stopAndSettle();
  });

  it("writes system audio back to off when there is no loopback track", async () => {
    const engine = fakeEngine({
      hasSystemAudio: false,
      setSystemAudioEnabled: vi.fn(() => "unavailable" as const),
    });
    await startWith(engine);

    broadcast({ isSystemAudioEnabled: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(updateSettings).toHaveBeenCalledWith({ isSystemAudioEnabled: false });
    await stopAndSettle();
  });

  it("corrects a system-audio 'on' setting at start when the take has no loopback", async () => {
    await startWith(fakeEngine({ hasSystemAudio: false }), { systemAudio: true });
    expect(updateSettings).toHaveBeenCalledWith({ isSystemAudioEnabled: false });
    await stopAndSettle();
  });

  it("reports loopback availability in the tick", async () => {
    await startWith(fakeEngine({ hasSystemAudio: false }));
    await vi.advanceTimersByTimeAsync(100);
    expect(window.electronAPI.recordingReportTick).toHaveBeenCalledWith(
      expect.objectContaining({ systemAudioAvailable: false }),
    );
    await stopAndSettle();
  });

  it("stops forwarding once the take ends", async () => {
    const engine = fakeEngine();
    await startWith(engine);
    await stopAndSettle();

    expect(settingsListeners.size).toBe(0);
    broadcast({ isMicrophoneEnabled: false });
    expect(engine.setMicrophoneEnabled).not.toHaveBeenCalled();
  });
});
