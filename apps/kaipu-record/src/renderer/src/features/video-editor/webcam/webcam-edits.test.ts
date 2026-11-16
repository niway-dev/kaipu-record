import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_BUBBLE } from "@shared/camera-bubble";
import { initialScene, type VideoScene } from "../scene";
import {
  addWebcamSegment,
  createWebcamPart,
  dragWebcamSegmentEdge,
  removeWebcamSegment,
  setWebcamLayout,
  setWebcamTransition,
  updateWebcamSegment,
  webcamPartRoom,
} from "./webcam-edits";
import { WEBCAM_TRANSITION_DEFAULTS, webcamAt, type WebcamScene } from "./webcam-model";

const DURATION = 60;
const WHOLE = { start: 0, end: DURATION };
const withWebcam = (): VideoScene =>
  initialScene(DURATION, {
    startOffsetMs: 0,
    offsetQuality: "exact",
    width: 1280,
    height: 720,
    fps: 30,
    recordedLayout: { ...DEFAULT_CAMERA_BUBBLE },
  });

describe("setWebcamLayout", () => {
  it("changes the given fields and keeps the rest", () => {
    const next = setWebcamLayout(withWebcam(), { shape: "rounded", mirrored: false });
    expect(next.webcam?.layout).toMatchObject({ shape: "rounded", mirrored: false });
    expect(next.webcam?.layout.size).toBe(withWebcam().webcam?.layout.size);
  });

  it("clamps what it is given", () => {
    const next = setWebcamLayout(withWebcam(), { size: 4, position: { x: 2, y: -1 } });
    expect(next.webcam?.layout).toMatchObject({ size: 0.9, position: { x: 1, y: 0 } });
  });

  it("returns the same scene when nothing changes, so no undo step is pushed", () => {
    const scene = withWebcam();
    expect(setWebcamLayout(scene, {})).toBe(scene);
    expect(setWebcamLayout(scene, { shape: scene.webcam!.layout.shape })).toBe(scene);
    expect(setWebcamLayout(scene, { position: { ...scene.webcam!.layout.position } })).toBe(scene);
  });

  it("does nothing on a recording without a webcam", () => {
    const scene = initialScene(DURATION);
    expect(setWebcamLayout(scene, { size: 0.3 })).toBe(scene);
  });
});

describe("addWebcamSegment", () => {
  it("adds a hidden segment, sorted among the others", () => {
    let scene = withWebcam();
    ({ scene } = addWebcamSegment(scene, { start: 20, end: 25, mode: "hidden" }, WHOLE));
    const added = addWebcamSegment(scene, { start: 5, end: 8, mode: "hidden" }, WHOLE);
    expect(added.id).toEqual(expect.any(String));
    expect(added.scene.webcam?.segments.map((s) => s.start)).toEqual([5, 20]);
  });

  it("adds an override with its clamped partial layout", () => {
    const { scene, id } = addWebcamSegment(
      withWebcam(),
      { start: 5, end: 9, mode: "override", layout: { size: 0.9 } },
      WHOLE,
    );
    expect(scene.webcam?.segments.find((s) => s.id === id)).toMatchObject({
      mode: "override",
      layout: { size: 0.9 },
    });
  });

  it("refuses a window that is too short, overlapping or outside the recording", () => {
    const base = addWebcamSegment(
      withWebcam(),
      { start: 10, end: 15, mode: "hidden" },
      WHOLE,
    ).scene;
    for (const window of [
      { start: 1, end: 1.5 },
      { start: 12, end: 18 },
      { start: 8, end: 11 },
      { start: 59.5, end: 62 },
      { start: -2, end: 1 },
    ]) {
      const result = addWebcamSegment(base, { ...window, mode: "hidden" }, WHOLE);
      expect(result.scene).toBe(base);
      expect(result.id).toBeNull();
    }
  });

  it("refuses on a recording without a webcam", () => {
    const scene = initialScene(DURATION);
    expect(addWebcamSegment(scene, { start: 1, end: 3, mode: "hidden" }, WHOLE)).toEqual({
      scene,
      id: null,
    });
  });
});

describe("updateWebcamSegment", () => {
  const setup = () => {
    const { scene, id } = addWebcamSegment(
      withWebcam(),
      { start: 10, end: 20, mode: "override", layout: { size: 0.4 } },
      WHOLE,
    );
    return { scene, id: id! };
  };

  it("merges layout fields into an override, clamped", () => {
    const { scene, id } = setup();
    const next = updateWebcamSegment(scene, id, { layout: { shadow: false, size: 5 } });
    expect(next.webcam?.segments[0]?.layout).toEqual({ size: 0.9, shadow: false });
  });

  it("turns an override into a hidden segment and drops its layout", () => {
    const { scene, id } = setup();
    const next = updateWebcamSegment(scene, id, { mode: "hidden" });
    expect(next.webcam?.segments[0]).toEqual({ id, start: 10, end: 20, mode: "hidden" });
  });

  it("ignores a layout patch on a hidden segment", () => {
    const { scene, id } = setup();
    const hidden = updateWebcamSegment(scene, id, { mode: "hidden" });
    expect(updateWebcamSegment(hidden, id, { layout: { size: 0.3 } })).toBe(hidden);
  });

  it("returns the same scene for an unknown id or a no-op patch", () => {
    const { scene, id } = setup();
    expect(updateWebcamSegment(scene, "nope", { mode: "hidden" })).toBe(scene);
    expect(updateWebcamSegment(scene, id, { layout: { size: 0.4 } })).toBe(scene);
    expect(updateWebcamSegment(scene, id, {})).toBe(scene);
  });
});

describe("webcam segments in a joined recording (ADR 0058)", () => {
  const rangeB = { start: 3600, end: 3630 };

  it("adds a segment inside B's range and refuses one outside it", () => {
    const ok = addWebcamSegment(withWebcam(), { start: 3610, end: 3615, mode: "hidden" }, rangeB);
    expect(ok.id).toEqual(expect.any(String));
    const past = addWebcamSegment(withWebcam(), { start: 3625, end: 3640, mode: "hidden" }, rangeB);
    expect(past.id).toBeNull();
    const before = addWebcamSegment(
      withWebcam(),
      { start: 3590, end: 3601, mode: "hidden" },
      rangeB,
    );
    expect(before.id).toBeNull();
  });

  it("drags an edge inside B's range", () => {
    const { scene, id } = addWebcamSegment(
      withWebcam(),
      { start: 3610, end: 3615, mode: "hidden" },
      rangeB,
    );
    const end = dragWebcamSegmentEdge(scene, id!, "end", 99999, rangeB);
    expect(end.webcam?.segments[0]?.end).toBe(3630);
    const start = dragWebcamSegmentEdge(scene, id!, "start", 10, rangeB);
    expect(start.webcam?.segments[0]?.start).toBe(3600);
  });
});

describe("dragWebcamSegmentEdge", () => {
  it("moves an edge but never into a neighbour or under the minimum", () => {
    let scene = withWebcam();
    ({ scene } = addWebcamSegment(scene, { start: 10, end: 20, mode: "hidden" }, WHOLE));
    let id: string | null;
    ({ scene, id } = addWebcamSegment(scene, { start: 25, end: 30, mode: "hidden" }, WHOLE));
    const dragStart = dragWebcamSegmentEdge(scene, id!, "start", 5, WHOLE);
    expect(dragStart.webcam?.segments[1]?.start).toBe(20);
    const dragEnd = dragWebcamSegmentEdge(scene, id!, "end", 25.2, WHOLE);
    expect(dragEnd.webcam?.segments[1]?.end).toBe(26);
    expect(dragWebcamSegmentEdge(scene, "nope", "end", 40, WHOLE)).toBe(scene);
  });
});

describe("removeWebcamSegment", () => {
  it("removes a segment, and is a no-op for an unknown id", () => {
    const { scene, id } = addWebcamSegment(
      withWebcam(),
      { start: 10, end: 20, mode: "hidden" },
      WHOLE,
    );
    expect(removeWebcamSegment(scene, id!).webcam?.segments).toEqual([]);
    expect(removeWebcamSegment(scene, "nope")).toBe(scene);
  });
});

describe("the edits through webcamAt", () => {
  it("a hidden segment hides the layer only inside its window", () => {
    const { scene } = addWebcamSegment(withWebcam(), { start: 10, end: 20, mode: "hidden" }, WHOLE);
    expect(webcamAt(scene, 15)).toBeNull();
    expect(webcamAt(scene, 25)).toEqual(scene.webcam?.layout);
  });
});

const withSegments = (segments: WebcamScene["segments"]): VideoScene => {
  const scene = withWebcam();
  return { ...scene, webcam: { ...scene.webcam!, segments } };
};

describe("createWebcamPart", () => {
  const at = (t: number) => ({ at: t, position: { x: 0.8, y: 0.2 } });

  it("a part at 24 s in a free 60 s recording ends at 34", () => {
    const { scene, id } = createWebcamPart(withWebcam(), at(24), WHOLE);
    expect(id).toEqual(expect.any(String));
    expect(scene.webcam?.segments).toEqual([
      expect.objectContaining({ id, start: 24, end: 34, mode: "override" }),
    ]);
  });

  it("stops at the next block", () => {
    const base = withSegments([{ id: "n", start: 30, end: 40, mode: "override" }]);
    const { scene } = createWebcamPart(base, at(24), WHOLE);
    expect(scene.webcam?.segments.map((s) => [s.start, s.end])).toEqual([
      [24, 30],
      [30, 40],
    ]);
  });

  it("is refused with a block starting at 24.5, under the minimum, and returns the same scene", () => {
    const base = withSegments([{ id: "n", start: 24.5, end: 40, mode: "override" }]);
    const result = createWebcamPart(base, at(24), WHOLE);
    expect(result.id).toBeNull();
    expect(result.scene).toBe(base);
  });

  it("ends at the end of the recording when that comes first", () => {
    const { scene } = createWebcamPart(withWebcam(), at(24), { start: 0, end: 28 });
    expect(scene.webcam?.segments.map((s) => [s.start, s.end])).toEqual([[24, 28]]);
  });

  it("is refused inside an existing block, hidden or not", () => {
    const base = withSegments([
      { id: "a", start: 10, end: 20, mode: "override" },
      { id: "h", start: 30, end: 35, mode: "hidden" },
    ]);
    for (const t of [12, 32]) {
      const result = createWebcamPart(base, at(t), WHOLE);
      expect(result.id).toBeNull();
      expect(result.scene).toBe(base);
    }
  });

  it("is refused with less than the minimum before the end of the recording", () => {
    const base = withWebcam();
    const result = createWebcamPart(base, at(DURATION - 0.5), WHOLE);
    expect(result.id).toBeNull();
    expect(result.scene).toBe(base);
  });

  it("does nothing on a recording without a webcam", () => {
    const scene = initialScene(DURATION);
    const result = createWebcamPart(scene, at(5), WHOLE);
    expect(result.id).toBeNull();
    expect(result.scene).toBe(scene);
  });

  it("stores the dropped position explicitly, and a copy of the default transition", () => {
    const { scene } = createWebcamPart(withWebcam(), at(20), WHOLE);
    const block = scene.webcam!.segments[0];
    expect(block.layout).toEqual({ position: { x: 0.8, y: 0.2 } });
    expect(block.transition).toEqual(WEBCAM_TRANSITION_DEFAULTS);
    expect(block.transition).not.toBe(WEBCAM_TRANSITION_DEFAULTS);
  });

  it("clamps a dropped position outside the frame", () => {
    const { scene } = createWebcamPart(withWebcam(), { at: 20, position: { x: 4, y: -3 } }, WHOLE);
    const { x, y } = scene.webcam!.segments[0].layout!.position!;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(1);
  });

  it("does not move when the default position changes afterwards", () => {
    const { scene } = createWebcamPart(withWebcam(), at(20), WHOLE);
    const before = webcamAt(scene, 25)!.position;
    const moved = setWebcamLayout(scene, { position: { x: 0.9, y: 0.1 } });
    expect(webcamAt(moved, 25)!.position).toEqual(before);
    expect(webcamAt(moved, 5)!.position).toEqual({ x: 0.9, y: 0.1 });
  });
});

describe("webcamPartRoom", () => {
  it("gives the window the part would take, and null when there is no room", () => {
    const base = withSegments([{ id: "n", start: 30, end: 40, mode: "override" }]);
    expect(webcamPartRoom(base, 10, WHOLE)).toEqual({ start: 10, end: 20 });
    expect(webcamPartRoom(base, 24, WHOLE)).toEqual({ start: 24, end: 30 });
    expect(webcamPartRoom(base, 29.5, WHOLE)).toBeNull();
    expect(webcamPartRoom(base, 35, WHOLE)).toBeNull();
    expect(webcamPartRoom(withWebcam(), 55, WHOLE)).toEqual({ start: 55, end: 60 });
    expect(webcamPartRoom(initialScene(DURATION), 5, WHOLE)).toBeNull();
  });
});

describe("setWebcamTransition", () => {
  const scene = (transition?: WebcamScene["segments"][number]["transition"]): VideoScene =>
    withSegments([{ id: "o", start: 10, end: 30, mode: "override", transition }]);

  it("changes one field and keeps the others", () => {
    const base = scene({ kind: "slide", ms: 700, easing: "back" });
    const next = setWebcamTransition(base, "o", { easing: "linear" });
    expect(next.webcam!.segments[0].transition).toEqual({
      kind: "slide",
      ms: 700,
      easing: "linear",
    });
  });

  it("clamps the duration to 100 to 2000 ms", () => {
    const base = scene({ kind: "slide", ms: 700, easing: "back" });
    expect(setWebcamTransition(base, "o", { ms: 5000 }).webcam!.segments[0].transition?.ms).toBe(
      2000,
    );
    expect(setWebcamTransition(base, "o", { ms: 10 }).webcam!.segments[0].transition?.ms).toBe(100);
  });

  it("turns a block without a transition into a slide with the defaults", () => {
    const next = setWebcamTransition(scene(), "o", { kind: "slide" });
    expect(next.webcam!.segments[0].transition).toEqual(WEBCAM_TRANSITION_DEFAULTS);
  });

  it("keeps the duration and easing when switching to Cut and back", () => {
    const base = scene({ kind: "slide", ms: 900, easing: "ease-out" });
    const cut = setWebcamTransition(base, "o", { kind: "cut" });
    expect(cut.webcam!.segments[0].transition).toEqual({
      kind: "cut",
      ms: 900,
      easing: "ease-out",
    });
    const back = setWebcamTransition(cut, "o", { kind: "slide" });
    expect(back.webcam!.segments[0].transition).toEqual({
      kind: "slide",
      ms: 900,
      easing: "ease-out",
    });
  });

  it("returns the same scene when nothing changes", () => {
    const base = scene({ kind: "slide", ms: 700, easing: "back" });
    expect(setWebcamTransition(base, "o", {})).toBe(base);
    expect(setWebcamTransition(base, "o", { ms: 700 })).toBe(base);
    expect(setWebcamTransition(base, "o", { ms: 700.2 })).toBe(base);
    // No transition is already a Cut.
    const absent = scene();
    expect(setWebcamTransition(absent, "o", { kind: "cut" })).toBe(absent);
  });

  it("does nothing for a hidden block, an unknown id or no webcam", () => {
    const hidden = withSegments([{ id: "h", start: 10, end: 30, mode: "hidden" }]);
    expect(setWebcamTransition(hidden, "h", { kind: "slide" })).toBe(hidden);
    const base = scene();
    expect(setWebcamTransition(base, "zzz", { kind: "slide" })).toBe(base);
    const none = initialScene(DURATION);
    expect(setWebcamTransition(none, "o", { kind: "slide" })).toBe(none);
  });
});
