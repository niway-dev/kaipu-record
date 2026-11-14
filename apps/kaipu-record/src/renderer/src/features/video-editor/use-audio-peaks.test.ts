import { renderHook, waitFor } from "@testing-library/react";
import { AudioSampleSink } from "mediabunny";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openRecordingInput } from "@renderer/lib/open-recording-input";
import { __resetAudioPeaksCacheForTests, useAudioPeaks } from "./use-audio-peaks";

// mediabunny decodes via WebCodecs, which jsdom lacks: mock it and the Range-reader helper
// at the boundary so the test exercises OUR orchestration (open, sink, reduce, cache).
vi.mock("mediabunny", () => ({ AudioSampleSink: vi.fn() }));
vi.mock("@renderer/lib/open-recording-input", () => ({ openRecordingInput: vi.fn() }));

const SinkMock = vi.mocked(AudioSampleSink);
const openMock = vi.mocked(openRecordingInput);

const URL_R1 = "kaipu-media://recording/r1";

interface FakeSample {
  timestamp: number;
  sampleRate: number;
  numberOfChannels: number;
  allocationSize: () => number;
  copyTo: (dest: Float32Array, options: { planeIndex: number }) => void;
  close: ReturnType<typeof vi.fn>;
}

/** A 100 Hz sample (one value per bucket) with the same data on every channel. */
function fakeSample(timestamp: number, values: number[], channels = 1): FakeSample {
  return {
    timestamp,
    sampleRate: 100,
    numberOfChannels: channels,
    allocationSize: () => values.length * 4,
    copyTo: (dest) => dest.set(values),
    close: vi.fn(),
  };
}

const inputs: {
  getPrimaryAudioTrack: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}[] = [];

function stubInput(track: unknown) {
  openMock.mockImplementation((() => {
    const input = { getPrimaryAudioTrack: vi.fn(async () => track), dispose: vi.fn() };
    inputs.push(input);
    return input;
  }) as never);
}

function stubSamples(samples: FakeSample[]) {
  SinkMock.mockImplementation(function () {
    return {
      samples: () =>
        (async function* () {
          for (const sample of samples) yield sample;
        })(),
    };
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  inputs.length = 0;
  __resetAudioPeaksCacheForTests();
  stubInput({});
});

describe("useAudioPeaks", () => {
  it("publishes the reduced peaks of the decoded samples and closes every sample", async () => {
    const samples = [fakeSample(0, [0.1, 0.5]), fakeSample(0.02, [0.25, -0.75])];
    stubSamples(samples);
    const { result } = renderHook(() => useAudioPeaks(URL_R1, 1, true));

    await waitFor(() => expect(result.current?.filled).toBe(4));
    expect(Array.from(result.current!.peaks.slice(0, 4))).toEqual(
      [0.1, 0.5, 0.25, 0.75].map(Math.fround),
    );
    expect(result.current!.reference).toBeCloseTo(0.75);
    expect(openMock).toHaveBeenCalledWith(URL_R1);
    for (const sample of samples) expect(sample.close).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(inputs[0]!.dispose).toHaveBeenCalled());
  });

  it("reduces every channel of a sample", async () => {
    const sample = fakeSample(0, [0.3, 0.2], 2);
    let call = 0;
    sample.copyTo = (dest) => dest.set(call++ === 0 ? [0.3, 0.2] : [0.1, 0.9]);
    stubSamples([sample]);
    const { result } = renderHook(() => useAudioPeaks(URL_R1, 1, true));

    await waitFor(() => expect(result.current?.filled).toBe(2));
    expect(result.current!.peaks[0]).toBeCloseTo(0.3);
    expect(result.current!.peaks[1]).toBeCloseTo(0.9);
  });

  it("returns null and disposes the input when the recording has no audio track", async () => {
    stubInput(null);
    stubSamples([]);
    const { result } = renderHook(() => useAudioPeaks(URL_R1, 1, true));

    await waitFor(() => expect(inputs[0]!.dispose).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(SinkMock).not.toHaveBeenCalled();
  });

  it("decodes nothing while disabled or without a url", () => {
    stubSamples([fakeSample(0, [0.5])]);
    const disabled = renderHook(() => useAudioPeaks(URL_R1, 1, false));
    const empty = renderHook(() => useAudioPeaks("", 1, true));

    expect(openMock).not.toHaveBeenCalled();
    expect(disabled.result.current).toBeNull();
    expect(empty.result.current).toBeNull();
  });

  it("starts decoding when the flag turns on and drops the peaks when it turns off", async () => {
    stubSamples([fakeSample(0, [0.5])]);
    const { result, rerender } = renderHook(({ enabled }) => useAudioPeaks(URL_R1, 1, enabled), {
      initialProps: { enabled: false },
    });
    expect(openMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current?.filled).toBe(1));

    rerender({ enabled: false });
    expect(result.current).toBeNull();
  });

  it("reuses the peaks of a recording reopened in the same session", async () => {
    stubSamples([fakeSample(0, [0.5, 0.4])]);
    const first = renderHook(() => useAudioPeaks(URL_R1, 1, true));
    await waitFor(() => expect(first.result.current?.filled).toBe(2));
    await waitFor(() => expect(inputs[0]!.dispose).toHaveBeenCalled());
    first.unmount();

    const second = renderHook(() => useAudioPeaks(URL_R1, 1, true));
    expect(second.result.current?.filled).toBe(2); // published on mount, no waiting
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by url and duration", async () => {
    stubSamples([fakeSample(0, [0.5])]);
    const first = renderHook(() => useAudioPeaks(URL_R1, 1, true));
    await waitFor(() => expect(first.result.current?.filled).toBe(1));
    first.unmount();

    const other = renderHook(() => useAudioPeaks(URL_R1, 2, true));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(2));
    other.unmount();
  });

  it("stays null and never throws when decoding fails", async () => {
    SinkMock.mockImplementation(function () {
      return {
        samples: () => ({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new Error("decode failed")),
          }),
        }),
      };
    } as never);
    const { result } = renderHook(() => useAudioPeaks(URL_R1, 1, true));

    await waitFor(() => expect(inputs[0]!.dispose).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("does not cache a decode that was cancelled", async () => {
    stubSamples([fakeSample(0, [0.5])]);
    const first = renderHook(() => useAudioPeaks(URL_R1, 1, true));
    first.unmount(); // before the decode could finish
    await waitFor(() => expect(inputs[0]!.dispose).toHaveBeenCalled());

    renderHook(() => useAudioPeaks(URL_R1, 1, true));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(2));
  });
});
