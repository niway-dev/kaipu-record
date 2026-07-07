import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateCss } from "./generate";

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../css/${file}`, import.meta.url)), "utf8");

describe("committed CSS is in sync with the TS sources", () => {
  // If these fail: run `bun run generate` in packages/tokens and commit css/.
  it("css/tokens.css matches generateCss()", () => {
    expect(read("tokens.css")).toBe(generateCss());
  });

  it("css/tokens.kaipu.css matches generateCss('kaipu-')", () => {
    expect(read("tokens.kaipu.css")).toBe(generateCss("kaipu-"));
  });
});
