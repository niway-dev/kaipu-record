import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RecordingSettings } from "@shared/types";

// Device enumeration mocked (no navigator.mediaDevices in jsdom).
const { MICS } = vi.hoisted(() => ({ MICS: [{ deviceId: "m1", label: "Mic One" }] }));
vi.mock("@renderer/features/recording/hooks/use-microphones", () => ({
  useMicrophones: () => MICS,
}));

// The real recording engine is mocked: status "idle" + delegation spies.
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

// Shared settings mocked deterministically: set `mockSettings` before rendering,
// assert writes through `mockUpdate`. Read at call time (no TDZ).
const mockUpdate = vi.fn();
let mockSettings: RecordingSettings;
vi.mock("@renderer/features/recording/hooks/use-recording-settings", () => ({
  useRecordingSettings: () => ({ ...mockSettings, update: mockUpdate }),
}));

import { useRecordingSetup } from "./use-recording-setup";

const SETTINGS = (over: Partial<RecordingSettings> = {}): RecordingSettings => ({
  selectedSource: null,
  selectedMicrophone: { deviceId: "m1", label: "Mic One" },
  isMicrophoneEnabled: true,
  isSystemAudioEnabled: false,
  isCameraEnabled: false,
  ...over,
});

const SCREEN = { id: "s1", name: "Display 1", type: "screen" as const };

describe("useRecordingSetup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSettings = SETTINGS();
    for (const spy of [recorderStart, recorderStop, recorderPause, recorderResume, mockUpdate]) {
      spy.mockClear();
    }
  });
  afterEach(() => vi.useRealTimers());

  it("can-start reflects the shared selected source", () => {
    const idle = renderHook(() => useRecordingSetup());
    expect(idle.result.current.canStartRecording).toBe(false);

    mockSettings = SETTINGS({ selectedSource: SCREEN });
    const ready = renderHook(() => useRecordingSetup());
    expect(ready.result.current.canStartRecording).toBe(true);
  });

  it("delegates capture toggles to the shared settings", () => {
    const { result } = renderHook(() => useRecordingSetup());
    act(() => result.current.toggleMicrophone());
    expect(mockUpdate).toHaveBeenCalledWith({ isMicrophoneEnabled: false });
    act(() => result.current.toggleCamera());
    expect(mockUpdate).toHaveBeenCalledWith({ isCameraEnabled: true });
  });

  it("defaults the mic into shared settings when none is selected", () => {
    mockSettings = SETTINGS({ selectedMicrophone: null });
    renderHook(() => useRecordingSetup());
    expect(mockUpdate).toHaveBeenCalledWith({
      selectedMicrophone: { deviceId: "m1", label: "Mic One" },
    });
  });

  it("exposes the recorder status and delegates pause/resume", () => {
    const { result } = renderHook(() => useRecordingSetup());
    expect(result.current.recordingStatus).toBe("idle");
    act(() => result.current.pauseRecording());
    expect(recorderPause).toHaveBeenCalledTimes(1);
    act(() => result.current.resumeRecording());
    expect(recorderResume).toHaveBeenCalledTimes(1);
  });

  it("counts down 3 → 2 → 1 then starts with the shared source/mic", () => {
    mockSettings = SETTINGS({ selectedSource: SCREEN });
    const { result } = renderHook(() => useRecordingSetup());

    act(() => result.current.startRecording());
    expect(result.current.countdown).toBe(3);
    expect(recorderStart).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBe(2);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.countdown).toBeNull();
    expect(recorderStart).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "s1", microphoneDeviceId: "m1" }),
    );
  });

  it("stopRecording cancels an in-progress countdown", () => {
    mockSettings = SETTINGS({ selectedSource: SCREEN });
    const { result } = renderHook(() => useRecordingSetup());

    act(() => result.current.startRecording());
    expect(result.current.countdown).toBe(3);

    act(() => result.current.stopRecording());
    expect(result.current.countdown).toBeNull();
    expect(recorderStop).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(5000));
    expect(recorderStart).not.toHaveBeenCalled();
  });
});
