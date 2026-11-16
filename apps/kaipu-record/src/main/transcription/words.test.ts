import { describe, expect, it } from "vitest";
import type { Seam, Segment } from "./segment";
import { groupTokens, normalizeWord, reconcile, type CliResult, type Word } from "./words";

const seg = (id: string, startMs = 0, endMs = 30_000): Segment => ({ id, startMs, endMs });

/** Tokens at the given start times (s) with a fixed duration (s). */
function result(tokens: string[], timestamps: number[], duration = 0.16): CliResult {
  return {
    text: tokens.join(""),
    tokens,
    timestamps,
    durations: tokens.map(() => duration),
    ys_log_probs: tokens.map(() => -0.1),
  };
}

describe("groupTokens", () => {
  it("groups at a leading space", () => {
    const words = groupTokens(
      result([" Ho", "y", " es", " lu", "nes"], [0, 0.16, 0.4, 0.8, 0.96]),
      seg("s0"),
    );
    expect(words.map((w) => w.text)).toEqual(["Hoy", "es", "lunes"]);
    expect(words[0]).toMatchObject({ startMs: 0, endMs: 320, segmentId: "s0" });
    expect(words[2]).toMatchObject({ startMs: 800, endMs: 1120 });
  });

  it("groups at the ▁ marker", () => {
    const words = groupTokens(result(["▁Hel", "lo", "▁wor", "ld"], [0, 0.2, 0.5, 0.7]), seg("s0"));
    expect(words.map((w) => w.text)).toEqual(["Hello", "world"]);
  });

  it("takes the first token of the result as a word start even without a marker", () => {
    const words = groupTokens(result(["Ho", "la"], [0.1, 0.3]), seg("s0"));
    expect(words.map((w) => w.text)).toEqual(["Hola"]);
    expect(words[0]!.startMs).toBe(100);
  });

  it("attaches punctuation without stretching the word end", () => {
    // "." has a long duration, as measured on the model; the word must still end at 0.32 s.
    const r: CliResult = {
      text: " Hoy.",
      tokens: [" Ho", "y", "."],
      timestamps: [0, 0.16, 0.32],
      durations: [0.16, 0.16, 0.6],
      ys_log_probs: [-0.1, -0.1, -0.1],
    };
    const [word] = groupTokens(r, seg("s0"));
    expect(word).toMatchObject({ text: "Hoy.", startMs: 0, endMs: 320 });
  });

  it("attaches punctuation that carries its own space marker to the word before", () => {
    const words = groupTokens(
      result([" Hola", " ,", " mundo", "▁."], [0, 0.4, 0.6, 1.0]),
      seg("s0"),
    );
    expect(words.map((w) => w.text)).toEqual(["Hola,", "mundo."]);
    expect(words[0]!.endMs).toBe(160);
  });

  it("keeps apostrophes inside the word", () => {
    const [word] = groupTokens(result([" don", "'", "t"], [0, 0.2, 0.24]), seg("s0"));
    expect(word).toMatchObject({ text: "don't", startMs: 0, endMs: 400 });
  });

  it("keeps opening punctuation with the word that follows it", () => {
    const words = groupTokens(result([" ¿", "Qué", " tal", "?"], [0, 0.1, 0.5, 0.7]), seg("s0"));
    expect(words.map((w) => w.text)).toEqual(["¿Qué", "tal?"]);
    expect(words[0]!.startMs).toBe(0);
    const mid = groupTokens(result([" Hola", " ¿", "qué"], [0, 0.4, 0.5]), seg("s0"));
    expect(mid.map((w) => w.text)).toEqual(["Hola", "¿qué"]);
  });

  it("ends the last word at its last token start plus duration", () => {
    const words = groupTokens(result([" uno", " dos"], [1, 2], 0.24), seg("s0"));
    expect(words[1]).toMatchObject({ startMs: 2000, endMs: 2240 });
  });

  it("returns no words for an empty result or one with only punctuation", () => {
    expect(groupTokens({ text: "", tokens: [], timestamps: [] }, seg("s0"))).toEqual([]);
    expect(groupTokens(result([" ."], [0.2]), seg("s0"))).toEqual([]);
  });

  it("gives a word with no duration at least 80 ms", () => {
    const r: CliResult = { text: " a b", tokens: [" a", " b"], timestamps: [0, 0.5] };
    const words = groupTokens(r, seg("s0"));
    expect(words.map((w) => [w.startMs, w.endMs])).toEqual([
      [0, 80],
      [500, 580],
    ]);
    expect(words.every((w) => w.logProb === 0)).toBe(true);
  });

  it("gives a zero-duration token the minimum too", () => {
    const [word] = groupTokens(result([" a"], [1], 0), seg("s0"));
    expect(word).toMatchObject({ startMs: 1000, endMs: 1080 });
  });

  it("offsets by the segment start and rounds to integer ms", () => {
    const words = groupTokens(result([" a"], [1.2346], 0.1111), seg("s3", 27_000, 57_000));
    expect(words[0]!.startMs).toBe(28_235); // 27000 + 1234.6
    expect(Number.isInteger(words[0]!.endMs)).toBe(true);
    expect(words[0]!.segmentId).toBe("s3");
    expect(words[0]!.endMs).toBeGreaterThanOrEqual(words[0]!.startMs);
  });

  it("averages the token log-probabilities of a word", () => {
    const r: CliResult = {
      text: " ab",
      tokens: [" a", "b"],
      timestamps: [0, 0.1],
      durations: [0.1, 0.1],
      ys_log_probs: [-0.2, -0.4],
    };
    expect(groupTokens(r, seg("s0"))[0]!.logProb).toBeCloseTo(-0.3, 10);
  });

  it("never emits an end before its start", () => {
    const r: CliResult = { text: " a", tokens: [" a"], timestamps: [1], durations: [-0.5] };
    const [word] = groupTokens(r, seg("s0"));
    expect(word!.endMs).toBeGreaterThanOrEqual(word!.startMs);
  });
});

describe("normalizeWord", () => {
  it("lowercases and drops everything but letters and digits", () => {
    expect(normalizeWord("¿Qué?")).toBe("qué");
    expect(normalizeWord("don't,")).toBe("dont");
    expect(normalizeWord("3.5")).toBe("35");
  });
});

describe("reconcile", () => {
  const word = (segmentId: string, text: string, startMs: number, endMs: number): Word => ({
    segmentId,
    text,
    startMs,
    endMs,
    logProb: -0.1,
  });
  const segments = [seg("s0", 0, 30_000), seg("s1", 27_000, 57_000)];
  const seams: Seam[] = [
    { beforeId: "s0", afterId: "s1", cutMs: 28_500, overlapStartMs: 27_000, overlapEndMs: 30_000 },
  ];

  it("keeps a word duplicated in both segments exactly once", () => {
    const out = reconcile(
      segments,
      seams,
      new Map([
        ["s0", [word("s0", "hola", 28_000, 28_300), word("s0", "mundo", 28_700, 29_000)]],
        [
          "s1",
          [
            word("s1", "hola", 28_000, 28_300),
            word("s1", "mundo", 28_700, 29_000),
            word("s1", "fin", 31_000, 31_300),
          ],
        ],
      ]),
    );
    expect(out.map((w) => w.text)).toEqual(["hola", "mundo", "fin"]);
    expect(out[0]!.segmentId).toBe("s0"); // before the cut: the earlier segment owns it
    expect(out[1]!.segmentId).toBe("s1"); // after the cut: the later one does
  });

  it("keeps a word that only one side heard", () => {
    const out = reconcile(
      segments,
      seams,
      new Map([
        ["s0", [word("s0", "solo", 27_500, 27_800)]],
        ["s1", [word("s1", "otra", 29_000, 29_300)]],
      ]),
    );
    expect(out.map((w) => w.text)).toEqual(["solo", "otra"]);
  });

  it("keeps a straddling word once, even when the two runs time it a frame apart", () => {
    const out = reconcile(
      segments,
      seams,
      new Map([
        ["s0", [word("s0", "Casa", 28_300, 28_620)]],
        ["s1", [word("s1", "casa,", 28_320, 28_640)]],
      ]),
    );
    expect(out).toHaveLength(1);
  });

  it("drops a duplicate that the midpoint rule keeps on both sides", () => {
    // Midpoints 28 480 and 28 520 fall on opposite sides of the cut at 28 500.
    const out = reconcile(
      segments,
      seams,
      new Map([
        ["s0", [word("s0", "toma", 28_400, 28_560)]],
        ["s1", [word("s1", "toma", 28_440, 28_600)]],
      ]),
    );
    expect(out.map((w) => w.text)).toEqual(["toma"]);
  });

  it("does not collapse a genuinely repeated word far from the cut", () => {
    const out = reconcile(
      [seg("s0", 0, 10_000)],
      [],
      new Map([["s0", [word("s0", "no", 1000, 1200), word("s0", "no", 1250, 1450)]]]),
    );
    expect(out).toHaveLength(2);
  });

  it("leaves non-overlapping segments untouched", () => {
    const out = reconcile(
      [seg("s0", 0, 10_000), seg("s1", 10_000, 20_000)],
      [],
      new Map([
        ["s0", [word("s0", "a", 100, 200)]],
        ["s1", [word("s1", "b", 10_100, 10_200)]],
      ]),
    );
    expect(out.map((w) => w.text)).toEqual(["a", "b"]);
  });

  it("assigns w1..wn in time order after reconciling, deterministically", () => {
    const input = () =>
      new Map([
        ["s1", [word("s1", "tres", 29_000, 29_300), word("s1", "cuatro", 31_000, 31_300)]],
        ["s0", [word("s0", "uno", 100, 300), word("s0", "dos", 27_500, 27_800)]],
      ]);
    const out = reconcile(segments, seams, input());
    expect(out.map((w) => w.id)).toEqual(["w1", "w2", "w3", "w4"]);
    expect(out.map((w) => w.text)).toEqual(["uno", "dos", "tres", "cuatro"]);
    expect(reconcile(segments, seams, input())).toEqual(out);
  });

  it("does not mutate its input and tolerates segments without words", () => {
    const words = [word("s0", "a", 100, 200)];
    const out = reconcile(segments, seams, new Map([["s0", words]]));
    expect(words[0]!.id).toBeUndefined();
    expect(out).toHaveLength(1);
  });
});
