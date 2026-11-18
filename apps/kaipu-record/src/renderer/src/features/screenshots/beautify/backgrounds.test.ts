import { describe, expect, it } from "vitest";
import en from "@kaipu/i18n/messages/en";
import es from "@kaipu/i18n/messages/es";
import {
  BACKGROUND_IDS,
  BACKGROUNDS,
  backgroundCss,
  backgroundPaint,
  frameRadius,
  shadowCss,
  TRANSPARENT_CHECKER_CSS,
} from "./backgrounds";

describe("beautify helpers", () => {
  it("shadowCss is 'none' at zero", () => {
    expect(shadowCss(0)).toBe("none");
  });

  it("shadowCss matches the design formula at 60%", () => {
    // y=27, blur=62, spread=11, alpha=0.42
    expect(shadowCss(60)).toBe("0 27px 62px -11px rgba(0, 0, 0, 0.42)");
  });

  it("frameRadius keeps the shot radius when the background is transparent", () => {
    expect(frameRadius("none", 12)).toBe(12);
  });

  it("frameRadius enlarges the frame for a real background (min 8)", () => {
    expect(frameRadius("magenta", 12)).toBe(16);
    expect(frameRadius("magenta", 2)).toBe(8);
  });

  it("backgroundCss resolves a known id and falls back to the first", () => {
    expect(backgroundCss("magenta")).toContain("linear-gradient");
    expect(backgroundCss("dark")).toBe("var(--bg-app)");
  });
});

describe("the background table (NIW2-676: seventeen presets, NIW2-851: plus White)", () => {
  const ORIGINAL = [
    "none",
    "dark",
    "carbon",
    "magenta",
    "purple",
    "ocean",
    "sunset",
    "forest",
    "graphite",
  ];
  const NEW_EIGHT = ["aurora", "iris", "coral", "lilac", "citrus", "ember", "sky", "dusk"] as const;

  it("keeps the original nine in their order, White after the dark solids, the eight new ones last", () => {
    expect(BACKGROUND_IDS.filter((id) => id !== "white").slice(0, 9)).toEqual(ORIGINAL);
    expect(BACKGROUND_IDS.slice(0, 4)).toEqual(["none", "dark", "carbon", "white"]);
    expect(BACKGROUND_IDS.slice(10)).toEqual(NEW_EIGHT);
    expect(BACKGROUND_IDS).toHaveLength(18);
    expect(BACKGROUNDS.map((b) => b.id)).toEqual([...BACKGROUND_IDS]);
  });

  it("has unique ids and unique name keys", () => {
    expect(new Set(BACKGROUND_IDS).size).toBe(BACKGROUND_IDS.length);
    expect(new Set(BACKGROUNDS.map((b) => b.nameKey)).size).toBe(BACKGROUNDS.length);
  });

  it("White is a solid #ffffff with a Spanish and an English name", () => {
    expect(backgroundPaint("white")).toEqual({ kind: "solid", color: "#ffffff" });
    expect(backgroundCss("white")).toBe("#ffffff");
    expect(en.screenshots.bgWhite).toBe("White");
    expect(es.screenshots.bgWhite).toBe("Blanco");
  });

  it("the transparent swatch and the export-box fill share one checker", () => {
    expect(backgroundCss("none")).toBe(TRANSPARENT_CHECKER_CSS);
  });

  it("leaves the first nine's values untouched", () => {
    expect(backgroundPaint("magenta")).toEqual({
      kind: "gradient",
      from: "#ff2d6e",
      to: "#a3044a",
    });
    expect(backgroundPaint("purple")).toEqual({ kind: "gradient", from: "#a855f7", to: "#6d28d9" });
    expect(backgroundPaint("ocean")).toEqual({ kind: "gradient", from: "#2563eb", to: "#06b6d4" });
    expect(backgroundPaint("sunset")).toEqual({ kind: "gradient", from: "#f59e0b", to: "#ef4444" });
    expect(backgroundPaint("forest")).toEqual({ kind: "gradient", from: "#22c55e", to: "#0ea5e9" });
    expect(backgroundPaint("graphite")).toEqual({
      kind: "gradient",
      from: "#3f3f46",
      to: "#18181b",
    });
  });

  it.each(NEW_EIGHT)(
    "%s is a 135° gradient whose preview css is built from its own paint",
    (id) => {
      const paint = backgroundPaint(id);
      if (paint.kind !== "gradient") throw new Error(`${id} must be a gradient`);
      expect(paint.from).toMatch(/^#[0-9a-f]{6}$/);
      expect(paint.to).toMatch(/^#[0-9a-f]{6}$/);
      expect(paint.from).not.toBe(paint.to);
      expect(backgroundCss(id)).toBe(`linear-gradient(135deg, ${paint.from}, ${paint.to})`);
    },
  );

  it("gives every preset a css, a paint and a name in English and Spanish", () => {
    for (const bg of BACKGROUNDS) {
      expect(bg.css.length).toBeGreaterThan(0);
      expect(bg.paint.kind).toBeTruthy();
      expect(en.screenshots[bg.nameKey]).toEqual(expect.any(String));
      expect(es.screenshots[bg.nameKey]).toEqual(expect.any(String));
      expect(en.screenshots[bg.nameKey]).not.toBe("");
      expect(es.screenshots[bg.nameKey]).not.toBe("");
    }
  });

  it("uses no two presets with the same colour pair", () => {
    const pairs = BACKGROUNDS.map((b) => JSON.stringify(b.paint));
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
