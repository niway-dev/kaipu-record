import { describe, expect, it } from "vitest";
import {
  BIN_COUNT,
  DIM_ALPHA,
  MAX_GROUPS,
  MAX_MEMBERS,
  MIN_AREA_PX,
  PHOTO_GROUP_SHARE,
  PHOTO_MIN_DISTINCT,
  analyzeColors,
  binOf,
  coverageGroups,
  deltaE,
  flatColors,
  formatShare,
  isPhoto,
  locateMask,
  packRgb,
  regionsOf,
  unpackRgb,
} from "./histogram";

type Px = [number, number, number, number?];

/** One row of pixels: `runs` of [color, how many]. */
function image(runs: [Px, number][]): { data: Uint8ClampedArray; width: number; height: number } {
  const width = runs.reduce((n, [, count]) => n + count, 0);
  const data = new Uint8ClampedArray(width * 4);
  let i = 0;
  for (const [[r, g, b, a = 255], count] of runs) {
    for (let k = 0; k < count; k++, i += 4) data.set([r, g, b, a], i);
  }
  return { data, width, height: 1 };
}

const hex = (rgb: number): string => `#${rgb.toString(16).padStart(6, "0")}`;

describe("binOf", () => {
  it("keeps the top 5 bits of each channel", () => {
    expect(binOf(0, 0, 0)).toBe(0);
    expect(binOf(255, 255, 255)).toBe(BIN_COUNT - 1);
    expect(binOf(255, 255, 255)).toBe(binOf(248, 248, 248));
    expect(binOf(247, 255, 255)).not.toBe(binOf(248, 255, 255));
  });
});

describe("packRgb / unpackRgb", () => {
  it("round-trips a color", () => {
    expect(unpackRgb(packRgb(18, 52, 86))).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });
});

describe("analyzeColors", () => {
  it("groups two near-identical whites and lists both, most frequent first", () => {
    const img = image([
      [[255, 255, 255], 100],
      [[250, 250, 250], 50],
      [[0, 0, 0], 30],
    ]);
    const { analysis } = analyzeColors(img.data, img.width, img.height);
    expect(analysis.counted).toBe(180);
    expect(analysis.distinct).toBe(3);
    expect(analysis.totalGroups).toBe(2);
    const [white, black] = analysis.groups;
    expect(white).toMatchObject({ id: 0, rgb: 0xffffff, count: 150, distinct: 2 });
    expect(white.members.map((m) => [hex(m.rgb), m.count])).toEqual([
      ["#ffffff", 100],
      ["#fafafa", 50],
    ]);
    expect(black).toMatchObject({ id: 1, rgb: 0x000000, count: 30, distinct: 1 });
  });

  it("keeps clearly different colors apart", () => {
    const img = image([
      [[255, 0, 0], 10],
      [[0, 0, 255], 20],
      [[255, 255, 255], 30],
    ]);
    const { analysis } = analyzeColors(img.data, img.width, img.height);
    expect(analysis.groups.map((g) => hex(g.rgb))).toEqual(["#ffffff", "#0000ff", "#ff0000"]);
  });

  it("does not count fully transparent pixels", () => {
    const img = image([
      [[255, 0, 0, 0], 40],
      [[0, 255, 0, 128], 10],
    ]);
    const { analysis } = analyzeColors(img.data, img.width, img.height);
    expect(analysis.counted).toBe(10);
    expect(analysis.groups).toHaveLength(1);
    expect(analysis.groups[0].rgb).toBe(0x00ff00);
  });

  it("leaves out a member under 1% of its group (anti-aliasing), but counts it", () => {
    const img = image([
      [[255, 255, 255], 1000],
      [[254, 254, 254], 5],
    ]);
    const { analysis } = analyzeColors(img.data, img.width, img.height);
    expect(analysis.groups[0].distinct).toBe(2);
    expect(analysis.groups[0].count).toBe(1005);
    expect(analysis.groups[0].members.map((m) => hex(m.rgb))).toEqual(["#ffffff"]);
  });

  it("keeps at most MAX_MEMBERS members, ties in ascending color order", () => {
    const runs: [Px, number][] = [];
    for (let k = 0; k < MAX_MEMBERS + 2; k++) runs.push([[248 + k, 255, 255], 10]);
    const img = image(runs);
    const { analysis } = analyzeColors(img.data, img.width, img.height);
    const members = analysis.groups[0].members;
    expect(members).toHaveLength(MAX_MEMBERS);
    const rgbs = members.map((m) => m.rgb);
    expect([...rgbs].sort((a, b) => a - b)).toEqual(rgbs);
  });

  it("puts every counted pixel in exactly one group on a many-color image", () => {
    const side = 256;
    const data = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const i = (y * side + x) * 4;
        data.set([x, y, (x * 7 + y * 13) & 255, 255], i);
      }
    }
    const { analysis, groupOfBin } = analyzeColors(data, side, side);
    expect(analysis.distinct).toBe(side * side);
    expect(analysis.totalGroups).toBeGreaterThan(MAX_GROUPS);
    expect(analysis.groups).toHaveLength(MAX_GROUPS);
    // Groups come most frequent first.
    for (let i = 1; i < analysis.groups.length; i++) {
      expect(analysis.groups[i - 1].count).toBeGreaterThanOrEqual(analysis.groups[i].count);
    }
    // The sum over all groups is the whole image: count each pixel's group directly.
    const perGroup = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const g = groupOfBin[binOf(data[i], data[i + 1], data[i + 2])];
      expect(g).toBeGreaterThanOrEqual(0);
      perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
    }
    expect([...perGroup.values()].reduce((a, b) => a + b, 0)).toBe(analysis.counted);
    for (const group of analysis.groups) expect(perGroup.get(group.id)).toBe(group.count);
  });

  it("returns no groups for an image with nothing opaque", () => {
    const img = image([[[10, 10, 10, 0], 4]]);
    const { analysis } = analyzeColors(img.data, img.width, img.height);
    expect(analysis).toMatchObject({ counted: 0, distinct: 0, totalGroups: 0, groups: [] });
  });
});

describe("locateMask", () => {
  const img = image([
    [[255, 255, 255], 2],
    [[250, 250, 250], 1],
    [[0, 0, 0], 1],
    [[255, 255, 255, 0], 1],
  ]);
  const { groupOfBin } = analyzeColors(img.data, img.width, img.height);
  const alphas = (mask: Uint8ClampedArray): number[] =>
    Array.from({ length: mask.length / 4 }, (_, p) => mask[p * 4 + 3]);

  it("leaves a group's pixels clear and dims the rest, transparent pixels included", () => {
    const { mask, matched } = locateMask(img.data, groupOfBin, { kind: "group", id: 0 });
    expect(matched).toBe(3);
    expect(alphas(mask)).toEqual([0, 0, 0, DIM_ALPHA, DIM_ALPHA]);
  });

  it("finds one exact color only", () => {
    const { mask, matched } = locateMask(img.data, groupOfBin, { kind: "color", rgb: 0xfafafa });
    expect(matched).toBe(1);
    expect(alphas(mask)).toEqual([DIM_ALPHA, DIM_ALPHA, 0, DIM_ALPHA, DIM_ALPHA]);
  });

  it("dims in black", () => {
    const { mask } = locateMask(img.data, groupOfBin, { kind: "group", id: 1 });
    expect(Array.from(mask.slice(0, 3))).toEqual([0, 0, 0]);
  });
});

describe("formatShare", () => {
  it.each([
    [0, 100, "0%"],
    [100, 100, "100%"],
    [1, 2000, "<0.1%"],
    [1999, 2000, ">99.9%"],
    [425, 1000, "42.5%"],
    [1, 3, "33.3%"],
  ])("%i of %i is %s", (count, total, text) => {
    expect(formatShare(count, total)).toBe(text);
  });
});

/** A width x height grid from rows of "#" (hit) and "." (miss). */
function grid(rows: string[]): { hit: (i: number) => boolean; width: number; height: number } {
  const width = rows[0].length;
  const flat = rows.join("");
  return { hit: (i) => flat[i] === "#", width, height: rows.length };
}
const block = (w: number, h: number): string[] => Array.from({ length: h }, () => "#".repeat(w));

describe("exact values", () => {
  it("lists all seven equally frequent greys, not just the top MAX_MEMBERS of their group", () => {
    const greys = [0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe];
    const { data, width, height } = image(greys.map((v) => [[v, v, v], 10] as [Px, number]));
    const { analysis } = analyzeColors(data, width, height);
    expect(analysis.distinct).toBe(7);
    expect(analysis.exact).toHaveLength(7);
    expect(flatColors(analysis).map((m) => m.rgb)).toEqual(greys.map((v) => packRgb(v, v, v)));
  });

  it("leaves exact empty for a photograph", () => {
    const n = PHOTO_MIN_DISTINCT + 5;
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      data.set([i >> 8, i & 255, 7, 255], i * 4);
    }
    const { analysis } = analyzeColors(data, n, 1);
    expect(analysis.distinct).toBeGreaterThanOrEqual(PHOTO_MIN_DISTINCT);
    expect(analysis.exact).toEqual([]);
  });
});

describe("regionsOf", () => {
  it("merges labels that meet late (a U shape is one region)", () => {
    const g = grid(["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"]);
    const result = regionsOf(g.hit, g.width, g.height);
    expect(result.areas).toBe(1);
    expect(result.bounds).toEqual({ x: 0, y: 0, w: 5, h: 7 });
  });

  it("joins alternating one-pixel columns through a top row", () => {
    const width = 41;
    const rows = ["#".repeat(width)];
    for (let y = 0; y < 5; y++) {
      rows.push(Array.from({ length: width }, (_, x) => (x % 2 === 0 ? "#" : ".")).join(""));
    }
    const g = grid(rows);
    const result = regionsOf(g.hit, g.width, g.height);
    expect(result.areas).toBe(1);
    expect(result.bounds).toEqual({ x: 0, y: 0, w: 41, h: 6 });
  });

  it("counts two separate blobs as two areas and bounds the largest", () => {
    const small = block(4, 4); // 16 px = MIN_AREA_PX
    const big = block(6, 5);
    const rows: string[] = [];
    for (let y = 0; y < 5; y++) rows.push((y < 4 ? small[y] : "....") + "..." + big[y]);
    const g = grid(rows);
    const result = regionsOf(g.hit, g.width, g.height);
    expect(MIN_AREA_PX).toBe(16);
    expect(result.areas).toBe(2);
    expect(result.bounds).toEqual({ x: 7, y: 0, w: 6, h: 5 });
  });

  it("joins a diagonal touch into one region (8-connectivity)", () => {
    const rows = [...block(4, 4).map((r) => r + "...."), ...block(4, 4).map((r) => "...." + r)];
    // Two 4x4 blocks touching only at one corner.
    const g = grid(rows);
    const result = regionsOf(g.hit, g.width, g.height);
    expect(result.areas).toBe(1);
    expect(result.bounds).toEqual({ x: 0, y: 0, w: 8, h: 8 });
  });

  it("does not count regions under MIN_AREA_PX", () => {
    const g = grid(["#...#", "....."]);
    expect(regionsOf(g.hit, g.width, g.height)).toEqual({ areas: 0, bounds: null });
  });

  it("merges a U shape whose arms only meet on a later row", () => {
    const g = grid(["###.###", "###.###", "###.###", "#######"]);
    expect(regionsOf(g.hit, g.width, g.height).areas).toBe(1);
  });
});

describe("photo summary", () => {
  const group = (id: number, count: number) => ({
    id,
    rgb: 0,
    count,
    distinct: 1,
    members: [],
  });
  const analysis = (distinct: number, counts: number[]) => ({
    width: 1,
    height: 1,
    counted: counts.reduce((a, b) => a + b, 0),
    distinct,
    totalGroups: counts.length,
    groups: counts.map((c, i) => group(i, c)),
    exact: [],
  });

  it("is a photo from PHOTO_MIN_DISTINCT exact values", () => {
    expect(isPhoto(analysis(PHOTO_MIN_DISTINCT - 1, [1]))).toBe(false);
    expect(isPhoto(analysis(PHOTO_MIN_DISTINCT, [1]))).toBe(true);
  });

  it("lists every group with at least PHOTO_GROUP_SHARE of the pixels and folds the rest into other", () => {
    expect(PHOTO_GROUP_SHARE).toBe(0.01);
    // 100 pixels: 50, 20, 10, 10, 5, then four of 1 (exactly 1% is listed) and one of 0.
    const a = analysis(2000, [50, 20, 10, 10, 5, 1, 1, 1, 1]);
    const { groups, other } = coverageGroups(a);
    expect(groups.map((g) => g.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(other).toBe(0);
    const many = analysis(2000, [900, 50, 20, ...Array.from({ length: 30 }, () => 1)]);
    const folded = coverageGroups(many);
    expect(folded.groups.map((g) => g.id)).toEqual([0, 1, 2]);
    expect(folded.other).toBe(30);
  });

  it("keeps at least one group", () => {
    const { groups, other } = coverageGroups(
      analysis(2000, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
    );
    expect(groups.length).toBe(10);
    expect(other).toBe(0);
    expect(coverageGroups(analysis(2000, [1])).groups.length).toBe(1);
    // Every group is under 1%: the largest is still listed.
    const tiny = coverageGroups(
      analysis(
        2000,
        Array.from({ length: 200 }, () => 1),
      ),
    );
    expect(tiny.groups.length).toBe(1);
    expect(tiny.other).toBe(199);
  });

  it("lists a ~3% accent that the old 80% coverage cut hid, on a synthetic photo", () => {
    // 100 x 100: four flat blocks of 20% (80% together), a 3% red accent, and 17% of a
    // gradient whose exact values are all different, so the image is a photograph.
    const flats: Px[] = [
      [255, 255, 255],
      [0, 0, 0],
      [0, 0, 200],
      [0, 160, 0],
    ];
    const accent: Px = [255, 0, 60];
    const runs: [Px, number][] = flats.map((c) => [c, 2000]);
    runs.push([accent, 300]);
    for (let i = 0; i < 1700; i++)
      runs.push([[(i * 5) % 251, (i >> 3) % 251, (i * 7 + 3) % 253], 1]);
    const img = image(runs);
    const { analysis: a } = analyzeColors(img.data, img.width, img.height);
    expect(isPhoto(a)).toBe(true);
    expect(a.counted).toBe(10000);
    const accentGroup = a.groups.find((g) => g.rgb === packRgb(255, 0, 60));
    // A few gradient values land near the red and join its group: about 3%, not exactly.
    expect(accentGroup!.count).toBeGreaterThanOrEqual(300);
    expect(accentGroup!.count).toBeLessThan(400);
    // Before: the four flat groups already covered 80% of the pixels, so the cut stopped there.
    const before = [...a.groups]
      .filter((g) => g.count > accentGroup!.count)
      .reduce((n, g) => n + g.count, 0);
    expect(before).toBeGreaterThanOrEqual(a.counted * 0.8);
    const { groups, other } = coverageGroups(a);
    expect(groups.map((g) => g.id)).toContain(accentGroup!.id);
    // Every listed group has at least 1% and everything else is "Other".
    for (const g of groups) expect(g.count).toBeGreaterThanOrEqual(a.counted * PHOTO_GROUP_SHARE);
    expect(other).toBe(a.counted - groups.reduce((n, g) => n + g.count, 0));
  });
});

describe("deltaE", () => {
  it("is about 100 between white and black", () => {
    expect(deltaE(0xffffff, 0x000000)).toBeGreaterThan(99);
    expect(deltaE(0xffffff, 0x000000)).toBeLessThan(101);
  });
  it("is small between white and #fafafa and zero for equal colors", () => {
    expect(deltaE(0xffffff, 0xfafafa)).toBeGreaterThan(0);
    expect(deltaE(0xffffff, 0xfafafa)).toBeLessThan(3);
    expect(deltaE(0x123456, 0x123456)).toBe(0);
  });
});

describe("flatColors", () => {
  it("lists every member by count descending, ties by rgb ascending", () => {
    // Runs are given out of order on purpose: the order comes from analyzeColors, not the input.
    const img = image([
      [[0x10, 0, 0], 2],
      [[0x30, 0, 0], 5],
      [[0x40, 0, 0], 9],
      [[0x20, 0, 0], 5],
    ]);
    const { analysis } = analyzeColors(img.data, img.width, img.height);
    expect(isPhoto(analysis)).toBe(false);
    const expected = [0x400000, 0x200000, 0x300000, 0x100000];
    expect(analysis.exact.map((m) => m.rgb)).toEqual(expected);
    expect(flatColors(analysis).map((m) => m.rgb)).toEqual(expected);
    expect(flatColors(analysis).map((m) => m.count)).toEqual([9, 5, 5, 2]);
  });
});

describe("analyzeColors progress", () => {
  it("reports 0..1 at most about 20 times and ends at 1", () => {
    const width = 4;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const calls: number[] = [];
    analyzeColors(data, width, height, (d) => calls.push(d));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(21);
    expect(calls[calls.length - 1]).toBe(1);
    expect([...calls].sort((a, b) => a - b)).toEqual(calls);
  });
});
