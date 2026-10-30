import { describe, expect, it } from "vitest";
import { STALE_WORKSPACE } from "@shared/types/workspaces";
import { WorkspaceGate } from "./gate";

const deferred = <T = void>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("WorkspaceGate", () => {
  it("runs a call stamped with the active workspace and generation", async () => {
    const gate = new WorkspaceGate("ws-a");
    expect(await gate.run({ workspaceId: "ws-a", generation: 1 }, () => 42)).toBe(42);
  });

  it("rejects a stale workspace id, a stale generation and a missing stamp, without running", async () => {
    const gate = new WorkspaceGate("ws-a");
    let ran = 0;
    const work = (): number => ++ran;
    await expect(gate.run({ workspaceId: "ws-b", generation: 1 }, work)).rejects.toThrow(
      STALE_WORKSPACE,
    );
    await expect(gate.run({ workspaceId: "ws-a", generation: 0 }, work)).rejects.toThrow(
      STALE_WORKSPACE,
    );
    await expect(gate.run(undefined, work)).rejects.toThrow(STALE_WORKSPACE);
    await expect(gate.run({ workspaceId: "ws-a" }, work)).rejects.toThrow(STALE_WORKSPACE);
    expect(ran).toBe(0);
  });

  it("after a commit, the old stamp is stale and the new one runs", async () => {
    const gate = new WorkspaceGate("ws-a");
    await gate.close();
    const next = gate.commit("ws-b");

    expect(next).toEqual({ workspaceId: "ws-b", generation: 2 });
    await expect(gate.run({ workspaceId: "ws-a", generation: 1 }, () => 1)).rejects.toThrow(
      STALE_WORKSPACE,
    );
    // Same id, old generation: a switch away and back still invalidates the old calls.
    await gate.close();
    gate.commit("ws-a");
    await expect(gate.run({ workspaceId: "ws-a", generation: 1 }, () => 1)).rejects.toThrow(
      STALE_WORKSPACE,
    );
    expect(await gate.run({ workspaceId: "ws-a", generation: 3 }, () => 1)).toBe(1);
  });

  it("close() waits for running calls and rejects new ones until the switch ends", async () => {
    const gate = new WorkspaceGate("ws-a");
    const stamp = gate.stamp;
    const slow = deferred<string>();
    const running = gate.run(stamp, () => slow.promise);

    let closed = false;
    const closing = gate.close().then(() => (closed = true));
    await Promise.resolve();
    expect(closed).toBe(false);
    await expect(gate.run(stamp, () => "late")).rejects.toThrow(STALE_WORKSPACE);

    slow.resolve("done");
    expect(await running).toBe("done");
    await closing;
    expect(closed).toBe(true);
  });

  it("a failing call still drains", async () => {
    const gate = new WorkspaceGate("ws-a");
    await expect(gate.run(gate.stamp, () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await gate.close();
    expect(gate.switching).toBe(true);
  });

  it("reopen() after an aborted switch keeps the workspace and the generation", async () => {
    const gate = new WorkspaceGate("ws-a");
    await gate.close();
    gate.reopen();
    expect(gate.stamp).toEqual({ workspaceId: "ws-a", generation: 1 });
    expect(await gate.run({ workspaceId: "ws-a", generation: 1 }, () => "ok")).toBe("ok");
  });

  it("runActive guards main-internal work bound to a workspace id (a toast's Save)", async () => {
    const gate = new WorkspaceGate("ws-a");
    expect(await gate.runActive("ws-a", () => "saved")).toBe("saved");
    await expect(gate.runActive("ws-b", () => "saved")).rejects.toThrow(STALE_WORKSPACE);
    await gate.close();
    await expect(gate.runActive("ws-a", () => "saved")).rejects.toThrow(STALE_WORKSPACE);
  });

  it("rebind() follows a pending workspace that adopted its folder's id, with a new generation", () => {
    const gate = new WorkspaceGate("ws-pending");
    expect(gate.rebind("ws-real")).toEqual({ workspaceId: "ws-real", generation: 2 });
  });
});
