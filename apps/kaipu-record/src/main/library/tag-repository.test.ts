import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TagLimitError, TagNameTakenError, TAGS_PER_ITEM_MAX } from "@kaipu/domain/constants";
import { LibraryVault } from "./library-vault";
import { loadDeviceId, TagRegistryError, uuidv7, VaultTagRepository } from "./tag-repository";

describe("VaultTagRepository", () => {
  let directory: string;
  let vault: LibraryVault;
  let repo: VaultTagRepository;
  let clock: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-tags-"));
    vault = new LibraryVault(directory);
    clock = 1_000;
    repo = new VaultTagRepository(
      () => vault,
      () => "d-test",
      () => clock++,
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const writeItem = (id: string): Promise<void> =>
    writeFile(join(directory, `${id}.webm`), Buffer.alloc(16));
  const sidecar = async (id: string): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(join(directory, ".kaipu", `${id}.json`), "utf8"));
  const kaipu = (): string => join(directory, ".kaipu");
  const registry = async (): Promise<{ tags: Array<Record<string, unknown>> }> =>
    JSON.parse(await readFile(join(directory, ".kaipu", "tags.json"), "utf8"));

  it("creates a standalone tag with a slug, a palette color and traceability", async () => {
    const tag = await repo.create("  Archivos   varios ");
    expect(tag).toMatchObject({
      name: "Archivos varios",
      slug: "archivos_varios",
      color: "rose",
      createdOn: "d-test",
      updatedOn: "d-test",
      deletedAt: null,
    });
    expect(tag.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await repo.list()).toEqual([
      { id: tag.id, name: "Archivos varios", slug: "archivos_varios", color: "rose", count: 0 },
    ]);
  });

  it("gives each new tag the least used color", async () => {
    expect((await repo.create("One")).color).toBe("rose");
    expect((await repo.create("Two")).color).toBe("coral");
    expect((await repo.create("Three", "mint")).color).toBe("mint");
  });

  it("refuses a name whose slug is taken, in any case", async () => {
    const demo = await repo.create("Demo");
    await expect(repo.create("demo")).rejects.toBeInstanceOf(TagNameTakenError);
    await expect(repo.create("DEMO ")).rejects.toMatchObject({ existingId: demo.id });
    await expect(repo.create("a/b")).rejects.toThrow(/valid tag name/);
  });

  it("renames in one registry write: items keep the same id", async () => {
    await writeItem("clip");
    const tag = await repo.create("Bug");
    await repo.assign("clip", [tag.id]);
    const renamed = await repo.rename(tag.id, "Issue");
    expect(renamed).toMatchObject({ id: tag.id, name: "Issue", slug: "issue" });
    expect((await sidecar("clip")).tagIds).toEqual([tag.id]);
    expect((await repo.list())[0]).toMatchObject({ name: "Issue", count: 1 });
  });

  it("refuses to rename onto another tag's name but allows changing its own case", async () => {
    const a = await repo.create("Alpha");
    await repo.create("Beta");
    await expect(repo.rename(a.id, "beta")).rejects.toBeInstanceOf(TagNameTakenError);
    expect((await repo.rename(a.id, "ALPHA")).name).toBe("ALPHA");
  });

  it("recolors and refuses colors outside the palette", async () => {
    const tag = await repo.create("Demo");
    expect((await repo.recolor(tag.id, "lagoon")).color).toBe("lagoon");
    // @ts-expect-error -- the IPC boundary can send anything
    await expect(repo.recolor(tag.id, "#ff0000")).rejects.toThrow(/palette/);
  });

  it("deletes with a tombstone and takes the tag off every item", async () => {
    await writeItem("one");
    await writeItem("two");
    const demo = await repo.create("Demo");
    const keep = await repo.create("Keep");
    await repo.assign("one", [demo.id, keep.id]);
    await repo.assign("two", [demo.id]);
    await repo.remove(demo.id);
    expect((await sidecar("one")).tagIds).toEqual([keep.id]);
    expect((await sidecar("two")).tagIds).toEqual([]);
    expect((await repo.list()).map((t) => t.name)).toEqual(["Keep"]);
    const tombstone = (await registry()).tags.find((t) => t.id === demo.id);
    expect(tombstone?.deletedAt).not.toBeNull();
    // A deleted name can be created again, as a new tag.
    expect((await repo.create("Demo")).id).not.toBe(demo.id);
  });

  it("assigns only live tags, caches their names, and keeps the sidecar's other fields", async () => {
    await writeItem("clip");
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(
      join(directory, ".kaipu", "clip.json"),
      JSON.stringify({ sidecarVersion: 2, title: "My clip", assetId: "asset-1" }),
    );
    const tag = await repo.create("Cricut");
    expect(await repo.assign("clip", [tag.id, tag.id, "ghost"])).toEqual([tag.id]);
    expect(await sidecar("clip")).toMatchObject({
      title: "My clip",
      assetId: "asset-1",
      tagIds: [tag.id],
      tagNames: ["Cricut"],
    });
  });

  it("refuses unknown, deleted or path-like items and writes no sidecar", async () => {
    await writeItem("gone");
    await rm(join(directory, "gone.webm"));
    for (const id of ["missing", "gone", "../clip", "a/b", ".kaipu", ""]) {
      await expect(repo.assign(id, [])).rejects.toThrow(/no library item/);
    }
    expect(await readdir(directory)).toEqual([]);
  });

  it("refuses more than the per-item limit", async () => {
    await writeItem("clip");
    const ids: string[] = [];
    for (let i = 0; i <= TAGS_PER_ITEM_MAX; i++) ids.push((await repo.create(`t${i}`)).id);
    await expect(repo.assign("clip", ids)).rejects.toBeInstanceOf(TagLimitError);
  });

  it("imports Phase 1 string tags once, merging spellings", async () => {
    await writeItem("one");
    await writeItem("two");
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(
      join(directory, ".kaipu", "one.json"),
      JSON.stringify({ tags: ["cricut", "demo"] }),
    );
    await writeFile(join(directory, ".kaipu", "two.json"), JSON.stringify({ tags: ["Cricut"] }));

    const list = await repo.list();
    // Spellings merge by slug; the first spelling met keeps the name.
    expect(list.map((t) => [t.slug, t.count])).toEqual([
      ["cricut", 2],
      ["demo", 1],
    ]);
    const one = await sidecar("one");
    expect(one.tags).toBeUndefined();
    expect(one.tagIds).toEqual(list.map((t) => t.id));
    expect((await sidecar("two")).tagIds).toEqual([list[0]!.id]);
  });

  it("persists an empty registry on first list so the import never re-runs", async () => {
    await writeItem("clip");
    expect(await repo.list()).toEqual([]);
    expect((await registry()).tags).toEqual([]);
    await writeFile(join(kaipu(), "clip.json"), JSON.stringify({ tags: ["late"] }));
    expect(await repo.list()).toEqual([]);
    expect((await sidecar("clip")).tags).toEqual(["late"]);
  });

  it("does not scan the vault for counts when there are no live tags", async () => {
    await writeItem("clip");
    const spy = vi.spyOn(vault, "list");
    await repo.list(); // the one-time import scans
    spy.mockClear();
    await repo.list();
    expect(spy).not.toHaveBeenCalled();
  });

  it("writes the registry before stripping legacy tags", async () => {
    await writeItem("one");
    await mkdir(kaipu(), { recursive: true });
    await writeFile(join(kaipu(), "one.json"), JSON.stringify({ tags: ["cricut", "demo"] }));
    // Not "Once": vault.list() backfills item identity through writeMeta and swallows its errors.
    vi.spyOn(vault, "writeMeta").mockRejectedValue(new Error("crash"));
    await expect(repo.list()).rejects.toThrow("crash");
    expect((await registry()).tags).toHaveLength(2);
  });

  it("refuses writes and keeps the file when tags.json is corrupt", async () => {
    await mkdir(kaipu(), { recursive: true });
    await writeFile(join(kaipu(), "tags.json"), "{ not json");
    await expect(repo.create("X")).rejects.toBeInstanceOf(TagRegistryError);
    await expect(repo.list()).rejects.toMatchObject({ code: "corrupt" });
    await expect(repo.list()).rejects.toMatchObject({ code: "corrupt" });
    expect(await readFile(join(kaipu(), "tags.json"), "utf8")).toBe("{ not json");
    const copies = (await readdir(kaipu())).filter((n) => n.startsWith("tags.json.corrupt-"));
    expect(copies).toHaveLength(1);
    expect(await readFile(join(kaipu(), copies[0]!), "utf8")).toBe("{ not json");
  });

  it("treats a newer registry version as untrusted", async () => {
    await mkdir(kaipu(), { recursive: true });
    const newer = JSON.stringify({ version: 2, tags: [] });
    await writeFile(join(kaipu(), "tags.json"), newer);
    await expect(repo.create("X")).rejects.toBeInstanceOf(TagRegistryError);
    expect(await readFile(join(kaipu(), "tags.json"), "utf8")).toBe(newer);
  });

  it("does not treat an unreadable registry as missing", async () => {
    await writeItem("one");
    await mkdir(join(kaipu(), "tags.json"), { recursive: true }); // EISDIR on read
    await writeFile(join(kaipu(), "one.json"), JSON.stringify({ tags: ["legacy"] }));
    await expect(repo.list()).rejects.toMatchObject({ code: "unreadable" });
    expect((await readdir(kaipu())).filter((n) => n.includes(".corrupt-"))).toEqual([]);
    expect((await sidecar("one")).tags).toEqual(["legacy"]);
  });

  it("writes the registry atomically, leaving no temp file", async () => {
    await repo.create("Demo");
    expect(await readdir(join(directory, ".kaipu"))).toEqual(["tags.json"]);
  });

  it("serializes concurrent creates so none is lost", async () => {
    await Promise.all(["a", "b", "c", "d"].map((name) => repo.create(name)));
    expect((await repo.list()).map((t) => t.name).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("uuidv7", () => {
  it("is a version 7 UUID that sorts by time", () => {
    const a = uuidv7(1_000);
    const b = uuidv7(2_000);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a[14]).toBe("7");
    expect(a < b).toBe(true);
  });
});

describe("loadDeviceId", () => {
  it("mints an id once and reuses it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kaipu-device-"));
    try {
      const first = await loadDeviceId(dir);
      expect(first).toMatch(/^d-/);
      expect(await loadDeviceId(dir)).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
