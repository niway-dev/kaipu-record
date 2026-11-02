import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIdentity, writeIdentity } from "./identity";
import { WorkspaceRegistry, type RegistryEnv } from "./registry";

/**
 * "Change folder…" (relocate): point a workspace at the folder where it now lives. It never
 * moves or copies files, and it never adopts a folder that is not this workspace's.
 */

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

const readPrefs = async (): Promise<Record<string, any>> =>
  JSON.parse(await readFile(join(userData, "preferences.json"), "utf-8")) as Record<string, any>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kaipu-workspaces-relocate-"));
  userData = join(root, "userData");
  defaultDir = join(root, "Movies", "Kaipu Record");
  await mkdir(userData, { recursive: true });
  ids = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A registry with Default (active) and "Work" in `workFolder`, which exists. */
async function withWork(): Promise<{
  registry: WorkspaceRegistry;
  workId: string;
  workFolder: string;
}> {
  const registry = await WorkspaceRegistry.open(env());
  const workFolder = join(root, "Work folder");
  await mkdir(workFolder);
  const added = await registry.add(workFolder);
  if (!added.ok) throw new Error("setup");
  await registry.edit(added.entry.id, { name: "Work", color: "sky" });
  return { registry, workId: added.entry.id, workFolder };
}

/** The folder was moved in Finder: the same contents, at a new path. */
async function move(from: string, to: string): Promise<string> {
  await rename(from, to);
  return to;
}

const tree = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true })).sort();

describe("relocate", () => {
  it("follows a moved folder: same identity, new path, name, color and id kept", async () => {
    const { registry, workId, workFolder } = await withWork();
    await mkdir(join(root, "Google Drive"));
    const moved = await move(workFolder, join(root, "Google Drive", "Work"));

    const outcome = await registry.relocate(workId, moved);

    expect(outcome).toMatchObject({
      ok: true,
      entry: { id: workId, path: moved, name: "Work", color: "sky" },
    });
    expect(registry.get(workId)?.path).toBe(moved);
    expect((await registry.availability(workId)).availability).toEqual({ state: "available" });
    const stored = (await readPrefs())["workspaces"].entries.find((e: any) => e.id === workId);
    expect(stored).toMatchObject({ path: moved, name: "Work", color: "sky" });
  });

  it("works for an unplugged workspace (the main fix when a mount path changed)", async () => {
    const { registry, workId, workFolder } = await withWork();
    const moved = await move(workFolder, join(root, "New mount"));
    expect((await registry.availability(workId)).availability).toMatchObject({
      state: "unavailable",
      reason: "missing",
    });

    expect(await registry.relocate(workId, moved)).toMatchObject({ ok: true });
    expect((await registry.availability(workId)).availability).toEqual({ state: "available" });
  });

  it("never moves, copies or writes files in the folder it points at", async () => {
    const { registry, workId, workFolder } = await withWork();
    await writeFile(join(workFolder, "clip.mp4"), "video");
    const moved = await move(workFolder, join(root, "Moved"));
    const before = await tree(moved);

    await registry.relocate(workId, moved);

    expect(await tree(moved)).toEqual(before);
    expect(await readFile(join(moved, "clip.mp4"), "utf-8")).toBe("video");
  });

  it("mirrors the new path into vaultDirectory when the workspace is the active one", async () => {
    const { registry } = await withWork();
    const activeId = registry.active().id;
    const moved = join(root, "Default moved");
    await move(defaultDir, moved);

    expect(await registry.relocate(activeId, moved)).toMatchObject({ ok: true });

    expect(registry.active().path).toBe(moved);
    expect((await readPrefs())["vaultDirectory"]).toBe(moved);
  });

  it("leaves vaultDirectory alone when another workspace is relocated", async () => {
    const { registry, workId, workFolder } = await withWork();
    const before = (await readPrefs())["vaultDirectory"];
    const moved = await move(workFolder, join(root, "Moved"));

    await registry.relocate(workId, moved);

    expect((await readPrefs())["vaultDirectory"]).toBe(before);
  });

  it("is a no-op, not a refusal, when the picked folder is the one already registered", async () => {
    const { registry, workId, workFolder } = await withWork();

    expect(await registry.relocate(workId, workFolder)).toMatchObject({
      ok: true,
      entry: { path: workFolder },
    });
  });

  it("keeps a name edited while the folder was away (pendingIdentity) and writes it to the moved folder", async () => {
    const { registry, workId, workFolder } = await withWork();
    const moved = await move(workFolder, join(root, "Moved"));
    await registry.edit(workId, { name: "Studio" }); // not connected: registry only

    await registry.relocate(workId, moved);
    await registry.availability(workId);

    expect(registry.get(workId)?.name).toBe("Studio");
    expect(await readIdentity(moved)).toMatchObject({ kind: "ok", identity: { name: "Studio" } });
  });
});

describe("relocate refusals", () => {
  it("refuses another workspace's folder and names that workspace", async () => {
    const { registry, workId } = await withWork();
    const other = join(root, "Client Acme");
    await mkdir(other);
    // A workspace this Mac does not know yet: its identity is not registered here.
    await writeIdentity(other, {
      version: 1,
      id: "0192f0c3-cccc-7000-8000-000000000001",
      name: "Client Acme",
      color: "mint",
      createdAt: 1,
    });

    expect(await registry.relocate(workId, other)).toEqual({
      ok: false,
      reason: "different",
      workspaceName: "Client Acme",
    });
    expect(registry.get(workId)?.path).toBe(join(root, "Work folder"));
  });

  it("refuses the folder of a registered workspace, naming it", async () => {
    const { registry, workId } = await withWork();

    expect(await registry.relocate(workId, defaultDir)).toEqual({
      ok: false,
      reason: "already-registered",
      workspaceName: "Default workspace",
    });
  });

  it("refuses a folder that has Kaipu items but no workspace identity", async () => {
    const { registry, workId } = await withWork();
    const legacy = join(root, "Old library");
    await mkdir(join(legacy, ".kaipu"), { recursive: true });
    await writeFile(join(legacy, ".kaipu", "clip.json"), "{}");
    await writeFile(join(legacy, "clip.mp4"), "video");

    expect(await registry.relocate(workId, legacy)).toEqual({
      ok: false,
      reason: "has-items-no-identity",
    });
    // Refusing writes nothing: no identity appears in the folder.
    expect(await readIdentity(legacy)).toEqual({ kind: "absent" });
  });

  it("accepts a moved folder that has Kaipu items but no identity when the workspace never got one (pendingInit)", async () => {
    const { workId, workFolder } = await withWork();
    // The folder was unplugged when the workspace was registered: no identity.json was ever written.
    const prefs = await readPrefs();
    prefs["workspaces"].entries.find((e: { id: string }) => e.id === workId).pendingInit = true;
    await writeFile(join(userData, "preferences.json"), JSON.stringify(prefs, null, 2));
    await rm(join(workFolder, ".kaipu"), { recursive: true, force: true });
    const registry = await WorkspaceRegistry.open(env());
    const remounted = join(root, "Remounted");
    await mkdir(join(remounted, ".kaipu"), { recursive: true });
    await writeFile(join(remounted, ".kaipu", "clip.json"), "{}");

    expect(await registry.relocate(workId, remounted)).toMatchObject({
      ok: true,
      entry: { id: workId, path: remounted },
    });
    // The probe that follows writes the identity under the registered id.
    expect((await registry.availability(workId)).availability).toEqual({ state: "available" });
    expect(await readIdentity(remounted)).toMatchObject({ kind: "ok", identity: { id: workId } });
  });

  it("keeps accepting the moved folder after an offline edit of a workspace that never got an identity", async () => {
    // Registered while its drive was unplugged: pendingInit, and no identity.json anywhere.
    const drive = join(root, "Volumes", "T7", "Kaipu");
    await writeFile(join(userData, "preferences.json"), JSON.stringify({ vaultDirectory: drive }));
    const registry = await WorkspaceRegistry.open(env());
    const id = registry.active().id;
    expect(registry.active().pendingInit).toBe(true);

    // The user renames it while the drive is still away: only the registry can take the change.
    const edited = await registry.edit(id, { name: "Archive", color: "sky" });
    expect(edited).toMatchObject({ ok: true, savedToFolder: false });
    expect(registry.get(id)?.pendingInit).toBe(true);

    // The drive comes back at another path, with Kaipu items and no identity.
    const remounted = join(root, "Remounted");
    await mkdir(join(remounted, ".kaipu"), { recursive: true });
    await writeFile(join(remounted, ".kaipu", "clip.json"), "{}");

    expect(await registry.relocate(id, remounted)).toMatchObject({
      ok: true,
      entry: { id, path: remounted },
    });
  });

  it("refuses an empty folder, never adopting it as this workspace", async () => {
    const { registry, workId } = await withWork();
    const empty = join(root, "Empty");
    await mkdir(empty);

    expect(await registry.relocate(workId, empty)).toEqual({
      ok: false,
      reason: "not-a-workspace",
    });
    expect(await readdir(empty)).toEqual([]);
    expect(registry.get(workId)?.path).toBe(join(root, "Work folder"));
  });

  it("refuses a plain folder with the user's own files", async () => {
    const { registry, workId } = await withWork();
    const plain = join(root, "Documents");
    await mkdir(plain);
    await writeFile(join(plain, "notes.txt"), "mine");

    expect(await registry.relocate(workId, plain)).toEqual({
      ok: false,
      reason: "not-a-workspace",
    });
    expect(await tree(plain)).toEqual(["notes.txt"]);
  });

  it("refuses a workspace file it cannot read, and leaves it as it is", async () => {
    const { registry, workId } = await withWork();
    const broken = join(root, "Broken");
    await mkdir(join(broken, ".kaipu", "workspace"), { recursive: true });
    await writeFile(join(broken, ".kaipu", "workspace", "identity.json"), "{not json");

    expect(await registry.relocate(workId, broken)).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(await readFile(join(broken, ".kaipu", "workspace", "identity.json"), "utf-8")).toBe(
      "{not json",
    );
  });

  it("refuses a path that is not a folder", async () => {
    const { registry, workId } = await withWork();
    const file = join(root, "a-file.txt");
    await writeFile(file, "x");

    expect(await registry.relocate(workId, file)).toEqual({ ok: false, reason: "not-a-folder" });
    expect(await registry.relocate(workId, join(root, "missing"))).toEqual({
      ok: false,
      reason: "not-a-folder",
    });
  });

  it("refuses an unknown workspace", async () => {
    const { registry } = await withWork();

    expect(await registry.relocate("nope", defaultDir)).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses when preferences are read-only this session", async () => {
    await writeFile(join(userData, "preferences.json"), "{broken");
    const registry = await WorkspaceRegistry.open(env());

    expect(await registry.relocate(registry.active().id, defaultDir)).toEqual({
      ok: false,
      reason: "read-only",
    });
  });
});

describe("checkRelocate", () => {
  it("answers the same as relocate, and changes nothing", async () => {
    const { registry, workId, workFolder } = await withWork();
    const moved = await move(workFolder, join(root, "Moved"));
    const empty = join(root, "Empty");
    await mkdir(empty);

    expect(await registry.checkRelocate(workId, moved)).toEqual({ ok: true });
    expect(await registry.checkRelocate(workId, empty)).toEqual({
      ok: false,
      reason: "not-a-workspace",
    });
    expect(registry.get(workId)?.path).toBe(workFolder);
  });
});
