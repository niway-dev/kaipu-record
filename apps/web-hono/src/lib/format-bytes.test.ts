import { describe, expect, it } from "vitest";
import { formatBytesForLocale } from "./format-bytes";

describe("formatBytesForLocale", () => {
  it("prints the same decimal-unit strings as desktop in English", () => {
    expect(formatBytesForLocale(1_000_000_000, "en")).toBe("1 GB");
    expect(formatBytesForLocale(610_000_000, "en")).toBe("610 MB");
    expect(formatBytesForLocale(1_300_000_000, "en")).toBe("1.3 GB");
    expect(formatBytesForLocale(0, "en")).toBe("0 B");
  });

  it("uses the locale's decimal separator", () => {
    expect(formatBytesForLocale(1_300_000_000, "es")).toBe("1,3 GB");
    expect(formatBytesForLocale(1_500_000, "es")).toBe("1,5 MB");
  });
});
