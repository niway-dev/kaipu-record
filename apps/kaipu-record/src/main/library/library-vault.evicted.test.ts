import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvictedFileError } from "./dataless";
import { LibraryVault, SyncedLocalCopyError } from "./library-vault";

/**
 * Synced folders (decision 15): rendering the Library must not download an evicted file. The
 * File Provider is not touched: the eviction probe is injected, and the test asserts both what
 * `describe()` hands out and which paths the vault asked about.
 */
describe("LibraryVault — evicted files get no image URL", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-evicted-"));
    await mkdir(join(directory, ".kaipu"), { recursive: true });
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function seedVideo(id: string): Promise<void> {
    await writeFile(join(directory, `${id}.mp4`), Buffer.alloc(64));
    await writeFile(join(directory, ".kaipu", `${id}.jpg`), Buffer.alloc(8));
  }
  async function seedShot(id: string): Promise<void> {
    await writeFile(join(directory, `${id}.png`), Buffer.alloc(64));
  }

  it("an evicted screenshot has no thumbnail URL (its thumbnail is its own PNG)", async () => {
    await seedShot("shot");
    const evicted = new Set([join(directory, "shot.png")]);
    const vault = new LibraryVault(directory, "ws-1", undefined, async () => evicted);
    const item = await vault.describe("shot");
    expect(item).toMatchObject({ id: "shot", evicted: "media", thumbnailUrl: null });
  });

  it("a local video whose own .jpg is evicted gets no thumbnail URL and says so", async () => {
    await seedVideo("clip");
    const evicted = new Set([join(directory, ".kaipu", "clip.jpg")]);
    const vault = new LibraryVault(directory, "ws-1", undefined, async () => evicted);
    expect(await vault.describe("clip")).toMatchObject({
      evicted: "thumbnail",
      thumbnailUrl: null,
    });
  });

  it("an evicted video has no thumbnail URL even when its .jpg is local", async () => {
    await seedVideo("clip");
    const evicted = new Set([join(directory, "clip.mp4")]);
    const vault = new LibraryVault(directory, "ws-1", undefined, async () => evicted);
    expect(await vault.describe("clip")).toMatchObject({ evicted: "media", thumbnailUrl: null });
  });

  it("list() asks once for the whole folder, media and thumbnails together", async () => {
    await seedVideo("a");
    await seedVideo("b");
    await seedShot("c");
    const probe = vi.fn(async () => new Set<string>([join(directory, "b.mp4")]));
    const vault = new LibraryVault(directory, "ws-1", undefined, probe);
    const items = await vault.list();
    expect(probe).toHaveBeenCalledTimes(1);
    const asked = (probe.mock.calls[0] as unknown as [string[]])[0];
    expect(asked).toEqual(
      expect.arrayContaining([
        join(directory, "a.mp4"),
        join(directory, ".kaipu", "a.jpg"),
        join(directory, "b.mp4"),
        join(directory, "c.png"),
      ]),
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("b")).toMatchObject({ evicted: "media", thumbnailUrl: null });
    expect(byId.get("a")?.evicted).toBeUndefined();
    expect(byId.get("a")?.thumbnailUrl).toMatch(/^kaipu-media:\/\/thumb\//);
    expect(byId.get("c")?.thumbnailUrl).toMatch(/^kaipu-media:\/\/screenshot\//);
  });

  it("a plain (not synced) workspace never probes", async () => {
    await seedVideo("a");
    const vault = new LibraryVault(directory, "ws-1");
    const [item] = await vault.list();
    expect(item?.evicted).toBeUndefined();
    expect(item?.thumbnailUrl).toMatch(/^kaipu-media:\/\/thumb\//);
  });

  it("never hashes an evicted file: reading it would download it (decision 4)", async () => {
    await seedVideo("clip");
    const file = join(directory, "clip.mp4");
    const vault = new LibraryVault(directory, "ws-1", undefined, async () => new Set([file]));
    await expect(vault.ensureContentHash("clip")).rejects.toBeInstanceOf(EvictedFileError);
    // Nothing was stamped: a failed guard leaves no hash behind.
    expect((await vault.sidecar("clip"))?.contentSha256).toBeUndefined();
  });

  it("hashes a file the provider holds locally, and a plain workspace never asks", async () => {
    await seedVideo("clip");
    const probe = vi.fn(async () => new Set<string>());
    const synced = new LibraryVault(directory, "ws-1", undefined, probe);
    await expect(synced.ensureContentHash("clip")).resolves.toMatchObject({
      contentSha256: expect.any(String),
    });
    expect(probe).toHaveBeenCalled();
  });

  it("removeLocalCopy refuses in a synced vault: deleting there deletes the cloud copy", async () => {
    await seedVideo("clip");
    const vault = new LibraryVault(directory, "ws-1", undefined, async () => new Set());
    await expect(vault.removeLocalCopy("clip")).rejects.toBeInstanceOf(SyncedLocalCopyError);
    await expect(access(join(directory, "clip.mp4"))).resolves.toBeUndefined();
    expect((await vault.sidecar("clip"))?.localRemovedAt).toBeUndefined();
  });

  it("readLocalFile reads a local file whole and refuses an evicted one without reading it", async () => {
    await seedShot("shot");
    const file = join(directory, "shot.png");
    const local = new LibraryVault(directory, "ws-1", undefined, async () => new Set());
    expect((await local.readLocalFile(file)).byteLength).toBe(64);

    const evicted = new LibraryVault(directory, "ws-1", undefined, async () => new Set([file]));
    await expect(evicted.readLocalFile(file)).rejects.toMatchObject({ code: "EVICTED" });
  });
});
