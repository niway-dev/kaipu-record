import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvictedFileError } from "./dataless";
import {
  LibraryVault,
  SYNCED_SIDECAR_READ_TIMEOUT_MS,
  SyncedLocalCopyError,
  type VaultReader,
} from "./library-vault";

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
  /** The record a synced item has once its sidecar arrived. */
  async function seedSidecar(id: string, assetId = `asset-${id}`): Promise<void> {
    await writeFile(
      join(directory, ".kaipu", `${id}.json`),
      JSON.stringify({ sidecarVersion: 2, assetId, title: `Title ${id}` }),
    );
  }
  async function seedShot(id: string): Promise<void> {
    await writeFile(join(directory, `${id}.png`), Buffer.alloc(64));
  }

  it("an evicted screenshot has no thumbnail URL (its thumbnail is its own PNG)", async () => {
    await seedShot("shot");
    // With its record, so describe() takes the normal path (a synced item without one is listed
    // as unreadable, whose thumbnail is null whatever the eviction guard does).
    await seedSidecar("shot");
    const evicted = new Set([join(directory, "shot.png")]);
    const vault = new LibraryVault(directory, "ws-1", undefined, async () => evicted);
    const item = await vault.describe("shot");
    expect(item).toMatchObject({ id: "shot", evicted: "media", thumbnailUrl: null });
    expect(item?.metadataIssue).toBeUndefined();
  });

  it("a local video whose own .jpg is evicted gets no thumbnail URL and says so", async () => {
    await seedVideo("clip");
    await seedSidecar("clip");
    const evicted = new Set([join(directory, ".kaipu", "clip.jpg")]);
    const vault = new LibraryVault(directory, "ws-1", undefined, async () => evicted);
    const item = await vault.describe("clip");
    expect(item).toMatchObject({ evicted: "thumbnail", thumbnailUrl: null });
    expect(item?.metadataIssue).toBeUndefined();
  });

  it("an evicted video has no thumbnail URL even when its .jpg is local", async () => {
    await seedVideo("clip");
    await seedSidecar("clip");
    const evicted = new Set([join(directory, "clip.mp4")]);
    const vault = new LibraryVault(directory, "ws-1", undefined, async () => evicted);
    const item = await vault.describe("clip");
    expect(item).toMatchObject({ evicted: "media", thumbnailUrl: null });
    expect(item?.metadataIssue).toBeUndefined();
  });

  it("list() asks once for the whole folder, media and thumbnails together", async () => {
    await seedVideo("a");
    await seedVideo("b");
    await seedShot("c");
    for (const id of ["a", "b", "c"]) await seedSidecar(id);
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

  it("list() never asks about a poster that is not there: a screenshot has none, and a missing path slows the whole probe", async () => {
    await seedVideo("a");
    await seedShot("c");
    // A video whose poster was never written.
    await writeFile(join(directory, "bare.mp4"), Buffer.alloc(64));
    const probe = vi.fn(async () => new Set<string>());
    await new LibraryVault(directory, "ws-1", undefined, probe).list();
    const asked = (probe.mock.calls[0] as unknown as [string[]])[0];
    expect(asked).toEqual(
      expect.arrayContaining([
        join(directory, "a.mp4"),
        join(directory, "bare.mp4"),
        join(directory, "c.png"),
        join(directory, ".kaipu", "a.jpg"),
      ]),
    );
    expect(asked).not.toContain(join(directory, ".kaipu", "c.jpg"));
    expect(asked).not.toContain(join(directory, ".kaipu", "bare.jpg"));
  });

  it("describe() of one item asks about its media and only the poster that exists", async () => {
    await seedShot("c");
    const probe = vi.fn(async () => new Set<string>());
    await new LibraryVault(directory, "ws-1", undefined, probe).describe("c");
    expect(probe).toHaveBeenCalledWith([join(directory, "c.png")]);
  });

  it("an item whose sidecar cannot be read still says its media is not downloaded", async () => {
    await seedVideo("clip");
    await writeFile(join(directory, ".kaipu", "clip.json"), "{ truncated");
    const file = join(directory, "clip.mp4");
    const vault = new LibraryVault(directory, "ws-1", undefined, async () => new Set([file]));
    expect(await vault.describe("clip")).toMatchObject({
      evicted: "media",
      thumbnailUrl: null,
      metadataIssue: expect.anything(),
    });
    const [listed] = await vault.list();
    expect(listed).toMatchObject({ id: "clip", evicted: "media" });
  });

  it("a synced vault gives up on a sidecar the provider never delivers and lists the item read-only", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await seedVideo("clip");
      let reading: () => void = () => {};
      const started = new Promise<void>((resolve) => (reading = resolve));
      const never: VaultReader = {
        readText: () => {
          reading();
          return new Promise<string>(() => {});
        },
      };
      const vault = new LibraryVault(directory, "ws-1", never, async () => new Set<string>());
      const listing = vault.list();
      await started;
      await vi.advanceTimersByTimeAsync(SYNCED_SIDECAR_READ_TIMEOUT_MS + 1);
      const [item] = await listing;
      expect(item).toMatchObject({ id: "clip", metadataIssue: expect.anything() });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a plain workspace puts no deadline on a sidecar read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await seedVideo("clip");
      let resolveRead: (text: string) => void = () => {};
      const slow: VaultReader = {
        readText: () => new Promise<string>((resolve) => (resolveRead = resolve)),
      };
      const vault = new LibraryVault(directory, "ws-1", slow);
      const sidecar = vault.sidecar("clip");
      await vi.advanceTimersByTimeAsync(SYNCED_SIDECAR_READ_TIMEOUT_MS * 2);
      resolveRead("{}");
      await expect(sidecar).resolves.toEqual({});
    } finally {
      vi.useRealTimers();
    }
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

  it("hashes a file the provider holds locally, after asking about exactly that file", async () => {
    await seedVideo("clip");
    const probe = vi.fn(async () => new Set<string>());
    const synced = new LibraryVault(directory, "ws-1", undefined, probe);
    await expect(synced.ensureContentHash("clip")).resolves.toMatchObject({
      contentSha256: expect.any(String),
    });
    expect(probe).toHaveBeenCalledWith([join(directory, "clip.mp4")]);
  });

  it("a plain workspace hashes without asking: it has no probe, and assertLocal passes", async () => {
    await seedVideo("clip");
    const plain = new LibraryVault(directory, "ws-1");
    await expect(plain.assertLocal([join(directory, "clip.mp4")])).resolves.toBeUndefined();
    expect(await plain.evictedAmong([join(directory, "clip.mp4")])).toEqual(new Set());
    await expect(plain.ensureContentHash("clip")).resolves.toMatchObject({
      contentSha256: expect.any(String),
    });
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
  describe("the cursor track (NIW2-912)", () => {
    const trackFile = () => join(directory, ".kaipu", "clip.cursor.json");

    it("is null only when there is none", async () => {
      await seedVideo("clip");
      const vault = new LibraryVault(directory, "ws-1", undefined, async () => new Set<string>());
      expect(await vault.readCursorTrack("clip")).toBeNull();
      await writeFile(trackFile(), '{"version":1}');
      expect(await vault.readCursorTrack("clip")).toBe('{"version":1}');
    });

    it("an offloaded track throws EvictedFileError without being read", async () => {
      await seedVideo("clip");
      await writeFile(trackFile(), '{"version":1}');
      const vault = new LibraryVault(
        directory,
        "ws-1",
        undefined,
        async () => new Set([trackFile()]),
      );
      await expect(vault.readCursorTrack("clip")).rejects.toBeInstanceOf(EvictedFileError);
    });

    it("a track that cannot be read for another reason throws that error, not EvictedFileError, and is read again next time", async () => {
      await seedVideo("clip");
      // A folder where the file should be: EISDIR, not ENOENT.
      await mkdir(trackFile());
      const vault = new LibraryVault(directory, "ws-1", undefined, async () => new Set<string>());
      const failure = await vault.readCursorTrack("clip").catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(EvictedFileError);
      expect((failure as NodeJS.ErrnoException).code).not.toBe("ENOENT");

      // Nothing sticks: once the file is readable the same vault reads it.
      await rm(trackFile(), { recursive: true });
      await writeFile(trackFile(), '{"version":1}');
      expect(await vault.readCursorTrack("clip")).toBe('{"version":1}');
    });

    it("a plain workspace reports an unreadable track too", async () => {
      await seedVideo("clip");
      await mkdir(trackFile());
      await expect(new LibraryVault(directory, "ws-1").readCursorTrack("clip")).rejects.toThrow();
    });
  });

  describe("a media file whose sidecar has not synced down yet (NIW2-912)", () => {
    const sidecarFile = () => join(directory, ".kaipu", "clip.json");
    const syncedVault = () =>
      new LibraryVault(directory, "ws-1", undefined, async () => new Set<string>());

    it("is listed read-only and never given an identity, however long it waits", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        await seedVideo("clip");
        const vault = syncedVault();
        expect(await vault.describe("clip")).toMatchObject({ metadataIssue: "unreadable" });
        vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
        expect(await vault.describe("clip")).toMatchObject({ metadataIssue: "unreadable" });
        expect(await vault.list()).toEqual([
          expect.objectContaining({ metadataIssue: "unreadable" }),
        ]);
        await expect(access(sidecarFile())).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps the sidecar that arrives meanwhile: nothing was minted over it", async () => {
      await seedVideo("clip");
      const vault = syncedVault();
      expect(await vault.describe("clip")).toMatchObject({ metadataIssue: "unreadable" });

      await seedSidecar("clip", "the-real-identity");
      expect(await vault.describe("clip")).toMatchObject({
        assetId: "the-real-identity",
        title: "Title clip",
      });
      expect(JSON.parse(await readFile(sidecarFile(), "utf-8"))).toMatchObject({
        assetId: "the-real-identity",
      });
    });

    it("adoptMedia mints nothing in a synced workspace unless the user asked", async () => {
      await seedVideo("clip");
      const vault = syncedVault();
      const fields = { title: "Clip", createdAt: 1 };
      expect(await vault.adoptMedia("clip", fields)).toBe(false);
      await expect(access(sidecarFile())).rejects.toMatchObject({ code: "ENOENT" });

      expect(await vault.adoptMedia("clip", fields, { explicit: true })).toBe(true);
      await expect(access(sidecarFile())).resolves.toBeUndefined();
      // A second explicit request finds the record and does not replace it.
      expect(await vault.adoptMedia("clip", fields, { explicit: true })).toBe(false);
    });

    it("a plain workspace gives a legacy item its identity at once", async () => {
      await seedVideo("clip");
      const vault = new LibraryVault(directory, "ws-1");
      expect((await vault.describe("clip"))?.metadataIssue).toBeUndefined();
      await expect(access(sidecarFile())).resolves.toBeUndefined();
      expect(
        await new LibraryVault(directory, "ws-2").adoptMedia("clip", { title: "x", createdAt: 1 }),
      ).toBe(false);
    });
  });
});
