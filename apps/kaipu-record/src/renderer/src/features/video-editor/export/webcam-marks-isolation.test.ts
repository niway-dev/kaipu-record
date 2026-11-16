import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The paused preview's marks (label, ghost, route, chip, hidden outline) are editor chrome.
 * If the export composer imported one, it would be drawn into the user's MP4. The export
 * folder's own imports are the line to hold.
 */
const EXPORT_DIR = __dirname;
const FORBIDDEN = /webcam-marks|webcam-names|webcam-route-overlay|webcam-stretches|webcam-lane/;

const sources = readdirSync(EXPORT_DIR).filter(
  (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
);

/** Every module specifier the file imports or re-exports, however it is written. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) found.push(match[1]!);
  return found;
}

describe("the export does not import the preview's marks", () => {
  it("reads the export folder (a guard against the test checking nothing)", () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources).toContain("compose-webcam.ts");
  });

  it("finds the specifiers it looks for (the regex sees static, dynamic and side-effect imports)", () => {
    const sample = `import a from "./a";\nexport { b } from "../webcam/webcam-marks";\nconst c = await import("./webcam-names");\nimport "./x.css";`;
    expect(specifiersOf(sample)).toEqual([
      "./a",
      "../webcam/webcam-marks",
      "./webcam-names",
      "./x.css",
    ]);
  });

  it.each(sources)("%s imports no mark, name, route overlay, stretch or lane module", (file) => {
    const specifiers = specifiersOf(readFileSync(join(EXPORT_DIR, file), "utf8"));
    expect(specifiers.filter((s) => FORBIDDEN.test(s))).toEqual([]);
  });
});
