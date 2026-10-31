import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_BUBBLE } from "@shared/camera-bubble";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import {
  WEBCAM_DEFAULTS,
  WEBCAM_LIMITS,
  clampWebcamPatch,
  seedWebcamScene,
  webcamAt,
  type WebcamLayout,
  type WebcamScene,
} from "./webcam-model";

const track = (recordedLayout?: WebcamTrackMeta["recordedLayout"]): WebcamTrackMeta => ({
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
  ...(recordedLayout ? { recordedLayout } : {}),
});

describe("seedWebcamScene", () => {
  it("is null for a recording without a webcam", () => {
    expect(seedWebcamScene(null)).toBeNull();
    expect(seedWebcamScene(undefined)).toBeNull();
  });

  it("seeds the layout from the bubble as recorded, plus the spec defaults", () => {
    const scene = seedWebcamScene(
      track({
        shape: "rounded",
        size: 240,
        mirrored: false,
        framing: { enabled: true, zoom: 1.5, x: 0.25, y: -0.5 },
        position: { x: 0.18, y: 0.82 },
        sizeFraction: 0.24,
      }),
    );
    expect(scene).toEqual({
      layout: {
        shape: "rounded",
        size: 0.24,
        position: { x: 0.18, y: 0.82 },
        mirrored: false,
        framing: { zoom: 1.5, x: 0.25, y: -0.5 },
        scaleDuringZoom: 0.7,
        shadow: true,
      },
      segments: [],
    });
  });

  it("uses a neutral framing while the bubble's framing was off", () => {
    const scene = seedWebcamScene(
      track({
        ...DEFAULT_CAMERA_BUBBLE,
        framing: { enabled: false, zoom: 2, x: 1, y: 1 },
      }),
    );
    expect(scene?.layout.framing).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it("falls back to the default corner without a recorded position", () => {
    const scene = seedWebcamScene(track({ ...DEFAULT_CAMERA_BUBBLE, sizeFraction: 0.2 }));
    expect(scene?.layout.position).toEqual(WEBCAM_DEFAULTS.position);
  });

  it("derives the size from the DIP size when no fraction was recorded, within the limits", () => {
    const size = (dip: number) =>
      seedWebcamScene(track({ ...DEFAULT_CAMERA_BUBBLE, size: dip }))?.layout.size;
    expect(size(270)).toBe(0.25);
    expect(size(120)).toBeCloseTo(0.111, 3);
    expect(size(60)).toBe(WEBCAM_LIMITS.minSize);
  });

  it("clamps a recorded fraction to the limits", () => {
    const size = (sizeFraction: number) =>
      seedWebcamScene(track({ ...DEFAULT_CAMERA_BUBBLE, sizeFraction }))?.layout.size;
    expect(size(0.95)).toBe(WEBCAM_LIMITS.maxSize);
    expect(size(0.02)).toBe(WEBCAM_LIMITS.minSize);
  });

  it("uses every default for a webcam whose bubble was not recorded", () => {
    expect(seedWebcamScene(track())).toEqual({ layout: WEBCAM_DEFAULTS, segments: [] });
  });
});

describe("seedWebcamScene: camera-off gaps", () => {
  const withGaps = (gaps: WebcamTrackMeta["gaps"]): WebcamTrackMeta => ({ ...track(), gaps });
  const spans = (scene: WebcamScene | null) =>
    scene?.segments.map(({ start, end, mode }) => ({ start, end, mode }));

  it("seeds each gap as a hidden segment, in source seconds, so the lane stripes it", () => {
    const scene = seedWebcamScene(
      withGaps([
        { startMs: 5000, endMs: 10_000 },
        { startMs: 20_000, endMs: 22_500 },
      ]),
    );
    expect(spans(scene)).toEqual([
      { start: 5, end: 10, mode: "hidden" },
      { start: 20, end: 22.5, mode: "hidden" },
    ]);
    expect(new Set(scene!.segments.map((s) => s.id)).size).toBe(2);
    // The face is hidden inside a gap, shown on both sides of it.
    expect(webcamAt({ webcam: scene }, 7)).toBeNull();
    expect(webcamAt({ webcam: scene }, 4.9)).not.toBeNull();
    expect(webcamAt({ webcam: scene }, 10)).not.toBeNull();
  });

  it("stretches a gap shorter than a segment can be, merging what then overlaps", () => {
    // A quick off/on still hides the held frame; a segment under 1 s would not survive a reload.
    const scene = seedWebcamScene(
      withGaps([
        { startMs: 3000, endMs: 3200 },
        { startMs: 3600, endMs: 3700 },
      ]),
    );
    expect(spans(scene)).toEqual([{ start: 3, end: 4.6, mode: "hidden" }]);
  });

  it("keeps a stretched gap inside the recording when its length is known", () => {
    const scene = seedWebcamScene(withGaps([{ startMs: 9800, endMs: 10_000 }]), 10);
    expect(spans(scene)).toEqual([{ start: 9, end: 10, mode: "hidden" }]);
  });

  it("seeds a trailing gap (the camera off at the end of the take) like any other", () => {
    const scene = seedWebcamScene(withGaps([{ startMs: 8000, endMs: 12_000 }]), 12);
    expect(spans(scene)).toEqual([{ start: 8, end: 12, mode: "hidden" }]);
  });

  it("seeds no segment for a take whose camera stayed on", () => {
    expect(seedWebcamScene(track())?.segments).toEqual([]);
  });
});

describe("clampWebcamPatch", () => {
  it("holds every field inside its range and leaves absent fields absent", () => {
    expect(
      clampWebcamPatch({
        size: 5,
        position: { x: -1, y: 2 },
        scaleDuringZoom: 0,
        framing: { zoom: 9, x: 3, y: -3 },
      }),
    ).toEqual({
      size: WEBCAM_LIMITS.maxSize,
      position: { x: 0, y: 1 },
      scaleDuringZoom: WEBCAM_LIMITS.minScaleDuringZoom,
      framing: { zoom: 3, x: 1, y: -1 },
    });
    expect(clampWebcamPatch({ mirrored: false })).toEqual({ mirrored: false });
  });
});

describe("webcamAt", () => {
  const layout: WebcamLayout = { ...WEBCAM_DEFAULTS };
  const webcam: WebcamScene = {
    layout,
    segments: [
      { id: "h", start: 2, end: 4, mode: "hidden" },
      { id: "o", start: 6, end: 8, mode: "override", layout: { size: 0.4, shape: "rounded" } },
    ],
  };

  it("is null without a webcam", () => {
    expect(webcamAt({ webcam: null }, 1)).toBeNull();
  });

  it("is the global layout outside every segment", () => {
    expect(webcamAt({ webcam }, 1)).toBe(layout);
    expect(webcamAt({ webcam }, 5)).toBe(layout);
  });

  it("is null inside a hidden segment, whose end is exclusive", () => {
    expect(webcamAt({ webcam }, 2)).toBeNull();
    expect(webcamAt({ webcam }, 3.99)).toBeNull();
    expect(webcamAt({ webcam }, 4)).toBe(layout);
  });

  it("merges an override over the global layout, field by field", () => {
    expect(webcamAt({ webcam }, 7)).toEqual({ ...layout, size: 0.4, shape: "rounded" });
    expect(webcamAt({ webcam }, 8)).toBe(layout);
  });
});
