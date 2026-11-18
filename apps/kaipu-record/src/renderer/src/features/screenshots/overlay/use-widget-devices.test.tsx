import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSettings } from "@shared/types/ipc";
import type { AppSettings } from "@shared/types";
import { installSettingsIpc } from "@renderer/test/settings-ipc";
import { STUB_SETTINGS } from "@renderer/test/stub-settings";
import { useWidgetDevices } from "./use-widget-devices";

const settingsWithCamera = (deviceId: string): AppSettings =>
  ({
    ...STUB_SETTINGS,
    cameraBubble: { ...(STUB_SETTINGS as { cameraBubble?: object }).cameraBubble, deviceId },
  }) as unknown as AppSettings;

const noSettings = {
  getRecordingSettings: vi.fn(() => new Promise(() => {})),
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
      // The window's settings store holds the first read back; `selectCamera` waits on the same
      // read before writing, so a pick's own write must not stand in for the first reply.
      const ipc = installSettingsIpc(settingsWithCamera("cam-0"), { deferRead: true });
      const api = {
        getRecordingSettings: vi.fn(() => new Promise(() => {})),
        updateSettings: vi.fn(),
        updateRecordingSettings: vi.fn(),
        onRecordingSettingsChanged: vi.fn(() => () => {}),
      } as unknown as Parameters<typeof useWidgetDevices>[0];
      return {
        api,
        ipc,
        settle: (deviceId: string) => ipc.resolveRead(settingsWithCamera(deviceId)),
        broadcast: (deviceId: string) => ipc.broadcast(settingsWithCamera(deviceId)),
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

    it("writes the pick with the whole bubble once the first read answered", async () => {
      const bridge = pendingCameraRead();
      const { result } = renderHook(() => useWidgetDevices(bridge.api, true));

      act(() => result.current.selectCamera("cam-2"));
      await act(async () => bridge.settle("cam-1"));

      await waitFor(() =>
        expect(bridge.api.updateSettings).toHaveBeenCalledWith({
          cameraBubble: expect.objectContaining({ deviceId: "cam-2" }),
        }),
      );
    });

    it("stops showing a pick once main's echo or another window changes the camera", async () => {
      const bridge = pendingCameraRead();
      const { result } = renderHook(() => useWidgetDevices(bridge.api, true));

      act(() => result.current.selectCamera("cam-2"));
      await act(async () => bridge.settle("cam-1"));
      act(() => bridge.broadcast("cam-3"));

      expect(result.current.cameraId).toBe("cam-3");
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

  describe("a pick that main has already answered", () => {
    afterEach(cleanup);

    it("shows the saved camera again when it returns to the value the pick was made over", async () => {
      const ipc = installSettingsIpc(settingsWithCamera("cam-1"));
      const api = {
        getRecordingSettings: vi.fn(() => new Promise(() => {})),
        updateSettings: vi.fn(),
        updateRecordingSettings: vi.fn(),
        onRecordingSettingsChanged: vi.fn(() => () => {}),
      } as unknown as Parameters<typeof useWidgetDevices>[0];
      const { result } = renderHook(() => useWidgetDevices(api, true));
      await waitFor(() => expect(result.current.cameraId).toBe("cam-1"));

      act(() => result.current.selectCamera("cam-2"));
      expect(result.current.cameraId).toBe("cam-2");
      // Main's echo makes the pick the saved value; the pick is spent.
      act(() => ipc.broadcast(settingsWithCamera("cam-2")));
      expect(result.current.cameraId).toBe("cam-2");

      // Another display (or Settings) puts cam-1 back: this widget must follow, not keep cam-2.
      act(() => ipc.broadcast(settingsWithCamera("cam-1")));
      expect(result.current.cameraId).toBe("cam-1");
    });
  });

  describe("the camera across displays", () => {
    afterEach(cleanup);
    it("follows a camera chosen in another overlay window", async () => {
      const ipc = installSettingsIpc(settingsWithCamera("cam-1"));
      const api = {
        getRecordingSettings: vi.fn(() => new Promise(() => {})),
        updateRecordingSettings: vi.fn(),
        onRecordingSettingsChanged: vi.fn(() => () => {}),
      } as unknown as Parameters<typeof useWidgetDevices>[0];
      const { result, unmount } = renderHook(() => useWidgetDevices(api, true));
      await waitFor(() => expect(result.current.cameraId).toBe("cam-1"));

      // Display B chose another camera: this window's widget must show it too.
      act(() => ipc.broadcast(settingsWithCamera("cam-2")));
      expect(result.current.cameraId).toBe("cam-2");

      // The window's one listener serves this hook; unmounting it opens or closes nothing.
      expect(ipc.activeSubscriptions()).toBe(1);
      unmount();
      expect(ipc.onSettingsChanged).toHaveBeenCalledTimes(1);
    });
  });
});
