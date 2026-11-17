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

/** An ArrayBuffer holding `head`, padded with zeros to 16 bytes. */
function file(head: readonly number[]): ArrayBuffer {
  const out = new Uint8Array(16);
  out.set(head);
  return out.buffer;
}
const PDF = file([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG = file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = file([0xff, 0xd8, 0xff, 0xe0]);
// RIFF, a 4-byte size, WEBP.
const WEBP = file([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("assertExportPayload", () => {
  it("accepts non-empty bytes of each allowed format under its own extension", () => {
    expect(() => assertExportPayload(PDF, "pdf")).not.toThrow();
    expect(() => assertExportPayload(PNG, "png")).not.toThrow();
    expect(() => assertExportPayload(JPEG, "jpg")).not.toThrow();
    expect(() => assertExportPayload(WEBP, "webp")).not.toThrow();
  });

  it("rejects a format outside the allowlist", () => {
    expect(() => assertExportPayload(PDF, "exe")).toThrow(/not allowed/);
    expect(() => assertExportPayload(PDF, "pdf/../x")).toThrow(/not allowed/);
    // The file extension, not the format name: "jpeg" is not what main writes.
    expect(() => assertExportPayload(JPEG, "jpeg")).toThrow(/not allowed/);
    expect(() => assertExportPayload(PNG, "avif")).toThrow(/not allowed/);
    expect(() => assertExportPayload(PNG, undefined)).toThrow(/not allowed/);
  });

  it("rejects bytes that are not the format their extension names", () => {
    // What an encoder that fell back to PNG would send as a ".webp".
    expect(() => assertExportPayload(PNG, "webp")).toThrow(/not a webp file/);
    expect(() => assertExportPayload(PNG, "jpg")).toThrow(/not a jpg file/);
    expect(() => assertExportPayload(JPEG, "png")).toThrow(/not a png file/);
    expect(() => assertExportPayload(new ArrayBuffer(16), "pdf")).toThrow(/not a pdf file/);
    // RIFF without the WEBP tag is a WAV or an AVI, not an image.
    expect(() => assertExportPayload(file([0x52, 0x49, 0x46, 0x46]), "webp")).toThrow(
      /not a webp file/,
    );
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

describe("exportFileName per format", () => {
  it("puts the extension of the format after the title", () => {
    expect(exportFileName("Login flow", "jpg")).toBe("Login flow.jpg");
    expect(exportFileName("Login flow", "webp")).toBe("Login flow.webp");
  });
});
