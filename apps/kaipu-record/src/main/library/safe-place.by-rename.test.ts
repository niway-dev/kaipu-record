import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A synced folder must never get a second name for a file: `link` is counted, never used.
const hooks = vi.hoisted(() => ({ links: 0, renameError: null as null | string }));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (from: string, to: string) => {
      hooks.links += 1;
      return actual.link(from, to);
    },
    rename: async (from: string, to: string) => {
      if (hooks.renameError)
        throw Object.assign(new Error(hooks.renameError), { code: hooks.renameError });
      return actual.rename(from, to);
    },
  };
});

const { placeByRename } = await import("./safe-place");

describe("placeByRename (synced folders: no hard link, ever)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-by-rename-"));
    hooks.links = 0;
    hooks.renameError = null;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("moves the file with one name only: link count 1, no link() call, source gone", async () => {
    await writeFile(join(dir, "take.part"), "bytes");
    const placed = await placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"));
    expect(placed).not.toBe("taken");
    expect(hooks.links).toBe(0);
    expect((await stat(join(dir, "Take.mp4"))).nlink).toBe(1);
    expect(await readFile(join(dir, "Take.mp4"), "utf-8")).toBe("bytes");
    await expect(stat(join(dir, "take.part"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never replaces a file already at the destination", async () => {
    await writeFile(join(dir, "take.part"), "new");
    await writeFile(join(dir, "Take.mp4"), "someone else");
    expect(await placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"))).toBe("taken");
    expect(await readFile(join(dir, "Take.mp4"), "utf-8")).toBe("someone else");
    expect(await readFile(join(dir, "take.part"), "utf-8")).toBe("new");
  });

  it("across devices, copies exclusively and removes the source, still without a link", async () => {
    hooks.renameError = "EXDEV";
    await writeFile(join(dir, "take.part"), "bytes");
    expect(await placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"))).not.toBe("taken");
    expect(hooks.links).toBe(0);
    expect(await readFile(join(dir, "Take.mp4"), "utf-8")).toBe("bytes");
    await expect(stat(join(dir, "take.part"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
