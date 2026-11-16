import { describe, expect, it, vi } from "vitest";
import type { RenderClipSegment } from "./export-plan";
import {
  audioPlan,
  clipAudioOf,
  createResampler,
  interleave,
  mapChannels,
  needsResampling,
  overlapsSilence,
  placeFlushed,
  type RecordingAudio,
} from "./joined-audio";
import { clipSource } from "./joined-media";

const clip = (sourceId: string | null, start: number, end: number): RenderClipSegment => ({
  kind: "clip",
  timelineStart: 0,
  duration: end - start,
  sourceStart: start,
  sourceEnd: end,
  sourceId,
});
const slide = { kind: "slide" as const, timelineStart: 0, duration: 2, assetId: "s" };
const plan = (segments: unknown[], audioMuted = false) =>
  ({ segments, audio: { audioMuted, mutedRanges: [] } }) as unknown as Parameters<
    typeof audioPlan
  >[0];
const rec = (
  sourceId: string | null,
  hasAudio: boolean,
  sampleRate = 48000,
  channels = 2,
): RecordingAudio => ({ sourceId, hasAudio, sampleRate, channels });

describe("audioPlan", () => {
  const segments = [clip(null, 0, 10), clip("b", 3600, 3610)];

  it("decodes A and gives B's clips silence when only A has audio", () => {
    const p = audioPlan(plan(segments), [rec(null, true, 44100, 1), rec("b", false)]);
    expect(p.reference).toEqual({ sourceId: null, sampleRate: 44100, channels: 1 });
    expect(p.perSegment).toEqual(["decode", "silence"]);
  });

  it("has no audio track when neither recording has audio", () => {
    const p = audioPlan(plan(segments), [rec(null, false), rec("b", false)]);
    expect(p.reference).toBeNull();
  });

  it("has no audio track when the scene is muted, even if both have audio", () => {
    const p = audioPlan(plan(segments, true), [rec(null, true), rec("b", true)]);
    expect(p.reference).toBeNull();
  });

  it("takes B's format and silences A's clips when only B has audio", () => {
    const p = audioPlan(plan(segments), [rec(null, false), rec("b", true, 32000, 1)]);
    expect(p.reference).toEqual({ sourceId: "b", sampleRate: 32000, channels: 1 });
    expect(p.perSegment).toEqual(["silence", "decode"]);
  });

  it("uses the first used recording with audio as the reference, in plan order", () => {
    const p = audioPlan(plan([clip("b", 3600, 3610), clip(null, 0, 10)]), [
      rec(null, true, 44100),
      rec("b", true, 32000),
    ]);
    expect(p.reference?.sampleRate).toBe(32000);
  });

  it("ignores a recording no clip reads", () => {
    const p = audioPlan(plan([clip(null, 0, 10)]), [rec(null, false), rec("b", true)]);
    expect(p.reference).toBeNull();
  });

  it("behaves as before without joins: the opened recording's audio, slides silent", () => {
    const withAudio = audioPlan(plan([clip(null, 0, 10), slide]), [rec(null, true, 44100, 2)]);
    expect(withAudio.reference).toEqual({ sourceId: null, sampleRate: 44100, channels: 2 });
    expect(withAudio.perSegment).toEqual(["decode", "silence"]);
    expect(audioPlan(plan([clip(null, 0, 10)]), [rec(null, false)]).reference).toBeNull();
  });

  it("keeps the opened recording's audio for a plan of slides only, as before", () => {
    const p = audioPlan(plan([slide]), [rec(null, true)]);
    expect(p.reference?.sourceId).toBeNull();
    expect(p.perSegment).toEqual(["silence"]);
  });
});

describe("overlapsSilence", () => {
  const silenced = [{ start: 3602, end: 3604 }];
  it("zeroes only the local samples whose axis time lies in the mute", () => {
    const at = (s: number, e: number) => overlapsSilence(s, e, 3600, silenced);
    expect(at(0, 1)).toBe(false);
    expect(at(1.5, 2.5)).toBe(true);
    expect(at(2, 4)).toBe(true);
    expect(at(3.5, 4.5)).toBe(true);
    expect(at(4, 5)).toBe(false);
  });
  it("compares the same numbers when the offset is 0", () => {
    expect(overlapsSilence(3, 4, 0, [{ start: 3, end: 5 }])).toBe(true);
    expect(overlapsSilence(5, 6, 0, [{ start: 3, end: 5 }])).toBe(false);
  });
});

describe("createResampler", () => {
  const chunks = (total: number, size: number, from: (i: number) => number) => {
    const out: Float32Array[] = [];
    for (let start = 0; start < total; start += size) {
      const n = Math.min(size, total - start);
      out.push(Float32Array.from({ length: n }, (_, i) => from(start + i)));
    }
    return out;
  };
  const run = (pieces: Float32Array[], fromRate: number, toRate: number): Float32Array => {
    const resampler = createResampler(fromRate, toRate, 1);
    const parts = [...pieces.map((p) => resampler.push([p])[0]!), resampler.flush()[0]!];
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };

  it("keeps the total length within one frame of the duration over 100 chunks", () => {
    const pieces = chunks(100 * 1024, 1024, () => 0.5);
    const resampler = createResampler(44100, 48000, 1);
    let total = 0;
    for (const piece of pieces) total += resampler.push([piece])[0]!.length;
    total += resampler.flush()[0]!.length;
    expect(Math.abs(total - Math.round((102400 * 48000) / 44100))).toBeLessThanOrEqual(1);
  });
  it("gives the same samples whether a ramp arrives in chunks or in one piece", () => {
    const ramp = (i: number) => i;
    const whole = run(chunks(5000, 5000, ramp), 44100, 48000);
    const split = run(chunks(5000, 1024, ramp), 44100, 48000);
    expect(split.length).toBe(whole.length);
    let max = 0;
    for (let i = 0; i < whole.length; i++) max = Math.max(max, Math.abs(split[i]! - whole[i]!));
    expect(max).toBeLessThan(1e-6);
  });
  it("interpolates across a chunk boundary instead of restarting", () => {
    const out = run([new Float32Array([0, 1]), new Float32Array([0, 1])], 1, 2);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[3]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(1);
  });
  it("keeps a constant signal constant and downsamples by the rate ratio", () => {
    const out = run(
      chunks(4800, 1000, () => 0.25),
      48000,
      16000,
    );
    expect(out.length).toBe(1600);
    expect(out.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });
  it("resamples every channel", () => {
    const resampler = createResampler(24000, 48000, 2);
    const out = resampler.push([new Float32Array(100).fill(0.2), new Float32Array(100).fill(0.4)]);
    const tail = resampler.flush();
    expect(out.map((p, c) => p.length + tail[c]!.length)).toEqual([200, 200]);
    expect(out[1]![10]).toBeCloseTo(0.4);
  });
});

describe("needsResampling", () => {
  it("is false for the reference rate, so the same format creates no resampler", () => {
    expect(needsResampling(48000, 48000)).toBe(false);
    expect(needsResampling(44100, 48000)).toBe(true);
  });
});

describe("mapChannels", () => {
  it("duplicates mono into stereo", () => {
    const out = mapChannels([new Float32Array([0.25, 0.5])], 2);
    expect(out).toHaveLength(2);
    expect([...out[1]!]).toEqual([0.25, 0.5]);
  });
  it("averages stereo into mono", () => {
    const out = mapChannels([new Float32Array([1, 0]), new Float32Array([0, 1])], 1);
    expect([...out[0]!]).toEqual([0.5, 0.5]);
  });
  it("is the identity for the same channel count", () => {
    const planes = [new Float32Array([1, 2])];
    expect(mapChannels(planes, 1)).toBe(planes);
  });

  describe("5.1 (FL, FR, C, LFE, SL, SR) into stereo", () => {
    const C = Math.SQRT1_2;
    const norm = 1 + C + C;
    const frame = (...values: number[]) => values.map((v) => new Float32Array([v]));

    it("mixes the centre and the surrounds into both sides and drops the LFE", () => {
      const out = mapChannels(frame(1, 0.5, 0.4, 1, 0.2, 0.1), 2);
      expect(out).toHaveLength(2);
      expect(out[0]![0]).toBeCloseTo((1 + C * 0.4 + C * 0.2) / norm, 6);
      expect(out[1]![0]).toBeCloseTo((0.5 + C * 0.4 + C * 0.1) / norm, 6);
    });

    it("keeps dialogue that lives only in the centre channel audible on both sides", () => {
      const out = mapChannels(frame(0, 0, 1, 0, 0, 0), 2);
      expect(out[0]![0]).toBeCloseTo(C / norm, 6);
      expect(out[1]![0]).toBeCloseTo(C / norm, 6);
      expect(out[0]![0]).toBeGreaterThan(0);
    });

    it("cannot clip: full-scale in every channel stays at full scale", () => {
      const out = mapChannels(frame(1, 1, 1, 1, 1, 1), 2);
      expect(out[0]![0]).toBeCloseTo(1, 6);
      expect(out[1]![0]).toBeCloseTo(1, 6);
      const loud = mapChannels(frame(-1, -1, -1, 1, -1, -1), 2);
      expect(Math.abs(loud[0]![0]!)).toBeLessThanOrEqual(1 + 1e-6);
    });

    it("maps every frame, not only the first", () => {
      const out = mapChannels(
        [
          new Float32Array([1, 0]),
          new Float32Array([0, 1]),
          new Float32Array([0, 0]),
          new Float32Array([0, 0]),
          new Float32Array([0, 0]),
          new Float32Array([0, 0]),
        ],
        2,
      );
      expect([...out[0]!].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0.4142, 0]);
      expect([...out[1]!].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0, 0.4142]);
    });
  });

  it("spreads the channels beyond the first two of any other layout into both sides, normalised", () => {
    // Three channels (L, R, C): the third reaches both sides at 0.7071, divided by 1 + 0.7071.
    const out = mapChannels(
      [new Float32Array([0.2]), new Float32Array([0.4]), new Float32Array([0.6])],
      2,
    );
    const norm = 1 + Math.SQRT1_2;
    expect(out[0]![0]).toBeCloseTo((0.2 + Math.SQRT1_2 * 0.6) / norm, 6);
    expect(out[1]![0]).toBeCloseTo((0.4 + Math.SQRT1_2 * 0.6) / norm, 6);
  });

  it("averages every channel of a surround layout into mono", () => {
    const out = mapChannels(
      [1, 2, 3, 4, 5, 6].map((v) => new Float32Array([v])),
      1,
    );
    expect(out[0]![0]).toBeCloseTo(3.5, 6);
  });

  it("folds the surplus channels into a target that is not stereo too, instead of cutting them", () => {
    // Five channels into three: the last two are spread into all three, divided by 1 + 2 * 0.7071.
    const out = mapChannels(
      [1, 0, 0, 0.5, 0.5].map((v) => new Float32Array([v])),
      3,
    );
    const norm = 1 + 2 * Math.SQRT1_2;
    expect(out).toHaveLength(3);
    expect(out[0]![0]).toBeCloseTo((1 + 2 * Math.SQRT1_2 * 0.5) / norm, 6);
    expect(out[1]![0]).toBeCloseTo((0 + 2 * Math.SQRT1_2 * 0.5) / norm, 6);
  });
});

describe("placeFlushed", () => {
  const ramp = (frames: number) => Float32Array.from({ length: frames }, (_, i) => i / frames);

  it("keeps what the clip still has room for and cuts the rest", () => {
    const run = { emittedFrames: 47999, lastEnd: 1, localStart: 0, localEnd: 1, toRate: 48000 };
    const placed = placeFlushed([new Float32Array([0.1, 0.2, 0.3])], run);
    expect(placed!.planes).toHaveLength(1);
    expect(placed!.planes[0]!.length).toBe(1);
    expect(placed!.planes[0]![0]).toBeCloseTo(0.1, 6);
  });

  it("emits nothing once the clip's length is already reached", () => {
    const run = { emittedFrames: 48000, lastEnd: 1, localStart: 0, localEnd: 1, toRate: 48000 };
    expect(placeFlushed([new Float32Array([0.5, 0.5])], run)).toBeNull();
  });

  it("checks the flushed frames at the clip's last moments, so a mute that reaches the end covers them", () => {
    // B sits at axis 3600; its clip is local [0, 1] and is muted from 3600.5 to its end.
    const run = { emittedFrames: 47998, lastEnd: 1, localStart: 0, localEnd: 1, toRate: 48000 };
    const placed = placeFlushed([new Float32Array([0.1, 0.2])], run)!;
    expect(placed.end).toBeLessThanOrEqual(1);
    expect(placed.start).toBeGreaterThanOrEqual(0);
    expect(overlapsSilence(placed.start, placed.end, 3600, [{ start: 3600.5, end: 3601 }])).toBe(
      true,
    );
    // And a mute that ended before the clip's last frames does not reach them.
    expect(overlapsSilence(placed.start, placed.end, 3600, [{ start: 3600.1, end: 3600.9 }])).toBe(
      false,
    );
  });

  it("keeps the interval inside the clip when the audio ended after, or the frames outnumber it", () => {
    const run = { emittedFrames: 0, lastEnd: 5, localStart: 2, localEnd: 2.001, toRate: 48000 };
    const placed = placeFlushed([new Float32Array(1000)], run)!;
    expect(placed.planes[0]!.length).toBe(48);
    expect(placed.start).toBeGreaterThanOrEqual(2);
    expect(placed.end).toBeLessThanOrEqual(2.001);
  });

  it("with the real resampler, keeps every frame a whole clip owes and no more", () => {
    // One second at 24 kHz into a 48 kHz reference: exactly 48000 frames, flush included.
    const resampler = createResampler(24000, 48000, 1);
    const emittedFrames = resampler.push([ramp(24000)])[0]!.length;
    const owed = resampler.flush();
    expect(owed[0]!.length).toBeGreaterThan(0);
    const placed = placeFlushed(owed, {
      emittedFrames,
      lastEnd: 1,
      localStart: 0,
      localEnd: 1,
      toRate: 48000,
    });
    expect(placed!.planes[0]!.length).toBe(owed[0]!.length);
    expect(emittedFrames + placed!.planes[0]!.length).toBe(48000);
    expect(placed!.end).toBe(1);
  });
});

describe("interleave", () => {
  it("lays channels frame by frame", () => {
    expect([...interleave([new Float32Array([1, 2]), new Float32Array([3, 4])])]).toEqual([
      1, 3, 2, 4,
    ]);
  });
});

describe("clipAudioOf", () => {
  const JOINED = [{ sourceId: "b", offset: 3600 }];
  it("decodes B's audio over its local 0-10 and the opened one's untouched", () => {
    const samples = vi.fn((_s: number, _e: number) => (async function* () {})());
    const readers = new Map([
      [null, { samples: vi.fn(() => (async function* () {})()) }],
      ["b", { samples }],
    ]);
    const src = clipSource(clip("b", 3600, 3610), JOINED);
    clipAudioOf(src, readers as never);
    expect(samples).toHaveBeenCalledWith(0, 10);
    const open = clipSource(clip(null, 50, 60), JOINED);
    clipAudioOf(open, readers as never);
    expect(readers.get(null)!.samples).toHaveBeenCalledWith(50, 60);
  });
  it("returns null for a recording without an audio reader", () => {
    expect(clipAudioOf(clipSource(clip("b", 3600, 3610), JOINED), new Map())).toBeNull();
  });
});
