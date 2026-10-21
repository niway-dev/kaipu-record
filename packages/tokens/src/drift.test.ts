import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateCss, generateStylex } from "./generate";

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../css/${file}`, import.meta.url)), "utf8");
const readStylex = () =>
  readFileSync(fileURLToPath(new URL("../stylex/kaipu.stylex.ts", import.meta.url)), "utf8");

describe("committed CSS is in sync with the TS sources", () => {
  it("css/tokens.css matches generateCss()", () => {
    expect(
      read("tokens.css"),
      "Out of sync — run `bun run generate` in packages/tokens and commit css/",
    ).toBe(generateCss());
  });

  it("css/tokens.kaipu.css matches generateCss('kaipu-')", () => {
    expect(
      read("tokens.kaipu.css"),
      "Out of sync — run `bun run generate` in packages/tokens and commit css/",
    ).toBe(generateCss("kaipu-"));
  });

  it("stylex/kaipu.stylex.ts matches generateStylex()", () => {
    expect(
      readStylex(),
      "Out of sync — run `bun run generate` in packages/tokens and commit stylex/",
    ).toBe(generateStylex());
  });
});
