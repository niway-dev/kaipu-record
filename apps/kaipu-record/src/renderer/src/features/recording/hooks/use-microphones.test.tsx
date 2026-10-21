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

  // This test used to assert the opposite — that a stream is ALWAYS opened to prime the
  // permission. That is what lit the OS microphone indicator on a page where nothing is
  // recorded. The priming remains, but only when the OS is still hiding every label.
  it("primes permission with a short-lived stream only when labels are hidden", async () => {
    enumerateDevices.mockResolvedValue([device({ deviceId: "m1", label: "" })]);
    const stop = vi.fn();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream);

    renderHook(() => useMicrophones());

    await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalled(); // the priming stream is released

    // And re-reads the list afterwards, which is the whole point of priming.
    expect(enumerateDevices.mock.calls.length).toBeGreaterThan(1);
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

describe("useMicrophones and the microphone indicator", () => {
  // Opening a stream just to read device labels turns on the OS microphone indicator
  // (and moves the user's audio meter) on a page where nothing is being recorded yet.
  // Once mic permission has been granted, `enumerateDevices` already returns real
  // labels, so the probe is pure cost.
  it("does not open the microphone when labels are already available", async () => {
    enumerateDevices.mockResolvedValue([
      device({ deviceId: "mic-1", label: "MacBook Pro Microphone" }),
    ]);

    const { result } = renderHook(() => useMicrophones());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]!.label).toBe("MacBook Pro Microphone");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  // First run: the OS hides labels until permission is granted, and the only way to ask
  // is to open a stream. That is a real reason, so it stays — just not on every mount.
  it("falls back to opening one briefly when every label is blank", async () => {
    enumerateDevices.mockResolvedValue([device({ deviceId: "mic-1", label: "" })]);

    const { result } = renderHook(() => useMicrophones());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("stops the probe stream it opened, so nothing stays live", async () => {
    const stop = vi.fn();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    enumerateDevices.mockResolvedValue([device({ deviceId: "mic-1", label: "" })]);

    const { result } = renderHook(() => useMicrophones());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(stop).toHaveBeenCalled();
  });
});
