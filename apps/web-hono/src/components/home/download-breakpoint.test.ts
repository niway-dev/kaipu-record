import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The width below which a rule turns on, read from the `@media (width < N px)` block that holds it. */
function breakpointOf(file: string, rule: string): number {
  const css = readFileSync(new URL(file, import.meta.url), "utf8");
  const block = css.split("@media").find((chunk) => chunk.includes(rule));
  const width = block?.match(/^\s*\(width < (\d+)px\)/)?.[1];
  if (!width) throw new Error(`${file}: no "@media (width < N px)" block holds ${rule}`);
  return Number(width);
}

describe("the phone download swap", () => {
  // The stage lays out as one column below 1080px, but a 980–1079px Mac still gets the installer:
  // only a phone-sized window swaps the download buttons for "send me the link".
  it("happens at the width where the sticky bar appears, not where the stage layout changes", () => {
    const sticky = breakpointOf("sticky-cta.module.css", "display: flex");
    expect(sticky).toBe(980);
    expect(breakpointOf("hero.module.css", ".mobileOnly {\n    display: inline-flex")).toBe(sticky);
    expect(breakpointOf("hero-stage.module.css", ".samplePhone {\n    display: inline-flex")).toBe(
      sticky,
    );
  });
});
