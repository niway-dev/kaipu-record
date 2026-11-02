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
  it("asks once per path within the window, then again after it", async () => {
    let now = 0;
    const probe = vi.fn(async (paths: string[]) => new Set(paths.filter((p) => p.endsWith(".a"))));
    const cache = new EvictionCache(probe, 2_000, () => now);
    expect(await cache.isEvicted("/x.a")).toBe(true);
    expect(await cache.isEvicted("/x.a")).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    now = 2_500;
    expect(await cache.isEvicted("/x.a")).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(await cache.isEvicted("/y.b")).toBe(false);
  });

  it("forget() drops a path, so a download that just finished is served at once", async () => {
    let evicted = true;
    const cache = new EvictionCache(async (paths) => new Set(evicted ? paths : []), 60_000);
    expect(await cache.isEvicted("/x")).toBe(true);
    evicted = false;
    cache.forget("/x");
    expect(await cache.isEvicted("/x")).toBe(false);
  });
});
