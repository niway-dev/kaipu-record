import { renameSync, writeFileSync, type PathLike } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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
  /** Every rename made, in order (a case-only rename is two). */
  renames: [] as Array<[string, string]>,
  /** When set, a rename onto this path fails (the second step of a case-only rename). */
  renameFailsTo: null as null | string,
  /** `lstat` answers like a case-insensitive volume: a name matches whatever its case. */
  foldCase: false,
  /** Runs just before a rename that is not refused: a file that arrives inside the same-device window. */
  beforeRename: null as null | ((to: string) => Promise<void>),
  /** Runs when this directory is opened (the flush after a copy): a provider acting after the copy. */
  atOpenDir: null as null | { path: string; run: () => void },
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
    open: async (path: string, ...rest: unknown[]) => {
      if (hooks.atOpenDir && path === hooks.atOpenDir.path) {
        const { run } = hooks.atOpenDir;
        hooks.atOpenDir = null;
        run();
      }
      return (actual.open as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    },
    lstat: async (path: string, options?: unknown) => {
      let at = path;
      if (hooks.foldCase) {
        const names = await actual.readdir(dirname(path));
        const hit = names.find((name) => name.toLowerCase() === basename(path).toLowerCase());
        if (hit) at = join(dirname(path), hit);
      }
      return actual.lstat(at, options as never);
    },
    rename: async (from: string, to: string) => {
      hooks.renames.push([from, to]);
      if (hooks.renameFailsTo === to) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      // Only the move into the destination is refused: setting a source aside must still work.
      if (hooks.renameError && !to.endsWith(".placed")) {
        await hooks.atRename?.(to);
        throw Object.assign(new Error(hooks.renameError), { code: hooks.renameError });
      }
      await hooks.beforeRename?.(to);
      return actual.rename(from, to);
    },
  };
});

const { identityAt, placeByRename, renameCaseOnlyByRename } = await import("./safe-place");

describe("placeByRename (synced folders: no hard link, ever)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-by-rename-"));
    hooks.links = 0;
    hooks.renameError = null;
    hooks.unlinkFails = false;
    hooks.unlinkOnly = null;
    hooks.atRename = null;
    hooks.renames = [];
    hooks.renameFailsTo = null;
    hooks.foldCase = false;
    hooks.beforeRename = null;
    hooks.atOpenDir = null;
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

  describe("into a synced folder on another volume (EXDEV; NIW2-912)", () => {
    const syncedOf = (root: string) => (path: string) =>
      path === join(root, "synced") || path.startsWith(join(root, "synced") + "/");
    /** A rename that is refused across volumes once (the scratch to synced move), then works. */
    const refusingOnce =
      (calls: Array<[string, string]>) => async (fromPath: PathLike, toPath: PathLike) => {
        const [from, to] = [String(fromPath), String(toPath)];
        calls.push([from, to]);
        if (calls.length === 1) {
          throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
        }
        renameSync(from, to);
      };

    it("stages the copy on the destination's volume outside the folder; the folder sees only the rename", async () => {
      await mkdir(join(dir, "synced"), { recursive: true });
      await mkdir(join(dir, "scratch"), { recursive: true });
      await writeFile(join(dir, "scratch", "take.mp4"), "whole file");
      const calls: Array<[string, string]> = [];
      const seenInFolder: string[][] = [];
      const rename = refusingOnce(calls);
      const placed = await placeByRename(
        join(dir, "scratch", "take.mp4"),
        join(dir, "synced", "Take.mp4"),
        {
          deps: {
            isSynced: syncedOf(dir),
            syncRoot: () => join(dir, "synced"),
            rename: async (from, to) => {
              // The moment the folder is touched: it holds nothing yet, and the staged file is whole.
              if (calls.length >= 1) {
                seenInFolder.push(await readdir(join(dir, "synced")));
                expect(await readFile(String(from), "utf-8")).toBe("whole file");
              }
              await rename(from, to);
            },
          },
        },
      );
      expect(placed).not.toBe("taken");
      expect(seenInFolder).toEqual([[]]);
      expect(calls[1]![0].startsWith(join(dir, ".kaipu-staging"))).toBe(true);
      expect(calls[1]![1]).toBe(join(dir, "synced", "Take.mp4"));
      expect(await readdir(join(dir, "synced"))).toEqual(["Take.mp4"]);
      expect(await readFile(join(dir, "synced", "Take.mp4"), "utf-8")).toBe("whole file");
      expect(await readdir(join(dir, ".kaipu-staging"))).toEqual([]);
      await expect(stat(join(dir, "scratch", "take.mp4"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("with no folder outside the synced one that can stage it, fails and keeps the source (nothing partial is placed)", async () => {
      await mkdir(join(dir, "synced"), { recursive: true });
      await mkdir(join(dir, "scratch"), { recursive: true });
      await writeFile(join(dir, "scratch", "take.mp4"), "whole file");
      const calls: Array<[string, string]> = [];
      // The detection claims every ancestor: no folder can be told apart from the synced one.
      await expect(
        placeByRename(join(dir, "scratch", "take.mp4"), join(dir, "synced", "Take.mp4"), {
          deps: {
            isSynced: () => true,
            syncRoot: () => join(dir, "synced"),
            rename: refusingOnce(calls),
          },
        }),
      ).rejects.toMatchObject({ code: "EXDEV" });
      expect(calls).toHaveLength(1);
      expect(await readdir(join(dir, "synced"))).toEqual([]);
      expect(await readFile(join(dir, "scratch", "take.mp4"), "utf-8")).toBe("whole file");
    });

    it("a synced destination whose provider root is unknown fails with EXDEV and keeps the source, with nothing staged beside it", async () => {
      await mkdir(join(dir, "synced"), { recursive: true });
      await mkdir(join(dir, "scratch"), { recursive: true });
      await writeFile(join(dir, "scratch", "take.mp4"), "whole file");
      const calls: Array<[string, string]> = [];
      // Found synced by its xattr alone (no path rule names a root): its parent could be inside it.
      await expect(
        placeByRename(join(dir, "scratch", "take.mp4"), join(dir, "synced", "Take.mp4"), {
          deps: { isSynced: syncedOf(dir), syncRoot: () => null, rename: refusingOnce(calls) },
        }),
      ).rejects.toMatchObject({ code: "EXDEV" });
      expect(calls).toHaveLength(1);
      expect(await readdir(join(dir, "synced"))).toEqual([]);
      await expect(stat(join(dir, ".kaipu-staging"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(dir, "scratch", "take.mp4"), "utf-8")).toBe("whole file");
    });

    it("a destination the caller knows is synced (a save-dialog folder) never gets the direct copy either", async () => {
      await mkdir(join(dir, "picked"), { recursive: true });
      await mkdir(join(dir, "scratch"), { recursive: true });
      await writeFile(join(dir, "scratch", "take.mp4"), "whole file");
      const calls: Array<[string, string]> = [];
      await expect(
        placeByRename(join(dir, "scratch", "take.mp4"), join(dir, "picked", "Take.mp4"), {
          intoSynced: true,
          deps: { isSynced: () => false, syncRoot: () => null, rename: refusingOnce(calls) },
        }),
      ).rejects.toMatchObject({ code: "EXDEV" });
      expect(await readdir(join(dir, "picked"))).toEqual([]);
      expect(await readFile(join(dir, "scratch", "take.mp4"), "utf-8")).toBe("whole file");
    });

    it("control: a destination the detection does not call synced keeps the direct exclusive copy", async () => {
      await mkdir(join(dir, "plain"), { recursive: true });
      await writeFile(join(dir, "take.mp4"), "whole file");
      const calls: Array<[string, string]> = [];
      await placeByRename(join(dir, "take.mp4"), join(dir, "plain", "Take.mp4"), {
        deps: { isSynced: () => false, rename: refusingOnce(calls) },
      });
      expect(calls).toHaveLength(1);
      expect(await readFile(join(dir, "plain", "Take.mp4"), "utf-8")).toBe("whole file");
      await expect(stat(join(dir, ".kaipu-staging"))).rejects.toMatchObject({ code: "ENOENT" });
    });
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

  // The same-device window: POSIX `rename` replaces, and Node has no rename-without-replace. The
  // doc comment on `placeByRename` states it; this pins it, so a change to the check, or to the
  // callers' reservation of the stem, shows up here instead of in a user's folder.
  it("on one device, a file created between the check and the rename is replaced (the documented window)", async () => {
    hooks.beforeRename = (to) => writeFile(to, "arrived late");
    await writeFile(join(dir, "take.part"), "new");
    const placed = await placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"));
    expect(placed).not.toBe("taken");
    expect(await readFile(join(dir, "Take.mp4"), "utf-8")).toBe("new");
    await expect(stat(join(dir, "take.part"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("across devices, a copy the provider replaces before the source goes keeps the source", async () => {
    hooks.renameError = "EXDEV";
    await writeFile(join(dir, "take.part"), "new");
    // The provider resolves a conflict in the instant after the copy: a different file, renamed
    // over the copy (made beside it first, so it cannot reuse the copy's inode number).
    hooks.atOpenDir = {
      path: dir,
      run: () => {
        writeFileSync(join(dir, "theirs.tmp"), "the provider's version");
        renameSync(join(dir, "theirs.tmp"), join(dir, "Take.mp4"));
      },
    };
    expect(await placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"))).toBe("taken");
    expect(await readFile(join(dir, "Take.mp4"), "utf-8")).toBe("the provider's version");
    expect(await readFile(join(dir, "take.part"), "utf-8")).toBe("new");
  });

  it("across devices only, a file that arrives after the check is never replaced and the source stays", async () => {
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
    // The name is taken over by another file before the placement. The replacement is made
    // while the original still exists and renamed over it, so it cannot get the original's
    // inode back (a file system may reuse a freed inode number straight away).
    await writeFile(join(dir, "other.part"), "someone else's file");
    await rename(join(dir, "other.part"), join(dir, "take.part"));

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
  describe("renameCaseOnlyByRename (a case-insensitive volume, simulated)", () => {
    it("goes through a temporary sibling by plain renames, never a link, and ends with the new case", async () => {
      await writeFile(join(dir, "clip.mp4"), "mine");
      hooks.foldCase = true; // `Clip.mp4` now answers with the identity of `clip.mp4`

      expect(await renameCaseOnlyByRename(join(dir, "clip.mp4"), join(dir, "Clip.mp4"))).toBe(
        "placed",
      );

      expect(hooks.links).toBe(0);
      expect(hooks.renames).toHaveLength(2);
      const [first, second] = hooks.renames as [[string, string], [string, string]];
      expect(first[0]).toBe(join(dir, "clip.mp4"));
      expect(basename(first[1])).toMatch(/^\.clip\.mp4\.case-/);
      expect(second).toEqual([first[1], join(dir, "Clip.mp4")]);
      expect(await readdir(dir)).toEqual(["Clip.mp4"]);
      expect(await readFile(join(dir, "Clip.mp4"), "utf-8")).toBe("mine");
    });

    it("a failed second step renames the file back to its old name and fails", async () => {
      await writeFile(join(dir, "clip.mp4"), "mine");
      hooks.foldCase = true;
      hooks.renameFailsTo = join(dir, "Clip.mp4");

      await expect(
        renameCaseOnlyByRename(join(dir, "clip.mp4"), join(dir, "Clip.mp4")),
      ).rejects.toMatchObject({ code: "EACCES" });

      expect(hooks.links).toBe(0);
      expect(await readdir(dir)).toEqual(["clip.mp4"]);
      expect(await readFile(join(dir, "clip.mp4"), "utf-8")).toBe("mine");
    });

    it("where the new name is free, it is one placement by rename", async () => {
      await writeFile(join(dir, "clip.mp4"), "mine");
      expect(await renameCaseOnlyByRename(join(dir, "clip.mp4"), join(dir, "Other.mp4"))).toBe(
        "placed",
      );
      expect(hooks.renames).toHaveLength(1);
      expect(await readdir(dir)).toEqual(["Other.mp4"]);
    });
  });
});
