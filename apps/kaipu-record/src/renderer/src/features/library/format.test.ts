import { describe, expect, it } from "vitest";
import { formatDuration, formatSize, relativeDate } from "./format";

describe("formatDuration", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(95)).toBe("1:35");
  });

  it("includes hours past 60 minutes", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("floors fractional seconds and clamps negatives to zero", () => {
    expect(formatDuration(9.9)).toBe("0:09");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("formatSize", () => {
  it("picks the unit by magnitude", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });

  it("drops decimals once the value reaches 10", () => {
    expect(formatSize(25 * 1024 * 1024)).toBe("25 MB");
  });
});

describe("relativeDate", () => {
  const MINUTE = 60_000;

  it("labels recent timestamps relative to now", () => {
    expect(relativeDate(Date.now())).toBe("just now");
    expect(relativeDate(Date.now() - 5 * MINUTE)).toBe("5m ago");
    expect(relativeDate(Date.now() - 3 * 60 * MINUTE)).toBe("3h ago");
    expect(relativeDate(Date.now() - 2 * 24 * 60 * MINUTE)).toBe("2d ago");
  });
});
