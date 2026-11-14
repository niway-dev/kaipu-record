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
