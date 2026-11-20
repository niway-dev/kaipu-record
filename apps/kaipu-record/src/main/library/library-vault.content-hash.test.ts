import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256FileBase64 } from "./content-hash";
import { LibraryVault } from "./library-vault";

vi.mock("./content-hash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content-hash")>();
  return { sha256FileBase64: vi.fn(actual.sha256FileBase64) };
});

/**
 * The cached content hash against the full-hash truth, on real files (NIW2-891). For every way a
 * file can change, the cache must give the same hash as hashing the bytes now, and must only
 * skip the read when nothing changed.
 */
describe("LibraryVault content-hash cache", () => {
  let directory: string;
  let vault: LibraryVault;
  const hashSpy = vi.mocked(sha256FileBase64);
  const media = (id: string) => join(directory, `${id}.mp4`);

  const truth = async (id: string): Promise<string> => {
    const real = await vi.importActual<typeof import("./content-hash")>("./content-hash");
    return real.sha256FileBase64(media(id));
  };
  const sidecar = async (id: string) =>
    JSON.parse(await readFile(join(directory, ".kaipu", `${id}.json`), "utf-8"));

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-vault-hash-"));
    vault = new LibraryVault(directory);
    hashSpy.mockClear();
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("records size, mtime, ctime and inode, and reads nothing on the second ask", async () => {
    await writeFile(media("a"), "0123456789");
    const first = await vault.ensureContentHash("a");
    const info = await stat(media("a"));
    expect(await sidecar("a")).toMatchObject({
      contentSha256: first?.contentSha256,
      hashedSizeBytes: 10,
      hashedMtimeMs: info.mtimeMs,
      hashedCtimeMs: info.ctimeMs,
      hashedIno: info.ino,
    });
    expect(hashSpy).toHaveBeenCalledTimes(1);

    const second = await vault.ensureContentHash("a");
    expect(second?.contentSha256).toBe(first?.contentSha256);
    expect(hashSpy).toHaveBeenCalledTimes(1);
  });

  it("detects a same-size rewrite whose mtime was restored, through ctime", async () => {
    await writeFile(media("a"), "aaaaaaaaaa");
    const before = await vault.ensureContentHash("a");
    const info = await stat(media("a"));
    await writeFile(media("a"), "bbbbbbbbbb");
    await utimes(media("a"), info.atimeMs / 1000, info.mtimeMs / 1000);
    expect((await stat(media("a"))).mtimeMs).toBe(info.mtimeMs);

    const after = await vault.ensureContentHash("a");
    expect(after?.contentSha256).not.toBe(before?.contentSha256);
    expect(after?.contentSha256).toBe(await truth("a"));
    expect(hashSpy).toHaveBeenCalledTimes(2);
  });

  it("detects a replaced file, which has a new inode", async () => {
    await writeFile(media("a"), "aaaaaaaaaa");
    const before = await vault.ensureContentHash("a");
    const info = await stat(media("a"));
    await writeFile(join(directory, "swap.tmp"), "cccccccccc");
    await utimes(join(directory, "swap.tmp"), info.atimeMs / 1000, info.mtimeMs / 1000);
    await rename(join(directory, "swap.tmp"), media("a"));

    const after = await vault.ensureContentHash("a");
    expect(after?.contentSha256).not.toBe(before?.contentSha256);
    expect(after?.contentSha256).toBe(await truth("a"));
    expect(hashSpy).toHaveBeenCalledTimes(2);
  });

  it("re-hashes after an mtime-only touch and still gets the same hash", async () => {
    await writeFile(media("a"), "aaaaaaaaaa");
    const before = await vault.ensureContentHash("a");
    const later = new Date(Date.now() + 60_000);
    await utimes(media("a"), later, later);

    const after = await vault.ensureContentHash("a");
    expect(after?.contentSha256).toBe(before?.contentSha256);
    expect(hashSpy).toHaveBeenCalledTimes(2);
    await vault.ensureContentHash("a");
    expect(hashSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps the cache across a rename of the item", async () => {
    await writeFile(media("a"), "aaaaaaaaaa");
    const before = await vault.ensureContentHash("a");
    const item = await vault.describe("a");
    const result = await vault.renameItem({ id: "a", assetId: item!.assetId }, "Renamed title");
    expect(result.file).toBe("renamed");
    const newId = result.recording.id;
    expect(newId).not.toBe("a");
    hashSpy.mockClear();

    expect(await vault.cachedContentHash(newId)).toEqual({
      status: "hit",
      contentSha256: before?.contentSha256,
    });
    expect((await vault.ensureContentHash(newId))?.contentSha256).toBe(before?.contentSha256);
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it("re-hashes once for a sidecar stamped before ctime and inode were recorded", async () => {
    await writeFile(media("a"), "aaaaaaaaaa");
    await vault.ensureContentHash("a");
    const info = await stat(media("a"));
    const old = await sidecar("a");
    delete old.hashedCtimeMs;
    delete old.hashedIno;
    await writeFile(join(directory, ".kaipu", "a.json"), JSON.stringify(old));
    hashSpy.mockClear();

    expect(await vault.cachedContentHash("a")).toEqual({ status: "miss" });
    expect((await vault.describe("a"))?.contentSha256).toBeNull();
    await vault.ensureContentHash("a");
    expect(hashSpy).toHaveBeenCalledTimes(1);
    expect(await sidecar("a")).toMatchObject({ hashedCtimeMs: info.ctimeMs, hashedIno: info.ino });
    await vault.ensureContentHash("a");
    expect(hashSpy).toHaveBeenCalledTimes(1);
  });

  it("answers a cache lookup without reading the file", async () => {
    expect(await vault.cachedContentHash("nothing")).toEqual({ status: "missing" });
    await writeFile(media("a"), "aaaaaaaaaa");
    expect(await vault.cachedContentHash("a")).toEqual({ status: "miss" });
    await vault.ensureContentHash("a");
    hashSpy.mockClear();
    expect((await vault.cachedContentHash("a")).status).toBe("hit");
    expect(hashSpy).not.toHaveBeenCalled();
  });
});
