import { describe, expect, it } from "vitest";
import { closeOpenPause, toVideoTimeMs } from "./cursor-clock";

describe("toVideoTimeMs", () => {
  const anchor = { t0: 1000, pauses: [{ start: 3000, end: 5000 }] };

  it("is null before t0", () => {
    expect(toVideoTimeMs(999, anchor)).toBeNull();
  });
  it("is main − t0 before any pause", () => {
    expect(toVideoTimeMs(1000, anchor)).toBe(0);
    expect(toVideoTimeMs(2500, anchor)).toBe(1500);
  });
  it("is null inside a pause (start inclusive, end exclusive)", () => {
    expect(toVideoTimeMs(3000, anchor)).toBeNull();
    expect(toVideoTimeMs(4999, anchor)).toBeNull();
  });
  it("removes the paused duration after a pause", () => {
    expect(toVideoTimeMs(5000, anchor)).toBe(2000);
    expect(toVideoTimeMs(6000, anchor)).toBe(3000);
  });
  it("treats an open pause as extending forever, until closed", () => {
    const open = { t0: 0, pauses: [{ start: 100, end: null }] };
    expect(toVideoTimeMs(10_000, open)).toBeNull();
    const closed = closeOpenPause(open, 400);
    expect(closed.pauses[0].end).toBe(400);
    expect(toVideoTimeMs(500, closed)).toBe(200);
  });
  it("sums several pauses", () => {
    const a = {
      t0: 0,
      pauses: [
        { start: 100, end: 200 },
        { start: 300, end: 600 },
      ],
    };
    expect(toVideoTimeMs(700, a)).toBe(300);
  });
});
