import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_BUBBLE } from "@shared/camera-bubble";
import { initialScene, type VideoScene } from "../scene";
import {
  addWebcamSegment,
  dragWebcamSegmentEdge,
  removeWebcamSegment,
  setWebcamLayout,
  updateWebcamSegment,
} from "./webcam-edits";
import { webcamAt } from "./webcam-model";

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
    expect(next.webcam?.layout).toMatchObject({ size: 0.6, position: { x: 1, y: 0 } });
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
      layout: { size: 0.6 },
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
    expect(next.webcam?.segments[0]?.layout).toEqual({ size: 0.6, shadow: false });
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
