import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dirnameOf } from "../../../test/source-tree";

// jsdom does not lay out CSS modules, so the tag's placement (mock A4) is pinned in the rule.
const css = readFileSync(join(dirnameOf(import.meta.url), "image-selection.module.css"), "utf8");
const rule = (selector: string): string => {
  const match = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no ${selector} rule`);
  return match[1] ?? "";
};

describe("ImageSelection tag placement (mock A4)", () => {
  it("sits 8 px below the image's bottom edge, left-aligned with it", () => {
    const tag = rule("\\.tag");
    expect(tag).toMatch(/top:\s*calc\(100% \+ 8px \/ var\(--canvas-zoom, 1\)\)/);
    expect(tag).toMatch(/left:\s*0;/);
    expect(tag).not.toMatch(/bottom:/);
    expect(tag).toMatch(/transform-origin:\s*left top/);
  });
});
