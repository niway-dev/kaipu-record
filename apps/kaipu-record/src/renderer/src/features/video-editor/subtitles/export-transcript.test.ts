import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "@shared/types/transcription";
import type { MutedRange } from "../audio-edits";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import { buildRows } from "../transcript-panel-model";
import { groupParagraphs } from "../transcript-paragraphs";
import { projectTranscript } from "../transcript-projection";
import { buildTranscriptExport } from "./export-transcript";

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
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

/**
 * One sentence, "Hola amigos y bienvenidos al canal de hoy.", spoken back to back between 1 s and
 * 5.2 s of the source, then a second sentence. The edit cuts 2.9-3.5 s out of the middle of the
 * first (the word "y" and half of the words around it live there), mutes "canal", and keeps
 * everything else. Illustrative fixture.
 */
const WORDS: TranscriptWord[] = [
  word("w1", 1000, 1400, "Hola"),
  word("w2", 1450, 2000, "amigos"),
  word("w3", 2050, 2400, "bienvenidos"),
  word("w4", 3000, 3300, "y"), // inside the cut
  word("w5", 3500, 3900, "al"),
  word("w6", 3950, 4300, "canal"), // muted
  word("w7", 4350, 4600, "de"),
  word("w8", 4650, 5200, "hoy."),
  word("w9", 5300, 5800, "¿Listos?"),
];
const LAYOUT = toLayout([clip("a", 0, 2.9), clip("b", 3.5, 10)]);
const MUTES = [mute("m", 3.9, 4.3)];

function shown() {
  const occurrences = projectTranscript(WORDS, LAYOUT, { audioMuted: false, mutedRanges: MUTES });
  // What the panel renders: rows of paragraphs, each with its occurrences, in order.
  const panelWords = buildRows(groupParagraphs(occurrences), []).flatMap((row) =>
    row.kind === "paragraph" ? row.paragraph.occurrences.map((o) => o.text) : [],
  );
  return { occurrences, panelWords };
}

function srtBlocks(srt: string): { time: string; text: string }[] {
  return srt
    .trim()
    .split("\n\n")
    .map((block) => {
      const [, time, ...lines] = block.split("\n");
      return { time, text: lines.join(" ") };
    });
}

describe("buildTranscriptExport", () => {
  it("the fixture is what we think: the cut and the mute removed words from the panel", () => {
    expect(shown().panelWords).toEqual([
      "Hola",
      "amigos",
      "bienvenidos",
      "al",
      "de",
      "hoy.",
      "¿Listos?",
    ]);
  });

  it("TXT holds every word the panel shows, in order, and nothing else", () => {
    const { occurrences, panelWords } = shown();
    const txt = buildTranscriptExport(occurrences, "txt");
    expect(txt.split(/\s+/).filter(Boolean)).toEqual(panelWords);
    expect(txt.endsWith("\n")).toBe(true);
  });

  it("SRT cue texts joined equal the panel's words, with comma milliseconds", () => {
    const { occurrences, panelWords } = shown();
    const srt = buildTranscriptExport(occurrences, "srt");
    const blocks = srtBlocks(srt);
    expect(blocks.map((b) => b.text).join(" ")).toBe(panelWords.join(" "));
    expect(blocks[0].time).toMatch(/^\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}$/);
    expect(srt.startsWith("1\n")).toBe(true);
    expect(srt).not.toContain("WEBVTT");
  });

  it("VTT has the WEBVTT header, dot milliseconds and the same words", () => {
    const { occurrences, panelWords } = shown();
    const vtt = buildTranscriptExport(occurrences, "vtt");
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    const cueText = vtt
      .split("\n\n")
      .slice(1)
      .map((block) => block.split("\n").slice(1).join(" "))
      .join(" ")
      .trim();
    expect(cueText).toBe(panelWords.join(" "));
    expect(vtt).toMatch(/\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}/);
    expect(vtt).not.toMatch(/\d,\d{3} -->/);
  });

  it("a muted word and a cut word are absent from all three formats", () => {
    const { occurrences } = shown();
    for (const format of ["srt", "vtt", "txt"] as const) {
      const out = buildTranscriptExport(occurrences, format);
      expect(out).not.toContain("canal");
      expect(out).not.toMatch(/\by\b/);
    }
  });

  it("a cut in the middle of a sentence splits the cue: none spans the discontinuity", () => {
    const { occurrences } = shown();
    // "bienvenidos" ends the first clip's speech (timeline 2.4 s) and "al" starts in the next clip
    // (timeline 2.9 s), after a 1.1 s skip in the source. The clip change splits the cue, so no
    // cue joins words from both sides of the cut.
    const blocks = srtBlocks(buildTranscriptExport(occurrences, "srt"));
    const texts = blocks.map((b) => b.text);
    const withBienvenidos = texts.find((t) => t.includes("bienvenidos")) ?? "";
    // The cue ends at the cut: the word after it ("al") starts the next cue.
    expect(withBienvenidos.endsWith("bienvenidos")).toBe(true);
    expect(withBienvenidos).not.toMatch(/\bal\b/);
    expect(texts.some((t) => t.startsWith("al"))).toBe(true);
  });

  it("timestamps are on the edited timeline", () => {
    const { occurrences } = shown();
    const [first] = srtBlocks(buildTranscriptExport(occurrences, "srt"));
    // "Hola" plays at 1.0 s in both the source and the edited video (the cut comes later).
    expect(first.time.startsWith("00:00:01,000")).toBe(true);
    // "al" is at source 3.5 s, which plays at 2.9 s after the cut.
    const after = srtBlocks(buildTranscriptExport(occurrences, "srt")).find((b) =>
      b.text.startsWith("al"),
    );
    expect(after?.time.startsWith("00:00:02,900")).toBe(true);
  });

  it("gives nothing to write for an empty edit", () => {
    expect(buildTranscriptExport([], "srt")).toBe("");
    expect(buildTranscriptExport([], "txt")).toBe("");
    expect(buildTranscriptExport([], "vtt")).toBe("WEBVTT\n\n");
  });
});
