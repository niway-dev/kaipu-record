import { afterEach, describe, expect, it } from "vitest";
import { applyTheme } from "./apply-theme";

afterEach(() => {
  delete document.documentElement.dataset.theme;
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
});
