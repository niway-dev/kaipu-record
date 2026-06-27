import { describe, expect, it } from "vitest";
import { elapsedMs, formatElapsed, pauseElapsed, resumeElapsed, startElapsed } from "./elapsed";

describe("elapsed", () => {
  it("counts wall-clock time from the start", () => {
    const s = startElapsed(1000);
    expect(elapsedMs(s, 1000)).toBe(0);
    expect(elapsedMs(s, 4500)).toBe(3500);
  });

  it("freezes while paused and resumes without counting the pause", () => {
    let s = startElapsed(0);
    s = pauseElapsed(s, 2000); // paused at 2s
    expect(elapsedMs(s, 5000)).toBe(2000); // still 2s during the pause
    s = resumeElapsed(s, 5000); // 3s pause discounted
    expect(elapsedMs(s, 6000)).toBe(3000); // 6s wall - 3s paused
  });

  it("accumulates multiple pauses", () => {
    let s = startElapsed(0);
    s = resumeElapsed(pauseElapsed(s, 1000), 2000); // -1s
    s = resumeElapsed(pauseElapsed(s, 3000), 5000); // -2s
    expect(elapsedMs(s, 10000)).toBe(7000); // 10 - 3 paused
  });

  it("is a no-op to pause twice or resume when not paused", () => {
    let s = startElapsed(0);
    s = pauseElapsed(pauseElapsed(s, 1000), 2000);
    s = resumeElapsed(s, 4000); // discount only the first pause start (1000)
    expect(elapsedMs(s, 5000)).toBe(2000); // 5 - 3 paused
    expect(resumeElapsed(s, 9000)).toBe(s); // resume when running = same ref
  });

  it("formats as hh:mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(257_000)).toBe("00:04:17");
    expect(formatElapsed(3_661_000)).toBe("01:01:01");
  });
});
