import { describe, expect, it } from "vitest";
import { checkOutputGrowth, checkOutputGrowthPerFile, type OutputSample } from "./invariant";

const s = (tMs: number, bytes: number | null): OutputSample => ({ tMs, bytes });
const range = (n: number, f: (i: number) => number | null): OutputSample[] =>
  Array.from({ length: n }, (_, i) => s(i * 1000, f(i)));

describe("checkOutputGrowth", () => {
  it("holds when the file grows steadily", () => {
    const r = checkOutputGrowth(
      range(60, (i) => 28 + i * 1_000_000),
      { maxStallMs: 30_000 },
    );
    expect(r.held).toBe(true);
    expect(r.longestStallMs).toBe(1000);
  });
  it("fails on the 2026-11-14 incident shape: stuck at 28 bytes, then a jump", () => {
    const samples = range(300, (i) => (i < 240 ? 28 : 5_590_000_000));
    const r = checkOutputGrowth(samples, { maxStallMs: 30_000 });
    expect(r.held).toBe(false);
    expect(r.longestStallMs).toBe(240_000);
    expect(r.reason).toMatch(/stuck/);
  });
  it("is inconclusive when the file never existed", () => {
    const r = checkOutputGrowth(
      range(10, () => null),
      { maxStallMs: 30_000 },
    );
    expect(r.held).toBeNull();
    expect(r.reason).toMatch(/never appeared/);
  });
  it("is inconclusive with a single sample", () => {
    expect(checkOutputGrowth([s(0, 5)], { maxStallMs: 30_000 }).held).toBeNull();
  });
  it("does not count a finished export's trailing flat part as a stall", () => {
    const samples = range(100, (i) => (i < 20 ? 1000 * (i + 1) : 20_000));
    expect(checkOutputGrowth(samples, { maxStallMs: 30_000 }).held).toBe(true);
  });
  it("fails when the file never grows for longer than the limit", () => {
    expect(
      checkOutputGrowth(
        range(60, () => 28),
        { maxStallMs: 30_000 },
      ).held,
    ).toBe(false);
  });
  it("is inconclusive when it never grows but was seen for less than the limit", () => {
    expect(
      checkOutputGrowth(
        range(10, () => 28),
        { maxStallMs: 30_000 },
      ).held,
    ).toBeNull();
  });
  it("splits segments when the file disappears, judging each", () => {
    const samples = [s(0, 10), s(1000, 20), s(2000, 30), s(3000, null), s(4000, 5), s(5000, 6)];
    const r = checkOutputGrowth(samples, { maxStallMs: 30_000 });
    expect(r.held).toBe(true);
    expect(r.segments).toBe(2);
  });
  it("starts a new segment when bytes shrink (a new export reused the folder)", () => {
    const r = checkOutputGrowth([s(0, 100), s(1000, 200), s(2000, 50), s(3000, 60)], {
      maxStallMs: 30_000,
    });
    expect(r.segments).toBe(2);
    expect(r.held).toBe(true);
  });
  it("reports first and last bytes and growth events", () => {
    const r = checkOutputGrowth([s(0, 1), s(1000, 5), s(2000, 5), s(3000, 9)], {
      maxStallMs: 30_000,
    });
    expect(r.firstBytes).toBe(1);
    expect(r.lastBytes).toBe(9);
    expect(r.growthEvents).toBe(2);
  });
});

describe("checkOutputGrowth at the boundary", () => {
  it("a flat file seen for exactly maxStallMs is violated, not held", () => {
    expect(
      checkOutputGrowth(
        range(31, () => 28),
        { maxStallMs: 30_000 },
      ).held,
    ).toBe(false);
  });
  it("a gap between increases of exactly maxStallMs holds; one second more fails", () => {
    const at = (gap: number): OutputSample[] => [s(0, 1), s(gap, 2), s(gap + 1000, 3)];
    expect(checkOutputGrowth(at(30_000), { maxStallMs: 30_000 }).held).toBe(true);
    expect(checkOutputGrowth(at(31_000), { maxStallMs: 30_000 }).held).toBe(false);
  });
});

describe("checkOutputGrowthPerFile", () => {
  const tick = (tMs: number, files: Record<string, number>) => ({
    tMs,
    files: new Map(Object.entries(files)),
  });
  const opts = { maxStallMs: 30_000 };

  it("ignores a file that was already there and never changes (idle)", () => {
    const ticks = Array.from({ length: 120 }, (_, i) => tick(i * 1000, { stale: 500 }));
    const r = checkOutputGrowthPerFile(ticks, opts);
    expect(r.held).toBeNull();
    expect(r.reason).toMatch(/idle/);
  });
  it("an idle stale file does not spoil a healthy export that appears later", () => {
    const ticks = Array.from({ length: 120 }, (_, i) =>
      tick(i * 1000, i < 10 ? { stale: 500 } : { stale: 500, export: 28 + (i - 10) * 1000 }),
    );
    expect(checkOutputGrowthPerFile(ticks, opts).held).toBe(true);
  });
  it("still fails a file born during the run that gets stuck", () => {
    const ticks = Array.from({ length: 120 }, (_, i) =>
      tick(i * 1000, i < 5 ? { stale: 500 } : { stale: 500, export: 28 }),
    );
    expect(checkOutputGrowthPerFile(ticks, opts).held).toBe(false);
  });
  it("judges a preexisting file from its first increase, not from idle time before it", () => {
    const ticks = Array.from({ length: 120 }, (_, i) =>
      tick(i * 1000, { f: i < 60 ? 100 : 100 + (i - 59) * 1000 }),
    );
    expect(checkOutputGrowthPerFile(ticks, opts).held).toBe(true);
  });
});
