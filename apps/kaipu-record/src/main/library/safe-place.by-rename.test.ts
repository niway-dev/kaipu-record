import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A synced folder must never get a second name for a file: `link` is counted, never used.
const hooks = vi.hoisted(() => ({
  links: 0,
  renameError: null as null | string,
  unlinkFails: false,
  /** When set, only this path's unlink fails (the source, while its copy must still be removable). */
  unlinkOnly: null as null | string,
  /** Runs where a rename is refused: a file that arrives between the check and the move. */
  atRename: null as null | ((to: string) => Promise<void>),
}));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (from: string, to: string) => {
      hooks.links += 1;
      return actual.link(from, to);
    },
    unlink: async (path: string) => {
      if (hooks.unlinkFails && (hooks.unlinkOnly === null || path === hooks.unlinkOnly))
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      return actual.unlink(path);
    },
    rename: async (from: string, to: string) => {
      // Only the move into the destination is refused: setting a source aside must still work.
      if (hooks.renameError && !to.endsWith(".placed")) {
        await hooks.atRename?.(to);
        throw Object.assign(new Error(hooks.renameError), { code: hooks.renameError });
      }
      return actual.rename(from, to);
    },
  };
});

const { identityAt, placeByRename } = await import("./safe-place");

describe("placeByRename (synced folders: no hard link, ever)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-by-rename-"));
    hooks.links = 0;
    hooks.renameError = null;
    hooks.unlinkFails = false;
    hooks.unlinkOnly = null;
    hooks.atRename = null;
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

  it("across devices, a source that cannot be removed is set aside so a sweep cannot recover it again", async () => {
    hooks.renameError = "EXDEV";
    hooks.unlinkFails = true;
    await writeFile(join(dir, "kaipu-rec-1.mp4.part"), "bytes");
    expect(await placeByRename(join(dir, "kaipu-rec-1.mp4.part"), join(dir, "Take.mp4"))).not.toBe(
      "taken",
    );
    expect(await readFile(join(dir, "Take.mp4"), "utf-8")).toBe("bytes");
    const names = await readdir(dir);
    // The part keeps no name the stranded sweep matches: it was renamed aside (or marked).
    expect(names).not.toContain("kaipu-rec-1.mp4.part");
    expect(names.some((name) => name.endsWith(".placed"))).toBe(true);
  });

  it("across devices, a file that arrives after the check is never replaced and the source stays", async () => {
    hooks.renameError = "EXDEV";
    hooks.atRename = (to) => writeFile(to, "someone else");
    await writeFile(join(dir, "take.part"), "new");
    expect(await placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"))).toBe("taken");
    expect(await readFile(join(dir, "Take.mp4"), "utf-8")).toBe("someone else");
    expect(await readFile(join(dir, "take.part"), "utf-8")).toBe("new");
  });

  it("refuses a source that is no longer the file the caller meant (expect), and moves nothing", async () => {
    await writeFile(join(dir, "take.part"), "the take");
    const expected = (await identityAt(join(dir, "take.part")))!;
    // The name is taken over by another file (a new inode) before the placement.
    await rm(join(dir, "take.part"));
    await writeFile(join(dir, "take.part"), "someone else's file");

    await expect(
      placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"), { expect: expected }),
    ).rejects.toMatchObject({ code: "ESTALE" });
    await expect(stat(join(dir, "Take.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(dir, "take.part"), "utf-8")).toBe("someone else's file");
  });

  it("across devices with stuck: rollback, a source that cannot be removed undoes the copy and keeps the source", async () => {
    hooks.renameError = "EXDEV";
    hooks.unlinkFails = true;
    hooks.unlinkOnly = join(dir, "take.part");
    await writeFile(join(dir, "take.part"), "bytes");

    await expect(
      placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"), { stuck: "rollback" }),
    ).rejects.toMatchObject({ code: "EBUSY" });
    // One copy of the take, in its old place: a failed rename must not leave it in two.
    await expect(stat(join(dir, "Take.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(dir, "take.part"), "utf-8")).toBe("bytes");
    expect(hooks.links).toBe(0);
  });
});
