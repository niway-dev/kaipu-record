import { describe, expect, it } from "vitest";
import type { WordOccurrence } from "../transcript-occurrence";
import { buildCues, DEFAULT_CUE_LIMITS } from "./cues";

/** Builds occurrences from `[text, start, end]` rows; source time follows the timeline in one clip. */
function words(
  rows: [string, number, number][],
  overrides: (index: number) => Partial<WordOccurrence> = () => ({}),
): WordOccurrence[] {
  return rows.map(([text, start, end], index) => ({
    wordId: `w${index}`,
    text,
    start,
    end,
    sourceStartMs: Math.round(start * 1000),
    sourceEndMs: Math.round(end * 1000),
    clipId: "clip-a",
    ...overrides(index),
  }));
}

/** Words of `duration` seconds each, back to back from `from`, with no pause. */
function run(texts: string[], from = 0, wordDuration = 0.4): [string, number, number][] {
  return texts.map((text, i) => [text, from + i * wordDuration, from + (i + 1) * wordDuration]);
}

const textOf = (cue: { lines: string[] }) => cue.lines.join(" ");

describe("buildCues", () => {
  it("gives no cues for no input", () => {
    expect(buildCues([])).toEqual([]);
  });

  it("builds one numbered cue from a short sentence-less run", () => {
    const cues = buildCues(words(run(["hello", "there", "friend"])));
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ index: 1, start: 0, lines: ["hello there friend"] });
    expect(cues[0]!.end).toBeCloseTo(1.2, 6);
  });

  it("normalizes whitespace and drops empty words", () => {
    const cues = buildCues(
      words([
        ["  hi ", 0, 0.5],
        ["   ", 0.5, 0.6],
        ["a\tb", 0.6, 1],
      ]),
    );
    expect(cues.map(textOf)).toEqual(["hi a b"]);
  });

  it("splits after sentence-ending punctuation, including closing quotes and brackets", () => {
    const cues = buildCues(
      words([
        ["Hola.", 0, 0.4],
        ["¿Cómo", 0.4, 0.8],
        ["estás?", 0.8, 1.2],
        ["Dijo", 1.2, 1.6],
        ['"vamos!"', 1.6, 2],
        ["Luego", 2, 2.4],
        ["(fin.)", 2.4, 2.8],
        ["Y…", 2.8, 3.2],
        ["más", 3.2, 3.6],
      ]),
    );
    expect(cues.map(textOf)).toEqual([
      "Hola.",
      "¿Cómo estás?",
      'Dijo "vamos!"',
      "Luego (fin.)",
      "Y…",
      "más",
    ]);
  });

  it("keeps Spanish accents and inverted marks intact", () => {
    const cues = buildCues(words(run(["¿Qué", "pasó", "mañana", "señor?"])));
    expect(cues.map(textOf)).toEqual(["¿Qué pasó mañana señor?"]);
  });

  it("splits at a pause over 0.6 s but not at one of exactly 0.6 s", () => {
    // The source stays contiguous, so only the timeline pause can explain a split.
    const contiguousSource = (i: number) =>
      i === 1 ? { sourceStartMs: 500, sourceEndMs: 900 } : {};
    const split = buildCues(
      words(
        [
          ["one", 0, 0.4],
          ["two", 1.05, 1.45],
        ],
        contiguousSource,
      ),
    );
    expect(split.map(textOf)).toEqual(["one", "two"]);

    const joined = buildCues(
      words(
        [
          ["one", 0, 0.4],
          ["two", 1, 1.4],
        ],
        contiguousSource,
      ),
    );
    expect(joined.map(textOf)).toEqual(["one two"]);
  });

  it("splits a cue where a cut falls inside a sentence (clip change, contiguous timeline)", () => {
    const cues = buildCues(
      words(
        [
          ["we", 0, 0.4],
          ["cut", 0.4, 0.8],
          ["here", 0.8, 1.2],
          ["and", 1.2, 1.6],
          ["go", 1.6, 2],
        ],
        (i) =>
          i >= 3
            ? {
                clipId: "clip-b",
                sourceStartMs: 9000 + (i - 3) * 400,
                sourceEndMs: 9400 + (i - 3) * 400,
              }
            : {},
      ),
    );
    expect(cues.map(textOf)).toEqual(["we cut here", "and go"]);
  });

  it("splits when the source skips forward more than 300 ms inside one clip", () => {
    const cues = buildCues(
      words(
        [
          ["a", 0, 0.4],
          ["b", 0.4, 0.8],
          ["c", 0.8, 1.2],
        ],
        (i) => (i === 2 ? { sourceStartMs: 1900, sourceEndMs: 2300 } : {}),
      ),
    );
    expect(cues.map(textOf)).toEqual(["a b", "c"]);
  });

  it("does not split when the source skips forward 300 ms or less", () => {
    const cues = buildCues(
      words(
        [
          ["a", 0, 0.4],
          ["b", 0.4, 0.8],
        ],
        (i) => (i === 1 ? { sourceStartMs: 700, sourceEndMs: 1100 } : {}),
      ),
    );
    expect(cues.map(textOf)).toEqual(["a b"]);
  });

  it("splits when the source goes backwards inside one clip", () => {
    const cues = buildCues(
      words(
        [
          ["a", 0, 0.4],
          ["b", 0.4, 0.8],
          ["c", 0.8, 1.2],
        ],
        (i) => (i === 2 ? { sourceStartMs: 100, sourceEndMs: 500 } : {}),
      ),
    );
    expect(cues.map(textOf)).toEqual(["a b", "c"]);
  });

  it("yields repeated footage twice, in timeline order, as separate cues", () => {
    const first = words(run(["same", "words", "again"]));
    const second = words(run(["same", "words", "again"], 1.2), () => ({
      clipId: "clip-b",
    })).map((o, i) => ({
      ...o,
      wordId: first[i]!.wordId,
      sourceStartMs: first[i]!.sourceStartMs,
      sourceEndMs: first[i]!.sourceEndMs,
    }));
    const cues = buildCues([...first, ...second]);
    expect(cues.map(textOf)).toEqual(["same words again", "same words again"]);
    expect(cues[0]!.end).toBeLessThanOrEqual(cues[1]!.start);
    expect(cues.map((c) => c.index)).toEqual([1, 2]);
  });

  describe("limits", () => {
    it("exposes the documented defaults", () => {
      expect(DEFAULT_CUE_LIMITS).toMatchObject({
        maxLineChars: 42,
        maxLines: 2,
        maxCharsPerSecond: 20,
        minDuration: 0.8,
        maxDuration: 7,
        maxPause: 0.6,
      });
    });

    it("breaks into two lines of at most 42 characters", () => {
      const texts = "the quick brown fox jumps over the lazy dog while the cat sleeps".split(" ");
      const cues = buildCues(words(run(texts, 0, 0.3)));
      expect(cues).toHaveLength(1);
      expect(cues[0]!.lines).toHaveLength(2);
      for (const line of cues[0]!.lines) expect(line.length).toBeLessThanOrEqual(42);
      expect(textOf(cues[0]!)).toBe(texts.join(" "));
    });

    it("starts a new cue when two lines cannot hold the text", () => {
      const texts = Array.from({ length: 30 }, () => "word");
      const cues = buildCues(words(run(texts, 0, 0.2)));
      expect(cues.length).toBeGreaterThan(1);
      for (const cue of cues) {
        expect(cue.lines.length).toBeLessThanOrEqual(2);
        for (const line of cue.lines) expect(line.length).toBeLessThanOrEqual(42);
      }
      expect(cues.map(textOf).join(" ")).toBe(texts.join(" "));
    });

    it("prefers to break the lines after a comma", () => {
      const texts = "When we arrived at the station, nobody was waiting for us there".split(" ");
      const cues = buildCues(words(run(texts, 0, 0.3)));
      expect(cues[0]!.lines).toEqual([
        "When we arrived at the station,",
        "nobody was waiting for us there",
      ]);
    });

    it("balances line lengths without a comma", () => {
      const texts = "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk".split(" ");
      const cues = buildCues(words(run(texts, 0, 0.3)));
      const [a, b] = cues[0]!.lines;
      expect(Math.abs(a!.length - b!.length)).toBeLessThanOrEqual(5);
    });

    it("keeps a word longer than the line length alone on its line", () => {
      const long = "x".repeat(50);
      const cues = buildCues(words(run(["short", long, "tail"], 0, 0.5)));
      const lines = cues.flatMap((c) => c.lines);
      expect(lines).toContain(long);
      expect(lines.join(" ")).toBe(`short ${long} tail`);
    });

    it("splits a cue that would last longer than 7 s", () => {
      const texts = Array.from({ length: 12 }, (_, i) => `w${i}`);
      const cues = buildCues(words(run(texts, 0, 1)));
      expect(cues.length).toBeGreaterThan(1);
      for (const cue of cues) expect(cue.end - cue.start).toBeLessThanOrEqual(7 + 1e-9);
      expect(cues.map(textOf).join(" ")).toBe(texts.join(" "));
    });

    it("extends a fast cue into the following silence up to the reading speed", () => {
      // 27 characters in 0.9 s of speech; 20 cps needs 1.35 s.
      const cues = buildCues(
        words([
          ["seventeen", 0, 0.3],
          ["characters", 0.3, 0.6],
          ["spoken", 0.6, 0.9],
          ["next", 1.8, 2.2],
        ]),
      );
      const [first, second] = cues;
      expect(first!.start).toBe(0);
      expect(first!.end).toBeCloseTo(1.35, 6);
      expect(first!.end).toBeLessThanOrEqual(second!.start - 0.04 + 1e-9);
    });

    it("extends a short cue to the minimum duration when there is room", () => {
      const cues = buildCues(
        words([
          ["hi.", 0, 0.2],
          ["later", 2, 2.4],
        ]),
      );
      expect(cues[0]!.end).toBeCloseTo(0.8, 6);
    });

    it("never extends past the next cue start minus 0.04 s, keeping the shorter cue", () => {
      const cues = buildCues(
        words([
          ["hi.", 0, 0.2],
          ["next", 0.5, 0.9],
        ]),
      );
      expect(cues[0]!.end).toBeCloseTo(0.46, 6);
      expect(cues[1]!.start).toBe(0.5);
    });

    it("does not extend past what the maximum duration allows", () => {
      const cues = buildCues(
        words([
          ["a".repeat(40), 0, 0.5],
          ["b", 30, 30.5],
        ]),
      );
      expect(cues[0]!.end - cues[0]!.start).toBeLessThanOrEqual(7);
    });

    it("does not extend the last cue, whose following silence is unknown", () => {
      const cues = buildCues(words([["hi", 0, 0.2]]));
      expect(cues[0]!.end).toBeCloseTo(0.2, 6);
    });

    it("accepts overridden limits", () => {
      const cues = buildCues(words(run(["aa", "bb", "cc", "dd"])), {
        maxLineChars: 5,
        maxLines: 1,
      });
      expect(cues.map(textOf)).toEqual(["aa bb", "cc dd"]);
    });
  });

  it("never overlaps cues on a long randomized stream", () => {
    let seed = 20261115;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const vocabulary = [
      "a",
      "of",
      "house",
      "speaking.",
      "however,",
      "¿why",
      "so?",
      "extraordinary",
      "ok!",
    ];
    const stream: WordOccurrence[] = [];
    let time = 0;
    let source = 0;
    let clip = 0;
    for (let i = 0; i < 5000; i++) {
      const gap = random() < 0.1 ? 0.5 + random() * 2 : random() * 0.1 - 0.03;
      const duration = 0.05 + random() * 0.5;
      time = Math.max(0, time + gap);
      if (random() < 0.05) {
        clip++;
        source = Math.floor(random() * 100000);
      }
      stream.push({
        wordId: `w${i}`,
        text: vocabulary[Math.floor(random() * vocabulary.length)]!,
        start: time,
        end: time + duration,
        sourceStartMs: source,
        sourceEndMs: source + Math.round(duration * 1000),
        clipId: `clip-${clip}`,
      });
      time += duration;
      source += Math.round(duration * 1000);
    }
    const cues = buildCues(stream);
    expect(cues.length).toBeGreaterThan(500);
    cues.forEach((cue, i) => {
      expect(cue.index).toBe(i + 1);
      expect(cue.end).toBeGreaterThanOrEqual(cue.start);
      expect(cue.lines.length).toBeGreaterThanOrEqual(1);
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      if (i > 0) expect(cue.start).toBeGreaterThanOrEqual(cues[i - 1]!.end);
    });
    expect(
      cues
        .flatMap((c) => c.lines)
        .join(" ")
        .split(" "),
    ).toHaveLength(5000);
  });
});
