import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "setup-card.module.css"), "utf8");

describe("setup-card.module.css", () => {
  it.each(["toggle", "device"])(
    "gives the %s zone its own hover and focus-visible state",
    (zone) => {
      expect(css).toMatch(new RegExp(`\\.${zone}:hover`));
      expect(css).toMatch(new RegExp(`\\.${zone}:focus-visible`));
    },
  );

  it("no longer draws the small switch", () => {
    expect(css).not.toMatch(/\.switch\b/);
    expect(css).not.toMatch(/\.knob\b/);
  });
});
