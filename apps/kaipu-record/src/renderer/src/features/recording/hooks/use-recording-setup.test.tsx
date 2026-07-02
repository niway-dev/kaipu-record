import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RecordingSettings } from "@shared/types";

// Device enumeration mocked (no navigator.mediaDevices in jsdom).
const { MICS } = vi.hoisted(() => ({ MICS: [{ deviceId: "m1", label: "Mic One" }] }));
vi.mock("@renderer/features/recording/hooks/use-microphones", () => ({
  useMicrophones: () => MICS,
}));

// The recorder store is mocked: status "idle" + delegation spies, mirroring
// the real module-singleton shape (see recorder-store.test.ts for the store's
// own tests — this file only checks use-recording-setup's wiring on top).
const recorderRequestStart = vi.fn();
const recorderStopOrCancel = vi.fn();
const recorderPause = vi.fn();
const recorderResume = vi.fn();
let mockRecorderStatus: "idle" | "counting" | "starting" | "recording" | "paused" | "finalizing" =
  "idle";
let mockCountdown: number | null = null;
vi.mock("@renderer/features/recording/hooks/use-screen-recorder", () => ({
  useScreenRecorder: () => ({
    status: mockRecorderStatus,
    countdown: mockCountdown,
    requestStart: recorderRequestStart,
    stopOrCancel: recorderStopOrCancel,
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
    mockRecorderStatus = "idle";
    mockCountdown = null;
    for (const spy of [
      recorderRequestStart,
      recorderStopOrCancel,
      recorderPause,
      recorderResume,
      mockUpdate,
    ]) {
      spy.mockClear();
    }
  });
  afterEach(() => vi.useRealTimers());

  it("can-start reflects the shared selected source and the recorder being idle", () => {
    const idle = renderHook(() => useRecordingSetup());
    expect(idle.result.current.canStartRecording).toBe(false);

    mockSettings = SETTINGS({ selectedSource: SCREEN });
    const ready = renderHook(() => useRecordingSetup());
    expect(ready.result.current.canStartRecording).toBe(true);

    mockRecorderStatus = "finalizing"; // a prior recording is still saving
    const busy = renderHook(() => useRecordingSetup());
    expect(busy.result.current.canStartRecording).toBe(false);
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

  it("exposes the recorder status/countdown and delegates pause/resume", () => {
    const { result } = renderHook(() => useRecordingSetup());
    expect(result.current.recordingStatus).toBe("idle");
    act(() => result.current.pauseRecording());
    expect(recorderPause).toHaveBeenCalledTimes(1);
    act(() => result.current.resumeRecording());
    expect(recorderResume).toHaveBeenCalledTimes(1);
  });

  it("startRecording asks the recorder to start, resolving input from the shared source/mic", () => {
    mockSettings = SETTINGS({ selectedSource: SCREEN });
    const { result } = renderHook(() => useRecordingSetup());

    act(() => result.current.startRecording());

    expect(recorderRequestStart).toHaveBeenCalledOnce();
    const resolveInput = recorderRequestStart.mock.calls[0][0] as () => unknown;
    expect(resolveInput()).toEqual(
      expect.objectContaining({ sourceId: "s1", microphoneDeviceId: "m1" }),
    );
  });

  it("startRecording is a no-op without a selected source", () => {
    const { result } = renderHook(() => useRecordingSetup());
    act(() => result.current.startRecording());
    expect(recorderRequestStart).not.toHaveBeenCalled();
  });

  it("stopRecording delegates to the recorder's unified stop-or-cancel", () => {
    const { result } = renderHook(() => useRecordingSetup());
    act(() => result.current.stopRecording());
    expect(recorderStopOrCancel).toHaveBeenCalledTimes(1);
  });
});
