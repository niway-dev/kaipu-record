import { describe, expect, it } from "vitest";
import { backgroundCss, frameRadius, shadowCss } from "./backgrounds";

describe("beautify helpers", () => {
  it("shadowCss is 'none' at zero", () => {
    expect(shadowCss(0)).toBe("none");
  });

  it("shadowCss matches the design formula at 60%", () => {
    // y=27, blur=62, spread=11, alpha=0.42
    expect(shadowCss(60)).toBe("0 27px 62px -11px rgba(0, 0, 0, 0.42)");
  });

  it("frameRadius keeps the shot radius when the background is transparent", () => {
    expect(frameRadius("ninguno", 12)).toBe(12);
  });

  it("frameRadius enlarges the frame for a real background (min 8)", () => {
    expect(frameRadius("magenta", 12)).toBe(16);
    expect(frameRadius("magenta", 2)).toBe(8);
  });

  it("backgroundCss resolves a known id and falls back to the first", () => {
    expect(backgroundCss("magenta")).toContain("linear-gradient");
    expect(backgroundCss("oscuro")).toBe("var(--bg-app)");
  });
});
