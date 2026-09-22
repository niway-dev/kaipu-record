import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { initialScene } from "./scene";
import { withInitialZooms } from "./initial-zooms";

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

describe("withInitialZooms", () => {
  it("detects on a fresh open", () => {
    expect(withInitialZooms(initialScene(20), false, TRACK, 20).zoomSegments).toHaveLength(1);
  });
  it("keeps saved v2 zooms, even an empty list", () => {
    expect(withInitialZooms(initialScene(20), true, TRACK, 20).zoomSegments).toEqual([]);
  });
  it("does nothing without a track", () => {
    const scene = initialScene(20);
    expect(withInitialZooms(scene, false, null, 20)).toBe(scene);
  });
});
