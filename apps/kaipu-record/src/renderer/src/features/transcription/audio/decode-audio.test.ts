import { AudioSampleSink } from "mediabunny";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openRecordingInput } from "@renderer/lib/open-recording-input";
import {
  AUDIO_CHUNK_MS,
  NoAudioError,
  UndecodableAudioError,
  decodeAudioToPcm,
} from "./decode-audio";

// mediabunny decodes through WebCodecs, which jsdom lacks: mock the sink and the input opener
// at the boundary so the test exercises OUR orchestration (gaps, downmix, resample, chunking).
vi.mock("mediabunny", () => ({ AudioSampleSink: vi.fn() }));
vi.mock("@renderer/lib/open-recording-input", () => ({ openRecordingInput: vi.fn() }));

const SinkMock = vi.mocked(AudioSampleSink);
const openMock = vi.mocked(openRecordingInput);

const URL_R1 = "kaipu-media://recording/r1";
const PACKET_FRAMES = 1024;
const CHUNK_BYTES = 128_000;

interface FakeSample {
  timestamp: number;
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  numberOfFrames: number;
  copyTo: (dest: Float32Array, options: { planeIndex: number }) => void;
  close: ReturnType<typeof vi.fn>;
}

function fakeSample(timestamp: number, sampleRate: number, planes: Float32Array[]): FakeSample {
  const frames = planes[0]!.length;
  return {
    timestamp,
    duration: frames / sampleRate,
    sampleRate,
    numberOfChannels: planes.length,
    numberOfFrames: frames,
    copyTo: (dest, options) => dest.set(planes[options.planeIndex]!),
    close: vi.fn(),
  };
}

function tone(
  frames: number,
  freq: number,
  rate: number,
  amplitude: number,
  from = 0,
): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * (from + i)) / rate);
  }
  return out;
}

/** Packets of a tone, each one a sample stamped where it sits on the media timeline. */
function tonePackets(
  startSeconds: number,
  seconds: number,
  rate: number,
  channelAmplitudes: number[],
): FakeSample[] {
  const total = Math.round(seconds * rate);
  const packets: FakeSample[] = [];
  for (let at = 0; at < total; at += PACKET_FRAMES) {
    const frames = Math.min(PACKET_FRAMES, total - at);
    const planes = channelAmplitudes.map((amplitude) => tone(frames, 1000, rate, amplitude, at));
    packets.push(fakeSample(startSeconds + at / rate, rate, planes));
  }
  return packets;
}

interface FakeInput {
  getPrimaryAudioTrack: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  disposed: Promise<never>;
}

let input: FakeInput;
let pulled: number;

/** Gives the next `AudioSampleSink` the packets; `failAfter` throws once that many are served. */
function stubDecode(
  samples: Iterable<FakeSample>,
  options: { track?: unknown; failAfter?: number; stallAfter?: number } = {},
): void {
  const track = "track" in options ? options.track : { canDecode: async () => true };
  let rejectDisposed: (reason: Error) => void = () => {};
  const disposed = new Promise<never>((_, reject) => {
    rejectDisposed = reject;
  });
  disposed.catch(() => {});
  input = {
    getPrimaryAudioTrack: vi.fn(async () => track),
    dispose: vi.fn(() => rejectDisposed(new Error("input disposed"))),
    disposed,
  };
  openMock.mockReturnValue(input as never);
  pulled = 0;
  SinkMock.mockImplementation(function () {
    return {
      samples: () =>
        (async function* () {
          for (const sample of samples) {
            if (options.failAfter !== undefined && pulled >= options.failAfter) {
              throw new Error("decoder exploded");
            }
            if (options.stallAfter !== undefined && pulled >= options.stallAfter)
              await input.disposed;
            pulled++;
            yield sample;
          }
        })(),
    };
  } as never);
}

async function collect(gen: AsyncGenerator<ArrayBuffer>): Promise<ArrayBuffer[]> {
  const chunks: ArrayBuffer[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

function toInt16(chunks: ArrayBuffer[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength / 2, 0);
  const out = new Int16Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(new Int16Array(chunk), at);
    at += chunk.byteLength / 2;
  }
  return out;
}

function rmsOf(samples: Int16Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += (samples[i]! / 32767) ** 2;
  return Math.sqrt(sum / (to - from));
}

function risingCrossings(samples: Int16Array, from: number, to: number): number {
  let count = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1]! < 0 && samples[i]! >= 0) count++;
  return count;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decodeAudioToPcm", () => {
  it("exports a 4 second default chunk", () => {
    expect(AUDIO_CHUNK_MS).toBe(4000);
  });

  it("decodes a stereo 48 kHz tone to 16 kHz mono chunks of about 4 seconds", async () => {
    const packets = tonePackets(0, 10.5, 48000, [0.6, 0.2]);
    stubDecode(packets);

    const chunks = await collect(decodeAudioToPcm({ url: URL_R1 }, {}));

    expect(openMock).toHaveBeenCalledWith(URL_R1);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([CHUNK_BYTES, CHUNK_BYTES, 80_000]);
    const pcm = toInt16(chunks);
    expect(pcm.length).toBe(168_000);
    // Downmix averages 0.6 and 0.2 into a 0.4 tone; skip the filter edges.
    expect(rmsOf(pcm, 1600, 166_000)).toBeCloseTo(0.4 / Math.SQRT2, 2);
    expect(Math.abs(risingCrossings(pcm, 1600, 161_600) - 10_000)).toBeLessThanOrEqual(2);
    expect(input.dispose).toHaveBeenCalledTimes(1);
    for (const packet of packets) expect(packet.close).toHaveBeenCalledTimes(1);
  });

  it("decodes a mono 44.1 kHz tone to the exact length of its duration", async () => {
    stubDecode(tonePackets(0, 3, 44100, [0.5]));

    const pcm = toInt16(await collect(decodeAudioToPcm({ url: URL_R1 }, {})));

    expect(pcm.length).toBe(Math.round((3 * 44100 * 16000) / 44100));
    expect(rmsOf(pcm, 1600, 46_000)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("honours a custom chunk length", async () => {
    stubDecode(tonePackets(0, 2.5, 48000, [0.5]));

    const chunks = await collect(decodeAudioToPcm({ url: URL_R1 }, { chunkMs: 1000 }));

    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([32_000, 32_000, 16_000]);
  });

  it("pads a late audio start with silence so PCM time equals media time", async () => {
    stubDecode(tonePackets(0.5, 1, 48000, [0.5]));

    const pcm = toInt16(await collect(decodeAudioToPcm({ url: URL_R1 }, {})));

    expect(pcm.length).toBe(24_000);
    // The first 500 ms (8000 samples) is silence; the filter only reaches a few samples past it.
    expect(pcm.subarray(0, 7_900).every((sample) => sample === 0)).toBe(true);
    expect(rmsOf(pcm, 8_400, 23_600)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("pads a gap in the middle of the stream", async () => {
    const before = tonePackets(0, 1, 48000, [0.5]);
    const after = tonePackets(1.5, 1, 48000, [0.5]);
    stubDecode([...before, ...after]);

    const pcm = toInt16(await collect(decodeAudioToPcm({ url: URL_R1 }, {})));

    expect(pcm.length).toBe(40_000);
    expect(pcm.subarray(16_000 + 200, 24_000 - 200).every((sample) => sample === 0)).toBe(true);
    expect(rmsOf(pcm, 24_400, 39_000)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("ignores timestamp jitter below 20 ms instead of inserting silence", async () => {
    const first = tonePackets(0, 1, 48000, [0.5]);
    const second = tonePackets(1.015, 1, 48000, [0.5]);
    stubDecode([...first, ...second]);

    const pcm = toInt16(await collect(decodeAudioToPcm({ url: URL_R1 }, {})));

    expect(pcm.length).toBe(32_000);
  });

  it("never emits negative time: audio stamped before zero is trimmed", async () => {
    // 100 ms of packets starting at -50 ms: the first 50 ms belongs before the start.
    const packets = tonePackets(-0.05, 1.05, 48000, [0.5]);
    stubDecode(packets);

    const pcm = toInt16(await collect(decodeAudioToPcm({ url: URL_R1 }, {})));

    expect(pcm.length).toBe(16_000);
  });

  it("reports decoded media time through onDecoded", async () => {
    stubDecode(tonePackets(0, 2, 48000, [0.5]));
    const seen: number[] = [];

    await collect(decodeAudioToPcm({ url: URL_R1 }, { onDecoded: (ms) => seen.push(ms) }));

    expect(seen.length).toBeGreaterThan(10);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen.at(-1)).toBeCloseTo(2000, 0);
  });

  it("decodes lazily: it does not read ahead of the consumer, so memory does not grow with duration", async () => {
    // 60 minutes of packets would be 168750 samples; only a few may be touched for one chunk.
    function* hour(): Generator<FakeSample> {
      const rate = 48000;
      for (let at = 0; at < 3600 * rate; at += PACKET_FRAMES) {
        yield fakeSample(at / rate, rate, [new Float32Array(PACKET_FRAMES)]);
      }
    }
    stubDecode(hour());
    const gen = decodeAudioToPcm({ url: URL_R1 }, {});

    const first = await gen.next();

    expect(first.done).toBe(false);
    // 4 s of 48 kHz is 188 packets; allow slack for the decoder's own look-ahead.
    expect(pulled).toBeLessThan(200);
    await gen.return(undefined);
    expect(input.dispose).toHaveBeenCalledTimes(1);
  });

  describe("failures", () => {
    it("throws NoAudioError when the recording has no audio track", async () => {
      stubDecode([], { track: null });

      await expect(collect(decodeAudioToPcm({ url: URL_R1 }, {}))).rejects.toBeInstanceOf(
        NoAudioError,
      );
      expect(input.dispose).toHaveBeenCalledTimes(1);
    });

    it("throws UndecodableAudioError when the track cannot be decoded", async () => {
      stubDecode([], { track: { canDecode: async () => false } });

      await expect(collect(decodeAudioToPcm({ url: URL_R1 }, {}))).rejects.toBeInstanceOf(
        UndecodableAudioError,
      );
      expect(input.dispose).toHaveBeenCalledTimes(1);
    });

    it("throws UndecodableAudioError when the file cannot be opened", async () => {
      stubDecode([]);
      input.getPrimaryAudioTrack.mockRejectedValue(new Error("unsupported container"));

      await expect(collect(decodeAudioToPcm({ url: URL_R1 }, {}))).rejects.toBeInstanceOf(
        UndecodableAudioError,
      );
      expect(input.dispose).toHaveBeenCalledTimes(1);
    });

    it("throws UndecodableAudioError when the track yields no samples", async () => {
      stubDecode([]);

      await expect(collect(decodeAudioToPcm({ url: URL_R1 }, {}))).rejects.toBeInstanceOf(
        UndecodableAudioError,
      );
      expect(input.dispose).toHaveBeenCalledTimes(1);
    });

    it("wraps a mid-stream decode error, keeps the chunks already yielded and closes the input", async () => {
      const packets = tonePackets(0, 10, 48000, [0.5]);
      stubDecode(packets, { failAfter: 300 });
      const chunks: ArrayBuffer[] = [];
      let error: unknown;

      try {
        for await (const chunk of decodeAudioToPcm({ url: URL_R1 }, {})) chunks.push(chunk);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(UndecodableAudioError);
      expect((error as UndecodableAudioError).cause).toBeInstanceOf(Error);
      expect(chunks).toHaveLength(1);
      expect(input.dispose).toHaveBeenCalledTimes(1);
      for (const packet of packets.slice(0, 300)) expect(packet.close).toHaveBeenCalledTimes(1);
    });

    it("rejects a stream whose sample rate changes midway", async () => {
      stubDecode([
        fakeSample(0, 48000, [new Float32Array(PACKET_FRAMES)]),
        fakeSample(PACKET_FRAMES / 48000, 44100, [new Float32Array(PACKET_FRAMES)]),
      ]);

      await expect(collect(decodeAudioToPcm({ url: URL_R1 }, {}))).rejects.toBeInstanceOf(
        UndecodableAudioError,
      );
      expect(input.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe("abort", () => {
    it("rejects with an AbortError without opening the file when the signal is already aborted", async () => {
      stubDecode(tonePackets(0, 1, 48000, [0.5]));
      const controller = new AbortController();
      controller.abort();

      await expect(
        collect(decodeAudioToPcm({ url: URL_R1 }, { signal: controller.signal })),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(openMock).not.toHaveBeenCalled();
    });

    it("stops after the current sample, with an AbortError, and closes the input", async () => {
      const packets = tonePackets(0, 30, 48000, [0.5]);
      stubDecode(packets);
      const controller = new AbortController();
      const gen = decodeAudioToPcm({ url: URL_R1 }, { signal: controller.signal });

      const first = await gen.next();
      expect(first.done).toBe(false);
      controller.abort();

      await expect(gen.next()).rejects.toMatchObject({ name: "AbortError" });
      expect(input.dispose).toHaveBeenCalled();
      // Samples already pulled are closed; none beyond the abort point is decoded.
      expect(pulled).toBeLessThan(packets.length);
      for (const packet of packets.slice(0, pulled)) expect(packet.close).toHaveBeenCalledTimes(1);
    });

    it("interrupts a decode that is waiting on the file by disposing the input", async () => {
      stubDecode(tonePackets(0, 30, 48000, [0.5]), { stallAfter: 10 });
      const controller = new AbortController();
      const running = collect(decodeAudioToPcm({ url: URL_R1 }, { signal: controller.signal }));

      await vi.waitFor(() => expect(pulled).toBe(10));
      controller.abort();

      await expect(running).rejects.toMatchObject({ name: "AbortError" });
      expect(input.dispose).toHaveBeenCalled();
    });

    it("closes the input when the consumer stops iterating", async () => {
      stubDecode(tonePackets(0, 30, 48000, [0.5]));
      const gen = decodeAudioToPcm({ url: URL_R1 }, {});

      await gen.next();
      await gen.return(undefined);

      expect(input.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
