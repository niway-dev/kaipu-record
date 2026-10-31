import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_BUBBLE } from "@shared/camera-bubble";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { initialScene, newId, reconcileWebcam } from "./scene";

describe("initialScene", () => {
  it("creates a single clip covering the whole recording", () => {
    const scene = initialScene(92.5);
    expect(scene.overlays).toEqual([]);
    expect(scene.items).toHaveLength(1);
    const clip = scene.items[0];
    expect(clip.kind).toBe("clip");
    expect(clip).toMatchObject({ sourceStart: 0, sourceEnd: 92.5 });
  });

  it("generates unique ids", () => {
    expect(newId()).not.toBe(newId());
  });
});

describe("initialScene — v2 fields", () => {
  it("starts with no zooms, no redactions and the default sensitivity", () => {
    const scene = initialScene(10);
    expect(scene.zoomSegments).toEqual([]);
    expect(scene.redactions).toEqual([]);
    expect(scene.zoomSensitivity).toBe(55);
  });
});

const WEBCAM: WebcamTrackMeta = {
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
  recordedLayout: {
    ...DEFAULT_CAMERA_BUBBLE,
    shape: "rounded",
    mirrored: false,
    position: { x: 0.9, y: 0.85 },
    sizeFraction: 0.3,
  },
};

describe("initialScene — webcam", () => {
  it("has no webcam layer for a recording without a webcam track", () => {
    expect(initialScene(10).webcam).toBeNull();
    expect(initialScene(10, null).webcam).toBeNull();
  });

  it("seeds the layer from the bubble as recorded, with no segments", () => {
    const { webcam } = initialScene(10, WEBCAM);
    expect(webcam?.segments).toEqual([]);
    expect(webcam?.layout).toMatchObject({
      shape: "rounded",
      mirrored: false,
      size: 0.3,
      position: { x: 0.9, y: 0.85 },
      scaleDuringZoom: 0.7,
    });
  });
});

describe("reconcileWebcam", () => {
  it("drops a saved layer when the recording has no webcam track any more", () => {
    const saved = initialScene(10, WEBCAM);
    expect(reconcileWebcam(saved, null, 10).webcam).toBeNull();
  });

  it("seeds a saved scene that predates the webcam when the recording has one", () => {
    const saved = initialScene(10);
    expect(reconcileWebcam(saved, WEBCAM, 10).webcam).toEqual(initialScene(10, WEBCAM).webcam);
  });

  it("keeps a seeded gap inside the recording, as a fresh scene does", () => {
    const withGap = { ...WEBCAM, gaps: [{ startMs: 9800, endMs: 10_000 }] };
    const seeded = reconcileWebcam(initialScene(10), withGap, 10).webcam!;
    expect(seeded.segments.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: 9, end: 10 },
    ]);
    expect(seeded).toEqual(initialScene(10, withGap).webcam);
  });

  it("keeps the user's saved layer, and returns the same scene when nothing changes", () => {
    const saved = initialScene(10, WEBCAM);
    expect(reconcileWebcam(saved, WEBCAM, 10)).toBe(saved);
    const none = initialScene(10);
    expect(reconcileWebcam(none, null, 10)).toBe(none);
  });
});
