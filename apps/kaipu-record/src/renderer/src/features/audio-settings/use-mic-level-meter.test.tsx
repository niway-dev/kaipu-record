import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { METER_BARS, spreadLevels, useMicLevelMeter } from "./use-mic-level-meter";

const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] } as unknown as MediaStream;
const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream);
const close = vi.fn(async () => {});
const createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
let timeDomain = 160;

class FakeAudioContext {
  createAnalyser(): unknown {
    return {
      fftSize: 0,
      getByteTimeDomainData: (data: Uint8Array) => data.fill(timeDomain),
    };
  }
  createMediaStreamSource = createMediaStreamSource;
  close = close;
}

let frames: ((now: number) => void)[] = [];
const originalMedia = navigator.mediaDevices;

beforeEach(() => {
  frames = [];
  timeDomain = 160;
  track.stop.mockClear();
  close.mockClear();
  getUserMedia.mockClear();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { value: originalMedia, configurable: true });
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useMicLevelMeter", () => {
  it("opens nothing while inactive", async () => {
    const { result } = renderHook(() => useMicLevelMeter("a", false));
    await flush();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current).toHaveLength(METER_BARS);
    expect(result.current.every((level) => level === 0)).toBe(true);
  });

  it("opens exactly the chosen device and reads levels into bars", async () => {
    const { result } = renderHook(() => useMicLevelMeter("a", true));
    await flush();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: "a" } } });
    act(() => frames.at(-1)!(1000));
    expect(result.current).toHaveLength(METER_BARS);
    expect(result.current.every((level) => level > 0)).toBe(true);
  });

  it("releases the tracks and the context when it goes inactive", async () => {
    const { rerender, result } = renderHook(({ active }) => useMicLevelMeter("a", active), {
      initialProps: { active: true },
    });
    await flush();
    act(() => frames.at(-1)!(1000));
    rerender({ active: false });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(result.current.every((level) => level === 0)).toBe(true);
  });

  it("releases on unmount and on a device change", async () => {
    const { rerender, unmount } = renderHook(({ id }) => useMicLevelMeter(id, true), {
      initialProps: { id: "a" },
    });
    await flush();
    rerender({ id: "b" });
    expect(track.stop).toHaveBeenCalledTimes(1);
    await flush();
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: "b" } } });
    unmount();
    expect(track.stop).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("stops a stream that arrives after the meter already closed", async () => {
    let resolve!: (s: MediaStream) => void;
    getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => (resolve = r)));
    const { unmount } = renderHook(() => useMicLevelMeter("a", true));
    unmount();
    await act(async () => resolve(stream));
    expect(track.stop).toHaveBeenCalledOnce();
  });
});

describe("spreadLevels", () => {
  it("is flat without a reading", () => {
    expect(spreadLevels(undefined)).toEqual(Array.from({ length: METER_BARS }, () => 0));
  });

  it("keeps the ends and interpolates between the engine's bars", () => {
    const bars = spreadLevels([0, 1]);
    expect(bars).toHaveLength(METER_BARS);
    expect(bars[0]).toBe(0);
    expect(bars.at(-1)).toBe(1);
    expect(bars[6]!).toBeGreaterThan(0.4);
    expect(bars[6]!).toBeLessThan(0.6);
  });
});
