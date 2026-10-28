import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  cleanupDragCopies,
  cleanupLegacyDragCopies,
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
});
