import { describe, expect, it, vi } from "vitest";
import {
  boundedProbe,
  probeWorkspaceFacts,
  scratchDrag,
  scratchTmp,
  stagingDirForPath,
  SyncStates,
} from "./sync-state";

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

describe("SyncStates, a pending workspace adopts its folder's id", () => {
  const HOME = "/Users/x";
  const path = `${HOME}/Documents/K`;

  it("keeps a detection the path rule cannot reproduce under the new id", async () => {
    const states = new SyncStates(async () => "google-drive", HOME);
    await states.refresh({ id: "pending", path });
    states.markUnverified("pending");
    states.rekey("pending", "adopted");

    // Without the re-key the new id would read as plain (the path is outside CloudStorage).
    expect(states.of({ id: "adopted", path })).toBe("google-drive");
    expect(states.isUnverified("adopted")).toBe(true);
    expect(states.of({ id: "pending", path })).toBeNull();
    expect(states.isUnverified("pending")).toBe(false);
  });

  it("carries a provisional plain answer, so the adopted workspace is still detected again", async () => {
    const states = new SyncStates(
      async () => null,
      HOME,
      async () => false,
    );
    await states.refresh({ id: "pending", path });
    states.rekey("pending", "adopted");
    expect(states.needsRecheck("adopted")).toBe(true);
    expect(states.needsRecheck("pending")).toBe(false);
  });

  it("is a no-op for the same id", async () => {
    const states = new SyncStates(async () => "google-drive", HOME);
    await states.refresh({ id: "w", path });
    states.rekey("w", "w");
    expect(states.of({ id: "w", path })).toBe("google-drive");
  });
});

describe("SyncStates, a plain answer given before the folder was there", () => {
  const HOME = "/Users/x";
  const entry = { id: "w", path: `${HOME}/Documents/K` };

  it("is provisional until detected again: a mount that was not up at launch is not 'not synced'", async () => {
    let mounted = false;
    const detect = vi.fn(async () => (mounted ? ("google-drive" as const) : null));
    const states = new SyncStates(detect, HOME, async () => mounted);
    expect(await states.refresh(entry)).toBeNull();
    expect(states.needsRecheck("w")).toBe(true);
    mounted = true;
    expect(await states.refresh(entry)).toBe("google-drive");
    expect(states.needsRecheck("w")).toBe(false);
    expect(states.of(entry)).toBe("google-drive");
  });

  it("a plain folder whose identity file is there is final", async () => {
    const states = new SyncStates(
      async () => null,
      HOME,
      async () => true,
    );
    await states.refresh(entry);
    expect(states.needsRecheck("w")).toBe(false);
  });

  it("forget drops it", async () => {
    const states = new SyncStates(
      async () => null,
      HOME,
      async () => false,
    );
    await states.refresh(entry);
    states.forget("w");
    expect(states.needsRecheck("w")).toBe(false);
  });
});

describe("SyncStates, workspaces whose check did not answer", () => {
  const HOME = "/Users/x";
  const entry = { id: "w", path: `${HOME}/Movies/K` };

  it("stays unverified until a check answers, a new detection runs or the workspace goes", async () => {
    const states = new SyncStates(async () => "google-drive", HOME);
    states.markUnverified("w");
    expect(states.isUnverified("w")).toBe(true);
    states.answered("w");
    expect(states.isUnverified("w")).toBe(false);

    states.markUnverified("w");
    await states.refresh(entry); // relocated: the old verdict is no longer about this folder
    expect(states.isUnverified("w")).toBe(false);

    states.markUnverified("w");
    states.forget("w");
    expect(states.isUnverified("w")).toBe(false);
  });
});

describe("SyncStates, overlapping detections of one workspace (NIW2-912)", () => {
  const HOME = "/Users/x";
  const oldPath = `${HOME}/Documents/Old`;
  const newPath = `${HOME}/Documents/New`;

  /** A detector whose answers the test releases one at a time, in any order. */
  function stalled() {
    const waiting: { path: string; answer(value: "google-drive" | null): void }[] = [];
    const detect = (path: string) =>
      new Promise<"google-drive" | null>((resolve) =>
        waiting.push({ path, answer: (value) => resolve(value) }),
      );
    return { detect, waiting };
  }

  it("an older detection that lands after a newer one does not put the old path back", async () => {
    const { detect, waiting } = stalled();
    const states = new SyncStates(detect, HOME, async () => true);
    const first = states.refresh({ id: "w", path: oldPath }); // the launch detection, slow
    const second = states.refresh({ id: "w", path: newPath }); // the relocation's, newer
    waiting[1]!.answer("google-drive"); // the newer one answers first
    await second;
    waiting[0]!.answer(null); // the stale one lands last
    await first;

    // The relocated folder keeps what the newer detection found (the path rule cannot say it).
    expect(states.of({ id: "w", path: newPath })).toBe("google-drive");
  });

  it("a detection that lands after forget does not bring the workspace back", async () => {
    const { detect, waiting } = stalled();
    const states = new SyncStates(detect, HOME, async () => false);
    const pending = states.refresh({ id: "w", path: oldPath });
    states.forget("w");
    waiting[0]!.answer(null);
    await pending;

    expect(states.needsRecheck("w")).toBe(false);
    expect(states.of({ id: "w", path: oldPath })).toBeNull();
  });

  it("a detection that lands after rekey leaves the old id gone", async () => {
    const { detect, waiting } = stalled();
    const states = new SyncStates(detect, HOME, async () => false);
    const entry = { id: "pending", path: oldPath };
    const inFlight = states.refresh(entry);
    entry.id = "adopted"; // the registry mutates a pending entry in place
    states.rekey("pending", "adopted");
    waiting[0]!.answer(null);
    await inFlight;

    expect(states.needsRecheck("pending")).toBe(false);
    expect(states.needsRecheck("adopted")).toBe(false);
  });
});

describe("scratch folders", () => {
  it("live in userData, per workspace, outside the workspace folder", () => {
    expect(scratchTmp("/ud", "ws-1")).toBe("/ud/workspace-scratch/ws-1/tmp");
    expect(scratchDrag("/ud", "ws-1")).toBe("/ud/workspace-scratch/ws-1/drag");
  });
});

describe("stagingDirForPath: where an atomic write under a workspace stages its temp file", () => {
  const HOME = "/Users/me";
  const drive = `${HOME}/Library/CloudStorage/GoogleDrive-me@x.com/My Drive/Work`;
  const plain = "/Volumes/Disk/Work";
  const entries = [
    { id: "ws-drive", path: drive },
    { id: "ws-plain", path: plain },
  ];
  const stage = (target: string, synced: (id: string) => boolean = (id) => id === "ws-drive") =>
    stagingDirForPath(target, entries, (entry) => synced(entry.id), "/ud", HOME);

  it("is the scratch folder of the synced workspace that holds the file", () => {
    expect(stage(`${drive}/.kaipu/tags.json`)).toBe("/ud/workspace-scratch/ws-drive/tmp");
    expect(stage(`${drive}/Demo.mp4`)).toBe("/ud/workspace-scratch/ws-drive/tmp");
  });

  it("is null for a plain workspace, userData and any other path: they keep their behavior", () => {
    expect(stage(`${plain}/.kaipu/tags.json`)).toBeNull();
    expect(stage("/ud/preferences.json")).toBeNull();
    expect(stage("/Users/me/Downloads/transcript.srt")).toBeNull();
  });

  it("does not take a sibling folder that only shares the prefix", () => {
    expect(stage(`${plain}-old/file.json`)).toBeNull();
    // Inside the provider but in no registered workspace: the shared scratch, not ws-drive's.
    expect(stage(`${drive}-old/file.json`)).toBe("/ud/workspace-scratch/unregistered/tmp");
  });

  it("follows what the registry detected, not the path alone", () => {
    expect(stage(`${plain}/a.json`, (id) => id === "ws-plain")).toBe(
      "/ud/workspace-scratch/ws-plain/tmp",
    );
    expect(stage(`${drive}/a.json`, () => false)).toBeNull();
  });

  it("the innermost registered workspace decides for a nested folder", () => {
    const nested = [...entries, { id: "ws-inner", path: `${plain}/Inner` }];
    expect(
      stagingDirForPath(`${plain}/Inner/a.json`, nested, (e) => e.id === "ws-inner", "/ud", HOME),
    ).toBe("/ud/workspace-scratch/ws-inner/tmp");
    expect(
      stagingDirForPath(`${plain}/Inner/a.json`, nested, (e) => e.id === "ws-plain", "/ud", HOME),
    ).toBeNull();
  });

  it("a folder inside a provider that no workspace holds yet stages in the shared unregistered scratch", () => {
    const fresh = `${HOME}/Library/CloudStorage/OneDrive-Personal/New/.kaipu/workspace/identity.json`;
    expect(stage(fresh)).toBe("/ud/workspace-scratch/unregistered/tmp");
  });
});

describe("boundedProbe", () => {
  it("answers the fallback when the provider does not answer in time", async () => {
    expect(await boundedProbe(new Promise<string>(() => {}), "timeout", 20)).toBe("timeout");
    expect(await boundedProbe(Promise.resolve("ok"), "timeout", 20)).toBe("ok");
  });
});

describe("probeWorkspaceFacts", () => {
  const never = () => new Promise<never>(() => {});

  it("a stalled synced folder costs one deadline, with the count and the drive asked together", async () => {
    const started = Date.now();
    const facts = await probeWorkspaceFacts(
      { synced: true, skip: false, remainingMs: 60 },
      { count: never, device: never },
    );
    expect(facts).toEqual({ count: null, device: null });
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("an unverified folder asks nothing", async () => {
    const count = vi.fn(async () => 3);
    const device = vi.fn(async () => "1");
    expect(
      await probeWorkspaceFacts(
        { synced: true, skip: true, remainingMs: 5_000 },
        { count, device },
      ),
    ).toEqual({ count: null, device: null });
    expect(count).not.toHaveBeenCalled();
    expect(device).not.toHaveBeenCalled();
  });

  it("a plain folder's slow count is waited for, never turned into a missing number", async () => {
    const slow = () => new Promise<number>((resolve) => setTimeout(() => resolve(7), 80));
    const facts = await probeWorkspaceFacts(
      { synced: false, skip: false, remainingMs: 10 },
      { count: slow, device: async () => "9" },
    );
    expect(facts).toEqual({ count: 7, device: "9" });
  });
});
