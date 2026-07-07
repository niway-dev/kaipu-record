import { describe, expect, it } from "vitest";
import { BASE_TOKEN_NAMES, THEME_TOKEN_NAMES, base, dark, light } from "./index";

describe("token sources", () => {
  it("dark carries the exact values from the desktop's base.css", () => {
    // Spot-check the brand-critical values verbatim (source of truth migration).
    expect(dark["accent-primary"]).toBe("#f6055c");
    expect(dark["bg-app"]).toBe("#0f0f11");
    expect(dark["text-primary"]).toBe("#e5e5e7");
    expect(dark["glow-accent"]).toBe("0 10px 26px -8px rgba(246, 5, 92, 0.75)");
  });

  it("base carries the theme-invariant values verbatim", () => {
    expect(base["space-md"]).toBe("12px");
    expect(base["radius-lg"]).toBe("8px");
    expect(base["titlebar-height"]).toBe("38px");
    expect(base["transition"]).toBe("150ms ease");
  });

  it("every declared token name has a value in every set", () => {
    // TokenSet already enforces this at compile time; this guards the arrays
    // and the objects against drifting apart at runtime too.
    for (const name of THEME_TOKEN_NAMES) {
      expect(dark[name], `dark.${name}`).toBeTruthy();
      expect(light[name], `light.${name}`).toBeTruthy();
    }
    for (const name of BASE_TOKEN_NAMES) {
      expect(base[name], `base.${name}`).toBeTruthy();
    }
  });

  it("light is the dark placeholder until PR2 designs the real palette", () => {
    expect(light).toEqual(dark);
  });
});
