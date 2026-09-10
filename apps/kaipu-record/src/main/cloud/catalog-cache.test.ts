import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { CatalogCache } from "./catalog-cache";

const entry = (assetId: string): CloudCatalogEntry => ({
  assetId,
  kind: "recording",
  title: "T",
  revisionId: "r1",
  contentType: "video/mp4",
  sizeBytes: 1,
  contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
  durationSeconds: 1,
  hasThumbnail: false,
  derivedFromAssetId: null,
  autoUploadExcluded: false,
  createdAt: 1,
  lastVerifiedAt: 1,
  lastSeenLocalId: null,
});

describe("CatalogCache", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-catalog-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is null before the first write and round-trips per account", async () => {
    const cache = new CatalogCache(dir);
    expect(await cache.read("u1")).toBeNull();
    await cache.write("u1", [entry("a")]);
    await cache.write("u2", [entry("b")]);
    expect((await cache.read("u1"))?.map((e) => e.assetId)).toEqual(["a"]);
    expect((await cache.read("u2"))?.map((e) => e.assetId)).toEqual(["b"]);
  });

  it("writes atomically (no .tmp left) and tolerates a corrupt file as null", async () => {
    const cache = new CatalogCache(dir);
    await cache.write("u1", [entry("a")]);
    expect((await readdir(join(dir, "cloud", "u1"))).some((f) => f.endsWith(".tmp"))).toBe(false);
    await writeFile(cache.path("u1"), "{not json");
    expect(await cache.read("u1")).toBeNull();
  });

  it("clear removes only that account's cache", async () => {
    const cache = new CatalogCache(dir);
    await cache.write("u1", [entry("a")]);
    await cache.write("u2", [entry("b")]);
    await cache.clear("u1");
    expect(await cache.read("u1")).toBeNull();
    expect(await cache.read("u2")).not.toBeNull();
  });

  it("refuses a userId that is not a safe path segment", async () => {
    const cache = new CatalogCache(dir);
    await expect(cache.write("../x", [])).rejects.toThrow(/unsafe/);
  });

  it("refuses to clear an unsafe userId and does not delete anything", async () => {
    const cache = new CatalogCache(dir);
    await cache.write("u1", [entry("a")]);
    await expect(cache.clear("../x")).rejects.toThrow(/unsafe/);
    expect(await cache.read("u1")).not.toBeNull();
  });
});
