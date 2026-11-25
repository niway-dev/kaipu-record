import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAvailability, verifiedFolder, type AvailabilityDeps } from "./availability-check";
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
      get: (id) => (id === "w" || id === "adopted" ? { id, path } : undefined),
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
    expect(await result).toEqual({
      availability: { state: "available" },
      id: "w",
      unverified: true,
    });
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
    expect(await result).toEqual({
      availability: { state: "available" },
      id: "w",
      unverified: true,
    });
    expect(states.isUnverified("w")).toBe(true);
  });

  describe("a workspace first detected as plain without its identity file (AC13)", () => {
    const PLAIN_PATH = `${HOME}/Documents/K`;
    /** Detected plain once with no identity file to ask about, then again on the recheck. */
    async function provisional(secondAnswer: "google-drive" | null) {
      const detect = vi
        .fn<(path: string) => Promise<"google-drive" | null>>()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(secondAnswer);
      let identityThere = false;
      const states = new SyncStates(detect, HOME, async () => identityThere);
      await states.refresh({ id: "w", path: PLAIN_PATH });
      expect(states.needsRecheck("w")).toBe(true);
      identityThere = true; // the mount came up: the next detection can read the folder
      return { states, detect };
    }

    it("is detected again once the folder answers, and goes on as a synced workspace when it is one", async () => {
      const { states, detect } = await provisional("google-drive");
      const asked = vi.fn<AvailabilityDeps["reg"]["availability"]>().mockResolvedValue(AVAILABLE);
      const d = deps(PLAIN_PATH, { states, availability: asked });

      expect(await checkAvailability(d, "w")).toEqual(AVAILABLE);

      expect(detect).toHaveBeenCalledTimes(2);
      // The folder is asked once as a provisional plain one, then again as the synced one it is.
      expect(asked).toHaveBeenCalledTimes(2);
      expect(states.of({ id: "w", path: PLAIN_PATH })).toBe("google-drive");
      expect(states.needsRecheck("w")).toBe(false);
      expect(states.isUnverified("w")).toBe(false);
    });

    it("stays plain, with the first answer, when the second detection still finds no provider", async () => {
      const { states, detect } = await provisional(null);
      const asked = vi.fn<AvailabilityDeps["reg"]["availability"]>().mockResolvedValue(AVAILABLE);
      const d = deps(PLAIN_PATH, { states, availability: asked });

      expect(await checkAvailability(d, "w")).toEqual(AVAILABLE);

      expect(detect).toHaveBeenCalledTimes(2);
      expect(asked).toHaveBeenCalledTimes(1); // no second probe: nothing to verify
      expect(states.of({ id: "w", path: PLAIN_PATH })).toBeNull();
    });

    it("counts a probe that rejects as unanswered: available under its id, unverified", async () => {
      const { states } = await provisional(null);
      const d = deps(PLAIN_PATH, {
        states,
        availability: async () => {
          throw new Error("EIO: the provider failed");
        },
      });

      expect(await checkAvailability(d, "w")).toEqual({
        availability: { state: "available" },
        id: "w",
        unverified: true,
      });
      expect(states.isUnverified("w")).toBe(true);
    });

    it("keeps the unverified flag when the id was adopted by the first probe and the second one stalls", async () => {
      const { states } = await provisional("google-drive");
      const asked = vi
        .fn<AvailabilityDeps["reg"]["availability"]>()
        .mockResolvedValueOnce({ availability: { state: "available" }, id: "adopted" })
        .mockImplementation(never);
      const d = deps(PLAIN_PATH, { states, availability: asked });

      const result = checkAvailability(d, "w");
      await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS + 1);

      expect(await result).toEqual({
        availability: { state: "available" },
        id: "adopted",
        unverified: true,
      });
      // A move must not treat it as verified: its provider never answered the second probe.
      expect(states.isUnverified("adopted")).toBe(true);
    });
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
    // A got no answer, and says so to its own caller; B's answer is still the shared flag's.
    expect(await a).toEqual({ availability: { state: "available" }, id: "w", unverified: true });
    expect(d.states.isUnverified("w")).toBe(false); // A's late result left B's answer alone
  });

  it("a superseded check that got no answer still reports unverified while the newer one waits", async () => {
    const asked = vi
      .fn<AvailabilityDeps["reg"]["availability"]>()
      .mockImplementationOnce(never) // check A (a move): the provider is stalled
      .mockImplementationOnce(() => new Promise((r) => setTimeout(() => r(AVAILABLE), 20_000))); // B starts later and is still waiting
    const d = deps(DRIVE, { availability: asked });
    const a = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(1_000);
    const b = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS - 1_000 + 1); // A times out, B has not
    expect(await a).toMatchObject({ availability: { state: "available" }, unverified: true });
    expect(d.states.isUnverified("w")).toBe(false); // the shared flag cannot be read as "unverified" yet
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS);
    await b;
  });

  it("the newest check still marks an unanswered workspace unverified", async () => {
    const d = deps(DRIVE, { availability: never });
    const first = checkAvailability(d, "w");
    const second = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS + 1);
    await Promise.all([first, second]);
    expect(d.states.isUnverified("w")).toBe(true);
  });

  it("a pending workspace that adopts its folder's id is verified under the adopted id (NIW2-912)", async () => {
    // The first check stalls: "w" is unverified. The next one answers, and the registry has
    // adopted the folder's own id by then. The answer belongs to the adopted id; leaving it
    // unverified would keep a reachable workspace on the slow path all session.
    const asked = vi
      .fn<AvailabilityDeps["reg"]["availability"]>()
      .mockImplementationOnce(never)
      .mockResolvedValue({ availability: { state: "available" }, id: "adopted" });
    const d = deps(DRIVE, { availability: asked });
    const first = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS + 1);
    await first;
    expect(d.states.isUnverified("w")).toBe(true);
    const result = await checkAvailability(d, "w");
    expect(result.id).toBe("adopted");
    expect(d.states.isUnverified("adopted")).toBe(false);
  });
});

describe("verifiedFolder (what a move reads from its own check)", () => {
  it("refuses a move after its own check got no answer, even though a newer check owns the shared flag", async () => {
    const asked = vi
      .fn<AvailabilityDeps["reg"]["availability"]>()
      .mockImplementationOnce(never) // the move's check: the provider is stalled
      .mockImplementationOnce(() => new Promise((r) => setTimeout(() => r(AVAILABLE), 20_000))); // the switcher's check is still waiting
    const d = deps(DRIVE, { availability: asked });
    const move = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(1_000);
    const switcher = checkAvailability(d, "w");
    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS - 1_000 + 1);
    const checked = await move;

    // The shared flag is not set yet: only the check's own result knows it got no answer.
    expect(d.states.isUnverified("w")).toBe(false);
    expect(verifiedFolder(d.reg, d.states, checked)).toBeNull();

    await vi.advanceTimersByTimeAsync(SYNCED_PROBE_TIMEOUT_MS);
    await switcher;
  });

  it("hands the folder over for an answered check", async () => {
    const d = deps(DRIVE, { availability: async () => AVAILABLE });
    const checked = await checkAvailability(d, "w");
    expect(verifiedFolder(d.reg, d.states, checked)).toBe(DRIVE);
  });

  it("is null for a folder that is not available", () => {
    const d = deps(DRIVE, { availability: async () => AVAILABLE });
    expect(
      verifiedFolder(d.reg, d.states, {
        availability: { state: "unavailable", reason: "missing" },
        id: "w",
      }),
    ).toBeNull();
  });
});
