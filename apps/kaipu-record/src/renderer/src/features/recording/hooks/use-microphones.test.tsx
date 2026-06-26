import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMicrophones } from "./use-microphones";

type Listener = () => void;

let getUserMedia: ReturnType<typeof vi.fn>;
let enumerateDevices: ReturnType<typeof vi.fn>;
let listeners: Listener[];

function device(partial: Partial<MediaDeviceInfo>): MediaDeviceInfo {
  return {
    kind: "audioinput",
    deviceId: "x",
    label: "",
    groupId: "g",
    toJSON: () => ({}),
    ...partial,
  } as MediaDeviceInfo;
}

beforeEach(() => {
  listeners = [];
  getUserMedia = vi.fn(
    async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream,
  );
  enumerateDevices = vi.fn(async () => []);
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia,
      enumerateDevices,
      addEventListener: (_: string, fn: Listener) => listeners.push(fn),
      removeEventListener: (_: string, fn: Listener) => {
        listeners = listeners.filter((l) => l !== fn);
      },
    },
    configurable: true,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("useMicrophones", () => {
  it("starts empty and lists audio inputs, dropping the synthetic 'default' device", async () => {
    enumerateDevices.mockResolvedValue([
      device({ deviceId: "default", label: "Default" }),
      device({ deviceId: "m1", label: "Built-in Mic" }),
      device({ deviceId: "cam", kind: "videoinput", label: "Webcam" }),
    ]);

    const { result } = renderHook(() => useMicrophones());
    expect(result.current).toEqual([]);

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toEqual({ deviceId: "m1", label: "Built-in Mic" });
  });

  it("primes permission with a short-lived stream so labels are populated", async () => {
    enumerateDevices.mockResolvedValue([device({ deviceId: "m1", label: "Mic" })]);
    const stop = vi.fn();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream);

    renderHook(() => useMicrophones());

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalled(); // the priming stream is released
  });

  it("numbers only the unnamed devices", async () => {
    enumerateDevices.mockResolvedValue([
      device({ deviceId: "m1", label: "Named Mic" }),
      device({ deviceId: "m2", label: "" }),
      device({ deviceId: "m3", label: "" }),
    ]);

    const { result } = renderHook(() => useMicrophones());

    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current.map((m) => m.label)).toEqual([
      "Named Mic",
      "Microphone 1",
      "Microphone 2",
    ]);
  });

  it("still enumerates when the permission prompt is denied", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));
    enumerateDevices.mockResolvedValue([device({ deviceId: "m1", label: "" })]);

    const { result } = renderHook(() => useMicrophones());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].label).toBe("Microphone 1");
  });

  it("refreshes the list on a devicechange event", async () => {
    enumerateDevices.mockResolvedValue([device({ deviceId: "m1", label: "First" })]);
    const { result } = renderHook(() => useMicrophones());
    await waitFor(() => expect(result.current).toHaveLength(1));

    enumerateDevices.mockResolvedValue([
      device({ deviceId: "m1", label: "First" }),
      device({ deviceId: "m2", label: "Second" }),
    ]);
    listeners.forEach((fn) => fn());

    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  it("detaches the devicechange listener on unmount", async () => {
    const { unmount } = renderHook(() => useMicrophones());
    await waitFor(() => expect(listeners).toHaveLength(1));
    unmount();
    expect(listeners).toHaveLength(0);
  });
});
