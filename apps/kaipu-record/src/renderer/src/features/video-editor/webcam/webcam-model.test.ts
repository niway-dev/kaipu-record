import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_BUBBLE } from "@shared/camera-bubble";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import {
  WEBCAM_DEFAULTS,
  WEBCAM_LIMITS,
  WEBCAM_TRANSITION_DEFAULTS,
  WEBCAM_TRANSITION_LIMITS,
  clampWebcamPatch,
  clampWebcamTransition,
  seedWebcamScene,
  webcamAt,
  webcamEffectiveTransitionMs,
  webcamEndSeconds,
  webcamSizeLabel,
  webcamStateAt,
  type WebcamLayout,
  type WebcamScene,
  type WebcamSegment,
  type WebcamTransition,
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
        cornerRadius: 0.18,
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
        cornerRadius: 0.18,
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
    expect(size(120)).toBe(WEBCAM_LIMITS.minSize);
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

  it("seeds the same ids each time, so the seeded layer is the same", () => {
    const gaps = withGaps([
      { startMs: 5000, endMs: 10_000 },
      { startMs: 20_000, endMs: 22_500 },
    ]);
    expect(seedWebcamScene(gaps, 30)).toEqual(seedWebcamScene(gaps, 30));
  });

  it("seeds no segment for a take whose camera stayed on", () => {
    expect(seedWebcamScene(track())?.segments).toEqual([]);
  });
});

describe("WEBCAM_LIMITS size range", () => {
  it("is 0.12 to 0.90", () => {
    expect(WEBCAM_LIMITS.minSize).toBe(0.12);
    expect(WEBCAM_LIMITS.maxSize).toBe(0.9);
    expect(WEBCAM_DEFAULTS.size).toBe(0.22);
  });

  it("clamps an old stored size up and an oversize down", () => {
    expect(clampWebcamPatch({ size: 0.1 }).size).toBe(0.12);
    expect(clampWebcamPatch({ size: 0.6 }).size).toBe(0.6);
    expect(clampWebcamPatch({ size: 1.5 }).size).toBe(0.9);
  });
});

describe("webcamSizeLabel", () => {
  it("maps the stored range linearly onto 10 to 90", () => {
    expect(webcamSizeLabel(0.12)).toBe(10);
    expect(webcamSizeLabel(0.51)).toBe(50);
    expect(webcamSizeLabel(0.9)).toBe(90);
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

describe("clampWebcamTransition", () => {
  it("defaults to a 700 ms slide with the Smooth preset", () => {
    expect(WEBCAM_TRANSITION_DEFAULTS).toEqual({ kind: "slide", ms: 700, easing: "ease-in-out" });
    expect(clampWebcamTransition({})).toEqual(WEBCAM_TRANSITION_DEFAULTS);
  });

  it("keeps a valid transition as given, rounding the duration", () => {
    expect(clampWebcamTransition({ kind: "cut", ms: 512.6, easing: "linear" })).toEqual({
      kind: "cut",
      ms: 513,
      easing: "linear",
    });
  });

  it("falls back per field to the default for a missing or invalid one", () => {
    expect(clampWebcamTransition({ kind: "wipe", ms: Number.NaN, easing: "bounce" })).toEqual(
      WEBCAM_TRANSITION_DEFAULTS,
    );
    expect(clampWebcamTransition({ kind: "cut", ms: "slow", easing: "ease-out" })).toEqual({
      kind: "cut",
      ms: WEBCAM_TRANSITION_DEFAULTS.ms,
      easing: "ease-out",
    });
  });

  it("clamps the duration to the limits", () => {
    expect(clampWebcamTransition({ ms: 5 }).ms).toBe(WEBCAM_TRANSITION_LIMITS.minMs);
    expect(clampWebcamTransition({ ms: 60000 }).ms).toBe(WEBCAM_TRANSITION_LIMITS.maxMs);
    expect(clampWebcamTransition({ ms: Infinity }).ms).toBe(WEBCAM_TRANSITION_DEFAULTS.ms);
  });
});

describe("webcamEffectiveTransitionMs", () => {
  it("is the duration for a long block and half the block for a short one", () => {
    expect(webcamEffectiveTransitionMs(10, 700)).toBe(700);
    expect(webcamEffectiveTransitionMs(1, 1500)).toBe(500);
  });
});

describe("webcamStateAt", () => {
  const BASE = { ...WEBCAM_DEFAULTS };
  const TOP_RIGHT = { x: 0.9, y: 0.1 };
  const CENTER = { x: 0.5, y: 0.5 };
  const slide = (ms = 1000, easing: WebcamTransition["easing"] = "linear"): WebcamTransition => ({
    kind: "slide",
    ms,
    easing,
  });
  const override = (
    id: string,
    start: number,
    end: number,
    position: { x: number; y: number },
    transition?: WebcamTransition,
  ): WebcamSegment => ({
    id,
    start,
    end,
    mode: "override",
    layout: { position },
    ...(transition ? { transition } : {}),
  });
  const sceneOf = (...segments: WebcamSegment[]) => ({
    webcam: { layout: BASE, segments } satisfies WebcamScene,
  });

  it("is null without a webcam and inside a hidden segment", () => {
    expect(webcamStateAt({ webcam: null }, 1)).toBeNull();
    const hidden: WebcamSegment = { id: "h", start: 2, end: 4, mode: "hidden" };
    expect(webcamStateAt(sceneOf(hidden), 3)).toBeNull();
    expect(webcamStateAt(sceneOf(hidden), 5)?.layout).toBe(BASE);
  });

  it("has no motion outside a block", () => {
    const scene = sceneOf(override("a", 10, 20, TOP_RIGHT, slide()));
    expect(webcamStateAt(scene, 5)).toMatchObject({ layout: BASE, from: null, progress: 1 });
  });

  it("slides from the default position at the start, midpoint and end of a transition", () => {
    const scene = sceneOf(override("a", 10, 20, TOP_RIGHT, slide(1000)));
    const start = webcamStateAt(scene, 10)!;
    expect(start.layout.position).toEqual(TOP_RIGHT);
    expect(start.from?.position).toEqual(BASE.position);
    expect(start.progress).toBe(0);
    expect(webcamStateAt(scene, 10.5)!.progress).toBeCloseTo(0.5);
    const end = webcamStateAt(scene, 11)!;
    expect(end.from).toBeNull();
    expect(end.progress).toBe(1);
    expect(end.layout.position).toEqual(TOP_RIGHT);
  });

  it("changes only the position in `from`: the other fields apply at once", () => {
    const scene = sceneOf({
      ...override("a", 10, 20, TOP_RIGHT, slide()),
      layout: { position: TOP_RIGHT, size: 0.4, shape: "rectangle" },
    });
    const state = webcamStateAt(scene, 10.2)!;
    expect(state.from).toEqual({ ...state.layout, position: BASE.position });
    expect(state.layout).toMatchObject({ size: 0.4, shape: "rectangle" });
  });

  it("gives the same values after seeking backwards (a pure function of time)", () => {
    const scene = sceneOf(override("a", 10, 20, TOP_RIGHT, slide(1000, "back")));
    const first = webcamStateAt(scene, 10.4);
    const other = webcamStateAt(scene, 3);
    const during = webcamStateAt(scene, 10.9);
    expect(other?.from).toBeNull();
    expect(during).not.toBeNull();
    expect(webcamStateAt(scene, 10.4)).toEqual(first);
    expect(webcamStateAt(scene, 10.9)).toEqual(during);
  });

  it("passes 1 in the middle of a back transition and settles on exactly 1", () => {
    const scene = sceneOf(override("a", 10, 20, TOP_RIGHT, slide(1000, "back")));
    const progresses = Array.from(
      { length: 100 },
      (_, i) => webcamStateAt(scene, 10 + i / 100)!.progress,
    );
    expect(Math.max(...progresses)).toBeGreaterThan(1);
    expect(webcamStateAt(scene, 11)!.progress).toBe(1);
  });

  it("caps the slide at half of a short block", () => {
    const scene = sceneOf(override("a", 10, 11, TOP_RIGHT, slide(1500)));
    expect(webcamStateAt(scene, 10.25)!.progress).toBeCloseTo(0.5);
    expect(webcamStateAt(scene, 10.5)!.from).toBeNull();
    expect(webcamStateAt(scene, 10.5)!.progress).toBe(1);
  });

  it("has no motion for a Cut or a block without a transition", () => {
    const cut = sceneOf(override("a", 10, 20, TOP_RIGHT, { ...slide(), kind: "cut" }));
    expect(webcamStateAt(cut, 10)).toMatchObject({ from: null, progress: 1 });
    const none = sceneOf(override("a", 10, 20, TOP_RIGHT));
    expect(webcamStateAt(none, 10)).toMatchObject({ from: null, progress: 1 });
    expect(webcamStateAt(none, 10)!.layout.position).toEqual(TOP_RIGHT);
  });

  it("has no motion when the position does not change", () => {
    const scene = sceneOf(override("a", 10, 20, BASE.position, slide()));
    expect(webcamStateAt(scene, 10)).toMatchObject({ from: null, progress: 1 });
  });

  it("slides adjacent blocks from the previous block's position", () => {
    const scene = sceneOf(
      override("a", 10, 20, TOP_RIGHT, slide()),
      override("b", 20, 30, CENTER, slide()),
    );
    const state = webcamStateAt(scene, 20.5)!;
    expect(state.from?.position).toEqual(TOP_RIGHT);
    expect(state.layout.position).toEqual(CENTER);
    expect(state.progress).toBeCloseTo(0.5);
    expect(webcamStateAt(scene, 19.9)!.from).toBeNull();
  });

  it("slides from the default layout when the previous block does not touch this one", () => {
    const scene = sceneOf(
      override("a", 10, 20, TOP_RIGHT, slide()),
      override("b", 25, 35, CENTER, slide()),
    );
    expect(webcamStateAt(scene, 25)!.from?.position).toEqual(BASE.position);
  });

  it("slides from the default layout after a hidden segment", () => {
    const hidden: WebcamSegment = { id: "h", start: 10, end: 14, mode: "hidden" };
    const scene = sceneOf(hidden, override("b", 14, 24, CENTER, slide()));
    expect(webcamStateAt(scene, 14)!.from?.position).toEqual(BASE.position);
  });

  it("returns to the default layout at the end of a block into a gap, with the block's own transition", () => {
    const scene = sceneOf(override("a", 10, 20, TOP_RIGHT, slide(1000)));
    const start = webcamStateAt(scene, 20)!;
    expect(start.layout).toBe(BASE);
    expect(start.from?.position).toEqual(TOP_RIGHT);
    expect(start.progress).toBe(0);
    expect(webcamStateAt(scene, 20.5)!.progress).toBeCloseTo(0.5);
    expect(webcamStateAt(scene, 21)).toMatchObject({ from: null, progress: 1 });
  });

  it("caps the return at half the gap before the next block", () => {
    const scene = sceneOf(
      override("a", 10, 20, TOP_RIGHT, slide(1500)),
      override("b", 21, 30, CENTER, { ...slide(), kind: "cut" }),
    );
    expect(webcamStateAt(scene, 20.25)!.progress).toBeCloseTo(0.5);
    expect(webcamStateAt(scene, 20.5)!.from).toBeNull();
  });

  it("does not return when the next block starts exactly where this one ends", () => {
    const scene = sceneOf(
      override("a", 10, 20, TOP_RIGHT, slide()),
      override("b", 20, 30, CENTER, { ...slide(), kind: "cut" }),
    );
    const state = webcamStateAt(scene, 20)!;
    expect(state.layout.position).toEqual(CENTER);
    expect(state.from).toBeNull();
  });

  it("does not return when the next segment is hidden", () => {
    const hidden: WebcamSegment = { id: "h", start: 20, end: 24, mode: "hidden" };
    const scene = sceneOf(override("a", 10, 20, TOP_RIGHT, slide()), hidden);
    expect(webcamStateAt(scene, 20)).toBeNull();
  });

  it("does not return after a Cut", () => {
    const scene = sceneOf(override("a", 10, 20, TOP_RIGHT, { ...slide(), kind: "cut" }));
    expect(webcamStateAt(scene, 20)).toMatchObject({ from: null, progress: 1 });
  });

  it("caps the last return at half of what is left of the recording, so it finishes before the end", () => {
    const scene = sceneOf(override("a", 10, 20, TOP_RIGHT, slide(700)));
    // 0.1 s of recording left: the return gets 50 ms and has settled by 20.05.
    expect(webcamStateAt(scene, 20.025, 20.1)!.progress).toBeCloseTo(0.5);
    expect(webcamStateAt(scene, 20.05, 20.1)).toMatchObject({ from: null, progress: 1 });
    expect(webcamStateAt(scene, 20.09, 20.1)).toMatchObject({ from: null, progress: 1 });
  });

  it("uses the transition's own length for the last return while the recording end is unknown or far", () => {
    const scene = sceneOf(override("a", 10, 20, TOP_RIGHT, slide(1000)));
    expect(webcamStateAt(scene, 20.5)!.progress).toBeCloseTo(0.5);
    expect(webcamStateAt(scene, 20.5, 120)!.progress).toBeCloseTo(0.5);
  });

  it("starts the next block's slide, not the default layout, across a gap of float noise", () => {
    const scene = sceneOf(
      override("a", 10, 20, TOP_RIGHT, slide()),
      override("b", 20.0000005, 30, CENTER, slide()),
    );
    const sliver = webcamStateAt(scene, 20)!;
    expect(sliver.layout.position).toEqual(CENTER);
    expect(sliver.from?.position).toEqual(TOP_RIGHT);
    expect(sliver.progress).toBe(0);
  });
});

describe("webcamEndSeconds", () => {
  it("passes a usable recording length through", () => {
    expect(webcamEndSeconds(20)).toBe(20);
    expect(webcamEndSeconds(0.5)).toBe(0.5);
  });

  it("reads a missing, zero, negative, NaN or infinite length as no end", () => {
    for (const v of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(webcamEndSeconds(v)).toBeUndefined();
    }
  });
});
