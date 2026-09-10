import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryVault } from "./library-vault";

describe("LibraryVault", () => {
  let directory: string;
  let vault: LibraryVault;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-vault-"));
    vault = new LibraryVault(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const writeRecording = (id: string, bytes = 2048): Promise<void> =>
    writeFile(join(directory, `${id}.webm`), Buffer.alloc(bytes));

  const writeSidecar = async (id: string, data: object): Promise<void> => {
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(join(directory, ".kaipu", `${id}.json`), JSON.stringify(data));
  };

  it("returns an empty list when the vault has no recordings", async () => {
    expect(await vault.list()).toEqual([]);
  });

  it("derives a title and reads the real size from disk", async () => {
    await writeRecording("alpha-clip", 4096);
    const [recording] = await vault.list();
    expect(recording.id).toBe("alpha-clip");
    expect(recording.title).toBe("Alpha Clip");
    expect(recording.sizeBytes).toBe(4096);
    expect(recording.durationSeconds).toBe(0);
  });

  it("ignores non-webm files", async () => {
    await writeRecording("clip");
    await writeFile(join(directory, "notes.txt"), "hello");
    expect((await vault.list()).map((r) => r.id)).toEqual(["clip"]);
  });

  it("sorts recordings newest-first by sidecar createdAt", async () => {
    await writeRecording("older");
    await writeRecording("newer");
    await writeSidecar("older", { createdAt: 1000 });
    await writeSidecar("newer", { createdAt: 5000 });
    expect((await vault.list()).map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("prefers sidecar title and duration over derived values", async () => {
    await writeRecording("clip");
    await writeSidecar("clip", { title: "My Demo", durationSeconds: 42 });
    const [recording] = await vault.list();
    expect(recording.title).toBe("My Demo");
    expect(recording.durationSeconds).toBe(42);
  });

  it("renames via the sidecar without touching the video file", async () => {
    await writeRecording("clip");
    await vault.rename("clip", "Renamed");

    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "clip.json"), "utf-8"));
    expect(sidecar.title).toBe("Renamed");
    expect((await vault.list())[0].title).toBe("Renamed");
    expect(await readdir(directory)).toContain("clip.webm");
  });

  it("removes the video and its sidecar", async () => {
    await writeRecording("clip");
    await vault.rename("clip", "X");
    await vault.remove("clip");

    expect(await vault.list()).toHaveLength(0);
    expect(await readdir(directory)).not.toContain("clip.webm");
  });

  it("mints a stable assetId for a legacy item and persists it without touching other fields", async () => {
    await writeRecording("legacy");
    await writeSidecar("legacy", { title: "Old", durationSeconds: 7, createdAt: 123 });

    const first = await vault.describe("legacy");
    expect(first?.assetId).toMatch(/^[0-9a-f-]{36}$/);
    const second = await vault.describe("legacy");
    expect(second?.assetId).toBe(first?.assetId);

    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "legacy.json"), "utf-8"));
    expect(sidecar).toMatchObject({
      title: "Old",
      durationSeconds: 7,
      createdAt: 123,
      sidecarVersion: 2,
    });
    expect(sidecar.assetId).toBe(first?.assetId);
  });

  it("gives two files different assetIds and never derives the id from the filename", async () => {
    await writeRecording("one");
    await writeRecording("two");
    const [a, b] = await Promise.all([vault.describe("one"), vault.describe("two")]);
    expect(a?.assetId).not.toBe(b?.assetId);
    expect(a?.assetId).not.toBe("one");
  });

  it.skipIf(process.platform === "win32")(
    "still lists when the sidecar directory is read-only (identity is in memory only)",
    async () => {
      await writeRecording("ro");
      await mkdir(join(directory, ".kaipu"), { recursive: true });
      await chmod(join(directory, ".kaipu"), 0o500);
      try {
        const [rec] = await vault.list();
        expect(rec.id).toBe("ro");
        expect(rec.assetId).toMatch(/^[0-9a-f-]{36}$/);
      } finally {
        await chmod(join(directory, ".kaipu"), 0o700);
      }
    },
  );

  it("exposes provenance and the cached hash only while it matches the file", async () => {
    await writeRecording("exp", 10);
    const info = await stat(join(directory, "exp.webm"));
    await writeSidecar("exp", {
      assetId: "11111111-1111-4111-8111-111111111111",
      derivedFromAssetId: "22222222-2222-4222-8222-222222222222",
      contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      hashedSizeBytes: 10,
      hashedMtimeMs: info.mtimeMs,
    });
    expect(await vault.describe("exp")).toMatchObject({
      assetId: "11111111-1111-4111-8111-111111111111",
      derivedFromAssetId: "22222222-2222-4222-8222-222222222222",
      contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    });
    await writeRecording("exp", 11); // bytes changed → cached hash is stale
    expect((await vault.describe("exp"))?.contentSha256).toBeNull();
  });

  it("ensureContentHash computes once, caches by size+mtime, and recomputes after a change", async () => {
    await writeRecording("h", 100);
    const first = await vault.ensureContentHash("h");
    expect(first?.contentSha256).toHaveLength(44);
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "h.json"), "utf-8"));
    expect(sidecar).toMatchObject({ contentSha256: first?.contentSha256, hashedSizeBytes: 100 });
    expect((await vault.describe("h"))?.contentSha256).toBe(first?.contentSha256);

    await writeFile(join(directory, "h.webm"), Buffer.alloc(100, 9));
    const second = await vault.ensureContentHash("h");
    expect(second?.contentSha256).not.toBe(first?.contentSha256);
    expect(await vault.ensureContentHash("missing")).toBeNull();
  });

  it("removeLocalCopy deletes only the media file and keeps identity, thumbnail, session and assets", async () => {
    await writeRecording("keep");
    await vault.writeMeta("keep", {
      title: "Keep",
      assetId: "33333333-3333-4333-8333-333333333333",
    });
    await vault.writeThumbnail("keep", Buffer.from([1]));
    await mkdir(join(directory, ".kaipu", "keep.assets"), { recursive: true });
    await writeFile(join(directory, ".kaipu", "keep.edit.json"), "{}");
    await writeFile(join(directory, ".kaipu", "keep.assets", "a.png"), "png");

    await vault.removeLocalCopy("keep");

    expect(await readdir(directory)).not.toContain("keep.webm");
    const files = await readdir(join(directory, ".kaipu"));
    expect(files).toEqual(
      expect.arrayContaining(["keep.json", "keep.jpg", "keep.edit.json", "keep.assets"]),
    );
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "keep.json"), "utf-8"));
    expect(sidecar.assetId).toBe("33333333-3333-4333-8333-333333333333");
    expect(typeof sidecar.localRemovedAt).toBe("number");
    expect(await vault.describe("keep")).toBeNull();
    expect(await vault.list()).toHaveLength(0);
  });

  it("removeLocalCopy propagates a failure to delete the media file", async () => {
    await expect(vault.removeLocalCopy("nope")).rejects.toThrow();
  });
});

describe("LibraryVault — screenshots", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("lists a saved screenshot as kind=screenshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-")); // reuse existing helpers/imports
    dirs.push(dir);
    const vault = new LibraryVault(dir);
    await vault.writeImage("shot-1", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const items = await vault.list();
    const shot = items.find((i) => i.id === "shot-1");
    expect(shot?.kind).toBe("screenshot");
    expect(shot?.filePath.endsWith("shot-1.png")).toBe(true);
    // URL carries a `?v=<mtime>` cache-bust token so an in-place overwrite refreshes.
    expect(shot?.thumbnailUrl).toMatch(/^kaipu-media:\/\/screenshot\/shot-1\?v=\d+$/);
  });
});

describe("LibraryVault — mp4 + thumbnails", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempVault(): Promise<LibraryVault> {
    const dir = await mkdtemp(join(tmpdir(), "vault-mp4-"));
    dirs.push(dir);
    return new LibraryVault(dir);
  }

  it("discovers .mp4 recordings", async () => {
    const vault = await tempVault();
    const file = await vault.filePath("rec-1");
    expect(file.endsWith("rec-1.mp4")).toBe(true);
    await writeFile(file, "data");
    const list = await vault.list();
    expect(list.map((r) => r.id)).toContain("rec-1");
  });

  it("writeMeta + describe surface title, duration and thumbnail url", async () => {
    const vault = await tempVault();
    await writeFile(await vault.filePath("rec-2"), "data");
    await vault.writeMeta("rec-2", { title: "Demo", durationSeconds: 12, createdAt: 111 });
    await vault.writeThumbnail("rec-2", Buffer.from([0xff, 0xd8, 0xff]));
    const rec = await vault.describe("rec-2");
    expect(rec).toMatchObject({
      id: "rec-2",
      title: "Demo",
      durationSeconds: 12,
      createdAt: 111,
      thumbnailUrl: "kaipu-media://thumb/rec-2",
    });
  });

  it("backfill persists duration + thumbnail for an orphan and returns the updated recording", async () => {
    const vault = await tempVault();
    await writeFile(await vault.filePath("orphan-1"), "data"); // orphan mp4, no sidecar
    expect(await vault.describe("orphan-1")).toMatchObject({
      durationSeconds: 0,
      thumbnailUrl: null,
    });

    const updated = await vault.backfill("orphan-1", {
      durationSeconds: 54,
      thumbnail: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    });

    expect(updated).toMatchObject({
      durationSeconds: 54,
      thumbnailUrl: "kaipu-media://thumb/orphan-1",
    });
    // A fresh describe re-reads the sidecar + thumbnail file, proving persistence.
    expect(await vault.describe("orphan-1")).toMatchObject({
      durationSeconds: 54,
      thumbnailUrl: "kaipu-media://thumb/orphan-1",
    });
  });

  it("backfill without a thumbnail writes duration only", async () => {
    const vault = await tempVault();
    await writeFile(await vault.filePath("orphan-2"), "data");

    const updated = await vault.backfill("orphan-2", { durationSeconds: 10, thumbnail: null });

    expect(updated).toMatchObject({ durationSeconds: 10, thumbnailUrl: null });
  });
});
