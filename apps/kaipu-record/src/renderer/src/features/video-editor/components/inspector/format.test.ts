import { describe, expect, it } from "vitest";
import { formatPrecise } from "./format";

describe("formatPrecise", () => {
  it("formats minutes, seconds and one decimal", () => {
    expect(formatPrecise(10.24)).toBe("0:10.2");
    expect(formatPrecise(3.05)).toBe("0:03.0");
    expect(formatPrecise(75.5)).toBe("1:15.5");
    expect(formatPrecise(-1)).toBe("0:00.0");
  });
});
