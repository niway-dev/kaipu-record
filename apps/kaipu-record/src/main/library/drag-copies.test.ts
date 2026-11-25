import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { constants } from "node:fs";
import { crc32, inflateSync } from "node:zlib";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DRAG_COPY_MAX_AGE_MS,
  DRAG_PLACEHOLDER_ICON_PNG,
  SyncedDragCopyError,
  cleanupDragCopies,
  cleanupLegacyDragCopies,
  cleanupScratchDragCopies,
  createDragCopy,
  dragRoot,
  pruneDragCopies,
} from "./drag-copies";

describe("drag copies", () => {
  let vault: string;
  let file: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "kaipu-drag-vault-"));
    file = join(vault, "rec.mp4");
    await writeFile(file, "video");
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });
  const errno = (code: string) => Object.assign(new Error(code), { code });

  it("hard-links the vault file under the friendly name inside the vault's drag folder", async () => {
    const result = await createDragCopy(vault, file, "My demo.mp4");
    expect(result.startsWith(dragRoot(vault))).toBe(true);
    expect(result.endsWith("My demo.mp4")).toBe(true);
    expect(await readFile(result, "utf-8")).toBe("video");
    expect((await stat(result)).ino).toBe((await stat(file)).ino);
    expect((await stat(file)).nlink).toBe(2);
  });

  it("falls back to copying when the link fails for a reason other than EXDEV", async () => {
    const result = await createDragCopy(vault, file, "x.mp4", {
      link: async () => {
        throw errno("EPERM");
      },
      copyFile,
    });
    expect(await readFile(result, "utf-8")).toBe("video");
    expect((await stat(result)).ino).not.toBe((await stat(file)).ino);
  });

  it("returns the vault file itself and copies nothing on EXDEV", async () => {
    const copy = vi.fn();
    const result = await createDragCopy(vault, file, "x.mp4", {
      link: async () => {
        throw errno("EXDEV");
      },
      copyFile: copy,
    });
    expect(result).toBe(file);
    expect(copy).not.toHaveBeenCalled();
    expect(await readdir(dragRoot(vault)).catch(() => [])).toEqual([]);
  });

  it("returns the vault file when the drag folder cannot be created", async () => {
    await writeFile(join(vault, ".kaipu"), "not a dir");
    expect(await createDragCopy(vault, file, "x.mp4")).toBe(file);
  });

  it("a second drag keeps the first drag's file", async () => {
    const first = await createDragCopy(vault, file, "One.mp4");
    const second = await createDragCopy(vault, file, "Two.mp4");
    expect(await readFile(first, "utf-8")).toBe("video");
    expect(await readFile(second, "utf-8")).toBe("video");
  });

  it("pruneDragCopies removes only folders older than the max age", async () => {
    await mkdir(join(dragRoot(vault), "old"), { recursive: true });
    await mkdir(join(dragRoot(vault), "fresh"), { recursive: true });
    const t = (Date.now() - DRAG_COPY_MAX_AGE_MS - 60_000) / 1000;
    await utimes(join(dragRoot(vault), "old"), t, t);
    await pruneDragCopies(vault);
    expect(await readdir(dragRoot(vault))).toEqual(["fresh"]);
  });

  it("pruneDragCopies does nothing when there is no drag folder", async () => {
    await expect(pruneDragCopies(vault)).resolves.toBeUndefined();
  });

  it("cleanupDragCopies removes every drag folder and leaves sidecars", async () => {
    await mkdir(join(vault, ".kaipu"), { recursive: true });
    await writeFile(join(vault, ".kaipu", "rec.json"), "{}");
    await createDragCopy(vault, file, "a.mp4");
    await createDragCopy(vault, file, "b.mp4");
    await cleanupDragCopies(vault);
    expect(await readFile(join(vault, ".kaipu", "rec.json"), "utf-8")).toBe("{}");
    await expect(stat(dragRoot(vault))).rejects.toThrow();
  });

  it("cleanupLegacyDragCopies removes <temp>/kaipu-drag", async () => {
    const temp = await mkdtemp(join(tmpdir(), "kaipu-legacy-"));
    await mkdir(join(temp, "kaipu-drag", "x"), { recursive: true });
    await cleanupLegacyDragCopies(temp);
    await expect(stat(join(temp, "kaipu-drag"))).rejects.toThrow();
    await rm(temp, { recursive: true, force: true });
  });

  describe("a synced workspace (decision 15; NIW2-577)", () => {
    let scratch: string;
    beforeEach(async () => {
      scratch = await mkdtemp(join(tmpdir(), "kaipu-drag-scratch-"));
    });
    afterEach(async () => {
      await rm(scratch, { recursive: true, force: true });
    });

    it("copies into the scratch folder, never links, and writes nothing inside the workspace", async () => {
      const link = vi.fn(async () => {});
      const result = await createDragCopy(
        vault,
        file,
        "My demo.mp4",
        { link, copyFile },
        { root: scratch, synced: true },
      );
      expect(link).not.toHaveBeenCalled();
      expect(result.startsWith(scratch)).toBe(true);
      expect(await readFile(result, "utf-8")).toBe("video");
      // The item keeps one name: the provider never sees a second one.
      expect((await stat(file)).nlink).toBe(1);
      expect(await readdir(join(vault, ".kaipu")).catch(() => [])).toEqual([]);
    });

    it("asks for a clone, so a large take does not delay the drag where the volume can", async () => {
      const copy = vi.fn(copyFile);
      await createDragCopy(
        vault,
        file,
        "c.mp4",
        { link: vi.fn(async () => {}), copyFile: copy },
        {
          root: scratch,
          synced: true,
        },
      );
      expect(copy).toHaveBeenCalledWith(file, expect.any(String), constants.COPYFILE_FICLONE);
    });

    it("refuses instead of handing out the original when the drag folder cannot be made", async () => {
      const blocked = join(scratch, "blocked");
      await writeFile(blocked, "a file where the folder must go");
      await expect(
        createDragCopy(vault, file, "x.mp4", undefined, {
          root: join(blocked, "drag"),
          synced: true,
        }),
      ).rejects.toBeInstanceOf(SyncedDragCopyError);
    });

    it("a workspace that is not synced still drags the original when its folder cannot be made", async () => {
      const blocked = join(scratch, "blocked");
      await writeFile(blocked, "a file where the folder must go");
      expect(
        await createDragCopy(vault, file, "x.mp4", undefined, { root: join(blocked, "drag") }),
      ).toBe(file);
    });

    it("prunes old drag folders in the scratch root, not in the workspace", async () => {
      await mkdir(join(scratch, "old"), { recursive: true });
      const past = new Date(Date.now() - DRAG_COPY_MAX_AGE_MS - 60_000);
      await utimes(join(scratch, "old"), past, past);
      await createDragCopy(vault, file, "x.mp4", undefined, { root: scratch, synced: true });
      expect(await readdir(scratch)).not.toContain("old");
    });
  });

  it("cleanupScratchDragCopies removes every synced workspace's drag folder, and only that", async () => {
    const userData = await mkdtemp(join(tmpdir(), "kaipu-drag-ud-"));
    await mkdir(join(userData, "workspace-scratch", "ws-1", "drag", "x"), { recursive: true });
    await mkdir(join(userData, "workspace-scratch", "ws-1", "tmp"), { recursive: true });
    await cleanupScratchDragCopies(userData);
    expect(await readdir(join(userData, "workspace-scratch", "ws-1"))).toEqual(["tmp"]);
    await rm(userData, { recursive: true, force: true });
  });
});

describe("DRAG_PLACEHOLDER_ICON_PNG", () => {
  /** The chunks of a PNG, each with its CRC checked: a truncated or hand-edited one throws. */
  function chunksOf(png: Buffer): Array<{ type: string; data: Buffer }> {
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const chunks: Array<{ type: string; data: Buffer }> = [];
    let at = 8;
    while (at < png.length) {
      const length = png.readUInt32BE(at);
      const type = png.subarray(at + 4, at + 8).toString("latin1");
      const data = png.subarray(at + 8, at + 8 + length);
      const stored = png.readUInt32BE(at + 8 + length);
      expect(crc32(png.subarray(at + 4, at + 8 + length)), `${type} CRC`).toBe(stored);
      chunks.push({ type, data });
      at += 12 + length;
    }
    expect(at).toBe(png.length);
    return chunks;
  }

  it("is a whole PNG: signature, checksummed chunks, and pixels that inflate to 64 x 64 RGBA", () => {
    const chunks = chunksOf(DRAG_PLACEHOLDER_ICON_PNG);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const header = chunks[0]!.data;
    expect([header.readUInt32BE(0), header.readUInt32BE(4)]).toEqual([64, 64]);
    expect([header[8], header[9]]).toEqual([8, 6]); // 8-bit RGBA
    const pixels = inflateSync(chunks[1]!.data);
    expect(pixels.length).toBe(64 * (1 + 64 * 4)); // one filter byte per row, then the pixels
    // Translucent, never opaque and never invisible: macOS would draw nothing for a clear one.
    const alpha = pixels[1 + 3]!;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
  });
});
