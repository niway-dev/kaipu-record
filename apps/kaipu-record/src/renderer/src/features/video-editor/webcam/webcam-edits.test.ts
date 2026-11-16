import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_BUBBLE } from "@shared/camera-bubble";
import { initialScene, type VideoScene } from "../scene";
import {
  addWebcamSegment,
  changeWebcamFrom,
  createWebcamBlock,
  dragWebcamSegmentEdge,
  removeWebcamSegment,
  setWebcamLayout,
  setWebcamTransition,
  splitWebcamBlock,
  updateWebcamSegment,
} from "./webcam-edits";
import { WEBCAM_TRANSITION_DEFAULTS, webcamAt, type WebcamScene } from "./webcam-model";

const DURATION = 60;
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
    ({ scene } = addWebcamSegment(scene, { start: 20, end: 25, mode: "hidden" }, DURATION));
    const added = addWebcamSegment(scene, { start: 5, end: 8, mode: "hidden" }, DURATION);
    expect(added.id).toEqual(expect.any(String));
    expect(added.scene.webcam?.segments.map((s) => s.start)).toEqual([5, 20]);
  });

  it("adds an override with its clamped partial layout", () => {
    const { scene, id } = addWebcamSegment(
      withWebcam(),
      { start: 5, end: 9, mode: "override", layout: { size: 0.9 } },
      DURATION,
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
      DURATION,
    ).scene;
    for (const window of [
      { start: 1, end: 1.5 },
      { start: 12, end: 18 },
      { start: 8, end: 11 },
      { start: 59.5, end: 62 },
      { start: -2, end: 1 },
    ]) {
      const result = addWebcamSegment(base, { ...window, mode: "hidden" }, DURATION);
      expect(result.scene).toBe(base);
      expect(result.id).toBeNull();
    }
  });

  it("refuses on a recording without a webcam", () => {
    const scene = initialScene(DURATION);
    expect(addWebcamSegment(scene, { start: 1, end: 3, mode: "hidden" }, DURATION)).toEqual({
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
      DURATION,
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

describe("dragWebcamSegmentEdge", () => {
  it("moves an edge but never into a neighbour or under the minimum", () => {
    let scene = withWebcam();
    ({ scene } = addWebcamSegment(scene, { start: 10, end: 20, mode: "hidden" }, DURATION));
    let id: string | null;
    ({ scene, id } = addWebcamSegment(scene, { start: 25, end: 30, mode: "hidden" }, DURATION));
    const dragStart = dragWebcamSegmentEdge(scene, id!, "start", 5, DURATION);
    expect(dragStart.webcam?.segments[1]?.start).toBe(20);
    const dragEnd = dragWebcamSegmentEdge(scene, id!, "end", 25.2, DURATION);
    expect(dragEnd.webcam?.segments[1]?.end).toBe(26);
    expect(dragWebcamSegmentEdge(scene, "nope", "end", 40, DURATION)).toBe(scene);
  });
});

describe("removeWebcamSegment", () => {
  it("removes a segment, and is a no-op for an unknown id", () => {
    const { scene, id } = addWebcamSegment(
      withWebcam(),
      { start: 10, end: 20, mode: "hidden" },
      DURATION,
    );
    expect(removeWebcamSegment(scene, id!).webcam?.segments).toEqual([]);
    expect(removeWebcamSegment(scene, "nope")).toBe(scene);
  });
});

describe("the edits through webcamAt", () => {
  it("a hidden segment hides the layer only inside its window", () => {
    const { scene } = addWebcamSegment(
      withWebcam(),
      { start: 10, end: 20, mode: "hidden" },
      DURATION,
    );
    expect(webcamAt(scene, 15)).toBeNull();
    expect(webcamAt(scene, 25)).toEqual(scene.webcam?.layout);
  });
});

const withSegments = (segments: WebcamScene["segments"]): VideoScene => {
  const scene = withWebcam();
  return { ...scene, webcam: { ...scene.webcam!, segments } };
};

describe("createWebcamBlock", () => {
  it("starts at the playhead and runs to the end of the recording", () => {
    const { scene, id } = createWebcamBlock(withWebcam(), 20, DURATION);
    expect(id).toEqual(expect.any(String));
    expect(scene.webcam?.segments).toEqual([
      expect.objectContaining({ id, start: 20, end: DURATION, mode: "override" }),
    ]);
  });

  it("stops at the next block", () => {
    const base = withSegments([{ id: "n", start: 30, end: 40, mode: "override" }]);
    const { scene } = createWebcamBlock(base, 10, DURATION);
    expect(scene.webcam?.segments.map((s) => [s.start, s.end])).toEqual([
      [10, 30],
      [30, 40],
    ]);
  });

  it("stores the position in force, explicitly, and the default transition", () => {
    const base = withWebcam();
    const { scene } = createWebcamBlock(base, 20, DURATION);
    const block = scene.webcam!.segments[0];
    expect(block.layout).toEqual({ position: base.webcam!.layout.position });
    expect(block.transition).toEqual(WEBCAM_TRANSITION_DEFAULTS);
  });

  it("does not move when the default position changes afterwards", () => {
    const { scene } = createWebcamBlock(withWebcam(), 20, DURATION);
    const before = webcamAt(scene, 25)!.position;
    const moved = setWebcamLayout(scene, { position: { x: 0.9, y: 0.1 } });
    expect(webcamAt(moved, 25)!.position).toEqual(before);
    expect(webcamAt(moved, 5)!.position).toEqual({ x: 0.9, y: 0.1 });
  });

  it("refuses inside a block, with less than the minimum before the next block or the end", () => {
    const base = withSegments([
      { id: "a", start: 10, end: 20, mode: "override" },
      { id: "h", start: 30, end: 35, mode: "hidden" },
    ]);
    expect(createWebcamBlock(base, 12, DURATION)).toEqual({ scene: base, id: null });
    expect(createWebcamBlock(base, 32, DURATION)).toEqual({ scene: base, id: null });
    expect(createWebcamBlock(base, 29.5, DURATION)).toEqual({ scene: base, id: null });
    expect(createWebcamBlock(base, DURATION - 0.5, DURATION)).toEqual({ scene: base, id: null });
  });

  it("does nothing on a recording without a webcam", () => {
    const scene = initialScene(DURATION);
    expect(createWebcamBlock(scene, 5, DURATION)).toEqual({ scene, id: null });
  });
});

describe("splitWebcamBlock", () => {
  const block = (): VideoScene =>
    withSegments([
      {
        id: "o",
        start: 10,
        end: 30,
        mode: "override",
        layout: { position: { x: 0.8, y: 0.2 }, size: 0.4 },
        transition: { kind: "slide", ms: 1200, easing: "linear" },
      },
    ]);

  it("splits at the playhead: the left part keeps the block, the right part is new", () => {
    const { scene, id } = splitWebcamBlock(block(), 18);
    const [left, right] = scene.webcam!.segments;
    expect(left).toMatchObject({ id: "o", start: 10, end: 18, mode: "override" });
    expect(left.transition).toEqual({ kind: "slide", ms: 1200, easing: "linear" });
    expect(right).toMatchObject({ id, start: 18, end: 30, mode: "override" });
    expect(id).not.toBe("o");
  });

  it("starts the right part with the same position and fields, as its own copy", () => {
    const { scene } = splitWebcamBlock(block(), 18);
    const [left, right] = scene.webcam!.segments;
    expect(right.layout).toEqual(left.layout);
    expect(right.layout).not.toBe(left.layout);
    expect(right.layout!.position).not.toBe(left.layout!.position);
    // Nothing moves on screen at the split.
    expect(webcamAt(scene, 17.9)!.position).toEqual(webcamAt(scene, 18)!.position);
  });

  it("gives the right part the default transition", () => {
    const { scene } = splitWebcamBlock(block(), 18);
    expect(scene.webcam!.segments[1].transition).toEqual(WEBCAM_TRANSITION_DEFAULTS);
  });

  it("refuses when either part would be shorter than the minimum", () => {
    const base = block();
    expect(splitWebcamBlock(base, 10.5)).toEqual({ scene: base, id: null });
    expect(splitWebcamBlock(base, 29.5)).toEqual({ scene: base, id: null });
    expect(splitWebcamBlock(base, 11).id).toEqual(expect.any(String));
    expect(splitWebcamBlock(base, 29).id).toEqual(expect.any(String));
  });

  it("refuses outside a block and inside a hidden one", () => {
    const base = withSegments([{ id: "h", start: 10, end: 30, mode: "hidden" }]);
    expect(splitWebcamBlock(base, 20)).toEqual({ scene: base, id: null });
    expect(splitWebcamBlock(base, 40)).toEqual({ scene: base, id: null });
  });
});

describe("changeWebcamFrom", () => {
  const base = withSegments([
    { id: "o", start: 10, end: 30, mode: "override" },
    { id: "h", start: 40, end: 50, mode: "hidden" },
  ]);

  it("creates a block outside every block", () => {
    const result = changeWebcamFrom(base, 32, DURATION);
    expect(result).toMatchObject({ ok: true, kind: "create" });
    expect(result.scene.webcam!.segments.map((s) => [s.start, s.end])).toEqual([
      [10, 30],
      [32, 40],
      [40, 50],
    ]);
  });

  it("splits inside a block", () => {
    const result = changeWebcamFrom(base, 20, DURATION);
    expect(result).toMatchObject({ ok: true, kind: "split" });
    expect(result.scene.webcam!.segments.map((s) => [s.start, s.end])).toEqual([
      [10, 20],
      [20, 30],
      [40, 50],
    ]);
  });

  it("says why it cannot", () => {
    expect(changeWebcamFrom(base, 45, DURATION)).toMatchObject({ ok: false, reason: "hidden" });
    expect(changeWebcamFrom(base, 39.5, DURATION)).toMatchObject({
      ok: false,
      reason: "no-room",
    });
    expect(changeWebcamFrom(base, 10.5, DURATION)).toMatchObject({
      ok: false,
      reason: "no-room",
    });
    expect(changeWebcamFrom(initialScene(DURATION), 5, DURATION)).toMatchObject({
      ok: false,
      reason: "no-room",
    });
  });

  it("returns the same scene when it cannot", () => {
    expect(changeWebcamFrom(base, 45, DURATION).scene).toBe(base);
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
