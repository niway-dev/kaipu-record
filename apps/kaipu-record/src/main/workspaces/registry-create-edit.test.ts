import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IDENTITY_FILE, readIdentity, writeIdentity } from "./identity";
import { WorkspaceRegistry, type RegistryEnv } from "./registry";

let root: string;
let userData: string;
let moviesDir: string;
let defaultDir: string;
let ids: number;

function env(overrides: Partial<RegistryEnv> = {}): RegistryEnv {
  return {
    preferencesFile: join(userData, "preferences.json"),
    defaultDirectory: defaultDir,
    now: () => 1_761_734_400_000,
    newId: () => `0192f0c4-0000-7000-8000-${String(++ids).padStart(12, "0")}`,
    ...overrides,
  };
}

const prefsFile = (): string => join(userData, "preferences.json");
const readPrefs = async (): Promise<Record<string, any>> =>
  JSON.parse(await readFile(prefsFile(), "utf-8")) as Record<string, any>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kaipu-workspaces-ce-"));
  userData = join(root, "userData");
  moviesDir = join(root, "Movies");
  defaultDir = join(moviesDir, "Kaipu Record");
  await mkdir(userData, { recursive: true });
  ids = 0;
});

afterEach(async () => {
  await chmod(root, 0o755).catch(() => {});
  await chmod(moviesDir, 0o755).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

describe("the Default workspace's brand color", () => {
  it("is Kaipu's color in a new migration, in the folder and in the registry", async () => {
    const registry = await WorkspaceRegistry.open(env());

    expect(registry.active()).toMatchObject({ name: "Default workspace", color: "kaipu" });
    expect(await readIdentity(defaultDir)).toMatchObject({
      kind: "ok",
      identity: { color: "kaipu" },
    });
    // A fresh install has nothing to upgrade, now or on the next launch.
    expect((await readPrefs())["workspaces"].kaipuColorApplied).toBe(true);
  });

  /** The owner's machine: migrated by part 1, so "rose", and no upgrade marker yet. */
  async function ownerMachineWithRose(): Promise<string> {
    const first = await WorkspaceRegistry.open(env());
    const id = first.active().id;
    await writeIdentity(defaultDir, {
      version: 1,
      id,
      name: "Default workspace",
      color: "rose",
      initials: "DW",
      createdAt: 1,
    });
    const prefs = await readPrefs();
    prefs["workspaces"].entries[0].color = "rose";
    delete prefs["workspaces"].kaipuColorApplied;
    await writeFile(prefsFile(), JSON.stringify(prefs, null, 2));
    return id;
  }

  it("upgrades a Default migrated with rose to kaipu, in the registry and in the folder", async () => {
    await ownerMachineWithRose();

    const registry = await WorkspaceRegistry.open(env());

    expect(registry.active().color).toBe("kaipu");
    expect(await readIdentity(defaultDir)).toMatchObject({
      kind: "ok",
      identity: { color: "kaipu", name: "Default workspace", initials: "DW" },
    });
    const stored = (await readPrefs())["workspaces"];
    expect(stored.entries[0].color).toBe("kaipu");
    expect(stored.entries[0].pendingIdentity).toBeUndefined();
    expect(stored.kaipuColorApplied).toBe(true);
  });

  it("does it once: a colour the user picks afterwards is never taken back", async () => {
    await ownerMachineWithRose();
    const upgraded = await WorkspaceRegistry.open(env());
    await upgraded.edit(upgraded.active().id, { color: "rose" });

    const next = await WorkspaceRegistry.open(env());

    expect(next.active().color).toBe("rose");
    expect(await readIdentity(defaultDir)).toMatchObject({ identity: { color: "rose" } });
  });

  it("is idempotent: reopening an upgraded install rewrites nothing", async () => {
    await ownerMachineWithRose();
    await WorkspaceRegistry.open(env());
    const prefsBytes = await readFile(prefsFile(), "utf-8");
    const identityBytes = await readFile(join(defaultDir, IDENTITY_FILE), "utf-8");

    await WorkspaceRegistry.open(env());

    expect(await readFile(prefsFile(), "utf-8")).toBe(prefsBytes);
    expect(await readFile(join(defaultDir, IDENTITY_FILE), "utf-8")).toBe(identityBytes);
  });

  it("leaves a workspace the user already renamed or recoloured alone, and marks it done", async () => {
    const id = await ownerMachineWithRose();
    const prefs = await readPrefs();
    prefs["workspaces"].entries[0].name = "Studio";
    await writeFile(prefsFile(), JSON.stringify(prefs, null, 2));
    await writeIdentity(defaultDir, {
      version: 1,
      id,
      name: "Studio",
      color: "rose",
      createdAt: 1,
    });

    const registry = await WorkspaceRegistry.open(env());

    expect(registry.active()).toMatchObject({ name: "Studio", color: "rose" });
    expect((await readPrefs())["workspaces"].kaipuColorApplied).toBe(true);
  });

  it("leaves a Default that another Mac renamed alone: the folder's name is not overwritten", async () => {
    const id = await ownerMachineWithRose();
    // Renamed on another Mac and still rose; this Mac's registry still caches the old name.
    await writeIdentity(defaultDir, {
      version: 1,
      id,
      name: "Studio",
      color: "rose",
      createdAt: 1,
    });

    const registry = await WorkspaceRegistry.open(env());

    expect(await readIdentity(defaultDir)).toMatchObject({
      identity: { name: "Studio", color: "rose" },
    });
    expect(registry.get(id)?.pendingIdentity).toBeUndefined();
    expect((await readPrefs())["workspaces"].kaipuColorApplied).toBe(true);
  });

  it("upgrades the registry now and the folder when it is plugged in again", async () => {
    await ownerMachineWithRose();
    const unplugged = `${defaultDir}-away`;
    const { rename } = await import("node:fs/promises");
    await mkdir(moviesDir, { recursive: true });
    await rename(defaultDir, unplugged);

    const registry = await WorkspaceRegistry.open(env());

    expect(registry.active().color).toBe("kaipu");
    // Its own marker, not `pendingIdentity`: an edit would be written over the folder's file,
    // a deferred upgrade only when the folder still holds the old Default and rose.
    const pending = (await readPrefs())["workspaces"].entries[0];
    expect(pending.pendingColorUpgrade).toBe(true);
    expect(pending.pendingIdentity).toBeUndefined();

    await rename(unplugged, defaultDir);
    const { availability } = await registry.availability(registry.active().id);

    expect(availability.state).toBe("available");
    expect(registry.active().color).toBe("kaipu");
    expect(await readIdentity(defaultDir)).toMatchObject({ identity: { color: "kaipu" } });
    expect((await readPrefs())["workspaces"].entries[0].pendingColorUpgrade).toBeUndefined();
  });

  it.each([
    ["renamed", { name: "Studio", color: "rose" as const }],
    ["recoloured", { name: "Default workspace", color: "sky" as const }],
  ])(
    "keeps a Default that another Mac %s while this folder was away: the deferred upgrade yields",
    async (_label, changed) => {
      const id = await ownerMachineWithRose();
      const unplugged = `${defaultDir}-away`;
      const { rename } = await import("node:fs/promises");
      await mkdir(moviesDir, { recursive: true });
      await rename(defaultDir, unplugged);
      const registry = await WorkspaceRegistry.open(env());
      expect(registry.active().color).toBe("kaipu");

      // Another Mac changes the folder's identity while it is away from this one.
      await writeIdentity(unplugged, { version: 1, id, ...changed, createdAt: 1 });
      await rename(unplugged, defaultDir);
      await registry.availability(id);

      expect(await readIdentity(defaultDir)).toMatchObject({ identity: changed });
      expect(registry.active()).toMatchObject(changed);
      const stored = (await readPrefs())["workspaces"].entries[0];
      expect(stored).toMatchObject(changed);
      expect(stored.pendingIdentity).toBeUndefined();
      expect(stored.pendingColorUpgrade).toBeUndefined();
    },
  );

  it("lets an edit made while the folder is away win over the deferred upgrade", async () => {
    const id = await ownerMachineWithRose();
    const unplugged = `${defaultDir}-away`;
    const { rename } = await import("node:fs/promises");
    await mkdir(moviesDir, { recursive: true });
    await rename(defaultDir, unplugged);
    const registry = await WorkspaceRegistry.open(env());
    await registry.edit(id, { name: "Studio" });

    await rename(unplugged, defaultDir);
    await registry.availability(id);

    expect(await readIdentity(defaultDir)).toMatchObject({
      identity: { name: "Studio", color: "kaipu" },
    });
    const stored = (await readPrefs())["workspaces"].entries[0];
    expect(stored.pendingIdentity).toBeUndefined();
    expect(stored.pendingColorUpgrade).toBeUndefined();
  });
});

describe("where a new workspace's folder goes", () => {
  it("is 'Kaipu Record — <name>' next to the Default workspace's folder", async () => {
    const registry = await WorkspaceRegistry.open(env());

    expect(await registry.checkNewLocation("Work")).toEqual({
      path: join(moviesDir, "Kaipu Record — Work"),
      state: "free",
    });
  });

  it("stays next to the Default workspace even while another one is active", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const elsewhere = join(root, "Drive", "Shared");
    await mkdir(elsewhere, { recursive: true });
    const added = await registry.add(elsewhere);
    if (!added.ok) throw new Error("add failed");
    await registry.setActive(added.entry.id);

    expect((await registry.checkNewLocation("Work")).path).toBe(
      join(moviesDir, "Kaipu Record — Work"),
    );
  });

  it("falls back to the active workspace's parent when the Default's drive is gone", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const elsewhere = join(root, "Drive", "Shared");
    await mkdir(elsewhere, { recursive: true });
    const added = await registry.add(elsewhere);
    if (!added.ok) throw new Error("add failed");
    await registry.setActive(added.entry.id);
    await rm(moviesDir, { recursive: true });

    expect((await registry.checkNewLocation("Work")).path).toBe(
      join(root, "Drive", "Kaipu Record — Work"),
    );
  });

  it("reports an existing empty folder as usable", async () => {
    const registry = await WorkspaceRegistry.open(env());
    await mkdir(join(moviesDir, "Kaipu Record — Work"));

    expect((await registry.checkNewLocation("Work")).state).toBe("empty");
  });

  it("refuses a folder that exists and is not empty", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const taken = join(moviesDir, "Kaipu Record — Work");
    await mkdir(taken);
    await writeFile(join(taken, "notes.txt"), "mine");

    expect(await registry.checkNewLocation("Work")).toEqual({ path: taken, state: "not-empty" });
  });

  it("does not count Finder's .DS_Store as content", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const folder = join(moviesDir, "Kaipu Record — Work");
    await mkdir(folder);
    await writeFile(join(folder, ".DS_Store"), "x");

    expect((await registry.checkNewLocation("Work")).state).toBe("empty");
  });

  it("refuses a file in the way", async () => {
    const registry = await WorkspaceRegistry.open(env());
    await writeFile(join(moviesDir, "Kaipu Record — Work"), "a file");

    expect((await registry.checkNewLocation("Work")).state).toBe("not-empty");
  });
});

describe("create workspace", () => {
  it("makes the folder, writes only Kaipu's identity in it, and registers it", async () => {
    const registry = await WorkspaceRegistry.open(env());

    const result = await registry.create({ name: "  Client  Acme ", color: "sky" });

    const folder = join(moviesDir, "Kaipu Record — Client Acme");
    expect(result).toMatchObject({
      ok: true,
      entry: { path: folder, name: "Client Acme", color: "sky", initials: "CA" },
    });
    expect(await readdir(folder)).toEqual([".kaipu"]);
    expect(await readdir(join(folder, ".kaipu"))).toEqual(["workspace"]);
    expect(await readIdentity(folder)).toMatchObject({
      kind: "ok",
      identity: { name: "Client Acme", color: "sky", initials: "CA" },
    });
    expect(registry.entries()).toHaveLength(2);
    expect(registry.active().name).toBe("Default workspace"); // creating does not switch
    expect((await readPrefs())["workspaces"].entries).toHaveLength(2);
  });

  it("uses an existing empty folder of that name", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const folder = join(moviesDir, "Kaipu Record — Work");
    await mkdir(folder);

    expect(await registry.create({ name: "Work", color: "lime" })).toMatchObject({ ok: true });
    expect(await readIdentity(folder)).toMatchObject({ kind: "ok" });
  });

  it("refuses a folder that already exists and is not empty, and touches nothing in it", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const folder = join(moviesDir, "Kaipu Record — Work");
    await mkdir(folder);
    await writeFile(join(folder, "notes.txt"), "mine");

    const result = await registry.create({ name: "Work", color: "lime" });

    expect(result).toEqual({ ok: false, reason: "exists" });
    expect(await readdir(folder)).toEqual(["notes.txt"]);
    expect(registry.entries()).toHaveLength(1);
  });

  it("refuses a name already in use, ignoring case", async () => {
    const registry = await WorkspaceRegistry.open(env());

    expect(await registry.create({ name: "default WORKSPACE", color: "lime" })).toEqual({
      ok: false,
      reason: "name-taken",
    });
    await expect(readdir(moviesDir)).resolves.toEqual(["Kaipu Record"]);
  });

  it("refuses an empty name and an unknown colour", async () => {
    const registry = await WorkspaceRegistry.open(env());

    expect(await registry.create({ name: "   ", color: "lime" })).toEqual({
      ok: false,
      reason: "invalid-name",
    });
    expect(await registry.create({ name: "Work", color: "#ff0000" as never })).toEqual({
      ok: false,
      reason: "invalid-color",
    });
  });

  it("leaves no folder behind when the parent refuses it", async () => {
    const registry = await WorkspaceRegistry.open(env());
    await chmod(moviesDir, 0o555);

    const result = await registry.create({ name: "Work", color: "lime" });

    await chmod(moviesDir, 0o755);
    expect(result).toEqual({ ok: false, reason: "not-writable" });
    expect(await readdir(moviesDir)).toEqual(["Kaipu Record"]);
    expect(registry.entries()).toHaveLength(1);
  });

  it("removes the folder it made when the registry cannot be stored", async () => {
    const registry = await WorkspaceRegistry.open(env());
    // The preferences file becomes a directory: the atomic rename over it fails.
    await rm(prefsFile());
    await mkdir(prefsFile());

    const result = await registry.create({ name: "Work", color: "lime" });

    expect(result).toEqual({ ok: false, reason: "not-writable" });
    expect(await readdir(moviesDir)).toEqual(["Kaipu Record"]);
    expect(registry.entries()).toHaveLength(1);
  });

  it("is refused when preferences could not be read at launch", async () => {
    await writeFile(prefsFile(), "{ not json");
    const registry = await WorkspaceRegistry.open(env());

    expect(await registry.create({ name: "Work", color: "lime" })).toEqual({
      ok: false,
      reason: "read-only",
    });
  });
});

describe("edit workspace", () => {
  async function withWork(): Promise<{ registry: WorkspaceRegistry; id: string; folder: string }> {
    const registry = await WorkspaceRegistry.open(env());
    const created = await registry.create({ name: "Work", color: "sky" });
    if (!created.ok) throw new Error("create failed");
    return { registry, id: created.entry.id, folder: created.entry.path };
  }

  it("renames and recolours in the folder's identity.json and in the registry", async () => {
    const { registry, id, folder } = await withWork();

    const result = await registry.edit(id, { name: "  Client   Acme ", color: "iris" });

    expect(result).toMatchObject({
      ok: true,
      savedToFolder: true,
      entry: { id, name: "Client Acme", color: "iris", initials: "CA" },
    });
    expect(await readIdentity(folder)).toMatchObject({
      kind: "ok",
      identity: {
        id,
        name: "Client Acme",
        color: "iris",
        initials: "CA",
        createdAt: 1_761_734_400_000,
      },
    });
    expect((await readPrefs())["workspaces"].entries[1]).toMatchObject({
      name: "Client Acme",
      color: "iris",
    });
  });

  it("writes the identity atomically: a whole file, no temp file left, other files untouched", async () => {
    const { registry, id, folder } = await withWork();
    await writeFile(join(folder, "keep.mp4"), "video");

    await registry.edit(id, { name: "Renamed" });

    const dir = join(folder, ".kaipu", "workspace");
    expect(await readdir(dir)).toEqual(["identity.json"]);
    expect(JSON.parse(await readFile(join(folder, IDENTITY_FILE), "utf-8"))).toMatchObject({
      name: "Renamed",
    });
    expect(await readFile(join(folder, "keep.mp4"), "utf-8")).toBe("video");
  });

  it("leaves the old identity whole when the write fails, and does not change the registry", async () => {
    const { registry, id, folder } = await withWork();
    const dir = join(folder, ".kaipu", "workspace");
    await chmod(dir, 0o555);

    const result = await registry.edit(id, { name: "Renamed" });

    await chmod(dir, 0o755);
    expect(result).toEqual({ ok: false, reason: "not-writable" });
    expect(await readIdentity(folder)).toMatchObject({ identity: { name: "Work" } });
    expect(registry.get(id)?.name).toBe("Work");
  });

  it("keeps initials the user chose, and follows the name when they were derived", async () => {
    const { registry, id, folder } = await withWork();
    await writeIdentity(folder, {
      version: 1,
      id,
      name: "Work",
      color: "sky",
      initials: "WK",
      createdAt: 1,
    });
    await registry.availability(id);

    await registry.edit(id, { name: "Client Acme" });

    expect(registry.get(id)?.initials).toBe("WK");
    expect(await readIdentity(folder)).toMatchObject({ identity: { initials: "WK" } });
  });

  it("refuses a name another workspace uses, but lets the workspace keep its own", async () => {
    const { registry, id } = await withWork();

    expect(await registry.edit(id, { name: "default workspace" })).toEqual({
      ok: false,
      reason: "name-taken",
    });
    expect(await registry.edit(id, { name: "WORK", color: "lime" })).toMatchObject({
      ok: true,
      entry: { name: "WORK", color: "lime" },
    });
  });

  it("refuses an empty name, an unknown colour and an unknown workspace", async () => {
    const { registry, id } = await withWork();

    expect(await registry.edit(id, { name: "  " })).toEqual({ ok: false, reason: "invalid-name" });
    expect(await registry.edit(id, { color: "nope" as never })).toEqual({
      ok: false,
      reason: "invalid-color",
    });
    expect(await registry.edit("0192f0c4-ffff-7000-8000-000000000000", { name: "X" })).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("changes nothing, and writes nothing, when nothing differs", async () => {
    const { registry, id, folder } = await withWork();
    const before = await readFile(join(folder, IDENTITY_FILE), "utf-8");
    const prefsBefore = await readFile(prefsFile(), "utf-8");

    const result = await registry.edit(id, { name: "Work", color: "sky" });

    expect(result).toMatchObject({ ok: true, savedToFolder: true });
    expect(await readFile(join(folder, IDENTITY_FILE), "utf-8")).toBe(before);
    expect(await readFile(prefsFile(), "utf-8")).toBe(prefsBefore);
  });

  it("renames a disconnected workspace in the registry only, and the folder catches up when it is back", async () => {
    const { registry, id, folder } = await withWork();
    const away = `${folder}-away`;
    const { rename } = await import("node:fs/promises");
    await rename(folder, away);

    const result = await registry.edit(id, { name: "Client Acme", color: "iris" });

    expect(result).toMatchObject({
      ok: true,
      savedToFolder: false,
      entry: { name: "Client Acme" },
    });
    expect((await readPrefs())["workspaces"].entries[1]).toMatchObject({
      name: "Client Acme",
      pendingIdentity: true,
    });
    // Nothing was recreated on the missing drive.
    await expect(readdir(folder)).rejects.toThrow();

    await rename(away, folder);
    expect(await readIdentity(folder)).toMatchObject({ identity: { name: "Work" } });
    const { availability } = await registry.availability(id);

    expect(availability.state).toBe("available");
    // The registry's newer name wins over the folder's older file, instead of being undone by it.
    expect(registry.get(id)).toMatchObject({ name: "Client Acme", color: "iris" });
    expect(await readIdentity(folder)).toMatchObject({
      identity: { name: "Client Acme", color: "iris", initials: "CA" },
    });
    expect((await readPrefs())["workspaces"].entries[1].pendingIdentity).toBeUndefined();
  });

  it("never overwrites an identity file it cannot read: registry only until it can", async () => {
    const { registry, id, folder } = await withWork();
    await writeFile(join(folder, IDENTITY_FILE), "{ broken");

    const result = await registry.edit(id, { name: "Renamed" });

    expect(result).toMatchObject({ ok: true, savedToFolder: false });
    expect(await readFile(join(folder, IDENTITY_FILE), "utf-8")).toBe("{ broken");
  });

  it("is refused when preferences could not be read at launch", async () => {
    await writeFile(prefsFile(), "{ not json");
    const registry = await WorkspaceRegistry.open(env());

    expect(await registry.edit(registry.active().id, { name: "X" })).toEqual({
      ok: false,
      reason: "read-only",
    });
  });
});

describe("edit workspace: refused whole", () => {
  it("puts the folder's identity back when the registry cannot be stored", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const created = await registry.create({ name: "Work", color: "sky" });
    if (!created.ok) throw new Error("create failed");
    // Its identity.json is gone: the probe inside edit() writes it again under the old name,
    // so the failed registry write must leave exactly that, never the refused new name.
    const { rm: remove } = await import("node:fs/promises");
    await remove(join(created.entry.path, ".kaipu"), { recursive: true });
    // The preferences file becomes a directory: the registry write fails.
    await rm(prefsFile());
    await mkdir(prefsFile());

    const result = await registry.edit(created.entry.id, { name: "Renamed" });

    expect(result).toEqual({ ok: false, reason: "not-writable" });
    expect(await readIdentity(created.entry.path)).toMatchObject({
      kind: "ok",
      identity: { name: "Work" },
    });
  });

  it("two edits cannot both take one name", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const a = await registry.create({ name: "A", color: "sky" });
    const b = await registry.create({ name: "B", color: "lime" });
    if (!a.ok || !b.ok) throw new Error("create failed");

    const [first, second] = await Promise.all([
      registry.edit(a.entry.id, { name: "Same" }),
      registry.edit(b.entry.id, { name: "same" }),
    ]);

    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(registry.entries().filter((e) => e.name.toLowerCase() === "same")).toHaveLength(1);
    const loser = first.ok ? b : a;
    // The refused edit left its folder's file as it was.
    expect(await readIdentity(loser.entry.path)).toMatchObject({
      identity: { name: loser.entry.name },
    });
  });
});
