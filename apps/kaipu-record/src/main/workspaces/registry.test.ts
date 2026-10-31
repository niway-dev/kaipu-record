import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { LibraryVault } from "../library/library-vault";
import { IDENTITY_FILE, readIdentity, writeIdentity } from "./identity";
import { readPreferences, WorkspaceRegistry, type RegistryEnv } from "./registry";

let root: string;
let userData: string;
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
const readPrefs = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(prefsFile(), "utf-8")) as Record<string, unknown>;
const writePrefs = (value: unknown): Promise<void> =>
  writeFile(prefsFile(), JSON.stringify(value, null, 2));

/** Every file under `dir`, relative, with its sha256: "unchanged" means byte-identical. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (current: string): Promise<void> => {
    for (const name of await readdir(current)) {
      const full = join(current, name);
      if ((await stat(full)).isDirectory()) await walk(full);
      else
        out[relative(dir, full)] = createHash("sha256")
          .update(await readFile(full))
          .digest("hex");
    }
  };
  await walk(dir);
  return out;
}

/** A pre-workspaces library, with a customer's `workspace.png` and `settings.png` and their sidecars. */
async function makeLegacyVault(dir: string): Promise<void> {
  await mkdir(join(dir, ".kaipu"), { recursive: true });
  await writeFile(join(dir, "recording-2026-10-01-10-00-00.mp4"), "video bytes");
  await writeFile(
    join(dir, ".kaipu", "recording-2026-10-01-10-00-00.json"),
    JSON.stringify({ title: "Demo", assetId: "asset-demo", tagIds: ["t1"] }),
  );
  await writeFile(join(dir, ".kaipu", "tags.json"), JSON.stringify({ version: 1, tags: [] }));
  await writeFile(join(dir, "workspace.png"), "png 1");
  await writeFile(
    join(dir, ".kaipu", "workspace.json"),
    JSON.stringify({ title: "My workspace shot", assetId: "asset-ws" }),
  );
  await writeFile(join(dir, "settings.png"), "png 2");
  await writeFile(
    join(dir, ".kaipu", "settings.json"),
    JSON.stringify({ title: "Settings shot", assetId: "asset-settings" }),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kaipu-workspaces-"));
  userData = join(root, "userData");
  defaultDir = join(root, "Movies", "Kaipu Record");
  await mkdir(userData, { recursive: true });
  ids = 0;
});

afterEach(async () => {
  await chmod(root, 0o755).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

describe("migration (first launch after the upgrade)", () => {
  it("registers the default folder as 'Default workspace' on a fresh install", async () => {
    const registry = await WorkspaceRegistry.open(env());

    const [entry] = registry.entries();
    expect(registry.entries()).toHaveLength(1);
    expect(entry).toMatchObject({
      path: defaultDir,
      name: "Default workspace",
      color: "rose",
      initials: "DW",
    });
    expect(registry.active().id).toBe(entry!.id);
    expect(registry.readOnly).toBe(false);
    const prefs = await readPrefs();
    // Absent before, absent after: an older version keeps reading "default".
    expect(prefs).not.toHaveProperty("vaultDirectory");
    expect(prefs["workspaces"]).toMatchObject({
      activeId: entry!.id,
      legacyCloudOwnerId: entry!.id,
    });
    const identity = await readIdentity(defaultDir);
    expect(identity).toMatchObject({
      kind: "ok",
      identity: { id: entry!.id, name: "Default workspace" },
    });
  });

  it("adopts a custom folder and changes nothing but identity.json and the workspaces key", async () => {
    const custom = join(root, "Work", "Kaipu");
    await makeLegacyVault(custom);
    await writeFile(
      join(userData, "settings.json"),
      JSON.stringify({ theme: "dark", locale: "es" }),
    );
    await writePrefs({ vaultDirectory: custom, somethingElse: 42 });
    const vaultBefore = await snapshot(custom);
    const userDataBefore = await snapshot(userData);

    const registry = await WorkspaceRegistry.open(env());

    expect(registry.active()).toMatchObject({ path: custom, name: "Default workspace" });
    const vaultAfter = await snapshot(custom);
    const added = Object.keys(vaultAfter).filter((file) => !(file in vaultBefore));
    expect(added).toEqual([IDENTITY_FILE]);
    for (const [file, hash] of Object.entries(vaultBefore)) expect(vaultAfter[file]).toBe(hash);
    // settings.json is neither read for the migration nor written.
    expect((await snapshot(userData))["settings.json"]).toBe(userDataBefore["settings.json"]);
    const prefs = await readPrefs();
    expect(prefs["vaultDirectory"]).toBe(custom);
    expect(prefs["somethingElse"]).toBe(42);
  });

  it("keeps a customer's workspace.png and settings.png sidecars byte-identical, and listed", async () => {
    await makeLegacyVault(defaultDir);
    const before = await snapshot(defaultDir);

    await WorkspaceRegistry.open(env());

    const after = await snapshot(defaultDir);
    expect(after[join(".kaipu", "workspace.json")]).toBe(before[join(".kaipu", "workspace.json")]);
    expect(after[join(".kaipu", "settings.json")]).toBe(before[join(".kaipu", "settings.json")]);
    const listed = await new LibraryVault(defaultDir).list();
    expect(listed.find((r) => r.id === "workspace")?.assetId).toBe("asset-ws");
    expect(listed.find((r) => r.id === "settings")?.assetId).toBe("asset-settings");
  });

  it("is idempotent: a second launch keeps the one id and rewrites nothing", async () => {
    const first = await WorkspaceRegistry.open(env());
    const bytes = await readFile(prefsFile(), "utf-8");

    const second = await WorkspaceRegistry.open(env());

    expect(second.entries().map((e) => e.id)).toEqual(first.entries().map((e) => e.id));
    expect(await readFile(prefsFile(), "utf-8")).toBe(bytes);
  });

  it("reuses the id when the app died after identity.json but before preferences.json", async () => {
    await mkdir(defaultDir, { recursive: true });
    await writeIdentity(defaultDir, {
      version: 1,
      id: "0192f0c3-0000-7000-8000-000000000001",
      name: "Default workspace",
      color: "rose",
      initials: "DW",
      createdAt: 1,
    });

    const registry = await WorkspaceRegistry.open(env());

    expect(registry.entries().map((e) => e.id)).toEqual(["0192f0c3-0000-7000-8000-000000000001"]);
  });

  it("writes nothing when preferences.json does not parse, and runs on the old folder", async () => {
    await writeFile(prefsFile(), "{ not json");
    await mkdir(defaultDir, { recursive: true });

    const registry = await WorkspaceRegistry.open(env());

    expect(registry.readOnly).toBe(true);
    expect(registry.active().path).toBe(defaultDir);
    expect(await readFile(prefsFile(), "utf-8")).toBe("{ not json");
    expect((await readIdentity(defaultDir)).kind).toBe("absent");
    expect(await registry.add(join(root, "Other"))).toEqual({ ok: false, reason: "read-only" });
    await expect(registry.setActive(registry.active().id)).rejects.toThrow(/read-only/);
  });

  it("registers an unreachable custom folder as pending and initializes it on the first reach", async () => {
    const drive = join(root, "Volumes", "T7", "Kaipu");
    await writePrefs({ vaultDirectory: drive });

    const registry = await WorkspaceRegistry.open(env());
    const id = registry.active().id;

    expect(registry.active()).toMatchObject({ path: drive, pendingInit: true });
    expect(await registry.availability(id)).toEqual({
      availability: { state: "unavailable", reason: "missing" },
      id,
    });
    // Never recreated: a missing root means "not connected", not "empty".
    await expect(stat(drive)).rejects.toThrow();

    await mkdir(drive, { recursive: true });
    expect((await registry.availability(id)).availability).toEqual({ state: "available" });
    expect(registry.active().pendingInit).toBeUndefined();
    expect(await readIdentity(drive)).toMatchObject({ kind: "ok", identity: { id } });
  });

  it("a pending entry adopts the identity it finds, and moves activeId and the cloud owner with it", async () => {
    const drive = join(root, "Volumes", "T7", "Kaipu");
    await writePrefs({ vaultDirectory: drive });
    const registry = await WorkspaceRegistry.open(env());
    const pending = registry.active().id;
    await mkdir(drive, { recursive: true });
    await writeIdentity(drive, {
      version: 1,
      id: "0192f0c3-aaaa-7000-8000-000000000009",
      name: "Work",
      color: "amber",
      createdAt: 1,
    });

    const result = await registry.availability(pending);

    expect(result).toEqual({
      availability: { state: "available" },
      id: "0192f0c3-aaaa-7000-8000-000000000009",
    });
    expect(registry.state.activeId).toBe("0192f0c3-aaaa-7000-8000-000000000009");
    expect(registry.state.legacyCloudOwnerId).toBe("0192f0c3-aaaa-7000-8000-000000000009");
    expect(registry.active().name).toBe("Work");
  });
});

describe("a probe's best-effort cache update", () => {
  it("still adopts the folder's identity in memory when the write fails: the probe never fails", async () => {
    const drive = join(root, "Volumes", "T7", "Kaipu");
    await writePrefs({ vaultDirectory: drive });
    const registry = await WorkspaceRegistry.open(env());
    const pending = registry.active().id;
    await mkdir(drive, { recursive: true });
    await writeIdentity(drive, {
      version: 1,
      id: "0192f0c3-aaaa-7000-8000-000000000009",
      name: "Work",
      color: "amber",
      createdAt: 1,
    });
    await writeFile(prefsFile(), "{ not json");

    const result = await registry.availability(pending);

    expect(result.id).toBe("0192f0c3-aaaa-7000-8000-000000000009");
    expect(registry.active().id).toBe(result.id);
  });
});

describe("downgrade", () => {
  it("mirrors the active path into vaultDirectory, and drops the key for the default folder", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const other = join(root, "Personal");
    await mkdir(other);
    const added = await registry.add(other);
    if (!added.ok) throw new Error("add failed");

    await registry.setActive(added.entry.id);
    expect((await readPrefs())["vaultDirectory"]).toBe(other);

    await registry.setActive(registry.entries()[0]!.id);
    expect(await readPrefs()).not.toHaveProperty("vaultDirectory");
  });

  it("adopts a folder an older version switched to, and keeps the workspaces key it preserved", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const defaultId = registry.active().id;
    // The older version: reads the file, spreads it, writes only vaultDirectory.
    const older = join(root, "Elsewhere");
    await mkdir(older);
    await writePrefs({ ...(await readPrefs()), vaultDirectory: older });

    const reopened = await WorkspaceRegistry.open(env());

    expect(reopened.active().path).toBe(older);
    expect(reopened.entries().map((e) => e.id)).toContain(defaultId);
    expect((await readIdentity(older)).kind).toBe("ok");
  });

  it("matches a folder the older version switched back to by its identity id", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const other = join(root, "Personal");
    await mkdir(other);
    const added = await registry.add(other);
    if (!added.ok) throw new Error("add failed");
    // Older version picks Personal again in Settings → Files.
    await writePrefs({ ...(await readPrefs()), vaultDirectory: other });

    const reopened = await WorkspaceRegistry.open(env());

    expect(reopened.entries()).toHaveLength(2);
    expect(reopened.active().id).toBe(added.entry.id);
  });

  it("the previous release deleting workspace.png removes its sidecar and leaves the identity", async () => {
    await makeLegacyVault(defaultDir);
    const registry = await WorkspaceRegistry.open(env());

    await new LibraryVault(defaultDir).remove("workspace");
    await new LibraryVault(defaultDir).remove("settings");

    await expect(stat(join(defaultDir, ".kaipu", "workspace.json"))).rejects.toThrow();
    await expect(stat(join(defaultDir, ".kaipu", "settings.json"))).rejects.toThrow();
    expect(await readIdentity(defaultDir)).toMatchObject({
      kind: "ok",
      identity: { id: registry.active().id },
    });
  });
});

describe("add workspace", () => {
  it("initializes a plain folder with its own name and the next color, touching nothing else", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const folder = join(root, "Client X");
    await mkdir(folder);
    await writeFile(join(folder, "notes.txt"), "mine");
    const before = await snapshot(folder);

    const result = await registry.add(folder);

    expect(result).toMatchObject({
      ok: true,
      created: true,
      entry: { path: folder, name: "Client X", initials: "CX", color: "coral" },
    });
    const after = await snapshot(folder);
    expect(Object.keys(after).sort()).toEqual([IDENTITY_FILE, "notes.txt"].sort());
    expect(after["notes.txt"]).toBe(before["notes.txt"]);
    expect(registry.active().path).toBe(defaultDir); // adding does not switch
  });

  it("adopts a folder that already has an identity, with its id and name", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const folder = join(root, "From another Mac");
    await mkdir(folder);
    await writeIdentity(folder, {
      version: 1,
      id: "0192f0c3-bbbb-7000-8000-000000000001",
      name: "Work",
      color: "sky",
      initials: "W",
      createdAt: 1,
    });

    const result = await registry.add(folder);

    expect(result).toMatchObject({
      ok: true,
      entry: { id: "0192f0c3-bbbb-7000-8000-000000000001", name: "Work", color: "sky" },
    });
  });

  it("gives a copy of a reachable registered folder a new id, and relocates an unreachable one", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const original = join(root, "Work");
    await mkdir(original);
    const added = await registry.add(original);
    if (!added.ok) throw new Error("add failed");
    const copy = join(root, "Work copy");
    await mkdir(join(copy, ".kaipu", "workspace"), { recursive: true });
    await writeFile(join(copy, IDENTITY_FILE), await readFile(join(original, IDENTITY_FILE)));

    const copied = await registry.add(copy);
    if (!copied.ok) throw new Error("copy add failed");
    expect(copied.entry.id).not.toBe(added.entry.id);
    expect(await readIdentity(copy)).toMatchObject({ identity: { id: copied.entry.id } });

    // The original is gone from its old path (renamed drive): adding it elsewhere relocates.
    const moved = join(root, "Work moved");
    await mkdir(join(moved, ".kaipu", "workspace"), { recursive: true });
    await writeFile(join(moved, IDENTITY_FILE), await readFile(join(original, IDENTITY_FILE)));
    await rm(original, { recursive: true });

    const relocated = await registry.add(moved);
    expect(relocated).toMatchObject({
      ok: true,
      created: false,
      entry: { id: added.entry.id, path: moved },
    });
    expect(registry.entries()).toHaveLength(3);
  });

  it("refuses a folder it cannot write into and leaves no Kaipu folder behind", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const locked = join(root, "Locked");
    await mkdir(locked);
    await chmod(locked, 0o555);

    const result = await registry.add(locked);

    await chmod(locked, 0o755);
    expect(result).toEqual({ ok: false, reason: "not-writable" });
    expect(await readdir(locked)).toEqual([]);
    expect(registry.entries()).toHaveLength(1);
  });

  it("refuses an identity it cannot read rather than overwrite it", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const folder = join(root, "Odd");
    await mkdir(join(folder, ".kaipu", "workspace"), { recursive: true });
    await writeFile(join(folder, IDENTITY_FILE), "garbage");

    expect(await registry.add(folder)).toEqual({ ok: false, reason: "unreadable" });
    expect(await readFile(join(folder, IDENTITY_FILE), "utf-8")).toBe("garbage");
  });
});

describe("remove from list", () => {
  it("unregisters a workspace and changes nothing on disk; re-adding restores the same id", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const folder = join(root, "Personal");
    await mkdir(folder);
    const added = await registry.add(folder);
    if (!added.ok) throw new Error("add failed");
    const before = await snapshot(folder);

    expect(await registry.remove(added.entry.id)).toEqual({ ok: true });

    expect(registry.entries()).toHaveLength(1);
    expect(await snapshot(folder)).toEqual(before);
    const again = await registry.add(folder);
    expect(again).toMatchObject({ ok: true, entry: { id: added.entry.id } });
  });

  it("refuses the active workspace, even when it is the only one", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const id = registry.active().id;
    expect(await registry.remove(id)).toEqual({ ok: false, reason: "active" });
    const folder = join(root, "Personal");
    await mkdir(folder);
    const added = await registry.add(folder);
    if (!added.ok) throw new Error("add failed");
    await registry.setActive(added.entry.id);
    expect(await registry.remove(added.entry.id)).toEqual({ ok: false, reason: "active" });
  });
});

describe("a failed write", () => {
  it("does not keep an added workspace in the list", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const folder = join(root, "Personal");
    await mkdir(folder);
    await writeFile(prefsFile(), "{ not json");

    await expect(registry.add(folder)).rejects.toThrow();

    expect(registry.entries()).toHaveLength(1);
  });

  it("does not drop a removed workspace from the list", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const folder = join(root, "Personal");
    await mkdir(folder);
    const added = await registry.add(folder);
    if (!added.ok) throw new Error("add failed");
    await writeFile(prefsFile(), "{ not json");

    await expect(registry.remove(added.entry.id)).rejects.toThrow();

    expect(registry.get(added.entry.id)).toBeDefined();
  });

  it("does not keep a dismissed hint", async () => {
    const registry = await WorkspaceRegistry.open(env());
    await writeFile(prefsFile(), "{ not json");

    await expect(registry.dismissHint()).rejects.toThrow();

    expect(registry.state.hintDismissedAt).toBeUndefined();
  });
});

describe("availability", () => {
  it("reports another workspace's identity in the folder as different", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const id = registry.active().id;
    await writeIdentity(defaultDir, {
      version: 1,
      id: "0192f0c3-cccc-7000-8000-000000000001",
      name: "Someone else",
      color: "lime",
      createdAt: 1,
    });

    expect((await registry.availability(id)).availability).toEqual({
      state: "unavailable",
      reason: "different",
    });
  });

  it("refreshes the cached name from the folder's identity", async () => {
    const registry = await WorkspaceRegistry.open(env());
    const id = registry.active().id;
    await writeIdentity(defaultDir, {
      version: 1,
      id,
      name: "Renamed elsewhere",
      color: "iris",
      createdAt: 1,
    });

    await registry.availability(id);

    expect(registry.active()).toMatchObject({ name: "Renamed elsewhere", color: "iris" });
    const stored = await readPreferences(prefsFile());
    expect(stored).toMatchObject({ kind: "ok" });
  });
});
