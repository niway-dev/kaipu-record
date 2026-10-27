import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, LocalRecording, RecordingSettings } from "@shared/types";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "@shared/audio-settings";
import type { ControlCommand } from "@shared/types/ipc";
import { startEngine, type EngineHandle } from "@renderer/features/recording/recorder-engine";
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
  audio: DEFAULT_AUDIO_SETTINGS,
};

function fakeEngine(over: Partial<EngineHandle> = {}): EngineHandle {
  return {
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => {}),
    readLevels: vi.fn(() => [0, 0, 0, 0, 0]),
    readMicLevels: vi.fn(() => [0, 0, 0, 0, 0]),
    thumbnail: Promise.resolve(null),
    outputSize: { width: 1662, height: 1080 },
    firstMediaTimestamp: Promise.resolve({ rendererMs: 0, quality: "estimated" as const }),
    hasSystemAudio: true,
    setMicrophoneEnabled: vi.fn(async () => "ok" as const),
    setSystemAudioEnabled: vi.fn(() => "ok" as const),
    setMicLevel: vi.fn(),
    setNoiseSuppression: vi.fn(async () => "ok" as const),
    setSystemAudioVolume: vi.fn(() => "ok" as const),
    setDucking: vi.fn(() => "ok" as const),
    ...over,
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
    window.electronAPI.waitForCountdownVisible = vi.fn(async () => {});
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

  it("resolves the take's input when the countdown ends, not when the start is requested", async () => {
    // Main starts a take chosen on the overlay by broadcasting the new source and area, then
    // requesting a start; the broadcast may reach React after the request. Reading the input
    // only at the end of the countdown is what makes that safe (see applyRecordTarget).
    let current: StartInput = input;
    store.requestStartRecording(() => current);
    const area = {
      displayId: 2,
      rect: { x: 0, y: 0, width: 640, height: 360 },
      displaySize: { width: 1512, height: 982 },
    };
    current = { ...input, sourceId: "screen:2", sourceName: "Area", area };

    await vi.advanceTimersByTimeAsync(3000);

    expect(window.electronAPI.recordingStart).toHaveBeenCalledWith({
      sourceId: "screen:2",
      sourceName: "Area",
      area,
    });
    expect(startEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "screen:2", area }),
    );

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

  it("cancelling during the 'starting' gap restores the app at once and stops the engine when it resolves", async () => {
    let resolveEngine!: (handle: EngineHandle) => void;
    const engine = fakeEngine();
    startEngineMock.mockImplementation(() => new Promise((resolve) => (resolveEngine = resolve)));

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("starting");

    store.stopOrCancelRecording(); // arrives during the acquire gap — no engine yet
    // Not deferred to the engine: the window comes back and the store is idle right away.
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce();

    resolveEngine(engine);
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.stop).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce();
  });

  it("a cancel during 'starting' works even when the engine never settles", async () => {
    startEngineMock.mockImplementation(() => new Promise<EngineHandle>(() => {}));

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
    let resolveEngine!: (handle: EngineHandle) => void;
    const late = fakeEngine();
    let lateChunk: ((data: ArrayBuffer, position: number) => void) | null = null;
    startEngineMock.mockImplementation((options) => {
      // Keep the chunk sink to check it is cut off for the discarded take.
      lateChunk = options.onChunk;
      return new Promise((resolve) => (resolveEngine = resolve));
    });

    store.requestStartRecording(() => input);
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getRecorderSnapshot().status).toBe("starting");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
    expect(reportErrorMock).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();

    resolveEngine(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.stop).toHaveBeenCalledOnce();
    lateChunk!(new ArrayBuffer(4), 0);
    expect(window.electronAPI.recordingWrite).not.toHaveBeenCalled();
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

  it("finalizes with the unfloored elapsed time in durationMs, not durationSeconds * 1000", async () => {
    const engine = fakeEngine();
    startEngineMock.mockResolvedValue(engine);

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
    startEngineMock.mockResolvedValue(fakeEngine({ outputSize: { width: 1280, height: 720 } }));
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
    expect(reportErrorMock).toHaveBeenCalledOnce();
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
  const appListeners = new Set<(settings: AppSettings) => void>();
  /** An app-settings broadcast whose `audio` is the defaults patched; the rest is irrelevant here. */
  const broadcastAudio = (patch: Partial<AudioSettings>): void => {
    const settings = { audio: { ...DEFAULT_AUDIO_SETTINGS, ...patch } } as AppSettings;
    for (const listener of appListeners) listener(settings);
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
    appListeners.clear();
    window.electronAPI.onSettingsChanged = vi.fn((listener) => {
      appListeners.add(listener);
      return () => appListeners.delete(listener);
    });
    window.electronAPI.recordingWrite = vi.fn();
    window.electronAPI.recordingFinalize = vi.fn(async () => RECORDING);
    window.electronAPI.recordingAbort = vi.fn(async () => {});
    window.electronAPI.recordingReportTick = vi.fn();
    startEngineMock.mockReset();
    expect(store.getRecorderSnapshot()).toEqual({ status: "idle", countdown: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function startWith(engine: EngineHandle, over: Partial<StartInput> = {}): Promise<void> {
    startEngineMock.mockResolvedValue(engine);
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

  it("hands the engine the audio settings the take starts with", async () => {
    const audio = { ...DEFAULT_AUDIO_SETTINGS, micLevel: 70, noiseSuppression: false };
    await startWith(fakeEngine(), { audio });
    expect(startEngineMock).toHaveBeenCalledWith(expect.objectContaining({ audio }));
    await stopAndSettle();
  });

  it("forwards only the audio settings that changed during a take", async () => {
    const engine = fakeEngine();
    await startWith(engine);

    broadcastAudio({}); // nothing differs from the start
    broadcastAudio({ micLevel: 60 });
    broadcastAudio({ micLevel: 60, noiseSuppression: false });
    broadcastAudio({ micLevel: 60, noiseSuppression: false, systemAudioVolume: 30 });
    broadcastAudio({
      micLevel: 60,
      noiseSuppression: false,
      systemAudioVolume: 30,
      duckSystemAudioWhileTalking: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(engine.setMicLevel).toHaveBeenCalledTimes(1);
    expect(engine.setMicLevel).toHaveBeenCalledWith(60);
    expect(engine.setNoiseSuppression).toHaveBeenCalledTimes(1);
    expect(engine.setNoiseSuppression).toHaveBeenCalledWith(false);
    expect(engine.setSystemAudioVolume).toHaveBeenCalledTimes(1);
    expect(engine.setSystemAudioVolume).toHaveBeenCalledWith(30);
    expect(engine.setDucking).toHaveBeenCalledTimes(1);
    expect(engine.setDucking).toHaveBeenCalledWith(true);
    await stopAndSettle();
  });

  it("applies audio changes in the order they were made", async () => {
    const order: string[] = [];
    let releaseNoise!: () => void;
    const engine = fakeEngine({
      setNoiseSuppression: vi.fn(async () => {
        order.push("noise");
        await new Promise<void>((resolve) => (releaseNoise = resolve));
        return "ok" as const;
      }),
      setMicLevel: vi.fn(() => void order.push("level")),
    });
    await startWith(engine);

    broadcastAudio({ noiseSuppression: false });
    broadcastAudio({ noiseSuppression: false, micLevel: 50 });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["noise"]); // the level waits for the slow constraint
    releaseNoise();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["noise", "level"]);
    await stopAndSettle();
  });

  describe("mic levels for the settings meter", () => {
    let listeningCallbacks: Array<(listening: boolean) => void>;
    let report: ReturnType<typeof vi.fn<(levels: number[]) => void>>;
    let queried: boolean;
    beforeEach(() => {
      listeningCallbacks = [];
      queried = false;
      report = vi.fn<(levels: number[]) => void>();
      window.electronAPI.recordingReportMicLevels = report;
      window.electronAPI.getMicLevelsListening = vi.fn(async () => queried);
      window.electronAPI.onMicLevelsListening = vi.fn((callback) => {
        listeningCallbacks.push(callback);
        return () => {
          listeningCallbacks = listeningCallbacks.filter((c) => c !== callback);
        };
      });
    });

    it("keeps the bars out of the activity tick and sends nothing while nobody listens", async () => {
      const engine = fakeEngine({ readMicLevels: vi.fn(() => [0.123, 0.4, 0.5, 0.6, 0.789]) });
      await startWith(engine);
      await vi.advanceTimersByTimeAsync(300);
      expect(report).not.toHaveBeenCalled();
      expect(engine.readMicLevels).not.toHaveBeenCalled();
      for (const [tick] of vi.mocked(window.electronAPI.recordingReportTick).mock.calls) {
        expect(tick).not.toHaveProperty("micLevels");
      }
      await stopAndSettle();
    });

    it("sends rounded bars while a window listens, zeros while paused, and stops when it leaves", async () => {
      const engine = fakeEngine({ readMicLevels: vi.fn(() => [0.123, 0.4, 0.5, 0.6, 0.789]) });
      await startWith(engine);
      for (const callback of listeningCallbacks) callback(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(report).toHaveBeenLastCalledWith([0.12, 0.4, 0.5, 0.6, 0.79]);

      store.pauseRecording();
      await vi.advanceTimersByTimeAsync(100);
      expect(report).toHaveBeenLastCalledWith([0, 0, 0, 0, 0]);
      store.resumeRecording();

      for (const callback of listeningCallbacks) callback(false);
      report.mockClear();
      await vi.advanceTimersByTimeAsync(300);
      expect(report).not.toHaveBeenCalled();
      await stopAndSettle();
    });

    it("learns about a window that was already listening when the take started", async () => {
      queried = true;
      await startWith(fakeEngine({ readMicLevels: vi.fn(() => [0.5, 0.5, 0.5, 0.5, 0.5]) }));
      await vi.advanceTimersByTimeAsync(100);
      expect(report).toHaveBeenCalled();
      await stopAndSettle();
    });

    it("stops listening for listeners when the take ends", async () => {
      await startWith(fakeEngine());
      expect(listeningCallbacks).toHaveLength(1);
      await stopAndSettle();
      expect(listeningCallbacks).toHaveLength(0);
    });
  });

  describe("noise suppression the device could not apply", () => {
    const updateAppSettings = vi.fn(async (_patch: unknown) => ({}) as never);
    beforeEach(() => {
      updateAppSettings.mockClear();
      window.electronAPI.updateSettings = updateAppSettings;
    });

    it("writes the value actually in effect back to the settings, so the UI never lies", async () => {
      const engine = fakeEngine({ setNoiseSuppression: vi.fn(async () => "unavailable" as const) });
      await startWith(engine, { audio: { ...DEFAULT_AUDIO_SETTINGS, micLevel: 80 } });

      broadcastAudio({ micLevel: 80, noiseSuppression: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.setNoiseSuppression).toHaveBeenCalledWith(false);
      expect(updateAppSettings).toHaveBeenCalledWith({
        audio: expect.objectContaining({ micLevel: 80, noiseSuppression: true }),
      });
      await stopAndSettle();
    });

    it("leaves the setting alone when the engine applied it", async () => {
      const engine = fakeEngine();
      await startWith(engine);
      broadcastAudio({ noiseSuppression: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(updateAppSettings).not.toHaveBeenCalled();
      await stopAndSettle();
    });

    it("only the latest request writes back, so a newer choice is not overwritten", async () => {
      let rejectFirst!: () => void;
      const setNoiseSuppression = vi
        .fn<EngineHandle["setNoiseSuppression"]>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              rejectFirst = () => resolve("unavailable");
            }),
        )
        .mockResolvedValue("ok");
      await startWith(fakeEngine({ setNoiseSuppression }));
      broadcastAudio({ noiseSuppression: false });
      await vi.advanceTimersByTimeAsync(0);
      broadcastAudio({ noiseSuppression: true });
      broadcastAudio({ noiseSuppression: false });
      rejectFirst();
      await vi.advanceTimersByTimeAsync(0);
      expect(updateAppSettings).not.toHaveBeenCalled();
      await stopAndSettle();
    });
  });

  describe("changes made while the engine is still acquiring", () => {
    it("applies the latest audio settings once the engine exists", async () => {
      let resolveEngine!: (engine: EngineHandle) => void;
      startEngineMock.mockReturnValue(new Promise((resolve) => (resolveEngine = resolve)));
      store.requestStartRecording(() => input);
      await vi.advanceTimersByTimeAsync(3000);
      expect(store.getRecorderSnapshot().status).toBe("starting");

      broadcastAudio({ micLevel: 40 });
      broadcastAudio({ micLevel: 60, systemAudioVolume: 30 });
      const engine = fakeEngine();
      resolveEngine(engine);
      await vi.advanceTimersByTimeAsync(0);

      expect(store.getRecorderSnapshot().status).toBe("recording");
      expect(engine.setMicLevel).toHaveBeenCalledTimes(1);
      expect(engine.setMicLevel).toHaveBeenCalledWith(60);
      expect(engine.setSystemAudioVolume).toHaveBeenCalledWith(30);
      await stopAndSettle();
    });

    it("applies nothing when the settings did not move meanwhile", async () => {
      let resolveEngine!: (engine: EngineHandle) => void;
      startEngineMock.mockReturnValue(new Promise((resolve) => (resolveEngine = resolve)));
      store.requestStartRecording(() => input);
      await vi.advanceTimersByTimeAsync(3000);
      broadcastAudio({});
      const engine = fakeEngine();
      resolveEngine(engine);
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.setMicLevel).not.toHaveBeenCalled();
      await stopAndSettle();
    });

    it("stops listening when the start is cancelled", async () => {
      startEngineMock.mockReturnValue(new Promise(() => {}));
      store.requestStartRecording(() => input);
      await vi.advanceTimersByTimeAsync(3000);
      expect(appListeners.size).toBe(1);
      store.stopOrCancelRecording();
      expect(appListeners.size).toBe(0);
    });

    it("stops listening when the start fails", async () => {
      startEngineMock.mockRejectedValue(new Error("no screen"));
      store.requestStartRecording(() => input);
      await vi.advanceTimersByTimeAsync(3000);
      expect(store.getRecorderSnapshot().status).toBe("idle");
      expect(appListeners.size).toBe(0);
    });
  });

  it("stops forwarding once the take ends", async () => {
    const engine = fakeEngine();
    await startWith(engine);
    await stopAndSettle();

    expect(settingsListeners.size).toBe(0);
    expect(appListeners.size).toBe(0);
    broadcastAudio({ micLevel: 10 });
    expect(engine.setMicLevel).not.toHaveBeenCalled();
    broadcast({ isMicrophoneEnabled: false });
    expect(engine.setMicrophoneEnabled).not.toHaveBeenCalled();
  });
});
