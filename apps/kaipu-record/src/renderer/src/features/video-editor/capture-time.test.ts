import { describe, expect, it } from "vitest";
import {
  axisSecondsOfCapture,
  captureOriginAt,
  captureTitleTime,
  findCaptureAt,
  formatClock,
} from "./capture-time";
import type { SceneSource } from "./scene";
import { sourceAxis } from "./source-axis";

describe("formatClock", () => {
  it("prints minutes, seconds and tenths", () => {
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(9)).toBe("0:09.0");
    expect(formatClock(83.46)).toBe("1:23.4");
    expect(formatClock(3725.9)).toBe("62:05.9");
  });

  it("never goes negative", () => {
    expect(formatClock(-3)).toBe("0:00.0");
  });
});

describe("captureTitleTime", () => {
  it("is compact and has no character a file name refuses", () => {
    expect(captureTitleTime(0)).toBe("0s");
    expect(captureTitleTime(45.9)).toBe("45s");
    expect(captureTitleTime(83)).toBe("1m23s");
    expect(captureTitleTime(600)).toBe("10m00s");
    expect(captureTitleTime(3725)).toBe("1h02m05s");
  });
});

describe("findCaptureAt", () => {
  const captures = [
    { id: "a", sourceTimeSeconds: 12.3454 },
    { id: "slide", sourceTimeSeconds: null },
  ];
  it("matches the same millisecond", () => {
    expect(findCaptureAt(captures, 12.3454)?.id).toBe("a");
    expect(findCaptureAt(captures, 12.3451)?.id).toBe("a");
  });
  it("does not match one millisecond apart", () => {
    expect(findCaptureAt(captures, 12.347)).toBeUndefined();
  });
  it("never matches a slide frame (null source second)", () => {
    expect(findCaptureAt(captures, null)).toBeUndefined();
  });

  describe("the same asset joined twice", () => {
    const copies = [
      { id: "opened", sourceTimeSeconds: 5 },
      { id: "legacy", sourceTimeSeconds: 6, sourceSceneSourceId: undefined },
      { id: "explicit-null", sourceTimeSeconds: 7, sourceSceneSourceId: null },
      { id: "second-copy", sourceTimeSeconds: 8, sourceSceneSourceId: "b2" },
    ];
    it("does not take a capture of another copy for a duplicate", () => {
      expect(findCaptureAt(copies, 8, "b1")).toBeUndefined();
      expect(findCaptureAt(copies, 8, null)).toBeUndefined();
      expect(findCaptureAt(copies, 5, "b2")).toBeUndefined();
    });
    it("matches the copy it names", () => {
      expect(findCaptureAt(copies, 8, "b2")?.id).toBe("second-copy");
    });
    it("treats an absent or null link as the opened recording", () => {
      expect(findCaptureAt(copies, 5, null)?.id).toBe("opened");
      expect(findCaptureAt(copies, 6, null)?.id).toBe("legacy");
      expect(findCaptureAt(copies, 7, null)?.id).toBe("explicit-null");
      expect(findCaptureAt(copies, 5)?.id).toBe("opened");
    });
  });
});

describe("capture origin over joined recordings (ADR 0058)", () => {
  const source = (id: string, assetId: string, offset: number): SceneSource => ({
    id,
    assetId,
    title: id,
    offset,
    durationSeconds: 40,
    width: 1280,
    height: 720,
  });
  const sources = [source("B", "asset-b", 3600), source("C", "asset-c", 7200)];
  const axis = sourceAxis(100, sources);

  it("names the opened recording and the same second for a frame inside its range", () => {
    expect(captureOriginAt(axis, sources, "asset-a", 42.5)).toEqual({
      sourceId: null,
      assetId: "asset-a",
      localSeconds: 42.5,
    });
  });

  it("names the joined recording and the LOCAL second for a frame inside its range", () => {
    expect(captureOriginAt(axis, sources, "asset-a", 3612.25)).toEqual({
      sourceId: "B",
      assetId: "asset-b",
      localSeconds: 12.25,
    });
  });

  it("has no origin for a slide or for a second no recording holds", () => {
    expect(captureOriginAt(axis, sources, "asset-a", null)).toBeNull();
    expect(captureOriginAt(axis, sources, "asset-a", 500)).toBeNull();
  });

  it("maps a joined capture back to the axis: offset plus its seconds", () => {
    expect(axisSecondsOfCapture(sources, "asset-a", "asset-c", 3)).toBe(7203);
  });

  it("keeps an opened capture's seconds as they are, and wins over a joined copy of the same asset", () => {
    const twice = [...sources, source("D", "asset-a", 9000)];
    expect(axisSecondsOfCapture(twice, "asset-a", "asset-a", 5)).toBe(5);
  });

  describe("the same asset joined twice", () => {
    const twice = [source("b1", "asset-b", 100), source("b2", "asset-b", 500)];

    it("places a capture on the copy its link names", () => {
      expect(axisSecondsOfCapture(twice, "asset-a", "asset-b", 7, "b2")).toBe(507);
      expect(axisSecondsOfCapture(twice, "asset-a", "asset-b", 7, "b1")).toBe(107);
    });
    it("keeps today's first-copy placement when the link names no copy", () => {
      expect(axisSecondsOfCapture(twice, "asset-a", "asset-b", 7)).toBe(107);
      expect(axisSecondsOfCapture(twice, "asset-a", "asset-b", 7, undefined)).toBe(107);
    });
    it("keeps today's placement for an id that is not in this scene", () => {
      expect(axisSecondsOfCapture(twice, "asset-a", "asset-b", 7, "gone")).toBe(107);
    });
    it("keeps today's placement for an id whose asset does not match the link", () => {
      expect(axisSecondsOfCapture(twice, "asset-a", "asset-c", 7, "b2")).toBeNull();
    });
    it("keeps the opened recording for a null link", () => {
      expect(axisSecondsOfCapture(twice, "asset-a", "asset-a", 7, null)).toBe(7);
    });
    it("places a capture of a joined copy of the opened asset on that copy", () => {
      const sameAsOpened = [source("b2", "asset-a", 500)];
      expect(axisSecondsOfCapture(sameAsOpened, "asset-a", "asset-a", 7, "b2")).toBe(507);
      expect(axisSecondsOfCapture(sameAsOpened, "asset-a", "asset-a", 7, null)).toBe(7);
    });
  });

  it("has no axis second for an asset the scene does not hold", () => {
    expect(axisSecondsOfCapture(sources, "asset-a", "asset-z", 5)).toBeNull();
    expect(axisSecondsOfCapture(undefined, "asset-a", "asset-z", 5)).toBeNull();
  });

  it("round-trips a frame through its origin and back to the axis", () => {
    const origin = captureOriginAt(axis, sources, "asset-a", 7231.5)!;
    expect(axisSecondsOfCapture(sources, "asset-a", origin.assetId, origin.localSeconds)).toBe(
      7231.5,
    );
  });
});
