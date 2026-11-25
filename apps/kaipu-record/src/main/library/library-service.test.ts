import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { CatalogCache } from "../cloud/catalog-cache";
import { LibraryService } from "./library-service";
import { LibraryVault, SYNCED_READS_BUDGET_MS } from "./library-vault";

/** Rename by the id a caller saw, with the identity it holds there (as the IPC does). */
async function renameById(
  v: LibraryVault,
  id: string,
  title: string,
  options?: Parameters<LibraryVault["renameItem"]>[2],
) {
  return v.renameItem(
    { id, assetId: (await v.describe(id))?.assetId ?? "missing" },
    title,
    options,
  );
}

const SHA_EMPTY = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

describe("LibraryService", () => {
  let vaultDir: string;
  let userData: string;
  let account: { userId: string; token: string } | null;
  let catalog: CloudCatalogEntry[];
  let cache: CatalogCache;
  // Typed with the deps signature (not `ReturnType<typeof vi.fn>`) so the injected
  // object is assignable — vi.fn's loose Mock type otherwise fails `bun run typecheck`
  // even though it runs fine (see screenshot-capture.test.ts for the same pattern).
  let fetchCatalog: (token: string) => Promise<CloudCatalogEntry[]>;
  let service: LibraryService;
  let clock: number;

  const cloudEntry = (
    assetId: string,
    extra: Partial<CloudCatalogEntry> = {},
  ): CloudCatalogEntry => ({
    assetId,
    kind: "recording",
    title: "C",
    revisionId: "r1",
    contentType: "video/mp4",
    sizeBytes: 0,
    contentSha256: SHA_EMPTY,
    durationSeconds: 1,
    hasThumbnail: false,
    derivedFromAssetId: null,
    autoUploadExcluded: false,
    createdAt: 1,
    lastVerifiedAt: 1,
    lastSeenLocalId: null,
    ...extra,
  });

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "kaipu-svc-vault-"));
    userData = await mkdtemp(join(tmpdir(), "kaipu-svc-data-"));
    account = { userId: "u1", token: "t" };
    catalog = [];
    clock = 777;
    fetchCatalog = vi.fn(async () => catalog);
    cache = new CatalogCache(userData);
    service = new LibraryService({
      vault: () => new LibraryVault(vaultDir),
      vaultDir: () => vaultDir,
      cache,
      account: () => account,
      fetchCatalog,
      now: () => clock,
    });
  });
  afterEach(async () => {
    await chmod(vaultDir, 0o700).catch(() => {});
    await rm(vaultDir, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  });

  it("lists a renamed item once, under its new id and the same assetId", async () => {
    account = null;
    await writeFile(join(vaultDir, "old.mp4"), "");
    const [before] = (await service.list()).items;
    await renameById(new LibraryVault(vaultDir), "old", "Sprint demo");
    const { items } = await service.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      assetId: before!.assetId,
      title: "Sprint demo",
      local: { id: "Sprint demo" },
    });
  });

  it("lists local items only when signed out, with catalogVerifiedAt null", async () => {
    account = null;
    await writeFile(join(vaultDir, "a.mp4"), "");
    const result = await service.list();
    expect(result.items.map((i) => i.availability)).toEqual(["local"]);
    expect(result.catalogVerifiedAt).toBeNull();
    expect(result.vaultError).toBeNull();
  });

  it("a workspace that does not own the legacy cloud entries hides them and leaves the cache alone", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const rec = (await new LibraryVault(vaultDir).describe("a"))!;
    catalog = [cloudEntry(rec.assetId), cloudEntry("from-default", { lastSeenLocalId: "x" })];
    await service.refreshCatalog();
    const before = await cache.read("u1");
    const other = new LibraryService({
      vault: () => new LibraryVault(vaultDir),
      vaultDir: () => vaultDir,
      cache,
      account: () => account,
      fetchCatalog,
      ownsLegacyCloud: () => false,
      now: () => 777,
    });

    const result = await other.list();

    // Its own item still shows its cloud copy; the other workspace's cloud-only item does not.
    expect(result.items.map((i) => [i.assetId, i.availability])).toEqual([
      [rec.assetId, "local-and-cloud"],
    ]);
    expect(await cache.read("u1")).toEqual(before);
    expect(result.catalogVerifiedAt).toBe(777);
  });

  it("refreshCatalog caches per account and list merges by assetId", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const vault = new LibraryVault(vaultDir);
    const rec = (await vault.describe("a"))!;
    catalog = [cloudEntry(rec.assetId), cloudEntry("cloud-only")];
    expect(await service.refreshCatalog()).toEqual({ ok: true, verifiedAt: 777, changed: true });
    const result = await service.list();
    expect(result.items.map((i) => [i.assetId, i.availability])).toEqual(
      expect.arrayContaining([
        [rec.assetId, "local-and-cloud"],
        ["cloud-only", "cloud"],
      ]),
    );
    expect(result.items).toHaveLength(2);
    expect(result.catalogVerifiedAt).toBe(777);
    // Switching accounts hides the other account's catalog.
    account = { userId: "u2", token: "t2" };
    expect((await service.list()).items.map((i) => i.availability)).toEqual(["local"]);
  });

  it("an unauthorized refresh keeps the cached catalog", async () => {
    catalog = [cloudEntry("x")];
    await service.refreshCatalog();
    vi.mocked(fetchCatalog).mockRejectedValueOnce({ kind: "unauthorized" });
    expect(await service.refreshCatalog({ force: true })).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect((await service.list()).items).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")(
    "an unreadable vault reports vaultError and keeps cloud items",
    async () => {
      await writeFile(join(vaultDir, "a.mp4"), "");
      const rec = (await new LibraryVault(vaultDir).describe("a"))!;
      catalog = [cloudEntry(rec.assetId)];
      await service.refreshCatalog();
      await service.list(); // records lastSeenLocalId
      await chmod(vaultDir, 0o000);
      const result = await service.list();
      expect(result.vaultError).toMatch(/EACCES|EPERM/);
      expect(result.items.map((i) => i.availability)).toEqual(["local-unavailable"]);
    },
  );

  it("removeLocalCopy applies the policy and only deletes the media file", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const rec = (await new LibraryVault(vaultDir).describe("a"))!;
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "no-cloud-copy" });
    catalog = [cloudEntry(rec.assetId, { sizeBytes: 0 })];
    await service.refreshCatalog();
    await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
    await writeFile(join(vaultDir, ".kaipu", "a.edit.json"), "{}");
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "edit-project" });
    await rm(join(vaultDir, ".kaipu", "a.edit.json"));
    await writeFile(join(vaultDir, ".kaipu", "a.webcam.mp4"), "");
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "webcam-track" });
    await access(join(vaultDir, "a.mp4"));
    await rm(join(vaultDir, ".kaipu", "a.webcam.mp4"));
    expect(await service.removeLocalCopy("a")).toEqual({ ok: true });
    const after = await service.list();
    expect(after.items.map((i) => i.availability)).toEqual(["cloud"]);
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "not-found" });
  });

  it("removeLocalCopy in a synced workspace reveals the file and deletes nothing (decision 4)", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const rec = (await new LibraryVault(vaultDir).describe("a"))!;
    catalog = [cloudEntry(rec.assetId, { sizeBytes: 0 })];
    const reveal = vi.fn();
    const synced = new LibraryService({
      vault: () => new LibraryVault(vaultDir, "ws", undefined, async () => new Set()),
      vaultDir: () => vaultDir,
      cache,
      account: () => account,
      fetchCatalog,
      now: () => clock,
      reveal,
    });
    await synced.refreshCatalog();

    expect(await synced.removeLocalCopy("a")).toEqual({ ok: true, revealed: true });

    expect(reveal).toHaveBeenCalledWith(join(vaultDir, "a.mp4"));
    await access(join(vaultDir, "a.mp4"));
    // Still local: the sidecar does not claim a removal that did not happen.
    expect((await synced.list()).items.map((i) => i.availability)).toEqual(["local-and-cloud"]);
  });

  it("list() in a synced workspace reads each edit meta through the bounded reader, and an offloaded one is not downloaded", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
    await writeFile(join(vaultDir, ".kaipu", "a.edit.json"), "{}");
    const metaPath = join(vaultDir, ".kaipu", "a.edit.meta.json");
    await writeFile(metaPath, JSON.stringify({ savedAt: 123 }));
    // The provider has offloaded the meta file: only the bounded reader knows that.
    const vault = new LibraryVault(
      vaultDir,
      "ws",
      undefined,
      async (paths) => new Set(paths.filter((p) => p === metaPath)),
    );
    const readTextBounded = vi.spyOn(vault, "readTextBounded");
    const synced = new LibraryService({
      vault: () => vault,
      vaultDir: () => vaultDir,
      cache,
      account: () => account,
      fetchCatalog,
      now: () => clock,
    });

    const { items } = await synced.list();

    // Both probes (editing and edit-session) share one read through the vault's bounded reader.
    expect(readTextBounded.mock.calls.filter(([p]) => p === metaPath)).toHaveLength(1);
    // Unknown, not damaged: an offloaded meta is neither "missing-dependencies" nor a bare read.
    expect(items[0]?.editing).toBe("project-available");
    expect(items[0]?.editExportedSavedAt ?? null).toBeNull();
    expect(items[0]?.editSavedAt ?? null).toBeNull();
  });

  it("list() in a synced workspace stops starting meta reads once the listing budget is spent", async () => {
    for (const id of ["a", "b", "c"]) {
      await writeFile(join(vaultDir, `${id}.mp4`), "");
      await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
      await writeFile(join(vaultDir, ".kaipu", `${id}.edit.json`), "{}");
      await writeFile(
        join(vaultDir, ".kaipu", `${id}.edit.meta.json`),
        JSON.stringify({ savedAt: 123 }),
      );
    }
    const vault = new LibraryVault(vaultDir, "ws", undefined, async () => new Set());
    const real = vault.readTextBounded.bind(vault);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // The first read answers, but only after the whole budget has gone by.
      const readTextBounded = vi.spyOn(vault, "readTextBounded").mockImplementation(async (p) => {
        vi.setSystemTime(Date.now() + SYNCED_READS_BUDGET_MS);
        return real(p);
      });
      const synced = new LibraryService({
        vault: () => vault,
        vaultDir: () => vaultDir,
        cache,
        account: () => account,
        fetchCatalog,
        now: () => clock,
      });

      const { items } = await synced.list();

      expect(readTextBounded).toHaveBeenCalledTimes(1);
      expect(items).toHaveLength(3);
      // The rest come back unknown, as a timeout would: available, no stamps.
      const skipped = items.filter((i) => i.editSavedAt !== 123);
      expect(skipped).toHaveLength(2);
      expect(skipped.every((i) => i.editing === "project-available")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removeLocalCopy in a synced workspace keeps the upload check: a different file is refused", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "different bytes");
    const rec = (await new LibraryVault(vaultDir).describe("a"))!;
    catalog = [cloudEntry(rec.assetId, { sizeBytes: 0 })];
    const reveal = vi.fn();
    const synced = new LibraryService({
      vault: () => new LibraryVault(vaultDir, "ws", undefined, async () => new Set()),
      vaultDir: () => vaultDir,
      cache,
      account: () => account,
      fetchCatalog,
      now: () => clock,
      reveal,
    });
    await synced.refreshCatalog();

    expect(await synced.removeLocalCopy("a")).toEqual({ ok: false, reason: "different-bytes" });
    expect(reveal).not.toHaveBeenCalled();
  });

  it("removeLocalCopy refuses an edit project or a webcam track before hashing the file", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const rec = (await new LibraryVault(vaultDir).describe("a"))!;
    catalog = [cloudEntry(rec.assetId, { sizeBytes: 0 })];
    await service.refreshCatalog();
    const vault = new LibraryVault(vaultDir);
    const ensureContentHash = vi.spyOn(vault, "ensureContentHash");
    service = new LibraryService({
      vault: () => vault,
      vaultDir: () => vaultDir,
      cache: new CatalogCache(userData),
      account: () => account,
      fetchCatalog,
      now: () => 777,
    });
    await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
    await writeFile(join(vaultDir, ".kaipu", "a.edit.json"), "{}");
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "edit-project" });
    await rm(join(vaultDir, ".kaipu", "a.edit.json"));
    await writeFile(join(vaultDir, ".kaipu", "a.webcam.mp4"), "");
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "webcam-track" });
    expect(ensureContentHash).not.toHaveBeenCalled();
  });

  it("removeLocalCopy reports hash-unknown when hashing a file still being written rejects", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const rec = (await new LibraryVault(vaultDir).describe("a"))!;
    catalog = [cloudEntry(rec.assetId, { sizeBytes: 0 })];
    await service.refreshCatalog();
    const flakyVault = Object.assign(new LibraryVault(vaultDir), {
      ensureContentHash: async () => {
        throw new Error("changed while hashing");
      },
    });
    service = new LibraryService({
      vault: () => flakyVault,
      vaultDir: () => vaultDir,
      cache: new CatalogCache(userData),
      account: () => account,
      fetchCatalog,
      now: () => 777,
    });
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "hash-unknown" });
    await expect(access(join(vaultDir, "a.mp4"))).resolves.toBeUndefined();
  });

  it("reports changed:false when the server catalog is identical, but still refreshes lastVerifiedAt", async () => {
    catalog = [cloudEntry("x")];
    await service.refreshCatalog({ force: true });
    clock += 1000;
    expect(await service.refreshCatalog({ force: true })).toEqual({
      ok: true,
      verifiedAt: 1777,
      changed: false,
    });
    const cached = await cache.read("u1");
    expect(cached![0]!.lastVerifiedAt).toBe(1777);
  });

  it("ignores lastVerifiedAt and lastSeenLocalId when comparing catalogs", async () => {
    catalog = [cloudEntry("x")];
    await service.refreshCatalog({ force: true });
    catalog = [cloudEntry("x", { lastVerifiedAt: 99, lastSeenLocalId: "elsewhere" })];
    expect(await service.refreshCatalog({ force: true })).toMatchObject({ changed: false });
  });

  it("reports changed:true when an entry changes, appears or disappears", async () => {
    catalog = [cloudEntry("x")];
    await service.refreshCatalog({ force: true });
    catalog = [cloudEntry("x", { title: "renamed" })];
    expect(await service.refreshCatalog({ force: true })).toMatchObject({ changed: true });
    catalog = [cloudEntry("x", { title: "renamed" }), cloudEntry("y")];
    expect(await service.refreshCatalog({ force: true })).toMatchObject({ changed: true });
    catalog = [];
    expect(await service.refreshCatalog({ force: true })).toMatchObject({ changed: true });
  });

  it("throttles a second refresh inside 30 s unless forced or the account changed", async () => {
    catalog = [cloudEntry("x")];
    await service.refreshCatalog();
    // A throttled call answers with the last verification and changed:false (nothing was fetched).
    expect(await service.refreshCatalog()).toEqual({ ok: true, verifiedAt: 777, changed: false });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    await service.refreshCatalog({ force: true });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    clock += 30_001;
    await service.refreshCatalog();
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
    account = { userId: "other", token: "t2" };
    await service.refreshCatalog();
    expect(fetchCatalog).toHaveBeenCalledTimes(4);
  });

  it("does not throttle after a failed refresh", async () => {
    vi.mocked(fetchCatalog).mockRejectedValueOnce(new Error("offline"));
    expect(await service.refreshCatalog()).toEqual({ ok: false, reason: "network" });
    expect(await service.refreshCatalog()).toMatchObject({ ok: true });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it("never throws out of refreshCatalog: a throwing account lookup or cache is a network failure", async () => {
    const boom = new LibraryService({
      vault: () => new LibraryVault(vaultDir),
      vaultDir: () => vaultDir,
      cache,
      account: () => {
        throw new Error("keychain unavailable");
      },
      fetchCatalog,
      now: () => clock,
    });
    expect(await boom.refreshCatalog()).toEqual({ ok: false, reason: "network" });

    vi.spyOn(cache, "write").mockRejectedValueOnce(new Error("ENOSPC"));
    catalog = [cloudEntry("x")];
    expect(await service.refreshCatalog({ force: true })).toEqual({ ok: false, reason: "network" });
  });

  it("list() skips the cache write when the catalog is unchanged", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const rec = (await new LibraryVault(vaultDir).describe("a"))!;
    catalog = [cloudEntry(rec.assetId)];
    await service.refreshCatalog();
    await service.list(); // first list() after refresh: records lastSeenLocalId, one write
    const writeSpy = vi.spyOn(cache, "write");
    await service.list();
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
