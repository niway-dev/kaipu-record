import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AppSettings, RecordingSettings } from "@shared/types";
import { DEFAULT_AUDIO_SETTINGS } from "@shared/audio-settings";

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
let mockLoaded = true;
vi.mock("@renderer/features/recording/hooks/use-recording-settings", () => ({
  useRecordingSettings: () => ({ ...mockSettings, loaded: mockLoaded, update: mockUpdate }),
}));

import { useRecordingSetup } from "./use-recording-setup";

const SETTINGS = (over: Partial<RecordingSettings> = {}): RecordingSettings => ({
  selectedSource: null,
  selectedMicrophone: { deviceId: "m1", label: "Mic One" },
  isMicrophoneEnabled: true,
  isSystemAudioEnabled: false,
  isCameraEnabled: false,
  area: null,
  ...over,
});

const SCREEN = { id: "s1", name: "Display 1", type: "screen" as const };

/** Lets the hook's `getSettings()` read resolve (the mic choice waits for it). */
async function flushSettings(): Promise<void> {
  await act(async () => {});
}

describe("useRecordingSetup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSettings = SETTINGS();
    mockLoaded = true;
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
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    MICS.splice(0, MICS.length, { deviceId: "m1", label: "Mic One" });
  });

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

  it("defaults the mic into shared settings when none is selected, without remembering it", async () => {
    const updateSettings = vi.spyOn(window.electronAPI, "updateSettings").mockClear();
    mockSettings = SETTINGS({ selectedMicrophone: null });
    renderHook(() => useRecordingSetup());
    await flushSettings();
    expect(mockUpdate).toHaveBeenCalledWith({
      selectedMicrophone: { deviceId: "m1", label: "Mic One" },
    });
    // An automatic default must keep following the system's input on the next launch.
    expect(updateSettings).not.toHaveBeenCalled();
  });

  describe("the mic a take uses: the picked one while connected, else the system default", () => {
    const YETI = { deviceId: "yeti", label: "Yeti Nano" };
    const IPHONE = { deviceId: "iphone", label: "iPhone Microphone" };

    async function remember(microphone: AppSettings["microphone"]): Promise<void> {
      const stored = await window.electronAPI.getSettings();
      vi.spyOn(window.electronAPI, "getSettings").mockResolvedValue({ ...stored, microphone });
    }

    it("selects the remembered mic when it is connected", async () => {
      await remember(YETI);
      MICS.splice(0, MICS.length, IPHONE, YETI); // the system default (iPhone) heads the list
      mockSettings = SETTINGS({ selectedMicrophone: null });
      renderHook(() => useRecordingSetup());
      await flushSettings();
      expect(mockUpdate).toHaveBeenLastCalledWith({ selectedMicrophone: YETI });
    });

    it("falls back to the system default while it is unplugged, and returns when it is back", async () => {
      await remember(YETI);
      MICS.splice(0, MICS.length, IPHONE);
      mockSettings = SETTINGS({ selectedMicrophone: YETI });
      const view = renderHook(() => useRecordingSetup());
      await flushSettings();
      expect(mockUpdate).toHaveBeenLastCalledWith({ selectedMicrophone: IPHONE });

      mockSettings = SETTINGS({ selectedMicrophone: IPHONE });
      MICS.splice(0, MICS.length, IPHONE, YETI);
      view.rerender();
      expect(mockUpdate).toHaveBeenLastCalledWith({ selectedMicrophone: YETI });
    });

    it("never switches while a take is pending or running", async () => {
      await remember(YETI);
      MICS.splice(0, MICS.length, IPHONE);
      mockSettings = SETTINGS({ selectedMicrophone: YETI });
      mockRecorderStatus = "recording";
      renderHook(() => useRecordingSetup());
      await flushSettings();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  it("remembers a picked mic for the next launch", () => {
    const updateSettings = vi.spyOn(window.electronAPI, "updateSettings").mockClear();
    const { result } = renderHook(() => useRecordingSetup());
    const yeti = { deviceId: "yeti", label: "Yeti Nano" };
    act(() => result.current.selectMicrophone(yeti));
    expect(mockUpdate).toHaveBeenCalledWith({ selectedMicrophone: yeti });
    expect(updateSettings).toHaveBeenCalledWith({ microphone: yeti });
  });

  it("does not default the mic before main's settings arrive (they hold the remembered one)", () => {
    mockSettings = SETTINGS({ selectedMicrophone: null });
    mockLoaded = false;
    renderHook(() => useRecordingSetup());
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ selectedMicrophone: expect.anything() }),
    );
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

  it("a slow initial settings read never overwrites a newer audio change", async () => {
    const original = { ...window.electronAPI };
    const listeners: Array<(settings: AppSettings) => void> = [];
    const onChange = (settings: AppSettings): void => listeners.forEach((l) => l(settings));
    const reads: Array<(settings: AppSettings) => void> = [];
    window.electronAPI.getSettings = () =>
      new Promise<AppSettings>((resolve) => reads.push(resolve));
    window.electronAPI.onSettingsChanged = (callback) => {
      listeners.push(callback);
      return () => {};
    };
    try {
      mockSettings = SETTINGS({ selectedSource: SCREEN });
      const { result } = renderHook(() => useRecordingSetup());

      // The user changes the level; the broadcast arrives before the first read resolves.
      act(() => onChange({ audio: { ...DEFAULT_AUDIO_SETTINGS, micLevel: 150 } } as AppSettings));
      await act(async () => {
        for (const read of reads) {
          read({ audio: { ...DEFAULT_AUDIO_SETTINGS, micLevel: 90 } } as AppSettings);
        }
      });

      act(() => result.current.startRecording());
      const resolveInput = recorderRequestStart.mock.calls[0][0] as () => {
        audio: { micLevel: number };
      };
      expect(resolveInput().audio.micLevel).toBe(150);
    } finally {
      Object.assign(window.electronAPI, original);
    }
  });

  it("records the webcam only with the camera on, from the bubble's camera and framing", async () => {
    const stored = await window.electronAPI.getSettings();
    const cameraBubble = {
      ...stored.cameraBubble,
      deviceId: "cam-1",
      size: 360,
      framing: { enabled: true, zoom: 1.5, x: 0.2, y: 0 },
    };
    vi.spyOn(window.electronAPI, "getSettings").mockResolvedValue({ ...stored, cameraBubble });

    mockSettings = SETTINGS({ selectedSource: SCREEN, isCameraEnabled: true });
    const on = renderHook(() => useRecordingSetup());
    await flushSettings();
    act(() => on.result.current.startRecording());
    const resolveOn = recorderRequestStart.mock.calls[0][0] as () => { webcam: unknown };
    expect(resolveOn().webcam).toEqual({
      deviceId: "cam-1",
      lines: 1080, // 360 × 2 × 1.5
      bubble: {
        shape: cameraBubble.shape,
        size: 360,
        mirrored: cameraBubble.mirrored,
        framing: cameraBubble.framing,
      },
    });

    mockSettings = SETTINGS({ selectedSource: SCREEN, isCameraEnabled: false });
    const off = renderHook(() => useRecordingSetup());
    await flushSettings();
    act(() => off.result.current.startRecording());
    const resolveOff = recorderRequestStart.mock.calls[1][0] as () => { webcam: unknown };
    expect(resolveOff().webcam).toBeNull();
  });

  it("startRecording carries the shared recording area into the start input", () => {
    const area = {
      displayId: 1,
      rect: { x: 100, y: 50, width: 640, height: 360 },
      displaySize: { width: 1512, height: 982 },
    };
    mockSettings = SETTINGS({ selectedSource: SCREEN, area });
    const { result } = renderHook(() => useRecordingSetup());

    act(() => result.current.startRecording());

    const resolveInput = recorderRequestStart.mock.calls[0][0] as () => unknown;
    expect(resolveInput()).toEqual(expect.objectContaining({ sourceId: "s1", area }));
  });

  it("choosing a source in the picker drops a previously chosen area", () => {
    mockSettings = SETTINGS({
      selectedSource: SCREEN,
      area: {
        displayId: 1,
        rect: { x: 0, y: 0, width: 640, height: 360 },
        displaySize: { width: 1512, height: 982 },
      },
    });
    const { result } = renderHook(() => useRecordingSetup());
    const safari = { id: "window:9", name: "Safari", type: "window" as const };

    act(() => result.current.selectSource(safari));

    expect(mockUpdate).toHaveBeenCalledWith({ selectedSource: safari, area: null });
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
