import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAvailability, type AvailabilityDeps } from "./availability-check";
import { SYNCED_PROBE_TIMEOUT_MS, SyncStates } from "./sync-state";

const HOME = "/Users/x";
const DRIVE = `${HOME}/Library/CloudStorage/GoogleDrive-x@y.z/My Drive/K`;
const AVAILABLE = { availability: { state: "available" as const }, id: "w" };
const never = () => new Promise<never>(() => {});

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

function deps(
  path: string,
  options: {
    states?: SyncStates;
    availability: AvailabilityDeps["reg"]["availability"];
    isDirectory?: AvailabilityDeps["isDirectory"];
  },
): AvailabilityDeps & { states: SyncStates } {
  const states =
    options.states ??
    new SyncStates(
      async () => null,
      HOME,
      async () => true,
    );
  return {
    states,
    syncStates: states,
    reg: {
      get: (id) => (id === "w" ? { id: "w", path } : undefined),
      availability: options.availability,
    },
    isDirectory: options.isDirectory ?? (async () => true),
  };
}

describe("checkAvailability", () => {
  it("a synced folder that does not answer is available but unverified, within the bound", async () => {
    const d = deps(DRIVE, { availability: never });
    const result = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS + 1);
    expect(await result).toEqual({ availability: { state: "available" }, id: "w" });
    expect(d.states.isUnverified("w")).toBe(true);
  });

  it("a plain folder first detected without its identity file is bounded too (AC13)", async () => {
    // Detected "not synced" while `identity.json` was missing: provisional. The mount is stalled.
    const states = new SyncStates(
      async () => null,
      HOME,
      async () => false,
    );
    await states.refresh({ id: "w", path: `${HOME}/Documents/K` });
    expect(states.needsRecheck("w")).toBe(true);
    const d = deps(`${HOME}/Documents/K`, { states, availability: never });
    const result = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS + 1);
    expect(await result).toEqual({ availability: { state: "available" }, id: "w" });
    expect(states.isUnverified("w")).toBe(true);
  });

  it("a plain folder with its identity file is never bounded: a slow local folder is no stalled provider", async () => {
    let resolve: (value: typeof AVAILABLE) => void = () => {};
    const d = deps(`${HOME}/Movies/K`, {
      availability: () => new Promise((r) => (resolve = r)),
    });
    // Detected at launch: plain, with `identity.json` there to be asked about (the stub says so),
    // so the answer is final and no provisional flag asks for another detection.
    await d.states.refresh({ id: "w", path: `${HOME}/Movies/K` });
    expect(d.states.needsRecheck("w")).toBe(false);
    const result = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS * 3);
    resolve(AVAILABLE);
    expect(await result).toEqual(AVAILABLE);
    expect(d.states.isUnverified("w")).toBe(false);
  });

  it("a late, timed-out check does not mark the workspace unverified after a newer one answered", async () => {
    let release: (isDirectory: boolean) => void = () => {};
    const asked = vi
      .fn<AvailabilityDeps["reg"]["availability"]>()
      .mockImplementationOnce(never) // check A: the provider is stalled
      .mockResolvedValue(AVAILABLE); // check B: it answered
    const d = deps(DRIVE, {
      availability: asked,
      isDirectory: () => new Promise((r) => (release = r)), // A's `stat` is slow too
    });
    const a = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS + 1); // A is now in its `stat` step
    expect(await checkAvailability(d, "w")).toEqual(AVAILABLE); // B answers
    release(true);
    expect(await a).toEqual({ availability: { state: "available" }, id: "w" });
    expect(d.states.isUnverified("w")).toBe(false); // A's late result left B's answer alone
  });

  it("the newest check still marks an unanswered workspace unverified", async () => {
    const d = deps(DRIVE, { availability: never });
    const first = checkAvailability(d, "w");
    const second = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS + 1);
    await Promise.all([first, second]);
    expect(d.states.isUnverified("w")).toBe(true);
  });
});
