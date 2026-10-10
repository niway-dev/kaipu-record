import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIF_MAX_BYTES, GifSaveError, saveGif, validateGifBytes } from "./gif-save";
import { LibraryVault } from "./library-vault";

const gifBytes = (extra = 16): Uint8Array =>
  new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array(extra).fill(0)]);

const meta = {
  title: "Demo (GIF)",
  durationSeconds: 4,
  width: 640,
  height: 360,
  fps: 15,
  thumbnail: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
  derivedFromAssetId: "11111111-1111-4111-8111-111111111111",
};

describe("saveGif", () => {
  let directory: string;
  const deps = () => ({ vaultDir: () => directory, newId: () => "gif-1", now: () => 1234 });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-gif-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes <id>.gif, the sidecar and the thumbnail, and lists it as kind gif", async () => {
    const recording = await saveGif(deps(), gifBytes(), meta);
    expect(recording).toMatchObject({
      id: "gif-1",
      kind: "gif",
      title: "Demo (GIF)",
      durationSeconds: 4,
      createdAt: 1234,
      derivedFromAssetId: meta.derivedFromAssetId,
      gif: { width: 640, height: 360, fps: 15 },
      thumbnailUrl: "kaipu-media://thumb/gif-1",
    });
    expect(recording.filePath).toBe(join(directory, "gif-1.gif"));
    expect(await readdir(directory)).toEqual(expect.arrayContaining(["gif-1.gif"]));
    expect(await readFile(join(directory, ".kaipu", "gif-1.jpg"))).toHaveLength(3);
    const listed = await new LibraryVault(directory).list();
    expect(listed.map((r) => [r.id, r.kind])).toEqual([["gif-1", "gif"]]);
  });

  it.each([
    ["not a GIF", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), "not-gif"],
    ["GIF87a", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0]), "not-gif"],
    ["empty", new Uint8Array(0), "empty"],
  ])("rejects %s and leaves nothing behind", async (_label, bytes, code) => {
    await expect(saveGif(deps(), bytes, meta)).rejects.toMatchObject({ code });
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects an oversize payload", () => {
    const big = new Uint8Array(GIF_MAX_BYTES + 1);
    big.set(gifBytes(0));
    expect(() => validateGifBytes(big)).toThrow(GifSaveError);
  });

  it("leaves no .part file when the write fails", async () => {
    // A vault "directory" that is a file → mkdir/open fails.
    const bogus = join(directory, "not-a-dir");
    await import("node:fs/promises").then((fs) => fs.writeFile(bogus, ""));
    await expect(
      saveGif({ ...deps(), vaultDir: () => join(bogus, "vault") }, gifBytes(), meta),
    ).rejects.toThrow();
    expect((await readdir(directory)).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("delete removes the GIF, its sidecar and its thumbnail", async () => {
    await saveGif(deps(), gifBytes(), meta);
    await new LibraryVault(directory).remove("gif-1");
    expect(await readdir(directory)).toEqual([".kaipu"]);
    expect(await readdir(join(directory, ".kaipu"))).toEqual([]);
  });
});
