import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSerializedCommit } from "./use-serialized-commit";

describe("useSerializedCommit", () => {
  it("runs tasks one after another, in the order they were queued", async () => {
    const { result } = renderHook(() => useSerializedCommit());
    const order: string[] = [];
    const first = result.current(async () => {
      await Promise.resolve();
      order.push("first");
    });
    const second = result.current(async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("a task that throws rejects its own caller and does not stall the next task", async () => {
    const { result } = renderHook(() => useSerializedCommit());
    const failed = result.current(async () => {
      throw new Error("boom");
    });
    const next = result.current(async () => "ran");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  it("a task that armed a render wait holds the next one until the owner renders", async () => {
    const { result, rerender } = renderHook(() => useSerializedCommit());
    const order: string[] = [];
    void result.current(async (armRenderWait) => {
      armRenderWait();
      order.push("first");
    });
    const second = result.current(async () => {
      order.push("second");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["first"]);
    rerender();
    await second;
    expect(order).toEqual(["first", "second"]);
  });
});
