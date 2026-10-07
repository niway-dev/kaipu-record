import { describe, expect, it } from "vitest";
import { exportFileName } from "./export-file-name";

describe("exportFileName", () => {
  it("appends the extension to a plain title", () => {
    expect(exportFileName("Login flow", "pdf")).toBe("Login flow.pdf");
  });

  it("replaces path separators and characters Finder/Windows reject", () => {
    expect(exportFileName("Screenshot — 10/7/2026, 3:04:05 PM", "pdf")).toBe(
      "Screenshot — 10-7-2026, 3-04-05 PM.pdf",
    );
    expect(exportFileName('a*b?c"d<e>f|g\\h', "pdf")).toBe("a-b-c-d-e-f-g-h.pdf");
  });

  it("falls back to a default name when nothing usable is left", () => {
    expect(exportFileName("   ", "pdf")).toBe("screenshot.pdf");
    expect(exportFileName("...", "pdf")).toBe("screenshot.pdf");
  });
});
