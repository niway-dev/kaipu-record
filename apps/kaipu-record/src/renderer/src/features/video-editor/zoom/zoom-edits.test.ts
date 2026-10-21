import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { initialScene } from "../scene";
import {
  addManualZoom,
  applySensitivity,
  dragZoomEdge,
  lockZoomAt,
  removeZoom,
  updateZoom,
} from "./zoom-edits";
import type { ZoomSegment } from "./zoom-model";

const AUTO: ZoomSegment = {
  id: "auto-1000",
  start: 1,
  end: 3,
  scale: 2,
  mode: "follow",
  anchor: null,
  smoothing: 70,
  origin: "auto",
  trigger: "click",
};

const withZoom = { ...initialScene(20), zoomSegments: [AUTO] };

const TRACK: CursorTrack = {
  version: 1,
  display: { id: "1", width: 1600, height: 1000, scaleFactor: 2 },
  anchor: "exact",
  clicksAvailable: true,
  t: [0, 20_000],
  x: [0.5, 0.5],
  y: [0.5, 0.5],
  clicks: [{ t: 10_000, x: 0.5, y: 0.5, button: 0 }],
};

describe("zoom edits", () => {
  it("any user edit flips an auto segment to manual and keeps its trigger", () => {
    const [s] = updateZoom(withZoom, AUTO.id, { scale: 3 }).zoomSegments;
    expect(s).toMatchObject({ scale: 3, origin: "manual", trigger: "click" });
  });
  it("clamps scale and smoothing", () => {
    const [s] = updateZoom(withZoom, AUTO.id, { scale: 9, smoothing: 140.4 }).zoomSegments;
    expect(s.scale).toBe(4);
    expect(s.smoothing).toBe(100);
  });
  it("lockZoomAt switches to fixed with a clamped anchor", () => {
    const [s] = lockZoomAt(withZoom, AUTO.id, { x: 0.99, y: 0.01 }).zoomSegments;
    expect(s).toMatchObject({ mode: "fixed", anchor: { x: 0.75, y: 0.25 }, origin: "manual" });
  });
  it("switching to fixed without an anchor centers it", () => {
    const [s] = updateZoom(withZoom, AUTO.id, { mode: "fixed" }).zoomSegments;
    expect(s.anchor).toEqual({ x: 0.5, y: 0.5 });
  });
  it("removes and adds", () => {
    expect(removeZoom(withZoom, AUTO.id).zoomSegments).toEqual([]);
    const { scene, id } = addManualZoom(withZoom, { start: 5, end: 8 });
    expect(scene.zoomSegments.map((s) => s.id)).toEqual([AUTO.id, id]);
    expect(scene.zoomSegments[1]).toMatchObject({
      origin: "manual",
      trigger: null,
      mode: "follow",
    });
  });
  it("applySensitivity replaces autos, keeps manuals, stores the value", () => {
    const edited = updateZoom(withZoom, AUTO.id, { scale: 3 });
    const next = applySensitivity(edited, TRACK, 20, 60);
    expect(next.zoomSensitivity).toBe(60);
    expect(next.zoomSegments.map((s) => s.origin)).toEqual(["manual", "auto"]);
    expect(next.zoomSegments[1].start).toBeCloseTo(9.6, 6);
  });
  it("applySensitivity returns the same scene when nothing changes", () => {
    const analysed = applySensitivity(withZoom, TRACK, 20, 55);
    expect(analysed).not.toBe(withZoom);
    expect(applySensitivity(analysed, TRACK, 20, 55)).toBe(analysed);
  });
});

describe("dragZoomEdge", () => {
  const two = {
    ...initialScene(20),
    zoomSegments: [AUTO, { ...AUTO, id: "auto-8000", start: 8, end: 12 }],
  };
  it("stops at the neighbour and flips the segment to manual", () => {
    const [, s] = dragZoomEdge(two, "auto-8000", "start", 2, 20).zoomSegments;
    expect(s).toMatchObject({ start: 3, end: 12, origin: "manual" });
  });
  it("keeps the minimum length", () => {
    const [s] = dragZoomEdge(two, "auto-1000", "end", 1.2, 20).zoomSegments;
    expect(s.end).toBe(2);
  });
  it("stays inside the source and ignores an unknown id", () => {
    const [, s] = dragZoomEdge(two, "auto-8000", "end", 99, 20).zoomSegments;
    expect(s.end).toBe(20);
    expect(dragZoomEdge(two, "nope", "end", 5, 20)).toBe(two);
  });
});
