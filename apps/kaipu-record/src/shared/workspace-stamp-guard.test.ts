import { describe, expect, it } from "vitest";
import { WorkspaceStampGuard } from "./workspace-stamp-guard";

const broadcast = (
  activeId: string,
  generation: number,
): { activeId: string; generation: number } => ({
  activeId,
  generation,
});

describe("WorkspaceStampGuard", () => {
  it("takes the stamp of every broadcast", () => {
    const guard = new WorkspaceStampGuard({ workspaceId: "ws-a", generation: 1 });
    guard.changed(broadcast("ws-b", 2));
    expect(guard.stamp).toEqual({ workspaceId: "ws-b", generation: 2 });
  });

  it("stays switching through a broadcast that does not end the switch (a lock or registry change)", () => {
    const guard = new WorkspaceStampGuard({ workspaceId: "ws-a", generation: 1 });
    guard.prepared(true);
    expect(guard.switching).toBe(true);

    // dismissHint, remove or a busy-state change: same workspace, same generation.
    guard.changed(broadcast("ws-a", 1));

    expect(guard.switching).toBe(true);
  });

  it("stops switching with the broadcast that ends the switch: a new generation", () => {
    const guard = new WorkspaceStampGuard({ workspaceId: "ws-a", generation: 1 });
    guard.prepared(true);
    guard.changed(broadcast("ws-b", 2));
    expect(guard.switching).toBe(false);
  });

  it("stops switching on an abort", () => {
    const guard = new WorkspaceStampGuard({ workspaceId: "ws-a", generation: 1 });
    guard.prepared(true);
    guard.abort();
    expect(guard.switching).toBe(false);
  });

  it("does not start switching when this window did not accept the prepare", () => {
    const guard = new WorkspaceStampGuard({ workspaceId: "ws-a", generation: 1 });
    guard.prepared(false);
    expect(guard.switching).toBe(false);
  });

  it("knows whether an answer comes back under the stamp it was sent with", () => {
    const guard = new WorkspaceStampGuard({ workspaceId: "ws-a", generation: 1 });
    const sent = guard.stamp;
    expect(guard.isCurrent(sent)).toBe(true);
    guard.changed(broadcast("ws-b", 2));
    expect(guard.isCurrent(sent)).toBe(false);
    expect(guard.isCurrent(null)).toBe(false);
  });
});
