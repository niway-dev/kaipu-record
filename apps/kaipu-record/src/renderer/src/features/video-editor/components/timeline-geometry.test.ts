import { describe, expect, it } from "vitest";
import {
  fractionToTime,
  formatScrubTime,
  rulerMinorTicks,
  rulerTicks,
  thumbnailAt,
  thumbnailTiles,
  timeToFraction,
} from "./timeline-geometry";

describe("time/fraction mapping", () => {
  it("maps and clamps", () => {
    expect(timeToFraction(5, 10)).toBe(0.5);
    expect(timeToFraction(-1, 10)).toBe(0);
    expect(timeToFraction(15, 10)).toBe(1);
    expect(timeToFraction(0, 0)).toBe(0); // zero-duration guard
    expect(fractionToTime(0.25, 60)).toBe(15);
  });
});

describe("rulerTicks", () => {
  it("picks a nice interval and includes 0", () => {
    const ticks = rulerTicks(90);
    expect(ticks[0]).toEqual({ time: 0, label: "0:00" });
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    expect(ticks.length).toBeLessThanOrEqual(11);
    expect(ticks.at(-1)!.time).toBeLessThanOrEqual(90);
  });

  it.each([10.5, 15, 101])(
    "keeps a reasonable tick count for short/edge durations (%s)",
    (duration) => {
      const ticks = rulerTicks(duration);
      expect(ticks.length).toBeGreaterThanOrEqual(5);
      expect(ticks.length).toBeLessThanOrEqual(11);
    },
  );
});

describe("rulerMinorTicks", () => {
  it("fills each labelled step with evenly spaced unlabelled ticks", () => {
    // 6 s → labelled every 1 s, minor every 0.25 s.
    const minor = rulerMinorTicks(6);
    expect(minor.slice(0, 4)).toEqual([0.25, 0.5, 0.75, 1.25]);
    expect(minor).toHaveLength(6 * 3);
  });

  it("never lands on a labelled tick", () => {
    for (const duration of [6, 29, 90, 601]) {
      const labelled = new Set(rulerTicks(duration).map((tick) => tick.time));
      for (const time of rulerMinorTicks(duration)) expect(labelled.has(time)).toBe(false);
    }
  });

  it("stays inside the duration", () => {
    expect(Math.max(...rulerMinorTicks(29))).toBeLessThanOrEqual(29);
  });
});

describe("formatScrubTime", () => {
  it.each([
    [0, "0:00.0"],
    [7.46, "0:07.4"],
    [65.99, "1:05.9"],
    [-1, "0:00.0"],
  ])("%s s → %s", (seconds, label) => {
    expect(formatScrubTime(seconds)).toBe(label);
  });
});

describe("rulerTicks while zoomed", () => {
  it("labels about as many ticks per VISIBLE lane as it does at fit, so labels never crowd", () => {
    // 100 s at 4x: the lane shows 25 s, so the step is the one a 25 s timeline would pick.
    const fitStep = rulerTicks(25)[1].time;
    const zoomedStep = rulerTicks(100, 4)[1].time;
    expect(zoomedStep).toBe(fitStep);
  });

  it("only returns the ticks in the window (plus one step each side), not 1800 for a long take", () => {
    const all = rulerTicks(600, 24);
    const windowed = rulerTicks(600, 24, { start: 300, end: 325 });
    expect(windowed.length).toBeLessThan(all.length / 4);
    expect(windowed.some((tick) => tick.time >= 300 && tick.time <= 325)).toBe(true);
    expect(windowed.every((tick) => tick.time >= 295 && tick.time <= 330)).toBe(true);
  });

  it("goes below one second at depth, labelling tenths so neighbours stay distinct", () => {
    // 8 s can zoom 1.92x at most in a 1000 px lane: one second is then 240 px wide.
    const ticks = rulerTicks(8, 1.9);
    const step = ticks[1].time - ticks[0].time;
    expect(step).toBeLessThan(1);
    expect(new Set(ticks.map((tick) => tick.label)).size).toBe(ticks.length);
    expect(ticks[1].label).toMatch(/^0:00\.\d$/);
  });

  it("keeps the fit ruler exactly as it was, down to a 4 s clip", () => {
    expect(rulerTicks(4).map((tick) => tick.time)).toEqual([0, 1, 2, 3, 4]);
  });

  it("minor ticks never land on a labelled tick at any zoom, windowed or not", () => {
    for (const [duration, zoom] of [
      [90, 1],
      [100, 4],
      [8, 1.9],
    ] as const) {
      const labelled = new Set(rulerTicks(duration, zoom).map((tick) => tick.time));
      for (const time of rulerMinorTicks(duration, zoom)) expect(labelled.has(time)).toBe(false);
    }
    const windowed = rulerMinorTicks(600, 24, { start: 300, end: 325 });
    expect(windowed.length).toBeLessThan(rulerMinorTicks(600, 24).length / 4);
  });
});

describe("thumbnailTiles", () => {
  const TILE_PX = 72;

  // A 240 s clip occupying the whole 240 s timeline.
  const block = { timelineStart: 0, timelineEnd: 240, sourceStart: 0, sourceEnd: 240 };

  it("at fit, tiles the whole block one every ~72 px, as the strip always did", () => {
    // 800 px for 240 s: scale 800/240.
    const { count, tiles } = thumbnailTiles({
      ...block,
      scale: 800 / 240,
      visible: { start: 0, end: 240 },
    });
    expect(count).toBe(Math.round(800 / TILE_PX));
    expect(tiles).toHaveLength(count);
    expect(tiles[0].left).toBe(0);
    expect(tiles.at(-1)!.left + tiles.at(-1)!.width).toBeCloseTo(1, 9);
  });

  it("at 16x asks only for the tiles in view, not for thousands", () => {
    // 16x of an 800 px lane: 12 800 px of block, about 178 tiles in all.
    const scale = (800 / 240) * 16;
    const { count, tiles } = thumbnailTiles({
      ...block,
      scale,
      visible: { start: 100, end: 115 },
    });
    expect(count).toBeGreaterThan(150);
    expect(tiles.length).toBeLessThan(20);
  });

  it("leaves no gap wider than a tile in the visible window at 16x, at any scroll", () => {
    const scale = (800 / 240) * 16;
    const windowSeconds = 800 / scale;
    for (const start of [0, 13.7, 100, 200.3, 240 - windowSeconds]) {
      const visible = { start, end: start + windowSeconds };
      const { tiles } = thumbnailTiles({ ...block, scale, visible });
      const px = (fraction: number): number => fraction * 240 * scale;
      // Cover [visible.start, visible.end] in px; no uncovered stretch may exceed a tile.
      const spans = tiles
        .map((tile) => ({ from: px(tile.left), to: px(tile.left + tile.width) }))
        .sort((a, b) => a.from - b.from);
      let covered = visible.start * scale;
      for (const span of spans) {
        expect(span.from - covered).toBeLessThanOrEqual(0.5); // contiguous
        covered = Math.max(covered, span.to);
      }
      expect(covered).toBeGreaterThanOrEqual(visible.end * scale - 0.5);
    }
  });

  it("tiles are never wider than 1.5 tiles, so a stretched frame stays recognisable", () => {
    for (const scale of [0.3, 3.3, 20, 53]) {
      const { tiles } = thumbnailTiles({ ...block, scale, visible: { start: 0, end: 240 } });
      for (const tile of tiles)
        expect(tile.width * 240 * scale).toBeLessThanOrEqual(TILE_PX * 1.5 + 1);
    }
  });

  it("maps each tile to the source time of its centre, through a cut", () => {
    // The second half of the source, placed at timeline 0..60 after a cut: tile centres
    // are in SOURCE time.
    const { tiles } = thumbnailTiles({
      timelineStart: 0,
      timelineEnd: 60,
      sourceStart: 120,
      sourceEnd: 180,
      scale: 720 / 60,
      visible: { start: 0, end: 60 },
    });
    expect(tiles[0].sourceTime).toBeGreaterThan(120);
    expect(tiles.at(-1)!.sourceTime).toBeLessThan(180);
  });

  it("only the part of the block inside the window is returned for a block starting mid-timeline", () => {
    const { tiles } = thumbnailTiles({
      timelineStart: 100,
      timelineEnd: 140,
      sourceStart: 0,
      sourceEnd: 40,
      scale: 40,
      visible: { start: 0, end: 50 }, // the block is out of view entirely
    });
    expect(tiles).toEqual([]);
  });

  it("returns a single full tile for a block narrower than a tile", () => {
    const { count, tiles } = thumbnailTiles({
      timelineStart: 0,
      timelineEnd: 1,
      sourceStart: 0,
      sourceEnd: 1,
      scale: 30,
      visible: { start: 0, end: 1 },
    });
    expect(count).toBe(1);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].width).toBe(1);
  });

  it("an unmeasured scale (0) still tiles the block once, so nothing renders blank before layout", () => {
    const { tiles } = thumbnailTiles({ ...block, scale: 0, visible: { start: 0, end: 240 } });
    expect(tiles.length).toBeGreaterThan(0);
  });
});

describe("thumbnailAt", () => {
  const thumbs = [
    { sourceTime: 5, url: "a" },
    { sourceTime: 15, url: "b" },
  ];

  it("picks the nearest frame", () => {
    expect(thumbnailAt(thumbs, 4)?.url).toBe("a");
    expect(thumbnailAt(thumbs, 11)?.url).toBe("b");
  });

  it("is null when there are no frames", () => {
    expect(thumbnailAt([], 4)).toBeNull();
  });

  describe("with a covered range (the webcam file may not span the whole source)", () => {
    // A long recording (240 s) has one thumbnail every 10 s of source: 5, 15, ... 235.
    const long = Array.from({ length: 24 }, (_, i) => ({ sourceTime: 5 + i * 10, url: `c${i}` }));
    const row = (
      sourceStart: number,
      sourceEnd: number,
      covered: { start: number; end: number },
    ): (string | null)[] => {
      // Five tiles over a 10 s clip: 360 px at 36 px/s.
      const { tiles } = thumbnailTiles({
        timelineStart: 0,
        timelineEnd: 10,
        sourceStart,
        sourceEnd,
        scale: 36,
        visible: { start: 0, end: 10 },
      });
      return tiles.map((tile) => thumbnailAt(long, tile.sourceTime, covered)?.url ?? null);
    };

    it("leaves a tile empty before a late start shorter than one thumbnail spacing", () => {
      // The webcam starts 3 s in: the tile at source 1 s has a frame 4 s away, but no footage.
      expect(row(0, 10, { start: 3, end: 240 })).toEqual([null, "c0", "c0", "c0", "c0"]);
    });

    it("leaves a tile empty after an early end shorter than one thumbnail spacing", () => {
      // The webcam ends 4 s before the screen: the tile at 239 s must not show the last face.
      expect(row(230, 240, { start: 0, end: 236 })).toEqual(["c23", "c23", "c23", null, null]);
    });
  });
});
