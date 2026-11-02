import { describe, expect, it, vi } from "vitest";
import {
  datalessPaths,
  EvictionCache,
  parseStatFlags,
  SF_DATALESS,
  type DatalessDeps,
} from "./dataless";

// What `/usr/bin/stat -f '%f %N'` printed in the spike: an evicted Drive file has 0x40000060.
const EVICTED_FLAGS = String(0x40000060);
const LOCAL_FLAGS = "0";

describe("parseStatFlags", () => {
  it("reads one decimal flags word and the path per line, keeping spaces in the path", () => {
    const out = `${EVICTED_FLAGS} /d/My Drive/a b.mp4\n${LOCAL_FLAGS} /d/c.png\n`;
    expect(parseStatFlags(out)).toEqual(
      new Map([
        ["/d/My Drive/a b.mp4", 0x40000060],
        ["/d/c.png", 0],
      ]),
    );
  });

  it("skips lines that are not a flags word and a path", () => {
    expect(parseStatFlags("stat: /x: No such file\n\nabc /y\n").size).toBe(0);
  });
});

function deps(overrides: Partial<DatalessDeps> = {}): DatalessDeps {
  return {
    runStat: async () => ({ stdout: "", failed: false }),
    lstat: async () => ({ size: 10, blocks: 8 }),
    ...overrides,
  };
}

describe("datalessPaths (SF_DATALESS via /usr/bin/stat, one call per batch)", () => {
  it("flags only the files whose flags carry SF_DATALESS", async () => {
    expect(SF_DATALESS).toBe(0x40000000);
    const runStat = vi.fn(async () => ({
      stdout: `${EVICTED_FLAGS} /w/a.mp4\n${LOCAL_FLAGS} /w/b.mp4\n`,
      failed: false,
    }));
    const result = await datalessPaths(["/w/a.mp4", "/w/b.mp4"], deps({ runStat }));
    expect([...result]).toEqual(["/w/a.mp4"]);
    expect(runStat).toHaveBeenCalledTimes(1);
    expect(runStat).toHaveBeenCalledWith(["/w/a.mp4", "/w/b.mp4"]);
  });

  it("a sparse local file with zero blocks is NOT evicted when stat answers (spike false positive)", async () => {
    const result = await datalessPaths(
      ["/w/sparse.mp4"],
      deps({
        runStat: async () => ({ stdout: `${LOCAL_FLAGS} /w/sparse.mp4\n`, failed: false }),
        lstat: async () => ({ size: 1_000_000, blocks: 0 }),
      }),
    );
    expect(result.size).toBe(0);
  });

  it("a missing file (stat fails for it alone) is not evicted, the others still are", async () => {
    const result = await datalessPaths(
      ["/w/gone.jpg", "/w/a.mp4"],
      deps({ runStat: async () => ({ stdout: `${EVICTED_FLAGS} /w/a.mp4\n`, failed: true }) }),
    );
    expect([...result]).toEqual(["/w/a.mp4"]);
  });

  it("only when the stat call itself gives nothing, falls back to blocks === 0 && size > 0", async () => {
    const result = await datalessPaths(
      ["/w/a.mp4", "/w/empty.mp4", "/w/local.mp4"],
      deps({
        runStat: async () => ({ stdout: "", failed: true }),
        lstat: async (path) =>
          path === "/w/a.mp4"
            ? { size: 500, blocks: 0 }
            : path === "/w/empty.mp4"
              ? { size: 0, blocks: 0 }
              : { size: 500, blocks: 8 },
      }),
    );
    expect([...result]).toEqual(["/w/a.mp4"]);
  });

  it("an empty batch spawns nothing", async () => {
    const runStat = vi.fn(async () => ({ stdout: "", failed: false }));
    expect((await datalessPaths([], deps({ runStat }))).size).toBe(0);
    expect(runStat).not.toHaveBeenCalled();
  });
});

describe("EvictionCache (the media protocol's gate)", () => {
  it("never reuses a local answer: every read is checked again", async () => {
    const probe = vi.fn(async () => new Set<string>());
    const cache = new EvictionCache(probe, 2_000, Date.now, 0);
    expect(await cache.isEvicted("/x")).toBe(false);
    expect(await cache.isEvicted("/x")).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("a file evicted right after a local answer is refused on the next read", async () => {
    let evicted = false;
    const cache = new EvictionCache(
      async (paths) => new Set(evicted ? paths : []),
      2_000,
      Date.now,
      0,
    );
    expect(await cache.isEvicted("/x")).toBe(false);
    evicted = true;
    expect(await cache.isEvicted("/x")).toBe(true);
  });

  it("requests within the window share one probe (a grid of thumbnails)", async () => {
    const probe = vi.fn(async (paths: string[]) => new Set(paths.filter((p) => p.endsWith(".a"))));
    const cache = new EvictionCache(probe, 2_000, Date.now, 5);
    const answers = await Promise.all(["/1.a", "/2.b", "/3.a"].map((p) => cache.isEvicted(p)));
    expect(answers).toEqual([true, false, true]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("remembers an evicted answer for the TTL only, and forget() drops it after a download", async () => {
    let now = 0;
    let evicted = true;
    const probe = vi.fn(async (paths: string[]) => new Set(evicted ? paths : []));
    const cache = new EvictionCache(probe, 2_000, () => now, 0);
    expect(await cache.isEvicted("/x")).toBe(true);
    expect(await cache.isEvicted("/x")).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    // Past the TTL, an evicted answer is asked again (no forget()).
    now = 5_000;
    expect(await cache.isEvicted("/x")).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
    // Within the TTL again, forget() makes the next read ask at once.
    evicted = false;
    cache.forget("/x");
    expect(await cache.isEvicted("/x")).toBe(false);
    expect(probe).toHaveBeenCalledTimes(3);
  });
});

describe("datalessPaths deadline (a stalled provider)", () => {
  it("reports every path not answered by the deadline as evicted, and stops asking", async () => {
    let now = 0;
    const paths = Array.from({ length: 450 }, (_, i) => `/w/${i}.mp4`);
    const runStat = vi.fn(async (batch: string[]) => {
      now += 6_000; // each batch answers only after the per-call timeout
      return { stdout: batch.map((p) => `0 ${p}`).join("\n"), failed: false };
    });
    const result = await datalessPaths(paths, deps({ runStat }), {
      deadlineMs: 10_000,
      now: () => now,
    });
    expect(runStat).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(50);
    expect(result.has("/w/449.mp4")).toBe(true);
    expect(result.has("/w/0.mp4")).toBe(false);
  });

  it("a stat call that hangs is cut at the deadline: every path reads as evicted", async () => {
    const started = Date.now();
    const result = await datalessPaths(
      ["/w/a.mp4", "/w/b.mp4"],
      deps({ runStat: () => new Promise(() => {}) }),
      { deadlineMs: 50 },
    );
    expect([...result].sort()).toEqual(["/w/a.mp4", "/w/b.mp4"]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("a stalled lstat in the fallback is cut at the deadline too", async () => {
    const started = Date.now();
    const result = await datalessPaths(
      ["/w/a.mp4", "/w/stuck.mp4", "/w/c.mp4"],
      deps({
        runStat: async () => ({ stdout: "", failed: true }),
        lstat: (path) =>
          path.endsWith("stuck.mp4")
            ? new Promise(() => {})
            : Promise.resolve({ size: 9, blocks: 8 }),
      }),
      { deadlineMs: 50 },
    );
    // a.mp4 was answered (local); the stuck one and everything after it are unanswered.
    expect([...result].sort()).toEqual(["/w/c.mp4", "/w/stuck.mp4"]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
