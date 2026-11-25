import { describe, expect, it } from "vitest";
import { formatBytes, outputCheckpoints } from "./summary";

describe("formatBytes", () => {
  it("formats with binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(6.5 * 1024 ** 3)).toBe("6.5 GB");
  });
});

describe("outputCheckpoints", () => {
  it("returns evenly spaced samples where the file existed", () => {
    const samples = Array.from({ length: 11 }, (_, i) => ({ tMs: i * 1000, bytes: i * 10 }));
    const cps = outputCheckpoints(samples, 3);
    expect(cps).toEqual([
      { tMs: 0, bytes: 0 },
      { tMs: 5000, bytes: 50 },
      { tMs: 10000, bytes: 100 },
    ]);
  });
  it("returns [] when the file never existed", () => {
    expect(outputCheckpoints([{ tMs: 0, bytes: null }], 3)).toEqual([]);
  });
});
