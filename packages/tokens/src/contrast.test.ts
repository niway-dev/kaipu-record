import { describe, expect, it } from "vitest";
import { dark } from "./themes/dark";
import { light } from "./themes/light";

/** WCAG relative luminance from a #rrggbb hex. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #rrggbb hex colors. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Every text token must be readable on every surface it can sit on.
const TEXT_TOKENS = ["text-primary", "text-secondary", "text-muted"] as const;
const SURFACE_TOKENS = [
  "bg-app",
  "bg-sidebar",
  "bg-card",
  "bg-card-hover",
  "bg-input",
  "bg-modal",
] as const;

describe("light theme", () => {
  it("is no longer the dark placeholder", () => {
    expect(light).not.toEqual(dark);
  });

  it("keeps the brand accent identical to dark", () => {
    expect(light["accent-primary"]).toBe(dark["accent-primary"]);
    expect(light["accent-primary-hover"]).toBe(dark["accent-primary-hover"]);
  });

  it.each(TEXT_TOKENS.flatMap((t) => SURFACE_TOKENS.map((s) => [t, s] as const)))(
    "light %s on %s meets WCAG AA (4.5:1)",
    (text, surface) => {
      expect(contrast(light[text], light[surface])).toBeGreaterThanOrEqual(4.5);
    },
  );
});

// NOTE: the DARK palette is intentionally NOT held to this bar here — the shipped
// dark text-muted (#6b7280) measures ~3.9:1 on bg-app, a pre-existing condition
// outside this PR's scope (spec binds AA on the LIGHT palette only). Flagged in
// the PR body as a known follow-up; do not "fix" dark values in this PR.
