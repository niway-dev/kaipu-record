import { describe, expect, it } from "vitest";
import { boundedProbe, scratchDrag, scratchTmp, SyncStates } from "./sync-state";

describe("SyncStates", () => {
  const HOME = "/Users/x";
  const drive = `${HOME}/Library/CloudStorage/GoogleDrive-x@y.z/My Drive/K`;

  it("answers with the path rule before detection, then with what was detected", async () => {
    // Detection says what the path rule cannot (Drive's xattr on a folder outside CloudStorage).
    const states = new SyncStates(async () => "google-drive", HOME);
    expect(states.of({ id: "d", path: drive })).toBe("google-drive");
    const elsewhere = { id: "w", path: `${HOME}/Documents/K` };
    expect(states.of(elsewhere)).toBeNull();
    await states.refresh(elsewhere);
    expect(states.of(elsewhere)).toBe("google-drive");
  });

  it("a relocated workspace is read from its new path, not from the old detection", async () => {
    const states = new SyncStates(async () => null, HOME);
    await states.refresh({ id: "w", path: `${HOME}/Movies/K` });
    expect(states.of({ id: "w", path: `${HOME}/Movies/K` })).toBeNull();
    expect(states.of({ id: "w", path: drive })).toBe("google-drive");
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
