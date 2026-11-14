import { describe, expect, it } from "vitest";
import type { MutedRange } from "../audio-edits";
import type { LayoutEntry } from "../timeline";
import { waveformBars, type WaveformBarsInput } from "./waveform-bars";

const clip = (
  itemId: string,
  timelineStart: number,
  timelineEnd: number,
  sourceStart: number,
): LayoutEntry => ({
  itemId,
  kind: "clip",
  timelineStart,
  timelineEnd,
  sourceStart,
  sourceEnd: sourceStart + (timelineEnd - timelineStart),
});

/** 10 s of peaks: bucket i holds i / 1000, so a bar's peak says which buckets it read. */
function ramp(seconds = 10): Float32Array {
  return Float32Array.from({ length: seconds * 100 }, (_, i) => i / 1000);
}

function input(overrides: Partial<WaveformBarsInput> = {}): WaveformBarsInput {
  const peaks = ramp();
  return {
    peaks,
    filled: peaks.length,
    layout: [clip("a", 0, 10, 0)],
    scale: 100, // 1 s = 100 px, so a 5 px bar covers 0.05 s = 5 buckets
    scroll: 0,
    laneWidth: 50,
    pitch: 5,
    mutedRanges: [],
    audioMuted: false,
    ...overrides,
  };
}

describe("waveformBars", () => {
  it("draws one bar per pitch across the visible window, with the max peak of its buckets", () => {
    const bars = waveformBars(input());
    expect(bars).toHaveLength(10);
    expect(bars.map((b) => b.x)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45]);
    // Bar 0 reads buckets 0..4, bar 1 buckets 5..9.
    expect(bars[0]!.peak).toBeCloseTo(0.004);
    expect(bars[1]!.peak).toBeCloseTo(0.009);
    expect(bars.every((b) => !b.muted)).toBe(true);
  });

  it("anchors bars to content pixels: scrolling shifts x without changing the peaks", () => {
    const a = waveformBars(input({ scroll: 0, laneWidth: 100 }));
    const b = waveformBars(input({ scroll: 10, laneWidth: 100 }));
    // The bar at content x = 10 is a[2] and b[0] shifted by the scroll.
    expect(b[0]!.x).toBe(0);
    expect(b[0]!.peak).toBeCloseTo(a[2]!.peak);
    // A scroll that is not a multiple of the pitch keeps the grid and goes slightly negative.
    const c = waveformBars(input({ scroll: 12, laneWidth: 20 }));
    expect(c.map((bar) => bar.x)).toEqual([-2, 3, 8, 13, 18]);
    expect(c[0]!.peak).toBeCloseTo(a[2]!.peak);
  });

  it("follows cuts: a clip that starts later in the source reads later buckets", () => {
    // Timeline 0..2 s shows source 5..7 s.
    const bars = waveformBars(input({ layout: [clip("a", 0, 2, 5)], laneWidth: 200 }));
    expect(bars).toHaveLength(40);
    expect(bars[0]!.peak).toBeCloseTo(0.504);
  });

  it("draws no bar over a slide or past the end of the layout", () => {
    const slide: LayoutEntry = {
      itemId: "s",
      kind: "slide",
      timelineStart: 0,
      timelineEnd: 0.5,
      sourceStart: 0,
      sourceEnd: 0.5,
      assetId: "img",
    };
    const bars = waveformBars(input({ layout: [slide, clip("a", 0.5, 1, 2)], laneWidth: 200 }));
    // 0..0.5 s is the slide (x 0..50): no bars. 0.5..1 s is the clip (x 50..100).
    expect(bars[0]!.x).toBe(50);
    expect(bars).toHaveLength(10);
  });

  it("reads at least one bucket when zoomed in past the bucket size", () => {
    // 1000 px/s: a 5 px bar covers 5 ms, half a bucket.
    const bars = waveformBars(input({ scale: 1000, laneWidth: 5 }));
    expect(bars).toHaveLength(1);
    expect(bars[0]!.peak).toBeCloseTo(0);
    const second = waveformBars(input({ scale: 1000, scroll: 10, laneWidth: 5 }));
    expect(second[0]!.peak).toBeCloseTo(0.001);
  });

  it("skips bars whose buckets are not decoded yet", () => {
    const bars = waveformBars(input({ filled: 20, laneWidth: 200 }));
    // Buckets 0..19 are decoded: bars 0..3.
    expect(bars).toHaveLength(4);
  });

  it("takes the max across the clips a bar straddles", () => {
    // Two clips meet at timeline 0.025 s (x = 2.5): the first reads source 0, the second 8.
    const bars = waveformBars(
      input({
        layout: [clip("a", 0, 0.025, 0), clip("b", 0.025, 1, 8)],
        laneWidth: 5,
      }),
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]!.peak).toBeGreaterThan(0.8);
  });

  it("marks bars inside a muted range, by the source time at the bar's midpoint", () => {
    const mutedRanges: MutedRange[] = [{ id: "m", sourceStart: 0.1, sourceEnd: 0.2 }];
    const bars = waveformBars(input({ mutedRanges, laneWidth: 50 }));
    // Bar k spans source 0.05k..0.05(k+1), midpoint 0.05k + 0.025: bars 2 and 3.
    expect(bars.map((b) => b.muted)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("follows the cut when marking muted bars", () => {
    // Timeline 0..1 shows source 5..6; the muted range is at source 5.5..5.6.
    const bars = waveformBars(
      input({
        layout: [clip("a", 0, 1, 5)],
        mutedRanges: [{ id: "m", sourceStart: 5.5, sourceEnd: 5.6 }],
        laneWidth: 100,
      }),
    );
    expect(bars.filter((b) => b.muted).map((b) => b.x)).toEqual([50, 55]);
  });

  it("marks every bar muted when the whole recording is muted", () => {
    const bars = waveformBars(input({ audioMuted: true }));
    expect(bars).toHaveLength(10);
    expect(bars.every((b) => b.muted)).toBe(true);
  });

  it("returns nothing for an unmeasured lane, scale or empty layout", () => {
    expect(waveformBars(input({ laneWidth: 0 }))).toEqual([]);
    expect(waveformBars(input({ scale: 0 }))).toEqual([]);
    expect(waveformBars(input({ layout: [] }))).toEqual([]);
    expect(waveformBars(input({ filled: 0 }))).toEqual([]);
  });
});
