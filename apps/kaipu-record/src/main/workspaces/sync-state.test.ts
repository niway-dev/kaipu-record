import { describe, expect, it, vi } from "vitest";
import { boundedProbe, scratchDrag, scratchTmp, SyncStates } from "./sync-state";

describe("SyncStates", () => {
  it("answers with the path rule before detection, then with what was detected", async () => {
    const states = new SyncStates(async () => "google-drive");
    const entry = { id: "w", path: "/Users/x/Documents/K" };
    expect(states.of(entry)).toBeNull();
    await states.refresh(entry);
    expect(states.of(entry)).toBe("google-drive");
  });

  it("a relocated workspace is re-read from its new path", async () => {
    const detect = vi.fn(async () => "google-drive" as const);
    const states = new SyncStates(detect);
    await states.refresh({ id: "w", path: "/Users/x/Documents/K" });
    expect(states.of({ id: "w", path: "/Volumes/T7/K" })).toBeNull();
  });
});

describe("scratch folders", () => {
  it("live in userData, per workspace, outside the workspace folder", () => {
    expect(scratchTmp("/ud", "ws-1")).toBe("/ud/workspace-scratch/ws-1/tmp");
    expect(scratchDrag("/ud", "ws-1")).toBe("/ud/workspace-scratch/ws-1/drag");
  });
});

describe("boundedProbe", () => {
  it("answers the fallback when the provider does not answer in time", async () => {
    expect(await boundedProbe(new Promise<string>(() => {}), "timeout", 20)).toBe("timeout");
    expect(await boundedProbe(Promise.resolve("ok"), "timeout", 20)).toBe("ok");
  });
});
