import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppSettings } from "@shared/types";
import { mergeSettings } from "../services/settings.service";
import * as overridesModule from "./settings-overrides";
import { MachineSettingsStore, SETTINGS_FILE, resolveEffective } from "./settings-overrides";
import { WorkspaceSettings } from "./workspace-settings";

interface Ws {
  id: string;
  name: string;
  path: string;
  available: boolean;
}

const DEFAULTS = mergeSettings(null);

let userData: string;
let work: Ws;
let personal: Ws;
let active: string;
let all: AppSettings;
let changed: ReturnType<typeof vi.fn<() => void>>;
let settings: WorkspaceSettings;
let machineStore: MachineSettingsStore;
let availabilityGate: Promise<void> | null;
let clock: number;

const folderFile = (ws: Ws): string => join(ws.path, SETTINGS_FILE);
const machineFile = (): string => join(userData, "workspace-settings.json");

async function putFolderFile(ws: Ws, overrides: Record<string, unknown>): Promise<string> {
  await mkdir(join(ws.path, ".kaipu", "workspace"), { recursive: true });
  const text = JSON.stringify({ version: 1, overrides });
  await writeFile(folderFile(ws), text);
  return text;
}

async function build(): Promise<WorkspaceSettings> {
  const machine = await MachineSettingsStore.open(machineFile());
  machineStore = machine;
  const instance = new WorkspaceSettings({
    machine,
    workspaces: () => [work, personal],
    activeId: () => active,
    isAvailable: async (id) => {
      await availabilityGate;
      return [work, personal].find((ws) => ws.id === id)?.available ?? false;
    },
    getAll: () => all,
    writeAll: (patch) => {
      all = { ...all, ...patch };
    },
    effective: () => resolveEffective(all, instance.activeOverrides()),
    changed: () => changed(),
    now: () => ++clock,
  });
  return instance;
}

beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "kaipu-userdata-"));
  const make = async (id: string, name: string): Promise<Ws> => ({
    id,
    name,
    path: await mkdtemp(join(tmpdir(), `kaipu-${id}-`)),
    available: true,
  });
  work = await make("work", "Work");
  personal = await make("personal", "Personal");
  active = "work";
  all = { ...DEFAULTS, screenshotCopy: "auto", showBrandBadge: true };
  changed = vi.fn<() => void>();
  clock = 1000;
  availabilityGate = null;
  settings = await build();
});

afterEach(async () => {
  for (const dir of [userData, work.path, personal.path]) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("effective settings", () => {
  it("equals the All level when no workspace overrides anything", async () => {
    await settings.refresh("work");
    expect(settings.activeOverrides()).toEqual({});
    const scoped = await settings.getScoped("work");
    expect(scoped.effective).toEqual(all);
    expect(scoped.folder).toBe("none");
  });

  it("follows the active workspace: only its overrides apply", async () => {
    await expect(settings.setOverride("work", "screenshotCopy", "manual")).resolves.toMatchObject({
      ok: true,
    });
    expect(settings.activeOverrides()).toEqual({ screenshotCopy: "manual" });
    active = "personal";
    await settings.refresh("personal");
    expect(settings.activeOverrides()).toEqual({});
  });

  it("changing an All value changes every workspace that does not override it", async () => {
    await settings.setOverride("work", "showBrandBadge", false);
    all = { ...all, showBrandBadge: true, screenshotCopy: "manual" };
    const work$ = await settings.getScoped("work");
    expect(work$.effective.showBrandBadge).toBe(false);
    expect(work$.effective.screenshotCopy).toBe("manual");
    const personal$ = await settings.getScoped("personal");
    expect(personal$.effective.showBrandBadge).toBe(true);
  });

  it("the scoped read of the All level returns the persisted All values, never an override", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    const scoped = await settings.getScoped("all");
    expect(scoped.effective.screenshotCopy).toBe("auto");
    expect(scoped.all.screenshotCopy).toBe("auto");
    expect(scoped.overrides).toEqual({});
  });
});

describe("where each key is stored", () => {
  it("keeps the four folder keys in the workspace's .kaipu/workspace/settings.json", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    await settings.setOverride("work", "showBrandBadge", false);
    await settings.setOverride("work", "exportQuality", "maximum");
    await settings.setOverride("work", "recordingQuality", {
      resolution: DEFAULTS.recordingQuality.resolution,
      fps: DEFAULTS.recordingQuality.fps,
      bitrate: DEFAULTS.recordingQuality.bitrate,
    });
    const file = JSON.parse(await readFile(folderFile(work), "utf-8")) as {
      version: number;
      overrides: Record<string, unknown>;
    };
    expect(file.version).toBe(1);
    expect(Object.keys(file.overrides).sort()).toEqual([
      "exportQuality",
      "recordingQuality",
      "screenshotCopy",
      "showBrandBadge",
    ]);
  });

  it("keeps uploadMode in userData keyed by workspace id, never in the folder", async () => {
    await expect(settings.setOverride("work", "uploadMode", "automatic")).resolves.toMatchObject({
      ok: true,
    });
    await expect(readFile(folderFile(work), "utf-8")).rejects.toThrow();
    const machine = JSON.parse(await readFile(machineFile(), "utf-8")) as {
      workspaces: Record<string, { uploadMode?: string }>;
    };
    expect(machine.workspaces["work"]?.uploadMode).toBe("automatic");
    expect(settings.activeOverrides()).toEqual({ uploadMode: "automatic" });
  });

  it("never touches the All level when an override is set", async () => {
    const before = { ...all };
    await settings.setOverride("work", "screenshotCopy", "manual");
    await settings.setOverride("work", "uploadMode", "manual");
    expect(all).toEqual(before);
  });

  it("refuses a key that is not overridable and a value that is not valid", async () => {
    await expect(settings.setOverride("work", "theme" as never, "light")).resolves.toEqual({
      ok: false,
      reason: "not-overridable",
    });
    await expect(settings.setOverride("work", "shortcuts" as never, {})).resolves.toEqual({
      ok: false,
      reason: "not-overridable",
    });
    await expect(settings.setOverride("work", "screenshotCopy", "always")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    await expect(settings.setOverride("nowhere", "screenshotCopy", "manual")).resolves.toEqual({
      ok: false,
      reason: "unknown-workspace",
    });
    await expect(readFile(folderFile(work), "utf-8")).rejects.toThrow();
  });

  it("refuses to edit an unavailable workspace and leaves both of its files alone", async () => {
    await settings.setOverride("personal", "uploadMode", "manual");
    personal.available = false;
    const machineBefore = await readFile(machineFile(), "utf-8");
    await expect(settings.setOverride("personal", "uploadMode", "automatic")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(settings.setOverride("personal", "screenshotCopy", "manual")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await readFile(machineFile(), "utf-8")).toBe(machineBefore);
    const scoped = await settings.getScoped("personal");
    expect(scoped.folder).toBe("unavailable");
  });
});

describe("folder overrides need confirmation on this Mac", () => {
  it("leaves an adopted folder's override inactive, with no record in userData", async () => {
    await putFolderFile(work, { screenshotCopy: "manual" });
    await settings.refresh("work");
    expect(settings.activeOverrides()).toEqual({});
    const scoped = await settings.getScoped("work");
    expect(scoped.folder).toBe("pending");
    expect(scoped.effective.screenshotCopy).toBe("auto");
    expect(scoped.pending).toEqual({ screenshotCopy: "manual" });
    await expect(readFile(machineFile(), "utf-8")).rejects.toThrow();
  });

  it("'Use them' records the sha256 and activates the file; a restart does not ask again", async () => {
    await putFolderFile(work, { screenshotCopy: "manual" });
    await settings.refresh("work");
    const { folderSha256 } = await settings.getScoped("work");
    expect(folderSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(settings.resolvePending("work", "use", folderSha256!)).resolves.toMatchObject({
      ok: true,
    });
    expect(settings.activeOverrides()).toEqual({ screenshotCopy: "manual" });
    const record = JSON.parse(await readFile(machineFile(), "utf-8")) as {
      workspaces: { work: { folderOverrides: { sha256: string; decision: string } } };
    };
    expect(record.workspaces.work.folderOverrides).toMatchObject({
      sha256: folderSha256,
      decision: "use",
    });

    const restarted = await build();
    await restarted.refresh("work");
    expect(restarted.activeOverrides()).toEqual({ screenshotCopy: "manual" });
    expect((await restarted.getScoped("work")).folder).toBe("active");
  });

  it("asks again when the file changes (sync from another machine)", async () => {
    await putFolderFile(work, { screenshotCopy: "manual" });
    await settings.refresh("work");
    const first = (await settings.getScoped("work")).folderSha256!;
    await settings.resolvePending("work", "use", first);
    expect(settings.activeOverrides()).toEqual({ screenshotCopy: "manual" });

    // Another machine's content lands on disk.
    await putFolderFile(work, { screenshotCopy: "auto", showBrandBadge: false });
    changed.mockClear();
    await settings.refresh("work");
    expect(settings.activeOverrides()).toEqual({});
    expect(changed).toHaveBeenCalled();
    const scoped = await settings.getScoped("work");
    expect(scoped.folder).toBe("pending");
    expect(scoped.pending).toEqual({ screenshotCopy: "auto", showBrandBadge: false });
    expect(scoped.folderSha256).not.toBe(first);
  });

  it("does not re-prompt for an unchanged file, and a refresh that changes nothing stays quiet", async () => {
    await putFolderFile(work, { screenshotCopy: "manual" });
    await settings.refresh("work");
    await settings.resolvePending("work", "use", (await settings.getScoped("work")).folderSha256!);
    changed.mockClear();
    await settings.refresh("work");
    await settings.refresh("work");
    expect((await settings.getScoped("work")).folder).toBe("active");
    expect(changed).not.toHaveBeenCalled();
  });

  it("'Ignore' keeps the All level, leaves the file untouched and stays ignored until the hash changes", async () => {
    const text = await putFolderFile(work, { screenshotCopy: "manual" });
    await settings.refresh("work");
    await settings.resolvePending(
      "work",
      "ignore",
      (await settings.getScoped("work")).folderSha256!,
    );
    expect(settings.activeOverrides()).toEqual({});
    expect(await readFile(folderFile(work), "utf-8")).toBe(text);
    expect((await settings.getScoped("work")).folder).toBe("ignored");

    await settings.refresh("work");
    expect((await settings.getScoped("work")).folder).toBe("ignored");

    await putFolderFile(work, { screenshotCopy: "auto" });
    await settings.refresh("work");
    expect((await settings.getScoped("work")).folder).toBe("pending");
  });

  it("refuses an answer for a file that changed after the user saw it", async () => {
    await putFolderFile(work, { screenshotCopy: "manual" });
    await settings.refresh("work");
    const seen = (await settings.getScoped("work")).folderSha256!;
    await putFolderFile(work, { screenshotCopy: "manual", showBrandBadge: false });
    await expect(settings.resolvePending("work", "use", seen)).resolves.toEqual({
      ok: false,
      reason: "changed",
    });
    expect(settings.activeOverrides()).toEqual({});
  });

  it("has nothing to resolve without a file", async () => {
    await expect(settings.resolvePending("work", "use", "x")).resolves.toEqual({
      ok: false,
      reason: "nothing-pending",
    });
  });

  it("a change this Mac writes itself records the new hash and never asks", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    expect((await settings.getScoped("work")).folder).toBe("active");
    await settings.setOverride("work", "showBrandBadge", false);
    expect((await settings.getScoped("work")).folder).toBe("active");
    await settings.resetOverrides("work", ["screenshotCopy"]);
    const scoped = await settings.getScoped("work");
    expect(scoped.folder).toBe("active");
    expect(scoped.overrides).toEqual({ showBrandBadge: false });
    const restarted = await build();
    await restarted.refresh("work");
    expect((await restarted.getScoped("work")).folder).toBe("active");
  });

  it("refuses to write over a pending file the user has not answered", async () => {
    const text = await putFolderFile(work, { screenshotCopy: "manual" });
    await settings.refresh("work");
    await expect(settings.setOverride("work", "showBrandBadge", false)).resolves.toEqual({
      ok: false,
      reason: "pending",
    });
    expect(await readFile(folderFile(work), "utf-8")).toBe(text);
  });

  it("replaces the content of an ignored file with the keys this Mac now writes", async () => {
    await putFolderFile(work, { screenshotCopy: "manual", exportQuality: "maximum" });
    await settings.refresh("work");
    await settings.resolvePending(
      "work",
      "ignore",
      (await settings.getScoped("work")).folderSha256!,
    );
    await expect(settings.setOverride("work", "showBrandBadge", false)).resolves.toMatchObject({
      ok: true,
    });
    const file = JSON.parse(await readFile(folderFile(work), "utf-8")) as {
      overrides: Record<string, unknown>;
    };
    expect(file.overrides).toEqual({ showBrandBadge: false });
    expect(settings.activeOverrides()).toEqual({ showBrandBadge: false });
  });

  it("an unreadable file leaves the overrides inactive and nothing is written over it", async () => {
    await mkdir(join(work.path, ".kaipu", "workspace"), { recursive: true });
    await writeFile(folderFile(work), "{broken");
    await settings.refresh("work");
    expect(settings.activeOverrides()).toEqual({});
    expect((await settings.getScoped("work")).folder).toBe("unreadable");
    await expect(settings.setOverride("work", "showBrandBadge", false)).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(await readFile(folderFile(work), "utf-8")).toBe("{broken");
  });

  it("an unknown key, an invalid value and an uploadMode in the folder file never take effect", async () => {
    await putFolderFile(work, {
      uploadMode: "automatic",
      theme: "light",
      screenshotCopy: "sometimes",
      showBrandBadge: false,
    });
    await settings.refresh("work");
    expect((await settings.getScoped("work")).pending).toEqual({ showBrandBadge: false });
    await settings.resolvePending("work", "use", (await settings.getScoped("work")).folderSha256!);
    expect(settings.activeOverrides()).toEqual({ showBrandBadge: false });
    expect((await settings.getScoped("work")).effective.uploadMode).toBe(all.uploadMode);
  });
});

describe("reset", () => {
  it("removes the override and the row falls back to the All value", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    await settings.setOverride("work", "uploadMode", "automatic");
    await expect(
      settings.resetOverrides("work", ["screenshotCopy", "uploadMode"]),
    ).resolves.toMatchObject({ ok: true });
    expect(settings.activeOverrides()).toEqual({});
    const scoped = await settings.getScoped("work");
    expect(scoped.effective.screenshotCopy).toBe(all.screenshotCopy);
    expect(scoped.effective.uploadMode).toBe(all.uploadMode);
    expect(changed).toHaveBeenCalled();
  });

  it("resetting a key that is not overridden creates no file", async () => {
    await expect(settings.setOverride("work", "screenshotCopy", null)).resolves.toMatchObject({
      ok: true,
    });
    await expect(readFile(folderFile(work), "utf-8")).rejects.toThrow();
  });
});

describe("copy to all workspaces", () => {
  it("writes the value to the All level and clears the key in every other workspace", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    await settings.setOverride("personal", "screenshotCopy", "auto");
    await settings.setOverride("personal", "showBrandBadge", false);
    const result = await settings.copyToAll("work", ["screenshotCopy"]);
    expect(result).toMatchObject({ ok: true, keptOwn: [] });
    expect(all.screenshotCopy).toBe("manual");
    // Both workspaces now inherit it; Personal keeps the key it did not copy.
    expect((await settings.getScoped("work")).overrides).toEqual({});
    expect((await settings.getScoped("personal")).overrides).toEqual({ showBrandBadge: false });
    expect((await settings.getScoped("personal")).effective.screenshotCopy).toBe("manual");
  });

  it("copies the value the workspace shows, even when it only inherits it", async () => {
    all = { ...all, showBrandBadge: true };
    await settings.setOverride("personal", "showBrandBadge", false);
    const result = await settings.copyToAll("work", ["showBrandBadge"]);
    expect(result.ok).toBe(true);
    expect(all.showBrandBadge).toBe(true);
    expect((await settings.getScoped("personal")).overrides).toEqual({});
  });

  it("copies uploadMode too, clearing every machine-bound override of the key", async () => {
    await settings.setOverride("work", "uploadMode", "automatic");
    await settings.setOverride("personal", "uploadMode", "manual");
    await settings.copyToAll("work", ["uploadMode"]);
    expect(all.uploadMode).toBe("automatic");
    expect((await settings.getScoped("personal")).overrides).toEqual({});
  });

  it("copies several keys at once", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    await settings.setOverride("work", "exportQuality", "maximum");
    await settings.copyToAll("work", ["screenshotCopy", "exportQuality"]);
    expect(all.screenshotCopy).toBe("manual");
    expect(all.exportQuality).toBe("maximum");
    expect((await settings.getScoped("work")).overrides).toEqual({});
  });

  it("names a workspace it cannot clear instead of pretending it reached everyone", async () => {
    await settings.setOverride("personal", "screenshotCopy", "auto");
    await settings.setOverride("work", "screenshotCopy", "manual");
    personal.available = false;
    const result = await settings.copyToAll("work", ["screenshotCopy"]);
    expect(result).toMatchObject({ ok: true, keptOwn: ["Personal"] });
    expect(all.screenshotCopy).toBe("manual");
    personal.available = true;
    // Its own file is as it was.
    expect((await settings.getScoped("personal")).overrides).toEqual({ screenshotCopy: "auto" });
  });

  it("refuses a key that is not overridable", async () => {
    await expect(settings.copyToAll("work", ["theme" as never])).resolves.toEqual({
      ok: false,
      reason: "not-overridable",
    });
  });
});

describe("the All scope", () => {
  it("lists the workspaces that override each key", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    await settings.setOverride("personal", "uploadMode", "manual");
    const scoped = await settings.getScoped("all");
    expect(scoped.overriddenIn).toEqual({ screenshotCopy: ["Work"], uploadMode: ["Personal"] });
  });

  it("does not list a workspace whose override is only pending", async () => {
    await putFolderFile(personal, { screenshotCopy: "manual" });
    const scoped = await settings.getScoped("all");
    expect(scoped.overriddenIn).toEqual({});
  });
});

describe("review fixes", () => {
  it("a failed machine record writes nothing to the folder and leaves the active overrides alone", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    const before = await readFile(folderFile(work), "utf-8");
    vi.spyOn(machineStore, "update").mockRejectedValueOnce(new Error("disk full"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(settings.setOverride("work", "showBrandBadge", false)).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
    // The hash is recorded before the file is replaced, so a failed record leaves the file as it was.
    expect(await readFile(folderFile(work), "utf-8")).toBe(before);
    expect(settings.activeOverrides()).toEqual({ screenshotCopy: "manual" });
    expect((await settings.getScoped("work")).folder).toBe("active");
  });

  it("clears uploadMode even when the folder file is pending", async () => {
    await settings.setOverride("work", "uploadMode", "automatic");
    await putFolderFile(work, { screenshotCopy: "manual" });
    await settings.refresh("work");
    const result = await settings.resetOverrides("work", ["screenshotCopy", "uploadMode"]);
    expect(result).toEqual({ ok: false, reason: "pending" });
    expect(settings.activeOverrides()).toEqual({});
    expect(machineStore.get("work").uploadMode).toBeUndefined();
  });

  it("two edits of one workspace at once both land and the file stays confirmed", async () => {
    await Promise.all([
      settings.setOverride("work", "screenshotCopy", "manual"),
      settings.setOverride("work", "showBrandBadge", false),
      settings.setOverride("work", "exportQuality", "maximum"),
    ]);
    const scoped = await settings.getScoped("work");
    expect(scoped.folder).toBe("active");
    expect(scoped.overrides).toEqual({
      screenshotCopy: "manual",
      showBrandBadge: false,
      exportQuality: "maximum",
    });
  });

  it("does not name a disconnected workspace that holds no override of the copied keys", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    await settings.refresh("personal");
    personal.available = false;
    const result = await settings.copyToAll("work", ["screenshotCopy"]);
    expect(result).toMatchObject({ ok: true, keptOwn: [] });
  });

  it("a workspace seen without an override stays ruled out after the Settings page looked at it unplugged", async () => {
    await settings.refresh("personal");
    personal.available = false;
    await settings.getScoped("all");
    await settings.setOverride("work", "screenshotCopy", "manual");
    await expect(settings.copyToAll("work", ["screenshotCopy"])).resolves.toMatchObject({
      keptOwn: [],
    });
  });

  it("names a disconnected workspace whose state is unknown, because it cannot be ruled out", async () => {
    // Never read: nothing says it has no override.
    await settings.setOverride("work", "screenshotCopy", "manual");
    personal.available = false;
    const fresh = await build();
    const result = await fresh.copyToAll("work", ["screenshotCopy"]);
    expect(result).toMatchObject({ ok: true, keptOwn: ["Personal"] });
  });

  it("names a disconnected workspace whose machine-bound upload mode is its own", async () => {
    await settings.setOverride("personal", "uploadMode", "manual");
    personal.available = false;
    const result = await settings.copyToAll("work", ["uploadMode"]);
    expect(result).toMatchObject({ ok: true, keptOwn: ["Personal"] });
  });

  it("refuses to copy from a workspace that is not connected", async () => {
    work.available = false;
    await expect(settings.copyToAll("work", ["screenshotCopy"])).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("a refresh bounds the availability probe too, so a capture never waits on a slow folder", async () => {
    const slow = new Promise<void>(() => {});
    availabilityGate = slow;
    const fast = new WorkspaceSettings({
      machine: machineStore,
      workspaces: () => [work, personal],
      activeId: () => active,
      isAvailable: async () => {
        await slow;
        return true;
      },
      getAll: () => all,
      writeAll: () => {},
      effective: () => all,
      changed: () => changed(),
      now: () => 1,
      readTimeoutMs: 30,
    });
    await putFolderFile(work, { screenshotCopy: "manual" });
    const started = Date.now();
    await fast.refresh("work");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fast.activeOverrides()).toEqual({});
  });
});

describe("a refresh racing a write", () => {
  it("never puts an older read over the write that finished first", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    const realRead = overridesModule.readFolderOverrides;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let oldReadDone!: () => void;
    const oldRead = new Promise<void>((resolve) => (oldReadDone = resolve));
    const spy = vi
      .spyOn(overridesModule, "readFolderOverrides")
      .mockImplementationOnce(async (path) => {
        const old = await realRead(path); // the old bytes, read before the write below
        oldReadDone();
        await held;
        return old;
      });
    const refreshing = settings.refresh("work");
    // Only once the old bytes are in hand does the write start, so the stale read is real.
    await oldRead;
    await settings.setOverride("work", "showBrandBadge", false);
    release();
    await refreshing;
    spy.mockRestore();
    // The cache, as captures and snapshots read it (no fresh read to mask the race).
    expect(settings.activeOverrides()).toEqual({ screenshotCopy: "manual", showBrandBadge: false });
  });

  it("a refresh that starts in the middle of a write is dropped, so the overrides never flicker off", async () => {
    await settings.setOverride("work", "screenshotCopy", "manual");
    const realUpdate = machineStore.update.bind(machineStore);
    let seenMidWrite: unknown = null;
    vi.spyOn(machineStore, "update").mockImplementationOnce(async (id, change) => {
      // The new hash is recorded; the file still holds the old bytes. A capture starts now.
      await realUpdate(id, change);
      await settings.refresh("work");
      seenMidWrite = settings.activeOverrides();
    });
    await settings.setOverride("work", "showBrandBadge", false);
    expect(seenMidWrite).toEqual({ screenshotCopy: "manual" });
    expect(settings.activeOverrides()).toEqual({ screenshotCopy: "manual", showBrandBadge: false });
  });

  it("of two overlapping refreshes the one that started last wins, whichever finishes first", async () => {
    await putFolderFile(work, { screenshotCopy: "auto" });
    const current = await overridesModule.readFolderOverrides(work.path);
    if (current.kind !== "ok") throw new Error("fixture file unreadable");
    await machineStore.update("work", (entry) => ({
      ...entry,
      folderOverrides: { sha256: current.sha256, decision: "use", at: 1 },
    }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const spy = vi
      .spyOn(overridesModule, "readFolderOverrides")
      .mockImplementationOnce(async () => {
        await gate; // the first refresh read the file before a sync rewrote it
        return { kind: "ok", overrides: { screenshotCopy: "manual" }, sha256: "0".repeat(64) };
      });
    const first = settings.refresh("work");
    await settings.refresh("work"); // started later, finishes first
    release();
    await first;
    spy.mockRestore();
    expect(settings.activeOverrides()).toEqual({ screenshotCopy: "auto" });
  });

  it("refuses to copy from a workspace whose file cannot be read, and writes nothing anywhere", async () => {
    await settings.setOverride("personal", "screenshotCopy", "auto");
    const before = await readFile(folderFile(personal), "utf-8");
    const allBefore = { ...all };
    await mkdir(join(work.path, ".kaipu", "workspace"), { recursive: true });
    await writeFile(folderFile(work), "{broken");
    await expect(settings.copyToAll("work", ["screenshotCopy"])).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(all).toEqual(allBefore);
    expect(await readFile(folderFile(personal), "utf-8")).toBe(before);
  });

  it("a refresh in flight cannot undo the answer the user just gave to a changed file", async () => {
    await putFolderFile(work, { screenshotCopy: "manual" });
    const current = await overridesModule.readFolderOverrides(work.path);
    if (current.kind !== "ok") throw new Error("fixture file unreadable");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const spy = vi
      .spyOn(overridesModule, "readFolderOverrides")
      .mockImplementationOnce(async () => {
        await gate; // read before a sync replaced the file
        return { kind: "ok", overrides: { screenshotCopy: "auto" }, sha256: "0".repeat(64) };
      });
    const slow = settings.refresh("work");
    await settings.resolvePending("work", "use", current.sha256);
    release();
    await slow;
    spy.mockRestore();
    expect(settings.activeOverrides()).toEqual({ screenshotCopy: "manual" });
  });

  it("copies uploadMode even when the folder file cannot be read (it is machine-bound)", async () => {
    await mkdir(join(work.path, ".kaipu", "workspace"), { recursive: true });
    await writeFile(folderFile(work), "{broken");
    await settings.setOverride("work", "uploadMode", "automatic");
    await expect(settings.copyToAll("work", ["uploadMode"])).resolves.toMatchObject({ ok: true });
    expect(all.uploadMode).toBe("automatic");
  });
});
