import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { CatalogCache } from "../cloud/catalog-cache";
import type { CloudScope } from "../cloud/workspace-filter";
import { LibraryService } from "./library-service";
import { LibraryVault } from "./library-vault";

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
    fetchCatalog = vi.fn(async () => catalog);
    cache = new CatalogCache(userData);
    service = new LibraryService({
      vault: () => new LibraryVault(vaultDir),
      vaultDir: () => vaultDir,
      cache,
      account: () => account,
      fetchCatalog,
      now: () => 777,
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

  describe("cloud entries per workspace (decision 4, the rule in the spec)", () => {
    const scoped = (scope: CloudScope) =>
      new LibraryService({
        vault: () => new LibraryVault(vaultDir),
        vaultDir: () => vaultDir,
        cache,
        account: () => account,
        fetchCatalog,
        cloudScope: () => scope,
        now: () => 777,
      });
    const scopeOf = (activeId: string, overrides: Partial<CloudScope> = {}): CloudScope => ({
      activeId,
      legacyOwnerId: "ws-a",
      registered: new Set(["ws-a", "ws-b"]),
      unassignedHidden: false,
      pending: new Map(),
      ...overrides,
    });

    it("B lists its own cloud-only entries and its local items' copies, never A's or the unassigned", async () => {
      await writeFile(join(vaultDir, "a.mp4"), "");
      const rec = (await new LibraryVault(vaultDir).describe("a"))!;
      catalog = [
        cloudEntry(rec.assetId, { workspaceId: null }),
        cloudEntry("of-a", { workspaceId: "ws-a" }),
        cloudEntry("of-b", { workspaceId: "ws-b" }),
        cloudEntry("unassigned", { workspaceId: null }),
      ];
      await service.refreshCatalog();

      const result = await scoped(scopeOf("ws-b")).list();

      expect(result.items.map((i) => [i.assetId, i.availability]).sort()).toEqual(
        [
          [rec.assetId, "local-and-cloud"],
          ["of-b", "cloud"],
        ].sort(),
      );
      expect(result.catalogVerifiedAt).toBe(777);
    });

    it("listing a workspace keeps every other workspace's entry in the cache file", async () => {
      await writeFile(join(vaultDir, "a.mp4"), "");
      const rec = (await new LibraryVault(vaultDir).describe("a"))!;
      await cache.write("u1", [
        cloudEntry(rec.assetId, { workspaceId: "ws-a" }),
        cloudEntry("of-b", { workspaceId: "ws-b", lastSeenLocalId: "kept-in-b" }),
      ]);

      await scoped(scopeOf("ws-a")).list();

      const stored = await cache.read("u1");
      expect(stored?.map((e) => [e.assetId, e.lastSeenLocalId]).sort()).toEqual(
        [
          [rec.assetId, "a"],
          ["of-b", "kept-in-b"],
        ].sort(),
      );
    });

    it("offline, switching to B without a refresh still shows B's cloud-only items", async () => {
      catalog = [
        cloudEntry("of-a", { workspaceId: "ws-a" }),
        cloudEntry("of-b", { workspaceId: "ws-b" }),
      ];
      await service.refreshCatalog();
      await scoped(scopeOf("ws-a")).list();
      fetchCatalog = vi.fn(async () => {
        throw new Error("offline");
      });

      const result = await scoped(scopeOf("ws-b")).list();

      expect(result.items.map((i) => i.assetId)).toEqual(["of-b"]);
    });

    it("the legacy owner lists the unassigned only until the first assignment", async () => {
      catalog = [cloudEntry("unassigned", { workspaceId: null })];
      await service.refreshCatalog();
      expect((await scoped(scopeOf("ws-a")).list()).items.map((i) => i.assetId)).toEqual([
        "unassigned",
      ]);
      expect((await scoped(scopeOf("ws-a", { unassignedHidden: true })).list()).items).toHaveLength(
        0,
      );
    });

    it("unassigned() reads the full catalog, and listing does not change it", async () => {
      catalog = [
        cloudEntry("of-a", { workspaceId: "ws-a" }),
        cloudEntry("unassigned", { workspaceId: null }),
        cloudEntry("of-deleted", { workspaceId: "ws-gone" }),
      ];
      await service.refreshCatalog();
      const svc = scoped(scopeOf("ws-b"));
      const before = (await svc.unassigned()).map((e) => e.assetId).sort();
      await svc.list();
      expect((await svc.unassigned()).map((e) => e.assetId).sort()).toEqual(before);
      expect(before).toEqual(["of-deleted", "unassigned"]);
    });

    it("unassigned() is empty when signed out or never fetched", async () => {
      expect(await scoped(scopeOf("ws-a")).unassigned()).toEqual([]);
    });
  });

  it("refreshCatalog caches per account and list merges by assetId", async () => {
    await writeFile(join(vaultDir, "a.mp4"), "");
    const vault = new LibraryVault(vaultDir);
    const rec = (await vault.describe("a"))!;
    catalog = [cloudEntry(rec.assetId), cloudEntry("cloud-only")];
    expect(await service.refreshCatalog()).toEqual({ ok: true, verifiedAt: 777 });
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
    expect(await service.refreshCatalog()).toEqual({ ok: false, reason: "unauthorized" });
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
