import { describe, expect, it } from "vitest";
import {
  buildFilmstripTargets,
  frameForTile,
  legacyFrames,
  mergeTileFrames,
  tileSpanInFile,
} from "./filmstrip-targets";
import type { ThumbnailTile } from "./components/timeline-geometry";
import type { LayoutEntry } from "./timeline";

const clip = (over: Partial<LayoutEntry> = {}): LayoutEntry => ({
  itemId: "c1",
  kind: "clip",
  timelineStart: 0,
  timelineEnd: 100,
  sourceStart: 0,
  sourceEnd: 100,
  ...over,
});

/** A tile of a 100 s clip cut in 10: tile 3 is [30, 40) with its centre at 35. */
const tile = (index: number, count = 10, entry = clip()): ThumbnailTile => ({
  index,
  left: index / count,
  width: 1 / count,
  sourceTime: entry.sourceStart + ((index + 0.5) / count) * (entry.sourceEnd - entry.sourceStart),
});

describe("buildFilmstripTargets", () => {
  it("lists the clips of each file in the controller's shape, skipping slides and files with no clip", () => {
    const targets = buildFilmstripTargets([
      {
        binding: { fileKey: "kaipu-media://a", fileOffset: 0, legacyOffset: 0 },
        duration: 100,
        entries: [clip(), { ...clip({ itemId: "s1" }), kind: "slide" }],
        legacy: [
          { sourceTime: 20, url: "blob:l2" },
          { sourceTime: 10, url: "blob:l1" },
        ],
      },
      {
        binding: { fileKey: "kaipu-media://b", fileOffset: 0, legacyOffset: 0 },
        duration: 50,
        entries: [{ ...clip({ itemId: "s2" }), kind: "slide" }],
        legacy: [],
      },
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0].fileKey).toBe("kaipu-media://a");
    expect(targets[0].clips).toEqual([
      { timelineStart: 0, timelineEnd: 100, sourceStart: 0, sourceEnd: 100 },
    ]);
    expect(targets[0].legacy.map((f) => f.timestamp)).toEqual([10, 20]);
  });

  it("moves a webcam's legacy frames from source time into the file's own time", () => {
    expect(legacyFrames([{ sourceTime: 12, url: "x" }], 2)).toEqual([{ timestamp: 10, url: "x" }]);
  });
});

describe("mergeTileFrames", () => {
  it("interleaves store and legacy frames by timestamp and keeps the store's on a tie", () => {
    const merged = mergeTileFrames(
      [
        { timestamp: 5, bytes: 1, data: "s5" },
        { timestamp: 9, bytes: 1, data: "s9" },
      ],
      [
        { timestamp: 1, url: "l1" },
        { timestamp: 5, url: "l5" },
        { timestamp: 12, url: "l12" },
      ],
    );
    expect(merged.map((f) => f.url)).toEqual(["l1", "s5", "l5", "s9", "l12"]);
  });
});

describe("frameForTile", () => {
  const frames = [
    { timestamp: 2, url: "far" },
    { timestamp: 33, url: "inside" },
    { timestamp: 71, url: "other" },
  ];

  it("AC1: picks a frame inside the tile's own span, not the nearest one far away", () => {
    const picked = frameForTile({ frames, tile: tile(3), entry: clip(), fileOffset: 0 });
    expect(picked?.frame.url).toBe("inside");
    expect(picked!.span).toEqual({ start: 30, end: 40 });
  });

  it("reads the file's own time through the offset (AC2: the webcam's start offset)", () => {
    // The webcam file starts 5 s after the screen: its frame at 33 is the source's 38.
    const entry = clip();
    const picked = frameForTile({ frames, tile: tile(3, 10, entry), entry, fileOffset: 5 });
    // Tile 3 is source [30, 40) = file [25, 35): the frame at 33 is inside it.
    expect(picked!.span).toEqual({ start: 25, end: 35 });
    expect(picked?.frame.url).toBe("inside");
    // Read with no offset, the same tile is [30, 40) and the frame at 33 is inside it too, so
    // only the span tells the two apart: the offset moved it.
    const unshifted = frameForTile({ frames, tile: tile(3, 10, entry), entry, fileOffset: 0 });
    expect(unshifted!.span).toEqual({ start: 30, end: 40 });
  });

  it("AC4: never takes a frame from outside the clip while one inside exists", () => {
    const entry = clip({ sourceStart: 60, sourceEnd: 80 });
    const picked = frameForTile({ frames, tile: tile(0, 2, entry), entry, fileOffset: 0 });
    expect(picked?.frame.url).toBe("other");
  });

  it("AC4: is never empty while the file has any frame", () => {
    const entry = clip({ sourceStart: 10, sourceEnd: 20 });
    expect(frameForTile({ frames, tile: tile(0, 1, entry), entry, fileOffset: 0 })).not.toBeNull();
    expect(frameForTile({ frames: [], tile: tile(0), entry: clip(), fileOffset: 0 })).toBeNull();
  });

  it("stays empty for a tile outside the footage the file covers", () => {
    const covered = { start: 0, end: 20 };
    expect(
      frameForTile({ frames, tile: tile(3), entry: clip(), fileOffset: 0, covered }),
    ).toBeNull();
    expect(
      frameForTile({ frames, tile: tile(1), entry: clip(), fileOffset: 0, covered })?.frame.url,
    ).toBe("far");
  });

  it("tileSpanInFile is the tile's stretch of the clip around its centre", () => {
    const entry = clip({ sourceStart: 100, sourceEnd: 200 });
    expect(tileSpanInFile(tile(0, 4, entry), entry, 100)).toEqual({ start: 0, end: 25 });
  });
});
