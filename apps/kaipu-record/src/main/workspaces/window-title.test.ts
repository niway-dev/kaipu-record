import { describe, expect, it } from "vitest";
import { composeWindowTitle } from "./window-title";

describe("composeWindowTitle", () => {
  it("prefixes the workspace once a second one exists", () => {
    expect(composeWindowTitle("Kaipu Record", "Work")).toBe("Work — Kaipu Record");
    expect(composeWindowTitle("Demo take", "Work")).toBe("Work — Demo take");
  });

  it("is the page's own title with one workspace", () => {
    expect(composeWindowTitle("Kaipu Record", null)).toBe("Kaipu Record");
    expect(composeWindowTitle("  ", null)).toBe("Kaipu Record");
  });
});
