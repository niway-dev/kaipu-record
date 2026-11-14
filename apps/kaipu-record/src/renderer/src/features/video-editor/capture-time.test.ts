import { describe, expect, it } from "vitest";
import { captureTitleTime, formatClock } from "./capture-time";

describe("formatClock", () => {
  it("prints minutes, seconds and tenths", () => {
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(9)).toBe("0:09.0");
    expect(formatClock(83.46)).toBe("1:23.4");
    expect(formatClock(3725.9)).toBe("62:05.9");
  });

  it("never goes negative", () => {
    expect(formatClock(-3)).toBe("0:00.0");
  });
});

describe("captureTitleTime", () => {
  it("is compact and has no character a file name refuses", () => {
    expect(captureTitleTime(0)).toBe("0s");
    expect(captureTitleTime(45.9)).toBe("45s");
    expect(captureTitleTime(83)).toBe("1m23s");
    expect(captureTitleTime(600)).toBe("10m00s");
    expect(captureTitleTime(3725)).toBe("1h02m05s");
  });
});
