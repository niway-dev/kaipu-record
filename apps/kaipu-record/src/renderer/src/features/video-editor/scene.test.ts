import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_BUBBLE } from "@shared/camera-bubble";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { initialScene, newId, reconcileWebcam, withJoinedWebcam, type SceneSource } from "./scene";

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

describe("reconcileWebcam — joined recordings (ADR 0058)", () => {
  it("keeps the layer when the opened recording has no track but a joined one does", () => {
    const saved = initialScene(10, WEBCAM);
    expect(reconcileWebcam(saved, null, 10, true)).toBe(saved);
  });

  it("drops the layer when neither has a track", () => {
    expect(reconcileWebcam(initialScene(10, WEBCAM), null, 10, false).webcam).toBeNull();
  });

  it("is the old behaviour when the fourth argument is left out", () => {
    expect(reconcileWebcam(initialScene(10, WEBCAM), null, 10).webcam).toBeNull();
  });
});

describe("withJoinedWebcam", () => {
  const SOURCE_B: SceneSource = {
    id: "b",
    assetId: "lib-b",
    title: "B",
    offset: 3600,
    durationSeconds: 20,
    width: 1280,
    height: 720,
  };
  const joinedMeta = {
    ...WEBCAM,
    gaps: [
      { startMs: 2000, endMs: 4000 },
      { startMs: 18_000, endMs: 20_000 },
    ],
  };

  it("leaves the scene unchanged when the joined recording has no webcam", () => {
    const scene = initialScene(10, WEBCAM);
    expect(withJoinedWebcam(scene, null, SOURCE_B)).toBe(scene);
    const none = initialScene(10);
    expect(withJoinedWebcam(none, null, SOURCE_B)).toBe(none);
  });

  it("seeds a layer from the joined recording and shifts its gaps into its range", () => {
    const next = withJoinedWebcam(initialScene(10), joinedMeta, SOURCE_B);
    expect(next.webcam!.layout).toEqual(initialScene(20, joinedMeta).webcam!.layout);
    expect(next.webcam!.segments.map(({ start, end, mode }) => ({ start, end, mode }))).toEqual([
      { start: 3602, end: 3604, mode: "hidden" },
      { start: 3618, end: 3620, mode: "hidden" },
    ]);
  });

  it("keeps the scene's layout and appends the joined gaps, shifted, after the existing ones", () => {
    const withFirstGap = initialScene(10, { ...WEBCAM, gaps: [{ startMs: 1000, endMs: 3000 }] });
    const customLayout = {
      ...withFirstGap.webcam!.layout,
      shape: "rounded" as const,
      position: { x: 0.9, y: 0.1 },
    };
    const scene = { ...withFirstGap, webcam: { ...withFirstGap.webcam!, layout: customLayout } };
    const next = withJoinedWebcam(scene, joinedMeta, SOURCE_B);
    expect(next.webcam!.layout).toBe(customLayout);
    expect(next.webcam!.segments.map((s) => [s.start, s.end])).toEqual([
      [1, 3],
      [3602, 3604],
      [3618, 3620],
    ]);
    const ids = next.webcam!.segments.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("adds no segment when the joined recording never lost its camera", () => {
    const scene = initialScene(10, WEBCAM);
    expect(withJoinedWebcam(scene, WEBCAM, SOURCE_B).webcam!.segments).toEqual([]);
  });

  it("keeps ids unique when two joins have the same gap", () => {
    const first = withJoinedWebcam(initialScene(10, WEBCAM), joinedMeta, SOURCE_B);
    const second = withJoinedWebcam(first, joinedMeta, { ...SOURCE_B, id: "c", offset: 7200 });
    const ids = second.webcam!.segments.map((s) => s.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});
