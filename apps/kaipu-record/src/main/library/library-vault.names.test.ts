import { describe, expect, it } from "vitest";
import { defaultCaptureName } from "@shared/default-capture-name";
import { alignedBase, captureDate, isAligned } from "./library-vault";

const date = new Date(2026, 9, 29, 19, 57, 30);

describe("isAligned (N2)", () => {
  it("accepts the base, ' (n)' with 2 ≤ n ≤ 99 and a 4-hex random tail", () => {
    for (const stem of ["Demo", "Demo (2)", "Demo (99)", "Demo (a3f0)"]) {
      expect(isAligned(stem, "Demo", "recording", date)).toBe(true);
    }
  });

  it("rejects other tails, case-only differences and unrelated names", () => {
    for (const stem of ["Demo (1)", "Demo (100)", "Demo (zzzz)", "Demo (A3F0)", "demo", "Demo 2"]) {
      expect(isAligned(stem, "Demo", "recording", date)).toBe(false);
    }
  });

  it("compares after NFC, so an NFD name from HFS+ or SMB is aligned (N7)", () => {
    const nfd = "Café";
    expect(isAligned(nfd, "Café", "recording", date)).toBe(true);
  });

  it("uses the sanitized stem of the title (N9): forbidden characters, reserved tails", () => {
    expect(isAligned("Sprint demo part 1 2", "Sprint demo: part 1/2?", "recording", date)).toBe(
      true,
    );
    expect(isAligned("Demo edit", "Demo.edit", "recording", date)).toBe(true);
    expect(isAligned("Kaipu tags", "tags", "screenshot", date)).toBe(true);
  });

  it("falls back to the default name when the title sanitizes to nothing (N3)", () => {
    const base = defaultCaptureName("screenshot", date);
    expect(alignedBase("???", "screenshot", date)).toBe(base);
    expect(isAligned(`${base} (2)`, "???", "screenshot", date)).toBe(true);
  });
});

describe("captureDate (N4)", () => {
  const stats = { birthtimeMs: 1_000, mtimeMs: 2_000 };

  it("prefers createdAt", () => {
    expect(captureDate({ createdAt: 5_000 }, "recording-2026-10-30-00-57-30", stats)).toBe(5_000);
  });

  it("then the date in a legacy stem, read as UTC", () => {
    expect(captureDate({}, "recording-2026-10-30-00-57-30", stats)).toBe(
      Date.UTC(2026, 9, 30, 0, 57, 30),
    );
    expect(captureDate({}, "screenshot-2026-10-15T21-37-10-853Z", stats)).toBe(
      Date.UTC(2026, 9, 15, 21, 37, 10),
    );
  });

  it("then birthtime, then mtime when the filesystem reports no birthtime", () => {
    expect(captureDate({}, "Demo", stats)).toBe(1_000);
    expect(captureDate({}, "Demo", { birthtimeMs: 0, mtimeMs: 2_000 })).toBe(2_000);
  });
});
