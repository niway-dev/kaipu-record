import { describe, expect, it } from "vitest";
import {
  clipRecordings,
  noCameraItemIds,
  recordingBoundaries,
  recordingsNeedingThumbnails,
  sameRecordingItemIds,
  type RecordingInfo,
} from "./clip-recordings";
import type { SceneSource, TrackItem } from "./scene";
import { sourceAxis } from "./source-axis";
import { toLayout } from "./timeline";

const joined: SceneSource = {
  id: "src-b",
  assetId: "asset-b",
  title: "Checkout bug",
  offset: 3600,
  durationSeconds: 14,
  width: 1920,
  height: 1080,
};
const axis = sourceAxis(30, [joined]);

// Clips alternate A, B, A: the opened recording is [0, 30], the joined one [3600, 3614].
const items: TrackItem[] = [
  { id: "a1", kind: "clip", sourceStart: 0, sourceEnd: 14 },
  { id: "b1", kind: "clip", sourceStart: 3600, sourceEnd: 3614 },
  { id: "a2", kind: "clip", sourceStart: 14, sourceEnd: 25 },
];
const layout = toLayout(items);

const infos = (over: Partial<RecordingInfo> = {}): RecordingInfo[] => [
  { sourceId: null, title: "Onboarding demo", status: "ready", hasWebcam: true },
  { sourceId: "src-b", title: "Checkout bug", status: "ready", hasWebcam: false, ...over },
];

describe("clipRecordings", () => {
  it("is null for a scene without joined recordings", () => {
    expect(clipRecordings(layout, sourceAxis(30), infos().slice(0, 1))).toBeNull();
  });

  it("maps every clip to its recording and the range's offset", () => {
    const map = clipRecordings(layout, axis, infos())!;
    expect(map.get("a1")).toMatchObject({ sourceId: null, title: "Onboarding demo", offset: 0 });
    expect(map.get("b1")).toMatchObject({
      sourceId: "src-b",
      title: "Checkout bug",
      status: "ready",
      hasWebcam: false,
      offset: 3600,
    });
    expect(map.get("a2")).toMatchObject({ sourceId: null, offset: 0 });
  });

  it("skips slides and clips no range holds", () => {
    const withSlide = toLayout([
      {
        id: "s",
        kind: "slide",
        assetId: "img",
        duration: 2,
        naturalWidth: 100,
        naturalHeight: 100,
      },
      { id: "legacy", kind: "clip", sourceStart: 1000, sourceEnd: 1005 },
      ...items,
    ]);
    const map = clipRecordings(withSlide, axis, infos())!;
    expect(map.has("s")).toBe(false);
    expect(map.has("legacy")).toBe(false);
    expect(map.has("b1")).toBe(true);
  });
});

describe("sameRecordingItemIds", () => {
  it("returns every clip of the hovered clip's recording, itself included", () => {
    const map = clipRecordings(layout, axis, infos());
    expect([...sameRecordingItemIds(map, "a1")].sort()).toEqual(["a1", "a2"]);
    expect([...sameRecordingItemIds(map, "b1")]).toEqual(["b1"]);
  });

  it("is empty with nothing hovered or without joins", () => {
    const map = clipRecordings(layout, axis, infos());
    expect(sameRecordingItemIds(map, null).size).toBe(0);
    expect(sameRecordingItemIds(null, "a1").size).toBe(0);
  });
});

describe("noCameraItemIds", () => {
  it("covers the clips of a ready recording without a webcam when another has one", () => {
    expect([...noCameraItemIds(clipRecordings(layout, axis, infos()), true)]).toEqual(["b1"]);
  });

  it("covers nothing when no recording has a webcam", () => {
    const map = clipRecordings(
      layout,
      axis,
      infos().map((i) => ({ ...i, hasWebcam: false })),
    );
    expect(noCameraItemIds(map, false).size).toBe(0);
  });

  it("does not call a loading or missing recording 'no camera'", () => {
    for (const status of ["loading", "missing"] as const) {
      expect(noCameraItemIds(clipRecordings(layout, axis, infos({ status })), true).size).toBe(0);
    }
  });
});

describe("recordingBoundaries", () => {
  it("lists where adjacent clips belong to different recordings", () => {
    expect(recordingBoundaries(layout, clipRecordings(layout, axis, infos()))).toEqual([14, 28]);
  });

  it("is empty without joins", () => {
    expect(recordingBoundaries(layout, null)).toEqual([]);
  });
});

describe("recordingsNeedingThumbnails", () => {
  const durations = new Map([["src-b", 14]]);

  it("asks for a ready joined recording that still has a clip", () => {
    const map = clipRecordings(layout, axis, infos());
    expect(recordingsNeedingThumbnails(map, durations)).toEqual([
      { sourceId: "src-b", durationSeconds: 14 },
    ]);
  });

  it("asks for nothing once its clips are deleted, or while loading or missing", () => {
    const withoutB = toLayout(items.filter((i) => i.id !== "b1"));
    expect(recordingsNeedingThumbnails(clipRecordings(withoutB, axis, infos()), durations)).toEqual(
      [],
    );
    for (const status of ["loading", "missing"] as const) {
      expect(
        recordingsNeedingThumbnails(clipRecordings(layout, axis, infos({ status })), durations),
      ).toEqual([]);
    }
  });
});
