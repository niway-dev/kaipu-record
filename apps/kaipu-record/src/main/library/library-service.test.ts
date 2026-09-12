import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { CatalogCache } from "../cloud/catalog-cache";
import { LibraryService } from "./library-service";
import { LibraryVault } from "./library-vault";

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

  it("lists local items only when signed out, with catalogVerifiedAt null", async () => {
    account = null;
    await writeFile(join(vaultDir, "a.mp4"), "");
    const result = await service.list();
    expect(result.items.map((i) => i.availability)).toEqual(["local"]);
    expect(result.catalogVerifiedAt).toBeNull();
    expect(result.vaultError).toBeNull();
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
    expect(await service.removeLocalCopy("a")).toEqual({ ok: true });
    const after = await service.list();
    expect(after.items.map((i) => i.availability)).toEqual(["cloud"]);
    expect(await service.removeLocalCopy("a")).toEqual({ ok: false, reason: "not-found" });
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
