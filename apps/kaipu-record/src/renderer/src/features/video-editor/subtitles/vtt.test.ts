import { describe, expect, it } from "vitest";
import type { Cue } from "./cues";
import { formatVtt } from "./vtt";

const cues: Cue[] = [
  { index: 1, start: 0.5, end: 2.25, lines: ["Hello there."] },
  {
    index: 2,
    start: 3723.456,
    end: 3725.9995,
    lines: ["¿Cómo estás, señor?", "Muy bien, gracias."],
  },
  { index: 3, start: 3726, end: 3727.1, lines: ["a & b <c> &amp;"] },
];

describe("formatVtt", () => {
  it("writes the header, dot timestamps, escaped text and a blank line per cue", () => {
    expect(formatVtt(cues)).toBe(
      [
        "WEBVTT",
        "",
        "00:00:00.500 --> 00:00:02.250",
        "Hello there.",
        "",
        "01:02:03.456 --> 01:02:06.000",
        "¿Cómo estás, señor?",
        "Muy bien, gracias.",
        "",
        "01:02:06.000 --> 01:02:07.100",
        "a &amp; b &lt;c&gt; &amp;amp;",
        "",
      ].join("\n"),
    );
  });

  it("gives only the header for no cues", () => {
    expect(formatVtt([])).toBe("WEBVTT\n\n");
  });
});
