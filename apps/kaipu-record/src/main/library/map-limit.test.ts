import { describe, expect, it } from "vitest";
import { mapLimit } from "./map-limit";

describe("mapLimit", () => {
  it("keeps the input order and never runs more than `limit` calls at once", async () => {
    let running = 0;
    let peak = 0;
    const result = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });

  it("starts no new item once one call has failed (round 11 #7)", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (n === 1) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    await new Promise((resolve) => setTimeout(resolve, 40));
    // Items 1 and 2 were in flight; the worker that finished 2 must not go on to 3..6.
    expect(started).toEqual([1, 2]);
  });
});
