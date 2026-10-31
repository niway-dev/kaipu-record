import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GIF_MAX_BYTES, GifSaveError, saveGif, validateGifBytes } from "./gif-save";
import { LibraryVault } from "./library-vault";

const gifBytes = (extra = 16): Uint8Array =>
  new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...Array.from({ length: extra }, () => 0)]);

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
  const deps = () => ({ vaultDir: () => directory, now: () => 1234 });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-gif-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes <id>.gif, the sidecar and the thumbnail, and lists it as kind gif", async () => {
    const recording = await saveGif(deps(), gifBytes(), meta);
    expect(recording).toMatchObject({
      id: "Demo (GIF)",
      kind: "gif",
      title: "Demo (GIF)",
      durationSeconds: 4,
      createdAt: 1234,
      derivedFromAssetId: meta.derivedFromAssetId,
      gif: { width: 640, height: 360, fps: 15 },
      thumbnailUrl: "kaipu-media://thumb/Demo%20(GIF)",
    });
    expect(recording.filePath).toBe(join(directory, "Demo (GIF).gif"));
    expect(await readdir(directory)).toEqual(expect.arrayContaining(["Demo (GIF).gif"]));
    expect(await readFile(join(directory, ".kaipu", "Demo (GIF).jpg"))).toHaveLength(3);
    const listed = await new LibraryVault(directory).list();
    expect(listed.map((r) => [r.id, r.kind])).toEqual([["Demo (GIF)", "gif"]]);
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

  it("gives a second GIF with the same title ' (2)'", async () => {
    const first = await saveGif(deps(), gifBytes(), meta);
    const second = await saveGif(deps(), gifBytes(), meta);
    expect([first.id, second.id]).toEqual(["Demo (GIF)", "Demo (GIF) (2)"]);
  });

  it("releases the reserved name when the sidecar write fails", async () => {
    const spy = vi
      .spyOn(LibraryVault.prototype, "writeMeta")
      .mockRejectedValueOnce(new Error("disk full"));
    try {
      await expect(saveGif(deps(), gifBytes(), meta)).rejects.toThrow("disk full");
    } finally {
      spy.mockRestore();
    }
    expect(await readdir(directory)).toEqual([".kaipu"]);
    expect(await readdir(join(directory, ".kaipu"))).toEqual([]);
  });

  it("a failed sidecar write never removes a file that replaced the GIF meanwhile", async () => {
    const spy = vi
      .spyOn(LibraryVault.prototype, "writeMeta")
      .mockImplementationOnce(async (id: string) => {
        await writeFile(join(directory, "foreign"), "incoming");
        await rename(join(directory, "foreign"), join(directory, `${id}.gif`));
        throw new Error("disk full");
      });
    try {
      await expect(saveGif(deps(), gifBytes(), meta)).rejects.toThrow("disk full");
    } finally {
      spy.mockRestore();
    }
    expect(await readFile(join(directory, "Demo (GIF).gif"), "utf-8")).toBe("incoming");
  });

  it("delete removes the GIF, its sidecar and its thumbnail", async () => {
    await saveGif(deps(), gifBytes(), meta);
    await new LibraryVault(directory).remove("Demo (GIF)");
    expect(await readdir(directory)).toEqual([".kaipu"]);
    expect(await readdir(join(directory, ".kaipu"))).toEqual([]);
  });
});
