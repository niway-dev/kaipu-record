/**
 * The colors panel's counting (NIW2-704). Pure and DOM-free: it runs inside the colors worker
 * and in tests, and the view only reads its result, so NIW2-708 can restyle the panel freely.
 *
 * A photograph has millions of distinct colors and comparing every pair is quadratic, so the
 * work is split into linear passes:
 *
 * 1. Count every exact color in a table of 2^24 counters (a fixed 64 MiB, no hashing).
 * 2. Quantize: drop the low bits of each channel, which leaves at most `BIN_COUNT` bins.
 * 3. Group bins, most frequent first. A bin joins the nearest group seed closer than
 *    `GROUP_DISTANCE` in OKLab, otherwise it seeds a new group. Seeds live in a grid whose
 *    cell is that distance, so each bin looks at 27 cells, not at every group.
 * 4. Every group keeps its most frequent exact members, so two near-identical whites end up
 *    in one group and are listed side by side.
 *
 * Fully transparent pixels are not counted. Translucent ones count by their RGB.
 */
import { srgbToOklab, type Rgba } from "../color";

/** Bits kept per channel. 5 leaves 32 levels per channel and 32,768 bins. */
export const QUANT_BITS = 5;
const SHIFT = 8 - QUANT_BITS;
export const BIN_COUNT = 1 << (QUANT_BITS * 3);
/**
 * OKLab distance under which two bins are one group. 0.02 is about a just-noticeable
 * difference; 0.03 still puts #ffffff and #f5f5f5 together, which is the point: the panel
 * shows both inside the group instead of hiding one of them.
 */
export const GROUP_DISTANCE = 0.03;
/** Exact members kept per group. */
export const MAX_MEMBERS = 6;
/** A member under this share of its group (anti-aliasing, noise) is not listed. */
export const NOTABLE_MEMBER_SHARE = 0.01;
/** Groups sent to the panel; the rest are only counted. */
export const MAX_GROUPS = 200;

/** Connected regions under this many pixels are not areas: it skips stray anti-aliasing
 * pixels, while each glyph of text in that color still counts as an area. */
export const MIN_AREA_PX = 16;
/** From this many exact values an image is treated as a photograph. */
export const PHOTO_MIN_DISTINCT = 1000;
/** A photograph lists every group with at least this share of the counted pixels. */
export const PHOTO_GROUP_SHARE = 0.01;
/** Rows between progress reports are chosen so there are about this many. */
const PROGRESS_STEPS = 20;

export interface ColorMember {
  /** 0xRRGGBB. */
  rgb: number;
  count: number;
}

export interface ColorGroup {
  /** Position in `ColorAnalysis.groups`, most frequent first. */
  id: number;
  /** The most frequent exact color in the group: the swatch the panel shows. */
  rgb: number;
  count: number;
  /** Distinct exact colors in the group. */
  distinct: number;
  /** The notable exact members, most frequent first; the first one is `rgb`. */
  members: ColorMember[];
}

export interface ColorAnalysis {
  width: number;
  height: number;
  /** Pixels counted: every pixel whose alpha is above 0. */
  counted: number;
  /** Distinct exact colors in the image. */
  distinct: number;
  /** Groups found; `groups` holds only the first `MAX_GROUPS` of them. */
  totalGroups: number;
  groups: ColorGroup[];
  /**
   * Every exact value, most frequent first (ties: lower color first). Filled only when the
   * image is not a photograph: a group keeps just `MAX_MEMBERS`, so "Group off" needs this.
   */
  exact: ColorMember[];
}

/** The analysis plus what `locateMask` needs to find a group's pixels again. */
export interface ColorIndex {
  analysis: ColorAnalysis;
  /** Group id of every bin (-1 for an empty bin). */
  groupOfBin: Int32Array;
}

export type LocateTarget = { kind: "group"; id: number } | { kind: "color"; rgb: number };

export function binOf(r: number, g: number, b: number): number {
  return ((r >> SHIFT) << (2 * QUANT_BITS)) | ((g >> SHIFT) << QUANT_BITS) | (b >> SHIFT);
}

export const packRgb = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

export function unpackRgb(rgb: number): Rgba {
  return { r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255, a: 255 };
}

// Grid cell key for OKLab coordinates. L spans 0-1, a and b about -0.4 to 0.4, so the
// offsets keep every index positive at GROUP_DISTANCE.
const cellIndex = (v: number): number => Math.floor(v / GROUP_DISTANCE);
const cellKey = (l: number, a: number, b: number): number =>
  ((l + 64) * 256 + (a + 128)) * 256 + (b + 128);

export function analyzeColors(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  /** Called with 0..1 while the pixels are counted, about `PROGRESS_STEPS` times. */
  onProgress?: (done: number) => void,
): ColorIndex {
  // 1. Exact counts, in chunks of rows so progress is reported per chunk, never per pixel.
  const exact = new Uint32Array(1 << 24);
  let counted = 0;
  const chunk = Math.max(4, Math.ceil(data.length / PROGRESS_STEPS / 4) * 4);
  for (let start = 0; start < data.length; start += chunk) {
    const end = Math.min(data.length, start + chunk);
    for (let i = start; i < end; i += 4) {
      if (data[i + 3] === 0) continue;
      exact[(data[i] << 16) | (data[i + 1] << 8) | data[i + 2]]++;
      counted++;
    }
    onProgress?.(end / data.length);
  }

  // 2. Bins: count and the sum of each channel, for the bin's mean color.
  const binCount = new Float64Array(BIN_COUNT);
  const sumR = new Float64Array(BIN_COUNT);
  const sumG = new Float64Array(BIN_COUNT);
  const sumB = new Float64Array(BIN_COUNT);
  let distinct = 0;
  for (let key = 0; key < exact.length; key++) {
    const c = exact[key];
    if (c === 0) continue;
    distinct++;
    const r = key >> 16;
    const g = (key >> 8) & 255;
    const b = key & 255;
    const bin = binOf(r, g, b);
    binCount[bin] += c;
    sumR[bin] += r * c;
    sumG[bin] += g * c;
    sumB[bin] += b * c;
  }

  const bins: number[] = [];
  for (let bin = 0; bin < BIN_COUNT; bin++) if (binCount[bin] > 0) bins.push(bin);
  bins.sort((x, y) => binCount[y] - binCount[x] || x - y);

  // 3. Group bins around seeds, most frequent first.
  const seedL: number[] = [];
  const seedA: number[] = [];
  const seedB: number[] = [];
  const rawCount: number[] = [];
  const cells = new Map<number, number[]>();
  const rawGroupOfBin = new Int32Array(BIN_COUNT).fill(-1);
  const limit = GROUP_DISTANCE * GROUP_DISTANCE;
  for (const bin of bins) {
    const n = binCount[bin];
    const lab = srgbToOklab([
      Math.round(sumR[bin] / n),
      Math.round(sumG[bin] / n),
      Math.round(sumB[bin] / n),
    ]);
    const cl = cellIndex(lab.l);
    const ca = cellIndex(lab.a);
    const cb = cellIndex(lab.b);
    let best = -1;
    let bestD = limit;
    for (let dl = -1; dl <= 1; dl++) {
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) {
          const seeds = cells.get(cellKey(cl + dl, ca + da, cb + db));
          if (!seeds) continue;
          for (const g of seeds) {
            const d = (seedL[g] - lab.l) ** 2 + (seedA[g] - lab.a) ** 2 + (seedB[g] - lab.b) ** 2;
            if (d < bestD || (d === bestD && best !== -1 && g < best)) {
              best = g;
              bestD = d;
            }
          }
        }
      }
    }
    if (best === -1) {
      best = seedL.length;
      seedL.push(lab.l);
      seedA.push(lab.a);
      seedB.push(lab.b);
      rawCount.push(0);
      const key = cellKey(cl, ca, cb);
      const list = cells.get(key);
      if (list) list.push(best);
      else cells.set(key, [best]);
    }
    rawGroupOfBin[bin] = best;
    rawCount[best] += n;
  }

  // Number groups by size, most frequent first (ties: the earlier seed).
  const order = rawCount.map((_, i) => i).sort((x, y) => rawCount[y] - rawCount[x] || x - y);
  const rank = new Int32Array(order.length);
  order.forEach((raw, id) => (rank[raw] = id));
  const groupOfBin = new Int32Array(BIN_COUNT).fill(-1);
  for (let bin = 0; bin < BIN_COUNT; bin++) {
    if (rawGroupOfBin[bin] !== -1) groupOfBin[bin] = rank[rawGroupOfBin[bin]];
  }

  // 4. Exact members of the groups that are sent: the top MAX_MEMBERS by count.
  const sent = Math.min(order.length, MAX_GROUPS);
  const groupDistinct = new Uint32Array(order.length);
  const topRgb = new Int32Array(sent * MAX_MEMBERS);
  const topCount = new Uint32Array(sent * MAX_MEMBERS);
  const topLen = new Uint8Array(sent);
  for (let key = 0; key < exact.length; key++) {
    const c = exact[key];
    if (c === 0) continue;
    const g = groupOfBin[binOf(key >> 16, (key >> 8) & 255, key & 255)];
    groupDistinct[g]++;
    if (g >= sent) continue;
    const base = g * MAX_MEMBERS;
    const len = topLen[g];
    // Insert keeping counts descending; an equal count stays after (ascending color order).
    let at = len;
    while (at > 0 && topCount[base + at - 1] < c) at--;
    if (at >= MAX_MEMBERS) continue;
    const end = Math.min(len, MAX_MEMBERS - 1);
    for (let j = end; j > at; j--) {
      topCount[base + j] = topCount[base + j - 1];
      topRgb[base + j] = topRgb[base + j - 1];
    }
    topCount[base + at] = c;
    topRgb[base + at] = key;
    if (len < MAX_MEMBERS) topLen[g] = len + 1;
  }

  const groups: ColorGroup[] = [];
  for (let id = 0; id < sent; id++) {
    const count = rawCount[order[id]];
    const base = id * MAX_MEMBERS;
    const members: ColorMember[] = [];
    for (let j = 0; j < topLen[id]; j++) {
      const memberCount = topCount[base + j];
      if (j > 0 && memberCount < count * NOTABLE_MEMBER_SHARE) break;
      members.push({ rgb: topRgb[base + j], count: memberCount });
    }
    groups.push({ id, rgb: members[0].rgb, count, distinct: groupDistinct[id], members });
  }

  const allExact: ColorMember[] = [];
  if (distinct < PHOTO_MIN_DISTINCT) {
    // Ascending key order plus a stable sort gives "lower color first" on equal counts.
    for (let key = 0; key < exact.length; key++) {
      if (exact[key] !== 0) allExact.push({ rgb: key, count: exact[key] });
    }
    allExact.sort((x, y) => y.count - x.count);
  }

  return {
    analysis: {
      width,
      height,
      counted,
      distinct,
      totalGroups: order.length,
      groups,
      exact: allExact,
    },
    groupOfBin,
  };
}

/** Euclidean distance in OKLab times 100 (ΔE_OK): about 100 between white and black. */
export function deltaE(a: number, b: number): number {
  const x = srgbToOklab([(a >> 16) & 255, (a >> 8) & 255, a & 255]);
  const y = srgbToOklab([(b >> 16) & 255, (b >> 8) & 255, b & 255]);
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b) * 100;
}

/** Every exact value, most frequent first (ties: lower color first); empty for a photograph. */
export function flatColors(analysis: ColorAnalysis): ColorMember[] {
  return analysis.exact;
}

export const isPhoto = (analysis: ColorAnalysis): boolean =>
  analysis.distinct >= PHOTO_MIN_DISTINCT;

/**
 * For a photograph: every group with at least `PHOTO_GROUP_SHARE` of the counted pixels (the
 * largest one always, so the list is never empty), and how many pixels are left outside them
 * ("Other"). Groups come most frequent first, so the first one under the share ends the list.
 */
export function coverageGroups(analysis: ColorAnalysis): { groups: ColorGroup[]; other: number } {
  const floor = analysis.counted * PHOTO_GROUP_SHARE;
  const groups: ColorGroup[] = [];
  let covered = 0;
  for (const g of analysis.groups) {
    if (groups.length > 0 && g.count < floor) break;
    groups.push(g);
    covered += g.count;
  }
  return { groups, other: Math.max(0, analysis.counted - covered) };
}

export interface AreaBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Connected regions (8-connectivity) of at least `MIN_AREA_PX` pixels among the pixels
 * `hit(pixelIndex)` accepts, and the bounds of the largest. Labels horizontal runs with a
 * union-find over labels, keeping only two rows of runs, so memory follows the number of
 * labels, not the runs or the 24 M pixels of a 6K image.
 */
export function regionsOf(
  hit: (pixel: number) => boolean,
  width: number,
  height: number,
): { areas: number; bounds: AreaBounds | null } {
  // Memory follows labels, not runs: only the previous and the current row's runs are kept.
  let cap = 256;
  let parent = new Int32Array(cap);
  let count = new Uint32Array(cap);
  let minX = new Int32Array(cap);
  let maxX = new Int32Array(cap);
  let minY = new Int32Array(cap);
  let maxY = new Int32Array(cap);
  let labels = 0;
  const widen = <T extends Int32Array | Uint32Array>(a: T): T => {
    const next = new (a.constructor as new (n: number) => T)(cap);
    next.set(a);
    return next;
  };
  const newLabel = (x0: number, x1: number, y: number): number => {
    if (labels === cap) {
      cap *= 2;
      parent = widen(parent);
      count = widen(count);
      minX = widen(minX);
      maxX = widen(maxX);
      minY = widen(minY);
      maxY = widen(maxY);
    }
    const id = labels++;
    parent[id] = id;
    count[id] = x1 - x0 + 1;
    minX[id] = x0;
    maxX[id] = x1;
    minY[id] = y;
    maxY[id] = y;
    return id;
  };
  const find = (r: number): number => {
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  };
  const union = (a: number, b: number): number => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return ra;
    // The smaller label stays the root so the order is deterministic.
    const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
    parent[drop] = keep;
    count[keep] += count[drop];
    minX[keep] = Math.min(minX[keep], minX[drop]);
    maxX[keep] = Math.max(maxX[keep], maxX[drop]);
    minY[keep] = Math.min(minY[keep], minY[drop]);
    maxY[keep] = Math.max(maxY[keep], maxY[drop]);
    return keep;
  };

  // A row's runs as parallel growing arrays: start, end, label.
  let prevS: number[] = [];
  let prevE: number[] = [];
  let prevL: number[] = [];
  for (let y = 0; y < height; y++) {
    const curS: number[] = [];
    const curE: number[] = [];
    const curL: number[] = [];
    const base = y * width;
    let p = 0;
    let x = 0;
    while (x < width) {
      if (!hit(base + x)) {
        x++;
        continue;
      }
      const start = x;
      while (x < width && hit(base + x)) x++;
      const end = x - 1;
      // Skip runs above that end left of this one's diagonal reach.
      while (p < prevS.length && prevE[p] < start - 1) p++;
      let label = -1;
      for (let q = p; q < prevS.length && prevS[q] <= end + 1; q++) {
        if (label === -1) label = find(prevL[q]);
        else label = union(label, prevL[q]);
      }
      if (label === -1) {
        label = newLabel(start, end, y);
      } else {
        const root = find(label);
        count[root] += end - start + 1;
        minX[root] = Math.min(minX[root], start);
        maxX[root] = Math.max(maxX[root], end);
        minY[root] = Math.min(minY[root], y);
        maxY[root] = Math.max(maxY[root], y);
        label = root;
      }
      curS.push(start);
      curE.push(end);
      curL.push(label);
    }
    prevS = curS;
    prevE = curE;
    prevL = curL;
  }

  let areas = 0;
  let best = -1;
  for (let r = 0; r < labels; r++) {
    if (parent[r] !== r || count[r] < MIN_AREA_PX) continue;
    areas++;
    if (best === -1 || count[r] > count[best]) best = r;
  }
  const bounds =
    best === -1
      ? null
      : {
          x: minX[best],
          y: minY[best],
          w: maxX[best] - minX[best] + 1,
          h: maxY[best] - minY[best] + 1,
        };
  return { areas, bounds };
}

/** Alpha of the dimmed (non-matching) pixels in the locate overlay: black at about 70%. */
export const DIM_ALPHA = 180;

/**
 * The locate overlay at the image's size: transparent where a pixel matches `target`, dim
 * black everywhere else. `matched` is how many pixels match.
 */
export function locateMask(
  data: Uint8ClampedArray,
  groupOfBin: Int32Array,
  target: LocateTarget,
): { mask: Uint8ClampedArray<ArrayBuffer>; matched: number } {
  const mask = new Uint8ClampedArray(data.length);
  let matched = 0;
  const wanted = target.kind === "group" ? target.id : target.rgb;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const hit =
      data[i + 3] !== 0 &&
      (target.kind === "group"
        ? groupOfBin[binOf(r, g, b)] === wanted
        : ((r << 16) | (g << 8) | b) === wanted);
    if (hit) matched++;
    else mask[i + 3] = DIM_ALPHA;
  }
  return { mask, matched };
}

/** A share as the panel prints it: one decimal, "<0.1%" for a trace, "100%" for all of it. */
export function formatShare(count: number, total: number): string {
  if (total <= 0 || count <= 0) return "0%";
  if (count >= total) return "100%";
  const pct = (count / total) * 100;
  if (pct < 0.1) return "<0.1%";
  if (pct > 99.9) return ">99.9%";
  return `${pct.toFixed(1)}%`;
}
