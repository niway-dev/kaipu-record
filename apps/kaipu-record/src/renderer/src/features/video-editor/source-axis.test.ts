import { describe, expect, it } from "vitest";
import { initialScene, type SceneSource, type TrackItem, type VideoScene } from "./scene";
import {
  AXIS_GAP_SECONDS,
  AXIS_GRID_SECONDS,
  clipBounds,
  joinRecording,
  nextOffset,
  recordingAt,
  resolveAt,
  sourceAxis,
} from "./source-axis";
import { layoutDuration, toLayout } from "./timeline";

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
});

const slide = (id: string, duration: number): TrackItem => ({
  id,
  kind: "slide",
  assetId: `asset-${id}`,
  duration,
  naturalWidth: 800,
  naturalHeight: 600,
});

const source = (id: string, offset: number, durationSeconds: number): SceneSource => ({
  id,
  assetId: `asset-${id}`,
  title: id,
  offset,
  durationSeconds,
  width: 1920,
  height: 1080,
});

const INPUT = {
  assetId: "lib-b",
  title: "Recording B",
  durationSeconds: 10,
  width: 1280,
  height: 720,
};

describe("sourceAxis", () => {
  it("lists the opened recording first, then the joins sorted by offset", () => {
    const axis = sourceAxis(120, [source("c", 7200, 30), source("b", 3600, 10)]);
    expect(axis.recordings).toEqual([
      { sourceId: null, offset: 0, duration: 120 },
      { sourceId: "b", offset: 3600, duration: 10 },
      { sourceId: "c", offset: 7200, duration: 30 },
    ]);
  });

  it("is only the opened recording without sources", () => {
    expect(sourceAxis(60).recordings).toEqual([{ sourceId: null, offset: 0, duration: 60 }]);
  });
});

describe("recordingAt", () => {
  const axis = sourceAxis(100, [source("b", 3600, 10)]);

  it("finds a recording at both ends of its range", () => {
    expect(recordingAt(axis, 0)).toMatchObject({ recording: { sourceId: null }, localTime: 0 });
    expect(recordingAt(axis, 100)).toMatchObject({ recording: { sourceId: null }, localTime: 100 });
    expect(recordingAt(axis, 3600)).toMatchObject({ recording: { sourceId: "b" }, localTime: 0 });
    expect(recordingAt(axis, 3610)).toMatchObject({ recording: { sourceId: "b" }, localTime: 10 });
  });

  it("returns the local second inside a range", () => {
    expect(recordingAt(axis, 3604.5)?.localTime).toBeCloseTo(4.5);
  });

  it("is null inside the gap, before 0 and after the last range", () => {
    expect(recordingAt(axis, 100.01)).toBeNull();
    expect(recordingAt(axis, 3599.99)).toBeNull();
    expect(recordingAt(axis, -0.01)).toBeNull();
    expect(recordingAt(axis, 3610.01)).toBeNull();
  });
});

describe("resolveAt", () => {
  // Timeline: A[0..5] 0–5, B[3600..3610] 5–15, A[5..8] 15–18.
  const axis = sourceAxis(100, [source("b", 3600, 20)]);
  const layout = toLayout([clip("a1", 0, 5), clip("b1", 3600, 3610), clip("a2", 5, 8)]);

  it("maps each timeline time to its recording and local second", () => {
    const at = (t: number) => {
      const r = resolveAt(layout, axis, t)!;
      return [r.entry.itemId, r.recording?.sourceId, r.axisTime, r.localTime];
    };
    expect(at(0)).toEqual(["a1", null, 0, 0]);
    expect(at(4.99)).toEqual(["a1", null, 4.99, 4.99]);
    expect(at(5)).toEqual(["b1", "b", 3600, 0]);
    expect(at(14.99)[0]).toBe("b1");
    expect(at(14.99)[3]).toBeCloseTo(9.99);
    expect(at(15)).toEqual(["a2", null, 5, 5]);
    expect(at(18)).toEqual(["a2", null, 8, 8]);
  });

  it("gives no recording on a slide and its local clock as the time", () => {
    const withSlide = toLayout([clip("a1", 0, 5), slide("s", 4), clip("b1", 3600, 3610)]);
    const r = resolveAt(withSlide, axis, 7)!;
    expect(r.entry.itemId).toBe("s");
    expect(r.recording).toBeNull();
    expect(r.axisTime).toBeCloseTo(2);
    expect(r.localTime).toBeCloseTo(2);
  });

  it("is null on an empty layout", () => {
    expect(resolveAt([], axis, 0)).toBeNull();
  });
});

describe("clipBounds", () => {
  const axis = sourceAxis(100, [source("b", 3600, 20)]);

  it("is the range of the recording holding the clip's start", () => {
    expect(clipBounds(axis, { sourceStart: 12 })).toEqual({ start: 0, end: 100 });
    expect(clipBounds(axis, { sourceStart: 3605 })).toEqual({ start: 3600, end: 3620 });
  });

  it("falls back to the whole axis when no range holds the clip", () => {
    expect(clipBounds(axis, { sourceStart: 500 })).toEqual({ start: 0, end: Infinity });
  });
});

describe("nextOffset", () => {
  it("is the next whole hour after the opened recording plus a minute", () => {
    expect(AXIS_GRID_SECONDS).toBe(3600);
    expect(AXIS_GAP_SECONDS).toBe(60);
    expect(nextOffset(sourceAxis(120))).toBe(3600);
  });

  it("skips to the following hour when the minute spills over", () => {
    expect(nextOffset(sourceAxis(3550))).toBe(7200);
  });

  it("starts after the last existing join", () => {
    expect(nextOffset(sourceAxis(120, [source("b", 3600, 100)]))).toBe(7200);
  });
});

describe("joinRecording", () => {
  const base = (): VideoScene => ({
    ...initialScene(0),
    items: [clip("a1", 0, 10), clip("a2", 10, 20)],
  });

  it("refuses a recording shorter than the shortest clip", () => {
    expect(() => joinRecording(base(), 20, { ...INPUT, durationSeconds: 0.05 }, 8)).toThrow(
      RangeError,
    );
  });

  it("inserts one clip over the whole recording at the nearest clip boundary", () => {
    const scene = base();
    const { scene: next, source: joined } = joinRecording(scene, 20, INPUT, 8);
    expect(joined).toMatchObject({
      assetId: "lib-b",
      title: "Recording B",
      offset: 3600,
      durationSeconds: 10,
      width: 1280,
      height: 720,
    });
    expect(next.sources).toEqual([joined]);
    expect(next.items.map((i) => i.kind === "clip" && [i.sourceStart, i.sourceEnd])).toEqual([
      [0, 10],
      [3600, 3610],
      [10, 20],
    ]);
    expect(layoutDuration(toLayout(next.items))).toBe(layoutDuration(toLayout(scene.items)) + 10);
  });

  it("goes to the start or the end when t is nearest to them", () => {
    expect(joinRecording(base(), 20, INPUT, 1).scene.items[0]).toMatchObject({ sourceStart: 3600 });
    const atEnd = joinRecording(base(), 20, INPUT, 19).scene.items;
    expect(atEnd[atEnd.length - 1]).toMatchObject({ sourceStart: 3600, sourceEnd: 3610 });
  });

  it("does not mutate the input scene", () => {
    const scene = base();
    joinRecording(scene, 20, INPUT, 8);
    expect(scene.sources).toBeUndefined();
    expect(scene.items).toHaveLength(2);
  });

  it("joining the same asset twice makes two independent sources", () => {
    const once = joinRecording(base(), 20, INPUT, 5);
    const twice = joinRecording(once.scene, 20, INPUT, 5);
    expect(twice.scene.sources).toHaveLength(2);
    expect(twice.scene.sources!.map((s) => s.offset)).toEqual([3600, 7200]);
    expect(twice.source.id).not.toBe(once.source.id);
    expect(twice.scene.sources![0].assetId).toBe(twice.scene.sources![1].assetId);
  });

  it("counts the boundary in items even when the layout skips an empty item", () => {
    const scene: VideoScene = {
      ...base(),
      items: [clip("a1", 0, 10), clip("empty", 5, 5), clip("a2", 10, 20)],
    };
    const { scene: next, source: joined } = joinRecording(scene, 20, INPUT, 10);
    const joinedClip = next.items.find(
      (i) => i.kind === "clip" && i.sourceStart === joined.offset,
    )!;
    expect(next.items.map((i) => (i === joinedClip ? "joined" : i.id))).toEqual([
      "a1",
      "joined",
      "empty",
      "a2",
    ]);
  });
});
