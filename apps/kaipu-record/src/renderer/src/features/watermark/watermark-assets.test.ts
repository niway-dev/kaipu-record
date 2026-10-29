import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The watermark is burned into the recording itself, so whatever art these files
 * hold ends up in every video a user shares. They used to carry the play-mark the
 * brand retired for the fox; nothing failed when the fox shipped everywhere else.
 * The mark is now the fox of the brand's mono cuts (the menu-bar art, without its
 * record dot), copied path for path.
 */
const ASSETS = resolve(__dirname, "../../assets/brand");
const BRAND = resolve(__dirname, "../../../../../../../packages/brand/assets");

const pathsOf = (svg: string): string[] => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
const foxPath = pathsOf(readFileSync(resolve(BRAND, "mono-record.svg"), "utf8"))[0];

describe("watermark assets", () => {
  it.each(["kaipu-wordmark.svg", "kaipu-mark-mono.svg"])("%s draws the brand fox", (file) => {
    expect(foxPath).toBeTruthy();
    expect(pathsOf(readFileSync(resolve(ASSETS, file), "utf8"))).toContain(foxPath);
  });
});
