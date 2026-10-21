import { afterEach, describe, expect, it } from "vitest";
import * as stylex from "@stylexjs/stylex";
import { lightTheme } from "@kaipu/tokens/kaipu.stylex";
import { applyTheme } from "./apply-theme";

const lightClasses = (stylex.props(lightTheme).className ?? "").split(" ").filter(Boolean);

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.documentElement.className = "";
});

describe("applyTheme", () => {
  it('sets data-theme="light" for the light theme', () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("removes the attribute for dark — the :root default must render with no attribute", () => {
    applyTheme("light");
    applyTheme("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("puts the StyleX light theme on <html>, so the shared components turn light too", () => {
    // The typed tokens hold literal dark values; only this class overrides them.
    // Without it a light window renders every @kaipu/ui component dark.
    expect(lightClasses.length).toBeGreaterThan(0);

    applyTheme("light");
    for (const name of lightClasses) {
      expect(document.documentElement.classList.contains(name)).toBe(true);
    }

    applyTheme("dark");
    for (const name of lightClasses) {
      expect(document.documentElement.classList.contains(name)).toBe(false);
    }
  });
});
