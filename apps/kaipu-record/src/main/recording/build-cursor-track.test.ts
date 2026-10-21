import { describe, expect, it } from "vitest";
import { buildCursorTrack } from "./build-cursor-track";

const DISPLAY = { id: "1", width: 1600, height: 1000, scaleFactor: 2 };

describe("buildCursorTrack", () => {
  it("rebases samples and clicks to video time and drops paused ones", () => {
    const result = buildCursorTrack({
      raw: {
        t: [900, 1000, 1500, 3500, 5200],
        x: [0.1, 0.2, 0.3, 0.4, 0.5],
        y: [0, 0, 0, 0, 0],
        clicks: [
          { t: 1200, x: 0.2, y: 0.2, button: 0 },
          { t: 4000, x: 0.3, y: 0.3, button: 0 },
        ],
      },
      anchor: { t0: 1000, pauses: [{ start: 3000, end: 5000 }] },
      anchorQuality: "exact",
      clicksAvailable: true,
      display: DISPLAY,
    });
    expect(result.t).toEqual([0, 500, 2200]);
    expect(result.x).toEqual([0.2, 0.3, 0.5]);
    expect(result.clicks).toEqual([{ t: 200, x: 0.2, y: 0.2, button: 0 }]);
    expect(result).not.toHaveProperty("truncatedAtMs");
  });

  it("cuts the tail sampled after the last frame (maxMs)", () => {
    const result = buildCursorTrack({
      raw: {
        t: [1000, 2000, 3500],
        x: [0.1, 0.2, 0.9],
        y: [0, 0, 0],
        clicks: [
          { t: 2500, x: 0.2, y: 0.2, button: 0 },
          { t: 3400, x: 0.9, y: 0.9, button: 0 },
        ],
      },
      anchor: { t0: 1000, pauses: [] },
      anchorQuality: "exact",
      clicksAvailable: true,
      display: DISPLAY,
      // The recording is 2 s long; everything after it was sampled while "Saving…".
      maxMs: 2000,
    });
    expect(result.t).toEqual([0, 1000]);
    expect(result.clicks).toEqual([{ t: 1500, x: 0.2, y: 0.2, button: 0 }]);
  });

  it("rebases the truncation point to video time", () => {
    const result = buildCursorTrack({
      raw: { t: [1000], x: [0.1], y: [0], clicks: [] },
      anchor: { t0: 1000, pauses: [] },
      anchorQuality: "exact",
      clicksAvailable: false,
      display: DISPLAY,
      maxMs: 10_000,
      truncatedAtMainMs: 4000,
    });
    expect(result.truncatedAtMs).toBe(3000);
  });
});
