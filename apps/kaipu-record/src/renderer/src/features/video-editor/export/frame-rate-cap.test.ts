import { describe, expect, it } from "vitest";
import { cappedSlideFps, createFrameRateCap } from "./frame-rate-cap";

/** Output frames per second after the cap, for `seconds` of a source at `fps`. */
function keptPerSecond(
  sourceFps: number,
  maxFps: number | null,
  seconds = 10,
  jitter: (i: number) => number = () => 0,
): number {
  const cap = createFrameRateCap(maxFps);
  let kept = 0;
  for (let i = 0; i < sourceFps * seconds; i++) {
    if (cap.keep(i / sourceFps + jitter(i))) kept++;
  }
  return kept / seconds;
}

describe("createFrameRateCap", () => {
  it("lands every common recording rate on 24 fps", () => {
    expect(keptPerSecond(48, 24)).toBeCloseTo(24, 0);
    expect(keptPerSecond(60, 24)).toBeCloseTo(24, 0);
    // The default recording quality is 30 fps: the old rule exported it at 15 fps.
    expect(keptPerSecond(30, 24)).toBeCloseTo(24, 0);
  });

  it("keeps every frame of a source at or below the cap, capture jitter included", () => {
    expect(keptPerSecond(24, 24)).toBe(24);
    // ±4 ms of jitter, alternating — frames a hair before their slot must survive.
    expect(keptPerSecond(24, 24, 10, (i) => (i % 2 ? -0.004 : 0.004))).toBe(24);
    expect(keptPerSecond(15, 24)).toBe(15);
  });

  it("never exceeds the cap in any one-second window", () => {
    const cap = createFrameRateCap(24);
    const kept: number[] = [];
    for (let i = 0; i < 600; i++) {
      const ts = i / 60 + (i % 3 === 0 ? 0.003 : 0);
      if (cap.keep(ts)) kept.push(ts);
    }
    for (let start = 0; start < 9; start += 0.25) {
      const inWindow = kept.filter((t) => t >= start && t < start + 1).length;
      expect(inWindow).toBeLessThanOrEqual(25); // a slot straddling each window edge
    }
  });

  it("keeps everything without a cap", () => {
    expect(keptPerSecond(60, null)).toBe(60);
  });

  it("drops a frame that rounds into a slot already taken (monotonic output)", () => {
    const cap = createFrameRateCap(24);
    expect(cap.keep(0)).toBe(true);
    expect(cap.keep(0.01)).toBe(false);
    expect(cap.keep(0.03)).toBe(true); // nearest slot is 1 (0.0417)
  });
});

describe("cappedSlideFps", () => {
  it("synthesizes slides at the cap when it is lower", () => {
    expect(cappedSlideFps(30, 24)).toBe(24);
    expect(cappedSlideFps(30, null)).toBe(30);
    expect(cappedSlideFps(30, 60)).toBe(30);
  });
});
