import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Mock the device-enumeration hook so useRecordingSetup never touches
// navigator.mediaDevices (absent in jsdom). Stable array via vi.hoisted.
const { MICS } = vi.hoisted(() => ({
  MICS: [{ deviceId: "m1", label: "Mic One" }],
}));
vi.mock("@renderer/features/recording/hooks/use-microphones", () => ({
  useMicrophones: () => MICS,
}));

// The real recording engine is mocked: status stays "idle" so the hook never
// reports an active session, and we assert the hook delegates to start/stop/pause.
const recorderStart = vi.fn();
const recorderStop = vi.fn();
const recorderPause = vi.fn();
const recorderResume = vi.fn();
vi.mock("@renderer/features/recording/hooks/use-screen-recorder", () => ({
  useScreenRecorder: () => ({
    status: "idle",
    start: recorderStart,
    stop: recorderStop,
    pause: recorderPause,
    resume: recorderResume,
  }),
}));

import { useRecordingSetup } from "./use-recording-setup";

describe("useRecordingSetup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    recorderStart.mockClear();
    recorderStop.mockClear();
    recorderPause.mockClear();
    recorderResume.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("defaults the selected microphone to the first device", () => {
    const { result } = renderHook(() => useRecordingSetup());
    expect(result.current.selectedMicrophone).toEqual({ deviceId: "m1", label: "Mic One" });
    expect(result.current.isRecording).toBe(false);
    expect(result.current.countdown).toBeNull();
  });

  it("can-start only once a source is selected", () => {
    const { result } = renderHook(() => useRecordingSetup());
    expect(result.current.canStartRecording).toBe(false);
    act(() => result.current.selectSource({ id: "s1", name: "Display 1", type: "screen" }));
    expect(result.current.canStartRecording).toBe(true);
  });

  it("exposes the recorder status and delegates pause/resume", () => {
    const { result } = renderHook(() => useRecordingSetup());
    expect(result.current.recordingStatus).toBe("idle");
    act(() => result.current.pauseRecording());
    expect(recorderPause).toHaveBeenCalledTimes(1);
    act(() => result.current.resumeRecording());
    expect(recorderResume).toHaveBeenCalledTimes(1);
  });

  it("toggles capture flags", () => {
    const { result } = renderHook(() => useRecordingSetup());
    expect(result.current.isMicrophoneEnabled).toBe(true);
    act(() => result.current.toggleMicrophone());
    expect(result.current.isMicrophoneEnabled).toBe(false);
  });

  it("counts down 3 → 2 → 1 and then starts the engine", () => {
    const { result } = renderHook(() => useRecordingSetup());

    act(() => result.current.selectSource({ id: "s1", name: "Display 1", type: "screen" }));
    act(() => result.current.startRecording());
    expect(result.current.countdown).toBe(3);
    expect(recorderStart).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBe(2);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBe(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBeNull();
    expect(recorderStart).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "s1" }));
  });

  it("stopRecording cancels an in-progress countdown", () => {
    const { result } = renderHook(() => useRecordingSetup());

    act(() => result.current.selectSource({ id: "s1", name: "Display 1", type: "screen" }));
    act(() => result.current.startRecording());
    expect(result.current.countdown).toBe(3);

    act(() => result.current.stopRecording());
    expect(result.current.countdown).toBeNull();
    expect(recorderStop).toHaveBeenCalledTimes(1);

    // A cancelled countdown must never reach the engine.
    act(() => vi.advanceTimersByTime(5000));
    expect(recorderStart).not.toHaveBeenCalled();
  });
});
