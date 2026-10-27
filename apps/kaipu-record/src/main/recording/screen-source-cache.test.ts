import { describe, expect, it, vi } from "vitest";
import { ScreenSourceCache, type ScreenSource } from "./screen-source-cache";

const SCREEN_1: ScreenSource = { id: "screen:1:0", name: "Screen 1", display_id: "1" };
const SCREEN_2: ScreenSource = { id: "screen:2:0", name: "Screen 2", display_id: "2" };

const byDisplay =
  (displayId: string) =>
  (list: ScreenSource[]): ScreenSource | undefined =>
    list.find((source) => source.display_id === displayId);

describe("ScreenSourceCache", () => {
  it("lists once for a prefetch and the finds after it", async () => {
    const list = vi.fn(async () => [SCREEN_1, SCREEN_2]);
    const cache = new ScreenSourceCache(list);
    cache.prefetch();
    expect(await cache.find(byDisplay("2"))).toBe(SCREEN_2);
    expect(await cache.find(byDisplay("1"))).toBe(SCREEN_1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("lists again after invalidate", async () => {
    const list = vi.fn(async () => [SCREEN_1]);
    const cache = new ScreenSourceCache(list);
    await cache.find(byDisplay("1"));
    cache.invalidate();
    await cache.find(byDisplay("1"));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("never keeps a failed or empty listing", async () => {
    const list = vi
      .fn<() => Promise<ScreenSource[]>>()
      .mockRejectedValueOnce(new Error("no permission"))
      .mockResolvedValueOnce([])
      .mockResolvedValue([SCREEN_1]);
    const cache = new ScreenSourceCache(list);
    expect(await cache.find(byDisplay("1"))).toBeUndefined();
    expect(await cache.find(byDisplay("1"))).toBeUndefined();
    expect(await cache.find(byDisplay("1"))).toBe(SCREEN_1);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("lists again once when the kept list has no match, so a stale list never wins", async () => {
    const list = vi
      .fn<() => Promise<ScreenSource[]>>()
      .mockResolvedValueOnce([SCREEN_1])
      .mockResolvedValue([SCREEN_1, SCREEN_2]);
    const cache = new ScreenSourceCache(list);
    await cache.find(byDisplay("1"));
    expect(await cache.find(byDisplay("2"))).toBe(SCREEN_2);
    expect(await cache.find(byDisplay("9"))).toBeUndefined();
    expect(list).toHaveBeenCalledTimes(3);
  });
});
