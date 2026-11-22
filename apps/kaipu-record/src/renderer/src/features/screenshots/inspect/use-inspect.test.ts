import { describe, expect, it } from "vitest";
import type { PickedColor } from "@shared/image-inspect-settings";
import { pickedReadout } from "./use-inspect";

const pick: PickedColor = {
  color: { r: 255, g: 0, b: 82, a: 255 },
  captured: { r: 250, g: 10, b: 90, a: 255 },
};

describe("pickedReadout", () => {
  it("formats the stored sRGB color in each format, so Format re-renders the box (AC4)", () => {
    expect(pickedReadout(pick, "hex", false)).toBe("#ff0052");
    expect(pickedReadout(pick, "rgb", false)).toBe("rgb(255, 0, 82)");
    expect(pickedReadout(pick, "hsl", false)).toMatch(/^hsl\(/);
    expect(pickedReadout(pick, "oklch", false)).toMatch(/^oklch\(/);
  });

  it("formats the captured bytes as hex or rgb when As captured is on", () => {
    expect(pickedReadout(pick, "hex", true)).toBe("#fa0a5a");
    expect(pickedReadout(pick, "rgb", true)).toBe("rgb(250, 10, 90)");
    // hsl and oklch are defined from sRGB: captured bytes fall back to the rgb form.
    expect(pickedReadout(pick, "hsl", true)).toBe("rgb(250, 10, 90)");
    expect(pickedReadout(pick, "oklch", true)).toBe("rgb(250, 10, 90)");
  });

  it("falls back to sRGB when the pick predates the captured probe", () => {
    const early: PickedColor = { color: pick.color };
    expect(pickedReadout(early, "hex", true)).toBe("#ff0052");
  });
});
