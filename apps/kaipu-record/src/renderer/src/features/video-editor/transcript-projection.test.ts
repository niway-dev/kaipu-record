import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "@shared/types/transcription";
import type { MutedRange } from "./audio-edits";
import type { TrackItem } from "./scene";
import { toLayout } from "./timeline";
import { projectTranscript } from "./transcript-projection";

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
});
const slide = (id: string, duration: number): TrackItem => ({
  id,
  kind: "slide",
  assetId: "img",
  duration,
  naturalWidth: 10,
  naturalHeight: 10,
});
const word = (id: string, startMs: number, endMs: number, text = id): TranscriptWord => ({
  id,
  segmentId: "seg",
  text,
  startMs,
  endMs,
  logProb: -0.1,
});
const mute = (id: string, sourceStart: number, sourceEnd: number): MutedRange => ({
  id,
  sourceStart,
  sourceEnd,
});
const audible = { audioMuted: false, mutedRanges: [] as MutedRange[] };

describe("projectTranscript", () => {
  it("cut footage absent: a word outside every clip has no occurrence", () => {
    // Source 0-10 s and 15-30 s kept; 10-15 s deleted.
    const layout = toLayout([clip("a", 0, 10), clip("b", 15, 30)]);
    const out = projectTranscript(
      [word("in-a", 2000, 2500), word("cut", 11000, 11400), word("in-b", 16000, 16500)],
      layout,
      audible,
    );
    expect(out.map((o) => o.wordId)).toEqual(["in-a", "in-b"]);
    // "in-b" is at source 16 s, which plays at timeline 11 s (10 + 1).
    expect(out[1]).toEqual({
      wordId: "in-b",
      text: "in-b",
      start: 11,
      end: 11.5,
      sourceStartMs: 16000,
      sourceEndMs: 16500,
      clipId: "b",
    });
  });

  it("partial mute hides the whole word", () => {
    const layout = toLayout([clip("a", 0, 10)]);
    // The mute covers only the last 100 ms of a 400 ms word.
    const out = projectTranscript([word("w", 2000, 2400), word("ok", 3000, 3400)], layout, {
      audioMuted: false,
      mutedRanges: [mute("m", 2.3, 2.6)],
    });
    expect(out.map((o) => o.wordId)).toEqual(["ok"]);
  });

  it("a mute that only touches the word edge does not hide it", () => {
    const layout = toLayout([clip("a", 0, 10)]);
    const out = projectTranscript([word("w", 2000, 2400)], layout, {
      audioMuted: false,
      mutedRanges: [mute("before", 1, 2), mute("after", 2.4, 3)],
    });
    expect(out.map((o) => o.wordId)).toEqual(["w"]);
  });

  it("whole mute removes all", () => {
    const layout = toLayout([clip("a", 0, 10)]);
    const out = projectTranscript([word("w", 2000, 2400), word("x", 3000, 3400)], layout, {
      audioMuted: true,
      mutedRanges: [],
    });
    expect(out).toEqual([]);
  });

  it("a muted range overlapping another muted range hides what either covers", () => {
    const layout = toLayout([clip("a", 0, 10)]);
    const mutedRanges = [mute("m1", 1, 2.5), mute("m2", 2, 4), mute("tiny", 6, 6.001)];
    const out = projectTranscript(
      [
        word("in-m1", 1200, 1500),
        word("in-both", 2100, 2400),
        word("in-m2", 3500, 3900),
        word("free", 4500, 4900),
        word("hit-by-tiny", 5900, 6100),
      ],
      layout,
      { audioMuted: false, mutedRanges },
    );
    expect(out.map((o) => o.wordId)).toEqual(["free"]);
  });

  it("ignores empty or inverted muted ranges", () => {
    const layout = toLayout([clip("a", 0, 10)]);
    const out = projectTranscript([word("w", 2000, 2400)], layout, {
      audioMuted: false,
      mutedRanges: [mute("empty", 2.2, 2.2), mute("inverted", 3, 2)],
    });
    expect(out.map((o) => o.wordId)).toEqual(["w"]);
  });

  it("repeated footage gives two occurrences with two seek targets", () => {
    // The same source seconds 0-5 appear twice, a slide between them.
    const layout = toLayout([clip("first", 0, 5), slide("s", 2), clip("again", 0, 5)]);
    const out = projectTranscript([word("hola", 1000, 1400)], layout, audible);
    expect(out).toHaveLength(2);
    expect(out.map((o) => [o.wordId, o.clipId, o.start, o.end])).toEqual([
      ["hola", "first", 1, 1.4],
      ["hola", "again", 8, 8.4],
    ]);
  });

  it("a word across a clip boundary yields one occurrence (the overlap that holds at least half the word or 120 ms)", () => {
    // Clip a ends at source 2.0 s; clip b starts at source 5.0 s, so footage between is cut.
    const layout = toLayout([clip("a", 0, 2), clip("b", 5, 9)]);

    // 250 ms of a 400 ms word (62%) is in a, the rest is cut: one occurrence, the overlap only.
    const mostlyInA = projectTranscript([word("w", 1750, 2150)], layout, audible);
    expect(mostlyInA).toHaveLength(1);
    expect(mostlyInA[0]).toMatchObject({ clipId: "a", start: 1.75, end: 2, sourceStartMs: 1750 });

    // 100 ms of a 400 ms word (25%, under 120 ms): no occurrence.
    expect(projectTranscript([word("w", 1900, 2300)], layout, audible)).toEqual([]);

    // 130 ms of a 1 s word is under half but at least 120 ms: kept.
    const longWord = projectTranscript([word("w", 1870, 2870)], layout, audible);
    expect(longWord).toHaveLength(1);
    expect(longWord[0]).toMatchObject({ clipId: "a", start: 1.87, end: 2 });

    // 150 of 300 ms: half, and also over 120 ms.
    expect(projectTranscript([word("w", 1850, 2150)], layout, audible)).toHaveLength(1);

    // 50 ms of a 100 ms word is exactly half: kept.
    expect(projectTranscript([word("w", 1950, 2050)], layout, audible)).toHaveLength(1);
  });

  it("a word split across two non-adjacent clips plays once, where most of it is heard", () => {
    // Word 4.9-5.3 s: 100 ms sit in a (ends at 5.0), 200 ms in b (starts at 5.1).
    const layout = toLayout([clip("a", 0, 5), clip("b", 5.1, 9)]);
    const out = projectTranscript([word("w", 4900, 5300)], layout, audible);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ clipId: "b", sourceStartMs: 4900, sourceEndMs: 5300 });
    expect(out[0].start).toBeCloseTo(5, 6);
    expect(out[0].end).toBeCloseTo(5.2, 6);
  });

  it("a plain split keeps a word whole as one occurrence", () => {
    const layout = toLayout([clip("a", 0, 5), clip("b", 5, 10)]);
    const out = projectTranscript([word("w", 4800, 5200)], layout, audible);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      clipId: "a",
      start: 4.8,
      sourceStartMs: 4800,
      sourceEndMs: 5200,
    });
    expect(out[0].end).toBeCloseTo(5.2, 6);
  });

  it("slide entries never play words", () => {
    // A slide's local clock is 0..duration; its sourceStart/sourceEnd must not match words.
    const layout = toLayout([slide("s", 4), clip("a", 10, 12)]);
    const out = projectTranscript(
      [word("early", 1000, 1400), word("w", 10500, 10900)],
      layout,
      audible,
    );
    expect(out.map((o) => [o.wordId, o.clipId, o.start])).toEqual([["w", "a", 4.5]]);
  });

  it("empty layout and empty words give nothing", () => {
    expect(projectTranscript([word("w", 0, 400)], [], audible)).toEqual([]);
    expect(projectTranscript([], toLayout([clip("a", 0, 10)]), audible)).toEqual([]);
  });

  it("skips words with no duration", () => {
    const layout = toLayout([clip("a", 0, 10)]);
    expect(projectTranscript([word("w", 2000, 2000)], layout, audible)).toEqual([]);
  });

  it("output is time-ordered when the layout reorders clips", () => {
    // Source 10-20 plays first, then source 0-10.
    const layout = toLayout([clip("late", 10, 20), clip("early", 0, 10)]);
    const out = projectTranscript(
      [word("one", 1000, 1400), word("two", 12000, 12400), word("three", 15000, 15400)],
      layout,
      audible,
    );
    expect(out.map((o) => [o.wordId, o.start])).toEqual([
      ["two", 2],
      ["three", 5],
      ["one", 11],
    ]);
  });

  it("orders words that share a timeline start by source start", () => {
    // Cut: clip b starts at source 5 s, so two words that begin before it both start on the
    // timeline where b starts. The earlier source start comes first, whatever the input order.
    const layout = toLayout([clip("a", 0, 2), clip("b", 5, 9)]);
    const out = projectTranscript(
      [word("second", 4950, 5300), word("first", 4900, 5300)],
      layout,
      audible,
    );
    expect(out.map((o) => [o.wordId, o.start])).toEqual([
      ["first", 2],
      ["second", 2],
    ]);
  });

  it("skips clips of another recording when itemIds names this recording's clips", () => {
    // Both clips cover source 0-10, but "other" belongs to a different recording.
    const layout = toLayout([clip("mine", 0, 10), clip("other", 0, 10)]);
    const out = projectTranscript([word("w", 1000, 1400)], layout, audible, {
      itemIds: new Set(["mine"]),
    });
    expect(out.map((o) => o.clipId)).toEqual(["mine"]);
    // Without itemIds every clip is this recording's.
    expect(projectTranscript([word("w", 1000, 1400)], layout, audible)).toHaveLength(2);
  });

  it("handles 20,000 words with many mutes and clips in well under a second", () => {
    const clips: TrackItem[] = [];
    for (let i = 0; i < 200; i++) clips.push(clip(`c${i}`, i * 60, i * 60 + 55));
    const layout = toLayout(clips);
    const words: TranscriptWord[] = [];
    for (let i = 0; i < 20000; i++) words.push(word(`w${i}`, i * 600, i * 600 + 400));
    const mutedRanges: MutedRange[] = [];
    for (let i = 0; i < 2000; i++) mutedRanges.push(mute(`m${i}`, i * 6 + 1, i * 6 + 1.5));
    const t0 = performance.now();
    const out = projectTranscript(words, layout, { audioMuted: false, mutedRanges });
    const elapsed = performance.now() - t0;
    expect(out.length).toBeGreaterThan(5000);
    expect(elapsed).toBeLessThan(500);
    for (let i = 1; i < out.length; i++)
      expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
  });
});
