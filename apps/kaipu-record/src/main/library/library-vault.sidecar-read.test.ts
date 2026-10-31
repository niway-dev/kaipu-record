import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryVault, SidecarUnavailableError, type VaultReader } from "./library-vault";

/** NIW2-568: only a missing sidecar means "legacy item"; every other failure must not mint an id. */
describe("LibraryVault — sidecar read errors never mint an identity", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-sidecar-read-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const original = JSON.stringify({
    sidecarVersion: 2,
    assetId: "11111111-1111-4111-8111-111111111111",
    title: "Keep me",
    tagIds: ["t1"],
  });
  const sidecarFile = (id: string): string => join(directory, ".kaipu", `${id}.json`);
  const seed = async (id: string, sidecar: string | null): Promise<void> => {
    await writeFile(join(directory, `${id}.mp4`), Buffer.alloc(512));
    if (sidecar === null) return;
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(sidecarFile(id), sidecar);
  };
  const failingWith = (code: string): VaultReader => ({
    readText: async (path) => {
      throw Object.assign(new Error(`${code}: ${path}`), { code });
    },
  });
  const metaFiles = async (): Promise<string[]> =>
    readdir(join(directory, ".kaipu")).catch(() => []);

  it.each(["EIO", "EACCES"])(
    "lists the item as unreadable on %s, mints nothing and leaves the sidecar byte-identical",
    async (code) => {
      await seed("clip", original);
      const vault = new LibraryVault(directory, null, failingWith(code));

      const [item] = await vault.list();
      expect(item).toMatchObject({ id: "clip", metadataIssue: "unreadable", tagIds: [] });
      expect(item.assetId).toBe("unreadable:clip");

      await expect(
        vault.renameItem({ id: "clip", assetId: "unreadable:clip" }, "New"),
      ).rejects.toBeInstanceOf(SidecarUnavailableError);
      await expect(
        vault.backfill("clip", { durationSeconds: 9, thumbnail: null }),
      ).rejects.toThrow();
      await expect(vault.markOpenedInEditor("clip")).rejects.toThrow();
      await expect(vault.ensureContentHash("clip")).rejects.toThrow();

      expect(await readFile(sidecarFile("clip"), "utf-8")).toBe(original);
      expect(await metaFiles()).toEqual(["clip.json"]);
    },
  );

  it("recovers the original identity, title and tags once a later read succeeds", async () => {
    await seed("clip", original);
    const [degraded] = await new LibraryVault(directory, null, failingWith("EIO")).list();
    expect(degraded.metadataIssue).toBe("unreadable");

    const [healthy] = await new LibraryVault(directory).list();
    expect(healthy).toMatchObject({
      assetId: "11111111-1111-4111-8111-111111111111",
      title: "Keep me",
      tagIds: ["t1"],
    });
    expect(healthy.metadataIssue).toBeUndefined();
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "lists the item as unreadable when the real file has mode 000, and restores it at 644",
    async () => {
      await seed("clip", original);
      await chmod(sidecarFile("clip"), 0o000);
      try {
        const vault = new LibraryVault(directory);
        expect((await vault.describe("clip"))?.metadataIssue).toBe("unreadable");
        await expect(
          vault.renameItem({ id: "clip", assetId: "unreadable:clip" }, "New"),
        ).rejects.toThrow();
      } finally {
        await chmod(sidecarFile("clip"), 0o644);
      }
      expect(await readFile(sidecarFile("clip"), "utf-8")).toBe(original);
      expect((await new LibraryVault(directory).describe("clip"))?.title).toBe("Keep me");
    },
  );

  it.each([
    ["truncated JSON", original.slice(0, 40)],
    ["an empty file", ""],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
  ])(
    "treats %s as corrupt: keeps one copy, never overwrites, writes nothing",
    async (_name, bad) => {
      await seed("clip", bad);
      const vault = new LibraryVault(directory);

      expect(await vault.describe("clip")).toMatchObject({
        metadataIssue: "corrupt",
        assetId: "unreadable:clip",
      });
      // Listed again and renamed: still the same single copy, and the file is untouched.
      await vault.list();
      await expect(
        vault.renameItem({ id: "clip", assetId: "unreadable:clip" }, "New"),
      ).rejects.toBeInstanceOf(SidecarUnavailableError);

      expect(await readFile(sidecarFile("clip"), "utf-8")).toBe(bad);
      const files = await metaFiles();
      expect(files.filter((f) => f.startsWith("clip.json.corrupt-"))).toHaveLength(1);
      expect(files).toHaveLength(2);
      const copy = files.find((f) => f.startsWith("clip.json.corrupt-"))!;
      expect(await readFile(join(directory, ".kaipu", copy), "utf-8")).toBe(bad);
    },
  );

  it("keeps a copy per session even across separate LibraryVault instances", async () => {
    await seed("once", "{not json");
    await new LibraryVault(directory).describe("once");
    await new LibraryVault(directory).describe("once");
    expect((await metaFiles()).filter((f) => f.includes(".corrupt-"))).toHaveLength(1);
  });

  it("keeps a new copy when a repaired sidecar is corrupted again in the same session", async () => {
    await seed("again", "{not json");
    const vault = new LibraryVault(directory);
    await vault.describe("again");
    await writeFile(sidecarFile("again"), original);
    expect(await vault.describe("again")).not.toHaveProperty("metadataIssue");
    await writeFile(sidecarFile("again"), "[]");
    await vault.describe("again");
    expect((await metaFiles()).filter((f) => f.includes(".corrupt-"))).toHaveLength(2);
  });

  it("does not delete the media on removeLocalCopy when the sidecar cannot be read", async () => {
    await seed("clip", original);
    const vault = new LibraryVault(directory, null, failingWith("EIO"));
    await expect(vault.removeLocalCopy("clip")).rejects.toBeInstanceOf(SidecarUnavailableError);
    expect(await readdir(directory)).toContain("clip.mp4");
  });

  it("keeps the assetId of a valid sidecar unchanged", async () => {
    await seed("clip", original);
    const item = await new LibraryVault(directory).describe("clip");
    expect(item?.assetId).toBe("11111111-1111-4111-8111-111111111111");
    expect(await readFile(sidecarFile("clip"), "utf-8")).toBe(original);
  });

  it("still mints and persists an id when the sidecar is genuinely missing (ENOENT)", async () => {
    await seed("legacy", null);
    const vault = new LibraryVault(directory);
    const first = await vault.describe("legacy");
    expect(first?.assetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first?.metadataIssue).toBeUndefined();
    expect(JSON.parse(await readFile(sidecarFile("legacy"), "utf-8")).assetId).toBe(first?.assetId);
    expect((await vault.describe("legacy"))?.assetId).toBe(first?.assetId);
  });
});
