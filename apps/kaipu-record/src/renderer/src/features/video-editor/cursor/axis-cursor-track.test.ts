import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { axisCursorTrack } from "./axis-cursor-track";

const DISPLAY_A = { id: "1", width: 1920, height: 1080, scaleFactor: 2 };
const DISPLAY_B = { id: "2", width: 1280, height: 720, scaleFactor: 1 };

const trackA: CursorTrack = {
  version: 1,
  display: DISPLAY_A,
  anchor: "exact",
  clicksAvailable: true,
  t: [0, 500, 1000],
  x: [0.1, 0.2, 0.3],
  y: [0.4, 0.5, 0.6],
  clicks: [{ t: 500, x: 0.2, y: 0.5, button: 0 }],
};
const trackB: CursorTrack = {
  version: 1,
  display: DISPLAY_B,
  anchor: "estimated",
  clicksAvailable: false,
  t: [0, 250],
  x: [0.7, 0.8],
  y: [0.1, 0.2],
  clicks: [{ t: 250, x: 0.8, y: 0.2, button: 2 }],
};

describe("axisCursorTrack", () => {
  it("is null when every track is null", () => {
    expect(axisCursorTrack(null, [])).toBeNull();
    expect(axisCursorTrack(null, [{ offset: 3600, track: null }])).toBeNull();
  });

  it("is the primary itself when no joined track has data", () => {
    expect(axisCursorTrack(trackA, [])).toBe(trackA);
    expect(axisCursorTrack(trackA, [{ offset: 3600, track: null }])).toBe(trackA);
  });

  it("shifts a joined track's samples and clicks by its offset, after the primary's", () => {
    const merged = axisCursorTrack(trackA, [{ offset: 3600, track: trackB }])!;
    expect(merged.t).toEqual([0, 500, 1000, 3_600_000, 3_600_250]);
    expect(merged.x).toEqual([0.1, 0.2, 0.3, 0.7, 0.8]);
    expect(merged.y).toEqual([0.4, 0.5, 0.6, 0.1, 0.2]);
    expect(merged.clicks).toEqual([
      { t: 500, x: 0.2, y: 0.5, button: 0 },
      { t: 3_600_250, x: 0.8, y: 0.2, button: 2 },
    ]);
  });

  it("takes display and anchor from the primary, and does not change its inputs", () => {
    const merged = axisCursorTrack(trackA, [{ offset: 3600, track: trackB }])!;
    expect(merged.display).toEqual(DISPLAY_A);
    expect(merged.anchor).toBe("exact");
    expect(trackA.t).toEqual([0, 500, 1000]);
    expect(trackB.clicks[0].t).toBe(250);
  });

  it("orders several joined tracks by offset, whatever order they are given in", () => {
    const merged = axisCursorTrack(trackA, [
      { offset: 7200, track: trackB },
      { offset: 3600, track: trackB },
    ])!;
    expect(merged.t).toEqual([0, 500, 1000, 3_600_000, 3_600_250, 7_200_000, 7_200_250]);
  });

  it("without a primary uses the first joined track for display and anchor", () => {
    const merged = axisCursorTrack(null, [
      { offset: 7200, track: trackA },
      { offset: 3600, track: trackB },
    ])!;
    expect(merged.display).toEqual(DISPLAY_B);
    expect(merged.anchor).toBe("estimated");
    expect(merged.t[0]).toBe(3_600_000);
    expect(merged.clicks.map((c) => c.t)).toEqual([3_600_250, 7_200_500]);
  });

  it("clicksAvailable is true when any track has click data", () => {
    const noClicks = { ...trackA, clicksAvailable: false, clicks: [] };
    expect(axisCursorTrack(noClicks, [{ offset: 3600, track: trackB }])!.clicksAvailable).toBe(
      false,
    );
    expect(axisCursorTrack(noClicks, [{ offset: 3600, track: trackA }])!.clicksAvailable).toBe(
      true,
    );
    expect(axisCursorTrack(trackA, [{ offset: 3600, track: trackB }])!.clicksAvailable).toBe(true);
  });
});
