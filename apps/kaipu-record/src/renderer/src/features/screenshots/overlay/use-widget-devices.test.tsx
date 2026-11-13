import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSettings } from "@shared/types/ipc";
import { useWidgetDevices } from "./use-widget-devices";

const noSettings = {
  getRecordingSettings: vi.fn(() => new Promise(() => {})),
  getSettings: vi.fn(() => new Promise(() => {})),
  updateRecordingSettings: vi.fn(),
  onRecordingSettingsChanged: vi.fn(() => () => {}),
} as unknown as Parameters<typeof useWidgetDevices>[0];

describe("useWidgetDevices", () => {
  const enumerateDevices = vi.fn(async () => []);
  const getUserMedia = vi.fn();
  beforeEach(() => {
    enumerateDevices.mockClear();
    getUserMedia.mockClear();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices,
        getUserMedia,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  });

  it("reads no device while the overlay is a screenshot one", () => {
    const { unmount } = renderHook(() => useWidgetDevices(noSettings, false));
    unmount();
    expect(enumerateDevices).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("enumerates devices once the overlay records", () => {
    const { unmount } = renderHook(() => useWidgetDevices(noSettings, true));
    unmount();
    expect(enumerateDevices).toHaveBeenCalled();
  });

  // Unmount while `navigator.mediaDevices` still exists: the outer afterEach removes it.
  describe("the first read racing a change", () => {
    afterEach(cleanup);
    const micA = { deviceId: "mic-a", label: "Mic A" };
    const micB = { deviceId: "mic-b", label: "Mic B" };
    const inputs = [micA, micB].map((mic) => ({
      ...mic,
      kind: "audioinput",
      groupId: mic.deviceId,
    }));

    function pendingRead() {
      let resolveRead: (settings: RecordingSettings) => void = () => {};
      let broadcast: (settings: RecordingSettings) => void = () => {};
      const api = {
        getRecordingSettings: vi.fn(
          () => new Promise<RecordingSettings>((resolve) => (resolveRead = resolve)),
        ),
        getSettings: vi.fn(() => new Promise(() => {})),
        updateRecordingSettings: vi.fn(),
        onRecordingSettingsChanged: vi.fn((callback: (settings: RecordingSettings) => void) => {
          broadcast = callback;
          return () => {};
        }),
      } as unknown as Parameters<typeof useWidgetDevices>[0];
      return {
        api,
        settle: (settings: Partial<RecordingSettings>) =>
          resolveRead(settings as RecordingSettings),
        broadcast: (settings: Partial<RecordingSettings>) =>
          broadcast(settings as RecordingSettings),
      };
    }

    it("keeps a microphone chosen before the first read answered", async () => {
      enumerateDevices.mockResolvedValue(inputs as never);
      const bridge = pendingRead();
      const { result } = renderHook(() => useWidgetDevices(bridge.api, true));
      await waitFor(() => expect(result.current.microphones).toHaveLength(2));

      act(() => result.current.selectMicrophone("mic-b"));
      expect(result.current.microphoneId).toBe("mic-b");

      await act(async () => bridge.settle({ selectedMicrophone: micA }));
      expect(result.current.microphoneId).toBe("mic-b");
    });

    it("keeps a broadcast that landed before the first read answered", async () => {
      const bridge = pendingRead();
      const { result } = renderHook(() => useWidgetDevices(bridge.api, true));

      act(() => bridge.broadcast({ selectedMicrophone: micB }));
      await act(async () => bridge.settle({ selectedMicrophone: micA }));

      expect(result.current.microphoneId).toBe("mic-b");
    });

    it("applies the first read when nothing changed meanwhile", async () => {
      const bridge = pendingRead();
      const { result } = renderHook(() => useWidgetDevices(bridge.api, true));

      await act(async () => bridge.settle({ selectedMicrophone: micA }));

      expect(result.current.microphoneId).toBe("mic-a");
    });
  });

  describe("the camera's first read racing a change", () => {
    afterEach(cleanup);

    function pendingCameraRead() {
      // Only the mount read is held back: `selectCamera` reads settings too, and a pick's own
      // read-then-write must not stand in for the first reply.
      let resolveRead: (settings: unknown) => void = () => {};
      let reads = 0;
      let broadcast: (settings: unknown) => void = () => {};
      const api = {
        getRecordingSettings: vi.fn(() => new Promise(() => {})),
        getSettings: vi.fn(() =>
          reads++ === 0 ? new Promise((resolve) => (resolveRead = resolve)) : new Promise(() => {}),
        ),
        updateSettings: vi.fn(),
        updateRecordingSettings: vi.fn(),
        onRecordingSettingsChanged: vi.fn(() => () => {}),
        onSettingsChanged: vi.fn((callback: (settings: unknown) => void) => {
          broadcast = callback;
          return () => {};
        }),
      } as unknown as Parameters<typeof useWidgetDevices>[0];
      return {
        api,
        settle: (deviceId: string) => resolveRead({ cameraBubble: { deviceId } }),
        broadcast: (deviceId: string) => broadcast({ cameraBubble: { deviceId } }),
      };
    }

    it("keeps a camera chosen before the first read answered", async () => {
      const bridge = pendingCameraRead();
      const { result } = renderHook(() => useWidgetDevices(bridge.api, true));

      act(() => result.current.selectCamera("cam-2"));
      expect(result.current.cameraId).toBe("cam-2");

      // The reply was computed before the choice: it must not undo it.
      await act(async () => bridge.settle("cam-1"));
      expect(result.current.cameraId).toBe("cam-2");
    });

    it("keeps a broadcast that landed before the first read answered", async () => {
      const bridge = pendingCameraRead();
      const { result } = renderHook(() => useWidgetDevices(bridge.api, true));

      act(() => bridge.broadcast("cam-2"));
      await act(async () => bridge.settle("cam-1"));

      expect(result.current.cameraId).toBe("cam-2");
    });

    it("applies the first read when nothing changed meanwhile", async () => {
      const bridge = pendingCameraRead();
      const { result } = renderHook(() => useWidgetDevices(bridge.api, true));

      await act(async () => bridge.settle("cam-1"));

      expect(result.current.cameraId).toBe("cam-1");
    });
  });

  describe("the camera across displays", () => {
    afterEach(cleanup);
    it("follows a camera chosen in another overlay window", async () => {
      let broadcast: (settings: unknown) => void = () => {};
      const unsubscribe = vi.fn();
      const api = {
        getRecordingSettings: vi.fn(() => new Promise(() => {})),
        getSettings: vi.fn(async () => ({ cameraBubble: { deviceId: "cam-1" } })),
        updateRecordingSettings: vi.fn(),
        onRecordingSettingsChanged: vi.fn(() => () => {}),
        onSettingsChanged: vi.fn((callback: (settings: unknown) => void) => {
          broadcast = callback;
          return unsubscribe;
        }),
      } as unknown as Parameters<typeof useWidgetDevices>[0];
      const { result, unmount } = renderHook(() => useWidgetDevices(api, true));
      await waitFor(() => expect(result.current.cameraId).toBe("cam-1"));

      // Display B chose another camera: this window's widget must show it too.
      act(() => broadcast({ cameraBubble: { deviceId: "cam-2" } }));
      expect(result.current.cameraId).toBe("cam-2");

      unmount();
      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});
