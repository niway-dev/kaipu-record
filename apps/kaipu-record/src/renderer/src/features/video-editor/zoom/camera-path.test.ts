import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { buildCameraPath, cameraAt, clampAnchor, cropRect, springStep } from "./camera-path";
import type { ZoomSegment } from "./zoom-model";

const DISPLAY = { id: "1", width: 1600, height: 1000, scaleFactor: 2 };

function track(partial: Partial<CursorTrack> = {}): CursorTrack {
  return {
    version: 1,
    display: DISPLAY,
    anchor: "exact",
    clicksAvailable: true,
    t: [],
    x: [],
    y: [],
    clicks: [],
    ...partial,
  };
}

function seg(partial: Partial<ZoomSegment>): ZoomSegment {
  return {
    id: "s",
    start: 0,
    end: 1,
    scale: 2,
    mode: "follow",
    anchor: null,
    smoothing: 70,
    origin: "auto",
    trigger: "click",
    ...partial,
  };
}

describe("springStep", () => {
  it("converges to the goal without overshoot from rest", () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 600; i++) {
      [x, v] = springStep(x, v, 1, 8, 1 / 60);
      expect(x).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(x).toBeCloseTo(1, 6);
  });
});

describe("buildCameraPath", () => {
  it("is identity with no segments", () => {
    const path = buildCameraPath([], null, 2);
    expect(path.scale.length).toBe(121);
    expect(cameraAt(path, 1)).toEqual({ cx: 0.5, cy: 0.5, scale: 1 });
  });
  it("zooms in during a fixed segment, reaches the anchor, and zooms back out", () => {
    const path = buildCameraPath(
      [seg({ start: 1, end: 5, mode: "fixed", anchor: { x: 0.7, y: 0.6 }, smoothing: 0 })],
      null,
      8,
    );
    const mid = cameraAt(path, 4);
    expect(mid.scale).toBeCloseTo(2, 2);
    expect(mid.cx).toBeCloseTo(0.7, 2);
    expect(mid.cy).toBeCloseTo(0.6, 2);
    expect(cameraAt(path, 7.9).scale).toBeCloseTo(1, 2);
  });
  it("starts moving before the segment (lookahead)", () => {
    const path = buildCameraPath(
      [seg({ start: 2, end: 4, mode: "fixed", anchor: { x: 0.7, y: 0.5 } })],
      null,
      5,
    );
    expect(cameraAt(path, 1.7).scale).toBe(1);
    expect(cameraAt(path, 1.95).scale).toBeGreaterThan(1);
  });
  it("stays zoomed until the segment's end (the lookahead never closes early)", () => {
    const path = buildCameraPath(
      [seg({ start: 1, end: 5, mode: "fixed", anchor: { x: 0.7, y: 0.5 }, smoothing: 0 })],
      null,
      8,
    );
    // The camera must still be on the segment 100 ms before its end, or the timeline
    // block, the camera box and the export fast path all disagree with the picture.
    expect(cameraAt(path, 4.9).scale).toBeCloseTo(2, 2);
    expect(cameraAt(path, 5.3).scale).toBeLessThan(1.9);
  });
  it("never lets the window leave the frame", () => {
    const path = buildCameraPath(
      [seg({ start: 0, end: 5, mode: "fixed", anchor: { x: 1, y: 0 }, scale: 4, smoothing: 0 })],
      null,
      5,
    );
    for (let i = 0; i < path.scale.length; i++) {
      const r = cropRect({ cx: path.cx[i], cy: path.cy[i], scale: path.scale[i] });
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
  it("follow mode ignores pointer motion inside the deadzone", () => {
    // Pointer sits at 0.5 then wiggles by 0.02 — well inside the deadzone at 2×.
    const tr = track({
      t: [0, 3000, 3100, 3200, 6000],
      x: [0.5, 0.5, 0.52, 0.5, 0.5],
      y: [0.5, 0.5, 0.5, 0.5, 0.5],
    });
    const path = buildCameraPath([seg({ start: 0, end: 6, smoothing: 0 })], tr, 6);
    expect(cameraAt(path, 3.1).cx).toBeCloseTo(0.5, 3);
  });
  it("follow mode tracks the pointer when it leaves the deadzone", () => {
    const tr = track({
      t: [0, 2000, 2100, 6000],
      x: [0.3, 0.3, 0.7, 0.7],
      y: [0.5, 0.5, 0.5, 0.5],
    });
    const path = buildCameraPath([seg({ start: 0, end: 6, smoothing: 0 })], tr, 6);
    const later = cameraAt(path, 5);
    // Target = pointer − deadzone half (0.35 × 0.25) = 0.6125.
    expect(later.cx).toBeCloseTo(0.6125, 2);
  });
  it("a fixed segment with a null anchor holds the frame centre instead of following", () => {
    const tr = track({ t: [0, 6000], x: [0.9, 0.9], y: [0.9, 0.9] });
    const path = buildCameraPath(
      [seg({ start: 0, end: 6, mode: "fixed", anchor: null, smoothing: 0 })],
      tr,
      6,
    );
    const mid = cameraAt(path, 3);
    expect(mid.scale).toBeCloseTo(2, 2);
    expect(mid.cx).toBeCloseTo(0.5, 3);
    expect(mid.cy).toBeCloseTo(0.5, 3);
  });
  it("a follow segment without a cursor track zooms on the frame centre", () => {
    const path = buildCameraPath([seg({ start: 0, end: 4, smoothing: 0 })], null, 4);
    const mid = cameraAt(path, 2);
    expect(mid.scale).toBeCloseTo(2, 2);
    expect(mid.cx).toBeCloseTo(0.5, 3);
    expect(mid.cy).toBeCloseTo(0.5, 3);
  });
  it("is deterministic", () => {
    const s = [seg({ start: 1, end: 3 })];
    const tr = track({ t: [0, 3000], x: [0.2, 0.8], y: [0.2, 0.8] });
    expect(buildCameraPath(s, tr, 4)).toEqual(buildCameraPath(s, tr, 4));
  });
});

describe("clampAnchor", () => {
  it("keeps a 2× window inside the frame", () => {
    expect(clampAnchor({ x: 0.9, y: 0.1 }, 2)).toEqual({ x: 0.75, y: 0.25 });
  });
});
