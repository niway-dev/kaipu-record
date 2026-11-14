import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { axisCursorTrack, axisOverlayTrack, frameCursorTrack } from "./axis-cursor-track";
import { DEFAULT_CURSOR, overlayLayerData, prepareCursor } from "./cursor-model";

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

// Illustrative scenes: the opened recording runs [0, 10] s on the axis, a joined one [20, 30] s.
const IDENTITY = { cx: 0.5, cy: 0.5, scale: 1 };
const PLAIN = { ...DEFAULT_CURSOR, smoothing: 0, idleHide: false };
function trackAt(x: number): CursorTrack {
  return {
    version: 1,
    display: DISPLAY_A,
    anchor: "exact",
    clicksAvailable: true,
    t: [0, 5000, 10_000],
    x: [x, x, x],
    y: [0.5, 0.5, 0.5],
    clicks: [{ t: 5000, x, y: 0.5, button: 0 }],
  };
}
/** Where the cursor layer would draw at axis second `s` (null: nothing is drawn). */
function drawnAt(track: CursorTrack | null, s: number): number | null {
  const data = overlayLayerData(track, PLAIN);
  if (!data) return null;
  const frame = prepareCursor(data.track, data.settings)(s, IDENTITY, 1000, 1000);
  return frame ? frame.x / 1000 : null;
}
const opened = (track: CursorTrack | null, canOverlay: boolean) => ({
  offset: 0,
  duration: 10,
  track,
  canOverlay,
});
const joinedAt = (track: CursorTrack | null, canOverlay: boolean) => ({
  offset: 20,
  duration: 10,
  track,
  canOverlay,
});

describe("axisOverlayTrack: provenance is per recording", () => {
  it("opened embeds the pointer, joined excludes it and has a track: drawn only in the joined range", () => {
    const overlay = axisOverlayTrack(opened(trackAt(0.2), false), [joinedAt(trackAt(0.7), true)]);
    expect(drawnAt(overlay, 5)).toBeNull();
    expect(drawnAt(overlay, 25)).toBeCloseTo(0.7);
    expect(drawnAt(overlay, 15)).toBeNull();
    expect(drawnAt(overlay, 35)).toBeNull();
  });

  it("reversed: opened excludes it, joined embeds it: drawn only in the opened range", () => {
    const overlay = axisOverlayTrack(opened(trackAt(0.2), true), [joinedAt(trackAt(0.7), false)]);
    expect(drawnAt(overlay, 5)).toBeCloseTo(0.2);
    expect(drawnAt(overlay, 25)).toBeNull();
  });

  it("neither recording can be overlaid: no overlay track at all", () => {
    expect(
      axisOverlayTrack(opened(trackAt(0.2), false), [joinedAt(trackAt(0.7), false)]),
    ).toBeNull();
  });

  it("keeps the range's last frame and clicks, and shifts the joined clicks by its offset", () => {
    const overlay = axisOverlayTrack(opened(trackAt(0.2), true), [joinedAt(trackAt(0.7), true)])!;
    expect(drawnAt(overlay, 10)).toBeCloseTo(0.2);
    expect(drawnAt(overlay, 30)).toBeCloseTo(0.7);
    expect(overlay.clicks.map((c) => c.t)).toEqual([5000, 25_000]);
    expect(overlay.t).toEqual([...overlay.t].sort((a, b) => a - b));
  });
});

describe("axisOverlayTrack: no pointer in a recording without a track", () => {
  it("the primary has a track, the joined one has none, idle hiding off: nothing in the joined range", () => {
    const overlay = axisOverlayTrack(opened(trackAt(0.2), true), [joinedAt(null, true)]);
    expect(drawnAt(overlay, 5)).toBeCloseTo(0.2);
    expect(drawnAt(overlay, 25)).toBeNull();
    expect(drawnAt(overlay, 15)).toBeNull();
  });

  it("a track that starts after its range starts holds its first position, not an older one", () => {
    const late = { ...trackAt(0.9), t: [2000, 5000, 10_000] };
    const overlay = axisOverlayTrack(opened(trackAt(0.2), true), [joinedAt(late, true)]);
    expect(drawnAt(overlay, 20.5)).toBeCloseTo(0.9);
    expect(drawnAt(overlay, 19.9)).toBeNull();
  });

  it("without joined recordings it returns the primary itself, or null when it cannot be overlaid", () => {
    const primary = trackAt(0.2);
    expect(axisOverlayTrack(opened(primary, true), [])).toBe(primary);
    expect(axisOverlayTrack(opened(primary, false), [])).toBeNull();
    expect(axisOverlayTrack(opened(null, true), [])).toBeNull();
    expect(overlayLayerData(axisOverlayTrack(opened(primary, true), []), DEFAULT_CURSOR)).toEqual({
      track: primary,
      settings: DEFAULT_CURSOR,
    });
    expect(axisCursorTrack(primary, [])).toBe(primary);
  });
});

describe("frameCursorTrack: joined coordinates are frame-relative", () => {
  const FRAME = 16 / 9;
  const square = {
    ...trackAt(0.1),
    display: { id: "s", width: 1000, height: 1000, scaleFactor: 1 },
  };

  it("puts x=0.1 of a 1:1 recording inside a 16:9 frame at x=0.275, y unchanged", () => {
    const mapped = frameCursorTrack(square, FRAME, 1);
    expect(mapped.x[0]).toBeCloseTo(0.21875 + 0.1 * 0.5625);
    expect(mapped.x[0]).toBeCloseTo(0.275, 3);
    expect(mapped.y).toEqual(square.y);
    expect(mapped.clicks[0].x).toBeCloseTo(0.275, 3);
    expect(square.x[0]).toBe(0.1);
  });

  it("the overlay track and the zoom-recording track both carry the frame coordinates", () => {
    const mapped = frameCursorTrack(square, FRAME, 1);
    const overlay = axisOverlayTrack(opened(trackAt(0.2), true), [joinedAt(mapped, true)]);
    expect(drawnAt(overlay, 25)).toBeCloseTo(0.275, 3);
    const camera = axisCursorTrack(trackAt(0.2), [{ offset: 20, track: mapped }])!;
    expect(camera.x[camera.x.length - 1]).toBeCloseTo(0.275, 3);
  });

  it("a wider recording is letterboxed above and below: y moves, x does not", () => {
    const wide = { ...trackAt(0.3), y: [0.1, 0.1, 0.1] };
    const mapped = frameCursorTrack(wide, 4 / 3, 16 / 9);
    expect(mapped.x).toEqual(wide.x);
    expect(mapped.y[0]).toBeCloseTo(0.125 + 0.1 * 0.75);
  });

  it("the same aspect, or an unknown one, is the identity: the track itself", () => {
    const t = trackAt(0.1);
    expect(frameCursorTrack(t, FRAME, FRAME)).toBe(t);
    expect(frameCursorTrack(t, 0, 1)).toBe(t);
    expect(frameCursorTrack(t, FRAME, 0)).toBe(t);
    expect(frameCursorTrack(null, FRAME, 1)).toBeNull();
  });

  it("a point off the display stays off it, instead of landing on a bar as a pointer", () => {
    const off = { ...trackAt(1.05), t: [0, 5000, 10_000] };
    const mapped = frameCursorTrack(off, FRAME, 1);
    expect(mapped.x.every((x) => x < 0 || x > 1)).toBe(true);
    expect(mapped.clicks[0].x < 0 || mapped.clicks[0].x > 1).toBe(true);
  });

  it("keeps the diagonal and gives frame units the frame's aspect, so detection distances hold", () => {
    const mapped = frameCursorTrack(square, FRAME, 1);
    expect(Math.hypot(mapped.display.width, mapped.display.height)).toBeCloseTo(
      Math.hypot(square.display.width, square.display.height),
    );
    expect(mapped.display.width / mapped.display.height).toBeCloseTo(FRAME);
  });
});
