import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceGate } from "./gate";
import { relocateRefusal, relocateWorkspace, type RelocateDeps } from "./relocate";
import { WorkspaceRegistry } from "./registry";

/**
 * The relocate flow main runs after the folder picker: the lock, the rules, and, for the active
 * workspace, the same transaction a switch uses (prepare windows, drain the gate, bump the
 * generation, refresh the library).
 */

let root: string;
let defaultDir: string;
let ids: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kaipu-relocate-flow-"));
  defaultDir = join(root, "Movies", "Kaipu Record");
  await mkdir(join(root, "userData"), { recursive: true });
  ids = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Harness {
  deps: RelocateDeps;
  registry: WorkspaceRegistry;
  gate: WorkspaceGate;
  log: string[];
  workId: string;
  workFolder: string;
  setBusy(value: "recording" | "exporting" | null): void;
}

async function harness(overrides: Partial<RelocateDeps> = {}): Promise<Harness> {
  const registry = await WorkspaceRegistry.open({
    preferencesFile: join(root, "userData", "preferences.json"),
    defaultDirectory: defaultDir,
    now: () => 1,
    newId: () => `0192f0c4-0000-7000-8000-${String(++ids).padStart(12, "0")}`,
  });
  const workFolder = join(root, "Work");
  await mkdir(workFolder);
  const added = await registry.add(workFolder);
  if (!added.ok) throw new Error("setup");
  await registry.edit(added.entry.id, { name: "Work" });
  const gate = new WorkspaceGate(registry.active().id);
  const log: string[] = [];
  let busy: "recording" | "exporting" | null = null;
  const deps: RelocateDeps = {
    registry,
    gate,
    busy: () => busy,
    prepareWindows: async () => {
      log.push("prepare");
      return true;
    },
    abortWindows: () => log.push("abort"),
    dropPendingCaptures: () => log.push("drop captures"),
    afterCommit: (stamp) => log.push(`commit ${stamp.workspaceId}#${stamp.generation}`),
    ...overrides,
  };
  return {
    deps,
    registry,
    gate,
    log,
    workId: added.entry.id,
    workFolder,
    setBusy: (value) => void (busy = value),
  };
}

describe("relocateWorkspace, a workspace that is not the active one", () => {
  it("points it at the moved folder without touching the windows or the generation", async () => {
    const h = await harness();
    const moved = join(root, "Moved");
    await rename(h.workFolder, moved);

    const outcome = await relocateWorkspace(h.deps, h.workId, moved);

    expect(outcome).toMatchObject({ ok: true, entry: { id: h.workId, path: moved } });
    expect(h.log).toEqual([]);
    expect(h.gate.stamp.generation).toBe(1);
  });

  it("is refused while a recording runs", async () => {
    const h = await harness();
    h.setBusy("recording");
    const moved = join(root, "Moved");
    await rename(h.workFolder, moved);

    expect(await relocateWorkspace(h.deps, h.workId, moved)).toEqual({
      ok: false,
      reason: "recording",
    });
    expect(h.registry.get(h.workId)?.path).toBe(h.workFolder);
  });

  it("is refused while an export runs", async () => {
    const h = await harness();
    h.setBusy("exporting");
    const moved = join(root, "Moved");
    await rename(h.workFolder, moved);

    expect(await relocateWorkspace(h.deps, h.workId, moved)).toEqual({
      ok: false,
      reason: "exporting",
    });
  });

  it("applies the registry's rules: an empty folder is refused", async () => {
    const h = await harness();
    const empty = join(root, "Empty");
    await mkdir(empty);

    expect(await relocateWorkspace(h.deps, h.workId, empty)).toEqual({
      ok: false,
      reason: "not-a-workspace",
    });
    expect(h.log).toEqual([]);
  });
});

describe("relocateWorkspace, the active workspace", () => {
  async function movedDefault(): Promise<string> {
    const moved = join(root, "Drive", "Default");
    await mkdir(join(root, "Drive"));
    await rename(defaultDir, moved);
    return moved;
  }

  it("runs the switch transaction: prepare windows, drain, persist, drop captures, bump", async () => {
    const h = await harness();
    const id = h.registry.active().id;
    const moved = await movedDefault();

    const outcome = await relocateWorkspace(h.deps, id, moved);

    expect(outcome).toMatchObject({ ok: true, entry: { id, path: moved } });
    expect(h.log).toEqual(["prepare", "drop captures", `commit ${id}#2`]);
    expect(h.gate.stamp).toEqual({ workspaceId: id, generation: 2 });
    expect(h.gate.switching).toBe(false);
    expect(h.registry.active().path).toBe(moved);
  });

  it("does nothing when the picked folder is the one it already points at", async () => {
    const h = await harness();
    const id = h.registry.active().id;

    const outcome = await relocateWorkspace(h.deps, id, defaultDir);

    expect(outcome).toMatchObject({ ok: true, unchanged: true, entry: { id, path: defaultDir } });
    // No window is asked to save, no capture is dropped, and no route remounts.
    expect(h.log).toEqual([]);
    expect(h.gate.stamp).toEqual({ workspaceId: id, generation: 1 });
  });

  it("is refused while a recording runs, before asking any window", async () => {
    const h = await harness();
    const id = h.registry.active().id;
    const moved = await movedDefault();
    h.setBusy("recording");

    expect(await relocateWorkspace(h.deps, id, moved)).toEqual({ ok: false, reason: "recording" });
    expect(h.log).toEqual([]);
    expect(h.registry.active().path).toBe(defaultDir);
  });

  it("is refused when a recording started while the windows were preparing", async () => {
    const h = await harness({
      prepareWindows: async () => {
        h.setBusy("recording");
        return true;
      },
    });
    const id = h.registry.active().id;
    const moved = await movedDefault();

    expect(await relocateWorkspace(h.deps, id, moved)).toEqual({ ok: false, reason: "recording" });
    expect(h.log).toEqual(["abort"]);
    expect(h.gate.stamp.generation).toBe(1);
    expect(h.gate.switching).toBe(false);
  });

  it("changes nothing when a window cancels (an unsaved editor: Keep editing)", async () => {
    const h = await harness({ prepareWindows: async () => false });
    const id = h.registry.active().id;
    const moved = await movedDefault();

    expect(await relocateWorkspace(h.deps, id, moved)).toEqual({ ok: false, reason: "cancelled" });
    expect(h.registry.active().path).toBe(defaultDir);
    expect(h.gate.stamp.generation).toBe(1);
  });

  it("asks no window about a folder it is going to refuse", async () => {
    const h = await harness();
    const id = h.registry.active().id;

    expect(await relocateWorkspace(h.deps, id, h.workFolder)).toEqual({
      ok: false,
      reason: "already-registered",
      workspaceName: "Work",
    });
    expect(h.log).toEqual([]);
    expect(h.gate.stamp.generation).toBe(1);
  });

  it("reopens the gate and aborts the windows when the registry cannot store the path", async () => {
    const h = await harness();
    const id = h.registry.active().id;
    const moved = await movedDefault();
    // preferences.json is now a directory: the write fails after the windows were prepared.
    await rm(join(root, "userData", "preferences.json"));
    await mkdir(join(root, "userData", "preferences.json"));

    const outcome = await relocateWorkspace(h.deps, id, moved);

    expect(outcome).toEqual({ ok: false, reason: "not-writable" });
    expect(h.log).toEqual(["prepare", "abort"]);
    expect(h.gate.switching).toBe(false);
    expect(h.gate.stamp.generation).toBe(1);
    expect(h.registry.active().path).toBe(defaultDir);
  });

  it("does not overlap another transaction", async () => {
    let release!: () => void;
    const h = await harness({
      prepareWindows: () => new Promise<boolean>((resolve) => (release = () => resolve(true))),
    });
    const id = h.registry.active().id;
    const moved = await movedDefault();
    const first = relocateWorkspace(h.deps, id, moved);
    await new Promise((r) => setTimeout(r, 10));

    expect(await relocateWorkspace(h.deps, id, moved)).toEqual({ ok: false, reason: "cancelled" });
    release();
    expect(await first).toMatchObject({ ok: true });
  });
});

describe("relocateRefusal (the check before the picker opens)", () => {
  it("passes when nothing is running", async () => {
    const h = await harness();
    expect(relocateRefusal(h.deps, h.workId)).toBeNull();
  });

  it("refuses while recording or exporting, and for an unknown workspace", async () => {
    const h = await harness();
    h.setBusy("recording");
    expect(relocateRefusal(h.deps, h.workId)).toEqual({ ok: false, reason: "recording" });
    h.setBusy("exporting");
    expect(relocateRefusal(h.deps, h.workId)).toEqual({ ok: false, reason: "exporting" });
    h.setBusy(null);
    expect(relocateRefusal(h.deps, "nope")).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses when preferences are read-only", async () => {
    const h = await harness();
    await writeFile(join(root, "userData", "broken.json"), "{broken");
    const readOnly = await WorkspaceRegistry.open({
      preferencesFile: join(root, "userData", "broken.json"),
      defaultDirectory: defaultDir,
      newId: () => "0192f0c4-0000-7000-8000-00000000ffff",
    });
    expect(relocateRefusal({ ...h.deps, registry: readOnly }, readOnly.active().id)).toEqual({
      ok: false,
      reason: "read-only",
    });
  });
});
