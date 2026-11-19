import { describe, expect, it } from "vitest";
import type { Cue } from "./cues";
import { formatSrt } from "./srt";

const cues: Cue[] = [
  { index: 1, start: 0.5, end: 2.25, lines: ["Hello there."] },
  {
    index: 2,
    start: 3723.456,
    end: 3725.9995,
    lines: ["¿Cómo estás, señor?", "Muy bien, gracias."],
  },
  { index: 3, start: 3726, end: 3727.1, lines: ["a & b <c>"] },
];

describe("formatSrt", () => {
  it("writes index, comma timestamps, text lines and a blank line per cue", () => {
    expect(formatSrt(cues)).toBe(
      [
        "1",
        "00:00:00,500 --> 00:00:02,250",
        "Hello there.",
        "",
        "2",
        "01:02:03,456 --> 01:02:06,000",
        "¿Cómo estás, señor?",
        "Muy bien, gracias.",
        "",
        "3",
        "01:02:06,000 --> 01:02:07,100",
        "a & b <c>",
        "",
      ].join("\n"),
    );
  });

  it("gives an empty string for no cues", () => {
    expect(formatSrt([])).toBe("");
  });

  it("ends with a single trailing newline and uses only \\n", () => {
    const out = formatSrt(cues);
    expect(out.endsWith("c>\n")).toBe(true);
    expect(out).not.toContain("\r");
  });
});
