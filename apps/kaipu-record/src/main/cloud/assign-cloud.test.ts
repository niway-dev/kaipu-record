import { describe, expect, it, vi } from "vitest";
import type { AssignOutcome } from "./assign-client";
import { assignCloudItems, type AssignCloudDeps } from "./assign-cloud";

function deps(
  outcomes: Record<string, AssignOutcome> = {},
  overrides: Partial<AssignCloudDeps> = {},
) {
  const calls = {
    confirmed: [] as string[],
    deferred: [] as string[],
    marked: 0,
  };
  const value: AssignCloudDeps = {
    registered: new Set(["ws-a", "ws-b"]),
    account: () => ({ userId: "u", token: "t" }),
    assign: vi.fn(async (_t: string, assetId: string) => outcomes[assetId] ?? "ok"),
    confirmed: async (assetId) => {
      calls.confirmed.push(assetId);
    },
    defer: async (assetId) => {
      calls.deferred.push(assetId);
    },
    markAssigned: async () => {
      calls.marked += 1;
    },
    ...overrides,
  };
  return { value, calls };
}

describe("assignCloudItems (Assign to workspace…)", () => {
  it("assigns each item, defers the unanswered ones, reports the missing ones", async () => {
    const { value, calls } = deps({ late: "retry", old: "unsupported", gone: "not-found" });
    const result = await assignCloudItems(["a", "late", "old", "gone", "a"], "ws-b", value);
    expect(result).toEqual({
      assigned: ["a"],
      queued: ["late", "old"],
      failed: [{ assetId: "gone", reason: "not-found" }],
    });
    expect(calls).toEqual({ confirmed: ["a"], deferred: ["late", "old"], marked: 1 });
  });

  it("refuses a workspace not registered on this Mac, and sends nothing", async () => {
    const { value, calls } = deps();
    const result = await assignCloudItems(["a"], "ws-elsewhere", value);
    expect(result.failed).toEqual([{ assetId: "a", reason: "unknown-workspace" }]);
    expect(value.assign).not.toHaveBeenCalled();
    expect(calls.marked).toBe(0);
  });

  it("signed out, nothing is sent and the first-assignment flag stays unset", async () => {
    const { value, calls } = deps({}, { account: () => null });
    const result = await assignCloudItems(["a"], "ws-a", value);
    expect(result.failed).toEqual([{ assetId: "a", reason: "signed-out" }]);
    expect(calls.marked).toBe(0);
  });

  it("ignores ids that are not strings", async () => {
    const { value } = deps();
    expect((await assignCloudItems([1, null, "a"], "ws-a", value)).assigned).toEqual(["a"]);
    expect((await assignCloudItems("a", "ws-a", value)).assigned).toEqual([]);
  });
});
