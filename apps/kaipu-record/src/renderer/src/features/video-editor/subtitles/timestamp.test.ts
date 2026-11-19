import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./timestamp";

describe("formatTimestamp", () => {
  it("pads hours, minutes, seconds and milliseconds", () => {
    expect(formatTimestamp(3723.456, ",")).toBe("01:02:03,456");
    expect(formatTimestamp(0, ".")).toBe("00:00:00.000");
    expect(formatTimestamp(5.007, ".")).toBe("00:00:05.007");
  });

  it("rounds milliseconds and carries into the seconds", () => {
    expect(formatTimestamp(0.9995, ",")).toBe("00:00:01,000");
    expect(formatTimestamp(59.9996, ",")).toBe("00:01:00,000");
    expect(formatTimestamp(0.9994, ",")).toBe("00:00:00,999");
  });

  it("lets the hours grow past two digits", () => {
    expect(formatTimestamp(100 * 3600 + 1.5, ",")).toBe("100:00:01,500");
  });

  it("clamps a negative or non-finite time to zero", () => {
    expect(formatTimestamp(-1, ",")).toBe("00:00:00,000");
    expect(formatTimestamp(Number.NaN, ",")).toBe("00:00:00,000");
  });
});
