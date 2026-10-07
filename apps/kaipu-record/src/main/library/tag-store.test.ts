import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TagLimitError, TAGS_PER_ITEM_MAX } from "@kaipu/domain/constants";
import { LibraryVault } from "./library-vault";
import { foldVocabulary, SidecarTagStore, TagStoreProvider } from "./tag-store";

describe("SidecarTagStore", () => {
  let directory: string;
  let vault: LibraryVault;
  let store: SidecarTagStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-tags-"));
    vault = new LibraryVault(directory);
    store = new SidecarTagStore(() => vault);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const writeRecording = (id: string): Promise<void> =>
    writeFile(join(directory, `${id}.webm`), Buffer.alloc(1024));

  const writeSidecar = async (id: string, data: object): Promise<void> => {
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(join(directory, ".kaipu", `${id}.json`), JSON.stringify(data));
  };

  const readSidecar = async (id: string): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(join(directory, ".kaipu", `${id}.json`), "utf8"));

  it("stores normalized tags and keeps title, assetId and hash fields", async () => {
    await writeRecording("clip");
    await writeSidecar("clip", {
      sidecarVersion: 2,
      title: "My clip",
      assetId: "asset-1",
      contentSha256: "abc123",
      hashedSizeBytes: 1024,
      hashedMtimeMs: 42,
    });

    const stored = await store.set("clip", ["Cricut", "issue #1232", "video"], 1000);

    expect(stored).toEqual(["cricut", "issue-#1232", "video"]);
    expect(await readSidecar("clip")).toMatchObject({
      title: "My clip",
      assetId: "asset-1",
      contentSha256: "abc123",
      hashedSizeBytes: 1024,
      hashedMtimeMs: 42,
      tags: ["cricut", "issue-#1232", "video"],
      tagsUpdatedAt: 1000,
    });
  });

  it("creates the sidecar for an item that had none, and lists the tags", async () => {
    await writeRecording("bare");
    await store.set("bare", [" Kaipu "], 5);
    expect(await store.get("bare")).toEqual(["kaipu"]);
    const [item] = await vault.list();
    expect(item.tags).toEqual(["kaipu"]);
  });

  it("drops invalid tags and duplicate spellings before the file system", async () => {
    await writeRecording("clip");
    const stored = await store.set("clip", ["../x", "Cricut", "cricut", "a/b", ""], 1);
    expect(stored).toEqual(["cricut"]);
    expect((await readSidecar("clip")).tags).toEqual(["cricut"]);
  });

  it("replaces the tag list (removing a tag sticks) and stamps tagsUpdatedAt", async () => {
    await writeRecording("clip");
    await store.set("clip", ["a", "b"], 1);
    await store.set("clip", ["b"], 2);
    expect(await readSidecar("clip")).toMatchObject({ tags: ["b"], tagsUpdatedAt: 2 });
  });

  it("refuses more than the per-item limit and leaves the sidecar alone", async () => {
    await writeRecording("clip");
    await store.set("clip", ["keep"], 1);
    const tooMany = Array.from({ length: TAGS_PER_ITEM_MAX + 1 }, (_, i) => `t${i}`);
    await expect(store.set("clip", tooMany, 2)).rejects.toBeInstanceOf(TagLimitError);
    expect((await readSidecar("clip")).tags).toEqual(["keep"]);
  });

  it("returns no tags for an item without a sidecar", async () => {
    await writeRecording("bare");
    expect(await store.get("bare")).toEqual([]);
    const [item] = await vault.list();
    expect(item.tags).toEqual([]);
  });

  it("builds the vocabulary from the scanned sidecars, most used first", async () => {
    await writeRecording("one");
    await writeRecording("two");
    await writeRecording("three");
    await store.set("one", ["cricut", "video"], 1);
    await store.set("two", ["cricut"], 1);
    expect(await store.vocabulary()).toEqual([
      { tag: "cricut", count: 2 },
      { tag: "video", count: 1 },
    ]);
  });

  it("is what the provider hands out in Phase 1", () => {
    expect(new TagStoreProvider(() => vault).current()).toBeInstanceOf(SidecarTagStore);
  });
});

describe("foldVocabulary", () => {
  it("breaks count ties alphabetically", () => {
    expect(foldVocabulary([["b", "a"], ["c"]])).toEqual([
      { tag: "a", count: 1 },
      { tag: "b", count: 1 },
      { tag: "c", count: 1 },
    ]);
  });
});
