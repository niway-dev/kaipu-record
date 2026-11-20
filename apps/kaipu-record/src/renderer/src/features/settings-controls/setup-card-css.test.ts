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

  it("makes each zone's hover clearly visible with a tint and a ring, and ON keeps its pink", () => {
    const hover = css.match(/\.toggle:hover[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(hover).toMatch(/background: rgba\(255, 255, 255, 0\.1\)/);
    expect(hover).toMatch(/box-shadow: inset 0 0 0 1px/);
    const activeHover = css.match(/\.card\[data-active\] \.toggle:hover[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(activeHover).toMatch(/rgba\(246, 5, 92/);
  });

  it("uses the pink open border for an ON card only; an OFF open card is neutral", () => {
    const open = css.match(/\n\.card\[data-open\] \{[^}]*\}/)?.[0] ?? "";
    expect(open).not.toMatch(/246, 5, 92/);
    expect(css).toMatch(/\.card\[data-active\]\[data-open\] \{[^}]*246, 5, 92/);
  });
});
