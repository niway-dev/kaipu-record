import { describe, expect, it, vi } from "vitest";
import type { MoveItemRef } from "@shared/types/workspaces";
import { MaintenanceError } from "../library/vault-activity";
import { StaleWorkspaceError } from "./gate";
import { refusalOfError, rememberingUnavailable, runMoveGroup } from "./move-group";

const items: MoveItemRef[] = ["a", "b", "c", "d"].map((id) => ({ id, assetId: `x-${id}` }));

describe("runMoveGroup", () => {
  it("moves one after another in order; a failure does not stop the rest", async () => {
    const calls: string[] = [];
    let inFlight = 0;
    const result = await runMoveGroup(
      items,
      async (item) => {
        inFlight += 1;
        expect(inFlight).toBe(1);
        calls.push(item.id);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return item.id === "b"
          ? { ok: false, reason: "checksum-mismatch" }
          : { ok: true, newId: `${item.id}-new` };
      },
      { targetId: "t" },
    );
    expect(calls).toEqual(["a", "b", "c", "d"]);
    expect(result).toEqual({
      targetId: "t",
      moved: [
        { id: "a", newId: "a-new" },
        { id: "c", newId: "c-new" },
        { id: "d", newId: "d-new" },
      ],
      failed: [{ id: "b", reason: "checksum-mismatch" }],
      skipped: [],
    });
  });

  it("reports progress as n of N before each move", async () => {
    const progress: string[] = [];
    await runMoveGroup(items.slice(0, 2), async () => ({ ok: true, newId: "n" }), {
      targetId: "t",
      onProgress: (p) => progress.push(`${p.current}/${p.total}`),
    });
    expect(progress).toEqual(["1/2", "2/2"]);
  });

  it("Stop lets the move in flight finish and starts no further one", async () => {
    let stop = false;
    const result = await runMoveGroup(
      items,
      async (item) => {
        if (item.id === "b") stop = true;
        return { ok: true, newId: item.id };
      },
      { targetId: "t", stopped: () => stop },
    );
    expect(result.moved.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result.skipped).toEqual(["c", "d"]);
  });

  it("a move that throws counts as failed with an io reason", async () => {
    const result = await runMoveGroup(
      items.slice(0, 1),
      async () => {
        throw new Error("boom");
      },
      { targetId: "t" },
    );
    expect(result.failed).toEqual([{ id: "a", reason: "io" }]);
  });
});

describe("refusalOfError", () => {
  it("says stale only for a stale window, maintenance for maintenance, and io for the rest", () => {
    expect(refusalOfError(new StaleWorkspaceError())).toBe("stale");
    expect(refusalOfError(new MaintenanceError())).toBe("maintenance");
    expect(refusalOfError(new Error("EACCES: reading the device id"))).toBe("io");
    expect(refusalOfError("not even an Error")).toBe("io");
  });
});

describe("rememberingUnavailable", () => {
  it("asks once more per item while the target answers, and never again after it does not", async () => {
    const answers: Array<string | null> = ["/ws", "/ws", null, "/ws"];
    const resolve = vi.fn(async () => answers.shift() ?? null);
    const target = rememberingUnavailable(resolve);
    expect(await target()).toBe("/ws");
    expect(await target()).toBe("/ws");
    // A stalled provider costs one bound for the group, not one per remaining item.
    expect(await target()).toBeNull();
    expect(await target()).toBeNull();
    expect(await target()).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(3);
  });
});
