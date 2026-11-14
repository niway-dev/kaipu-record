import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { initialScene, type SceneSource } from "./scene";
import { withInitialZooms, withJoinedZooms } from "./initial-zooms";
import { detectZoomSegments } from "./zoom/detect-zoom-segments";

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

describe("withJoinedZooms", () => {
  const SOURCE_B: SceneSource = {
    id: "b",
    assetId: "lib-b",
    title: "B",
    offset: 3600,
    durationSeconds: 20,
    width: 0,
    height: 0,
  };
  const manualZoom = {
    id: "m",
    start: 2,
    end: 4,
    scale: 2,
    mode: "follow" as const,
    anchor: null,
    smoothing: 70,
    origin: "manual" as const,
    trigger: null,
  };

  it("adds the joined recording's zooms inside its range and leaves the others as they were", () => {
    const opened = withInitialZooms(initialScene(20), false, TRACK, 20);
    const scene = {
      ...opened,
      zoomSegments: [...opened.zoomSegments, manualZoom].sort((a, b) => a.start - b.start),
    };
    const next = withJoinedZooms(scene, SOURCE_B, TRACK);
    const before = next.zoomSegments.filter((z) => z.start < 3600);
    expect(before).toEqual(scene.zoomSegments);
    const added = next.zoomSegments.filter((z) => z.start >= 3600);
    expect(added).toHaveLength(detectZoomSegments(TRACK, 20, scene.zoomSensitivity).length);
    for (const z of added) {
      expect(z.end).toBeLessThanOrEqual(3620);
      expect(z.origin).toBe("auto");
    }
  });

  it("returns the same scene without a track", () => {
    const scene = initialScene(20);
    expect(withJoinedZooms(scene, SOURCE_B, null)).toBe(scene);
  });
});
