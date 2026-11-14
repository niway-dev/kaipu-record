import { describe, expect, it, vi } from "vitest";
import type { RenderClipSegment } from "./export-plan";
import {
  audioPlan,
  clipAudioOf,
  convertPlanar,
  interleave,
  overlapsSilence,
  resampleLinear,
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

describe("resampleLinear", () => {
  it("keeps the duration within one sample and a constant signal constant", () => {
    const out = resampleLinear(new Float32Array(4410).fill(0.5), 44100, 48000);
    expect(Math.abs(out.length / 48000 - 4410 / 44100)).toBeLessThanOrEqual(1 / 48000);
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });
  it("returns the same data for the same rate", () => {
    const input = new Float32Array([1, 2, 3]);
    expect(resampleLinear(input, 48000, 48000)).toBe(input);
  });
  it("interpolates between neighbours when upsampling by two", () => {
    const out = resampleLinear(new Float32Array([0, 1, 0, 1]), 1, 2);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[2]).toBeCloseTo(1);
  });
});

describe("convertPlanar", () => {
  it("duplicates mono into stereo", () => {
    const out = convertPlanar([new Float32Array([0.25, 0.5])], 48000, 48000, 2);
    expect(out).toHaveLength(2);
    expect([...out[1]!]).toEqual([0.25, 0.5]);
  });
  it("averages stereo into mono", () => {
    const out = convertPlanar(
      [new Float32Array([1, 0]), new Float32Array([0, 1])],
      48000,
      48000,
      1,
    );
    expect([...out[0]!]).toEqual([0.5, 0.5]);
  });
  it("resamples every channel", () => {
    const out = convertPlanar(
      [new Float32Array(100).fill(0.2), new Float32Array(100).fill(0.4)],
      24000,
      48000,
      2,
    );
    expect(out.map((p) => p.length)).toEqual([200, 200]);
    expect(out[1]![150]).toBeCloseTo(0.4);
  });
  it("is the identity for the same format", () => {
    const planes = [new Float32Array([1, 2])];
    expect(convertPlanar(planes, 48000, 48000, 1)).toBe(planes);
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
