import { describe, expect, it, vi } from "vitest";
import { STALE_WORKSPACE } from "@shared/types/workspaces";
import { WorkspaceGate } from "./gate";
import { switchWorkspace, type SwitchDeps } from "./switch-transaction";

function setup(overrides: Partial<SwitchDeps> = {}): {
  deps: SwitchDeps;
  log: string[];
  gate: WorkspaceGate;
  active: () => string;
} {
  const log: string[] = [];
  const gate = new WorkspaceGate("ws-a");
  let activeId = "ws-a";
  const deps: SwitchDeps = {
    gate,
    activeId: () => activeId,
    isKnown: (id) => id === "ws-a" || id === "ws-b",
    readOnly: () => false,
    availability: async (id) => {
      log.push(`probe ${id}`);
      return { availability: { state: "available" }, id };
    },
    busy: () => null,
    prepareWindows: async () => {
      log.push("prepare");
      return true;
    },
    abortWindows: () => log.push("abort"),
    dropPendingCaptures: () => log.push("drop captures"),
    persistActive: async (id) => {
      log.push(`persist ${id}`);
      activeId = id;
    },
    afterCommit: (stamp) => log.push(`commit ${stamp.workspaceId}#${stamp.generation}`),
    ...overrides,
  };
  return { deps, log, gate, active: () => activeId };
}

describe("switchWorkspace", () => {
  it("runs the transaction in order: probe, prepare windows, drain, persist, drop captures, bump", async () => {
    const { deps, log, gate } = setup();

    expect(await switchWorkspace(deps, "ws-b")).toEqual({ ok: true });

    expect(log).toEqual([
      "probe ws-b",
      "prepare",
      "persist ws-b",
      "drop captures",
      "commit ws-b#2",
    ]);
    expect(gate.stamp).toEqual({ workspaceId: "ws-b", generation: 2 });
  });

  it("is refused while a recording or an export runs (the LOCKED state), before asking any window", async () => {
    const recording = setup({ busy: () => "recording" });
    expect(await switchWorkspace(recording.deps, "ws-b")).toEqual({
      ok: false,
      reason: "recording",
    });
    expect(recording.log).toEqual([]);

    const exporting = setup({ busy: () => "exporting" });
    expect(await switchWorkspace(exporting.deps, "ws-b")).toEqual({
      ok: false,
      reason: "exporting",
    });
    expect(exporting.active()).toBe("ws-a");
  });

  it("is refused when a recording started while the windows were preparing", async () => {
    let busy: "recording" | null = null;
    const { deps, log, gate } = setup({
      busy: () => busy,
      prepareWindows: async () => {
        busy = "recording";
        return true;
      },
    });

    expect(await switchWorkspace(deps, "ws-b")).toEqual({ ok: false, reason: "recording" });
    expect(log).toContain("abort");
    expect(gate.stamp).toEqual({ workspaceId: "ws-a", generation: 1 });
    expect(gate.switching).toBe(false);
  });

  it("is refused for a target that is not connected, and never falls back", async () => {
    const { deps, log, active } = setup({
      availability: async (id) => ({
        availability: { state: "unavailable", reason: "missing" },
        id,
      }),
    });

    expect(await switchWorkspace(deps, "ws-b")).toEqual({ ok: false, reason: "unavailable" });
    expect(log).not.toContain("prepare");
    expect(active()).toBe("ws-a");
  });

  it("a window that cancels (an unsaved editor) aborts it, and the old workspace stays as it was", async () => {
    const { deps, log, gate, active } = setup({ prepareWindows: async () => false });

    expect(await switchWorkspace(deps, "ws-b")).toEqual({ ok: false, reason: "cancelled" });

    expect(log).toEqual(["probe ws-b", "abort"]);
    expect(active()).toBe("ws-a");
    expect(gate.stamp).toEqual({ workspaceId: "ws-a", generation: 1 });
    expect(await gate.run({ workspaceId: "ws-a", generation: 1 }, () => "still works")).toBe(
      "still works",
    );
  });

  it("waits for a call already running in the old workspace before it commits", async () => {
    const { deps, log, gate } = setup();
    let finish!: () => void;
    const running = gate.run(gate.stamp, () => new Promise<void>((r) => (finish = r)));

    const switching = switchWorkspace(deps, "ws-b");
    await new Promise((r) => setTimeout(r, 0));
    expect(log).not.toContain("persist ws-b");

    finish();
    await running;
    expect(await switching).toEqual({ ok: true });
  });

  it("after the switch, a call stamped with the old workspace is rejected and writes nothing", async () => {
    const { deps, gate } = setup();
    const old = gate.stamp;
    await switchWorkspace(deps, "ws-b");
    const write = vi.fn();

    await expect(gate.run(old, write)).rejects.toThrow(STALE_WORKSPACE);
    expect(write).not.toHaveBeenCalled();
  });

  it("a failed persist leaves the old workspace active and the gate open", async () => {
    const { deps, gate, log } = setup({
      persistActive: async () => {
        throw new Error("disk full");
      },
    });

    await expect(switchWorkspace(deps, "ws-b")).rejects.toThrow("disk full");
    expect(gate.stamp).toEqual({ workspaceId: "ws-a", generation: 1 });
    expect(gate.switching).toBe(false);
    expect(log).toContain("abort");
  });

  it("a failed persist keeps the pending captures: they are dropped only once the switch is certain", async () => {
    const { deps, log } = setup({
      persistActive: async () => {
        throw new Error("disk full");
      },
    });

    await expect(switchWorkspace(deps, "ws-b")).rejects.toThrow("disk full");
    expect(log).not.toContain("drop captures");
  });

  it("refuses an unknown id, a read-only registry, and a second switch while one runs", async () => {
    expect(await switchWorkspace(setup().deps, "ws-x")).toEqual({ ok: false, reason: "unknown" });
    expect(await switchWorkspace(setup({ readOnly: () => true }).deps, "ws-b")).toEqual({
      ok: false,
      reason: "read-only",
    });

    let release!: (ok: boolean) => void;
    const { deps } = setup({ prepareWindows: () => new Promise<boolean>((r) => (release = r)) });
    const first = switchWorkspace(deps, "ws-b");
    await new Promise((r) => setTimeout(r, 0));
    expect(await switchWorkspace(deps, "ws-b")).toEqual({ ok: false, reason: "cancelled" });
    release(true);
    expect(await first).toEqual({ ok: true });
  });

  it("switching to the active workspace is a no-op", async () => {
    const { deps, log } = setup();
    expect(await switchWorkspace(deps, "ws-a")).toEqual({ ok: true });
    expect(log).toEqual([]);
  });
});
