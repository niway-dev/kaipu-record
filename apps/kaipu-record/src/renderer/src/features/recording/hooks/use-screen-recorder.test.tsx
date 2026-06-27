import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types";
import type { ControlCommand } from "@shared/types/ipc";
import { startEngine, type EngineHandle } from "@renderer/features/recording/recorder-engine";
import { useScreenRecorder } from "./use-screen-recorder";

vi.mock("@renderer/features/recording/recorder-engine", () => ({
  startEngine: vi.fn(),
}));

const startEngineMock = vi.mocked(startEngine);

function fakeEngine(): EngineHandle {
  return {
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => {}),
    readLevels: vi.fn(() => [0, 0, 0, 0, 0]),
    thumbnail: null,
  };
}

const RECORDING: LocalRecording = {
  id: "recording-x",
  title: "T",
  filePath: "/vault/recording-x.mp4",
  createdAt: 1,
  sizeBytes: 10,
  durationSeconds: 5,
  thumbnailUrl: null,
};

const input = {
  sourceId: "screen:1",
  sourceName: "Screen 1",
  microphoneDeviceId: "mic-1",
  systemAudio: false,
};

describe("useScreenRecorder", () => {
  let commands: Array<(command: ControlCommand) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    commands = [];
    startEngineMock.mockReset();
    startEngineMock.mockResolvedValue(fakeEngine());
    window.electronAPI.recordingCreate = vi.fn(async () => ({ tempPath: "/tmp/s" }));
    window.electronAPI.recordingWrite = vi.fn();
    window.electronAPI.recordingFinalize = vi.fn(async () => RECORDING);
    window.electronAPI.recordingAbort = vi.fn(async () => {});
    window.electronAPI.recordingReportTick = vi.fn();
    window.electronAPI.recordingStart = vi.fn();
    window.electronAPI.recordingStop = vi.fn();
    window.electronAPI.onRecordingCommand = vi.fn((callback) => {
      commands.push(callback);
      return () => {};
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start opens a session, starts the engine, and tells the hub", async () => {
    const { result } = renderHook(() => useScreenRecorder());

    await act(async () => {
      await result.current.start(input);
    });

    expect(window.electronAPI.recordingCreate).toHaveBeenCalledOnce();
    expect(startEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "screen:1", microphoneDeviceId: "mic-1" }),
    );
    expect(window.electronAPI.recordingStart).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "screen:1", sourceName: "Screen 1" }),
    );
    expect(result.current.status).toBe("recording");
  });

  it("pause and resume drive the engine and the status", async () => {
    const engine = fakeEngine();
    startEngineMock.mockResolvedValue(engine);
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      await result.current.start(input);
    });

    act(() => result.current.pause());
    expect(engine.pause).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("paused");

    act(() => result.current.resume());
    expect(engine.resume).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("recording");
  });

  it("stop shows Saving, finalizes, fires onComplete, restores the window", async () => {
    const engine = fakeEngine();
    startEngineMock.mockResolvedValue(engine);
    const onComplete = vi.fn();
    const { result } = renderHook(() => useScreenRecorder({ onComplete }));
    await act(async () => {
      await result.current.start(input);
    });

    await act(async () => {
      const stopping = result.current.stop();
      await vi.advanceTimersByTimeAsync(700); // clear the MIN_SAVING_MS dwell
      await stopping;
    });

    expect(window.electronAPI.recordingReportTick).toHaveBeenCalledWith(
      expect.objectContaining({ status: "saving" }),
    );
    expect(engine.stop).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(RECORDING);
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("idle");
  });

  it("a 'stop' command relayed from the bar finalizes the recording", async () => {
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      await result.current.start(input);
    });

    await act(async () => {
      commands[0]("stop");
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledOnce();
  });

  it("tears down and restores the window when the engine fails mid-recording", async () => {
    let onError: ((error: unknown) => void) | undefined;
    startEngineMock.mockImplementation(async (opts) => {
      onError = opts.onError;
      return fakeEngine();
    });
    const { result } = renderHook(() => useScreenRecorder());
    await act(async () => {
      await result.current.start(input);
    });
    expect(result.current.status).toBe("recording");

    // Simulate the encoder erroring / the screen capture ending mid-recording.
    await act(async () => {
      onError?.(new Error("screen capture ended"));
      await vi.advanceTimersByTimeAsync(700);
    });

    // The app recovers: the main window is restored and we're not stuck recording.
    expect(window.electronAPI.recordingStop).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("idle");
  });

  it("ignores a second start while one is already starting (no double session)", async () => {
    const { result } = renderHook(() => useScreenRecorder());

    await act(async () => {
      void result.current.start(input); // sets sessionRef synchronously
      await result.current.start(input); // must early-return
    });

    expect(window.electronAPI.recordingCreate).toHaveBeenCalledOnce();
  });

  it("aborts the session and surfaces an error when the engine fails to start", async () => {
    startEngineMock.mockRejectedValue(new Error("getDisplayMedia denied"));
    const { result } = renderHook(() => useScreenRecorder());

    await act(async () => {
      await result.current.start(input);
    });

    expect(window.electronAPI.recordingAbort).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("error");
  });
});
