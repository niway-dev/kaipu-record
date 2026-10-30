import { describe, expect, it } from "vitest";
import {
  areaToGlobal,
  bubbleBoundsInArea,
  bubblePlacementInRect,
  bubbleSizeOf,
  fullDisplayBorderAllowed,
  sanitizeArea,
  withRecordedBubble,
} from "./area-geometry";

describe("fullDisplayBorderAllowed", () => {
  it("skips the whole-display border only on Windows builds without capture exclusion", () => {
    expect(fullDisplayBorderAllowed("darwin", "24.0.0")).toBe(true);
    expect(fullDisplayBorderAllowed("linux", "6.8.0")).toBe(true);
    expect(fullDisplayBorderAllowed("win32", "10.0.19041")).toBe(true);
    expect(fullDisplayBorderAllowed("win32", "10.0.22631")).toBe(true);
    expect(fullDisplayBorderAllowed("win32", "10.0.18363")).toBe(false);
    expect(fullDisplayBorderAllowed("win32", "6.3.9600")).toBe(false);
    // An unreadable release never hides the border.
    expect(fullDisplayBorderAllowed("win32", "")).toBe(true);
  });
});

describe("areaToGlobal", () => {
  it("moves a display-relative area to global DIP", () => {
    expect(
      areaToGlobal(
        {
          displayId: 2,
          rect: { x: 100, y: 50, width: 640, height: 360 },
          displaySize: { width: 2560, height: 1440 },
        },
        { x: 1512, y: -200, width: 2560, height: 1440 },
      ),
    ).toEqual({ x: 1612, y: -150, width: 640, height: 360 });
  });
});

describe("bubbleBoundsInArea", () => {
  // Window = bubble + 2 × 24 px pad, 32 px from the area's left and bottom edges.
  it("anchors the default (M, 240 px) bubble at the area's bottom-left corner", () => {
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 640, height: 360 })).toEqual({
      x: 32,
      y: 40,
      width: 288,
      height: 288,
    });
  });

  it("follows the area on a second display", () => {
    expect(bubbleBoundsInArea({ x: 1612, y: 50, width: 1280, height: 720 }, 160)).toEqual({
      x: 1644,
      y: 530,
      width: 208,
      height: 208,
    });
  });

  it("grows up and to the right from the same corner", () => {
    const area = { x: 0, y: 0, width: 1440, height: 900 };
    const small = bubbleBoundsInArea(area, 160)!;
    const large = bubbleBoundsInArea(area, 360)!;
    expect(large.x).toBe(small.x);
    expect(large.y + large.height).toBe(small.y + small.height);
    expect(bubbleSizeOf(large)).toBe(360);
  });

  it("clamps the size to the allowed range", () => {
    const area = { x: 0, y: 0, width: 1440, height: 900 };
    expect(bubbleSizeOf(bubbleBoundsInArea(area, 40)!)).toBe(120);
    expect(bubbleSizeOf(bubbleBoundsInArea(area, 900)!)).toBe(480);
  });

  it("shrinks a bubble the area cannot hold to what fits", () => {
    // 300 − 2 × 32 − 2 × 24 = 188 px of room.
    expect(bubbleSizeOf(bubbleBoundsInArea({ x: 0, y: 0, width: 300, height: 300 }, 360)!)).toBe(
      188,
    );
  });

  it("answers null when not even the smallest bubble fits", () => {
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 231, height: 600 })).toBeNull();
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 1280, height: 231 })).toBeNull();
    expect(bubbleBoundsInArea({ x: 0, y: 0, width: 232, height: 232 })).not.toBeNull();
  });
});

describe("sanitizeArea — an area that crossed a process boundary", () => {
  const display = { id: 2, bounds: { x: 1512, y: 0, width: 1512, height: 982 } };
  const area = (rect: unknown, displayId: unknown = 2) => ({
    displayId,
    rect,
    displaySize: { width: 9999, height: 9999 },
  });

  it("keeps a valid area, rounded, with the display's own size", () => {
    expect(sanitizeArea(area({ x: 100.4, y: 50, width: 640, height: 360.6 }), display)).toEqual({
      displayId: 2,
      rect: { x: 100, y: 50, width: 640, height: 361 },
      displaySize: { width: 1512, height: 982 },
    });
  });

  it("keeps the ratio the area was locked to, and drops one that names no chip", () => {
    const rect = { x: 0, y: 0, width: 640, height: 360 };
    expect(sanitizeArea({ ...area(rect), ratio: "16:9" }, display)?.ratio).toBe("16:9");
    expect(sanitizeArea({ ...area(rect), ratio: "4:3" }, display)).not.toHaveProperty("ratio");
  });

  it("clamps an area that hangs off the display to the part on it", () => {
    expect(
      sanitizeArea(area({ x: -500, y: 900, width: 5000, height: 400 }), display)?.rect,
    ).toEqual({ x: 0, y: 900, width: 1512, height: 82 });
  });

  it("refuses what is malformed, on another display, or under the minimum once clamped", () => {
    expect(sanitizeArea(null, display)).toBeNull();
    expect(sanitizeArea("area", display)).toBeNull();
    expect(sanitizeArea(area({ x: 0, y: 0, width: 640, height: 360 }, 3), display)).toBeNull();
    expect(sanitizeArea(area({ x: 0, y: 0, width: 0, height: 360 }), display)).toBeNull();
    expect(
      sanitizeArea(area({ x: Number.NaN, y: 0, width: 640, height: 360 }), display),
    ).toBeNull();
    expect(sanitizeArea(area({ x: 1500, y: 0, width: 640, height: 360 }), display)).toBeNull();
  });
});

describe("bubblePlacementInRect", () => {
  const recorded = { x: 1512, y: 0, width: 1000, height: 500 };

  it("normalizes the bubble's centre and side to the recorded rectangle", () => {
    // Bottom-left corner of the area: window 288 wide (240 bubble), 32 from the left and bottom.
    const window = { x: 1512 + 32, y: 500 - 32 - 288, width: 288, height: 288 };
    expect(bubblePlacementInRect(window, recorded)).toEqual({
      position: { x: 0.176, y: 0.648 },
      sizeFraction: 0.48,
    });
  });

  it("is null when the bubble's centre is outside the recorded rectangle (another display)", () => {
    expect(bubblePlacementInRect({ x: 0, y: 0, width: 288, height: 288 }, recorded)).toBeNull();
  });

  it("is null for an empty recorded rectangle", () => {
    expect(
      bubblePlacementInRect(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 0, y: 0, width: 0, height: 0 },
      ),
    ).toBeNull();
  });
});

describe("withRecordedBubble", () => {
  const webcam = {
    startOffsetMs: 0,
    offsetQuality: "exact",
    width: 1280,
    height: 720,
    fps: 30,
    recordedLayout: {
      shape: "circle",
      size: 240,
      mirrored: true,
      framing: { enabled: false, zoom: 1, x: 0, y: 0 },
      position: { x: 0.9, y: 0.9 },
    },
  } as const;
  const meta = { title: "T", durationSeconds: 1, durationMs: 1000, webcam };
  const placement = { position: { x: 0.2, y: 0.8 }, sizeFraction: 0.3 };

  it("replaces the renderer's position with main's", () => {
    expect(withRecordedBubble(meta, placement).webcam?.recordedLayout).toMatchObject(placement);
  });

  it("removes the renderer's position when main has none", () => {
    expect(withRecordedBubble(meta, null).webcam?.recordedLayout).not.toHaveProperty("position");
  });

  it("returns the meta untouched without a webcam or a recorded layout", () => {
    const bare = { title: "T", durationSeconds: 1, durationMs: 1000 };
    expect(withRecordedBubble(bare, placement)).toBe(bare);
    const noLayout = { ...bare, webcam: { ...webcam, recordedLayout: undefined } };
    expect(withRecordedBubble(noLayout, placement)).toBe(noLayout);
  });
});
