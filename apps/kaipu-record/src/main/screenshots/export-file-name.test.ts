import { describe, expect, it } from "vitest";
import { assertExportPayload, exportFileName, MAX_EXPORT_BYTES } from "./export-file-name";

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

describe("assertExportPayload", () => {
  it("accepts non-empty bytes in an allowed format", () => {
    expect(() => assertExportPayload(new ArrayBuffer(8), "pdf")).not.toThrow();
  });

  it("rejects a format outside the allowlist", () => {
    expect(() => assertExportPayload(new ArrayBuffer(8), "exe")).toThrow(/not allowed/);
    expect(() => assertExportPayload(new ArrayBuffer(8), "pdf/../x")).toThrow(/not allowed/);
  });

  it("rejects anything that is not an ArrayBuffer", () => {
    expect(() => assertExportPayload("bytes", "pdf")).toThrow(/ArrayBuffer/);
    expect(() => assertExportPayload(new Uint8Array(8), "pdf")).toThrow(/ArrayBuffer/);
  });

  it("rejects empty and oversized payloads", () => {
    expect(() => assertExportPayload(new ArrayBuffer(0), "pdf")).toThrow(/empty/);
    expect(() => assertExportPayload(new ArrayBuffer(MAX_EXPORT_BYTES + 1), "pdf")).toThrow(
      /exceeds/,
    );
  });
});
