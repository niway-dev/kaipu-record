import { renameSync, writeFileSync, type PathLike } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
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
  /** Renames onto any of these paths fail (the second step of a case-only rename, or the move back). */
  renameFailsTo: [] as string[],
  /** `lstat` answers like a case-insensitive volume: a name matches whatever its case. */
  foldCase: false,
  /** Runs just before a rename that is not refused: a file that arrives inside the same-device window. */
  beforeRename: null as null | ((to: string) => Promise<void>),
  /** When set, the next rename is refused across volumes (EXDEV), the ones after it work. */
  exdevOnce: false,
  /** Runs when this path is `lstat`ed for the `nth` time (1 = the first): a file arriving mid-placement. */
  atLstat: null as null | { path: string; nth: number; run: () => void; seen: number },
  /** Runs right after a rename that went through: a file that arrives once the old name is free. */
  afterRename: null as null | ((to: string) => Promise<void>),
  /** Runs when this directory is opened (the flush after a copy): a provider acting after the copy. */
  atOpenDir: null as null | { path: string; run: () => void },
  /** Runs right after this path is opened for reading the `nth` time (1 = the first): a swap while a hash reads it. */
  afterOpenRead: null as null | { path: string; nth: number; run: () => void; seen: number },
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
      const opened = await (actual.open as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
      if (hooks.afterOpenRead && path === hooks.afterOpenRead.path && rest[0] === "r") {
        hooks.afterOpenRead.seen += 1;
        if (hooks.afterOpenRead.seen === hooks.afterOpenRead.nth) hooks.afterOpenRead.run();
      }
      return opened;
    },
    lstat: async (path: string, options?: unknown) => {
      if (hooks.atLstat && path === hooks.atLstat.path) {
        hooks.atLstat.seen += 1;
        if (hooks.atLstat.seen === hooks.atLstat.nth) hooks.atLstat.run();
      }
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
      if (hooks.exdevOnce) {
        hooks.exdevOnce = false;
        throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
      }
      if (hooks.renameFailsTo.includes(to)) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      // Only the move into the destination is refused: setting a source aside must still work.
      if (hooks.renameError && !to.endsWith(".placed")) {
        await hooks.atRename?.(to);
        throw Object.assign(new Error(hooks.renameError), { code: hooks.renameError });
      }
      await hooks.beforeRename?.(to);
      await actual.rename(from, to);
      await hooks.afterRename?.(to);
    },
  };
});

const { identityAt, placeByRename, renameCaseOnlyByRename, replaceConfirmed } =
  await import("./safe-place");
const { setStagingResolver, setSyncRootResolver } = await import("./atomic-write");

/** Every hook back to its default: the hooks object is shared by every test in this file. */
function resetHooks(): void {
  hooks.links = 0;
  hooks.renameError = null;
  hooks.unlinkFails = false;
  hooks.unlinkOnly = null;
  hooks.atRename = null;
  hooks.renames = [];
  hooks.renameFailsTo = [];
  hooks.foldCase = false;
  hooks.beforeRename = null;
  hooks.afterRename = null;
  hooks.exdevOnce = false;
  hooks.atOpenDir = null;
  hooks.atLstat = null;
  hooks.afterOpenRead = null;
}

describe("placeByRename (synced folders: no hard link, ever)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-by-rename-"));
    resetHooks();
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

  it("a rename that went through is a placement even if the name is gone a moment later (NIW2-912)", async () => {
    // The provider (or the user) removes the new name between the rename and the read that
    // follows it. The file was placed, and the source name is gone, so reporting a failure would
    // send the caller to roll back a move that happened. It gets the identity read before.
    await writeFile(join(dir, "take.part"), "bytes");
    const before = (await identityAt(join(dir, "take.part")))!;
    const placed = await placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"), {
      deps: {
        rename: (async (from: string, to: string) => {
          await rename(from, to);
          await rm(to);
        }) as typeof rename,
      },
    });
    expect(placed).toEqual(before);
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

    it.each([
      // Same size, same mtime, same inode: only the bytes tell.
      ["rewritten in place with the same size, mtime and inode", "WHOLE FILE", true],
      // #8: the size moved too: the stamp tells.
      ["appended to", "whole file, and more", false],
    ])(
      "a source %s after the copy is kept, and the stale copy is not reported as placed",
      async (_label, edited, restoreMtime) => {
        await mkdir(join(dir, "synced"), { recursive: true });
        await mkdir(join(dir, "scratch"), { recursive: true });
        const source = join(dir, "scratch", "take.mp4");
        await writeFile(source, "whole file");
        await utimes(source, 1_700_000_000, 1_700_000_000);
        const calls: Array<[string, string]> = [];
        const refuse = refusingOnce(calls);
        await expect(
          placeByRename(source, join(dir, "synced", "Take.mp4"), {
            deps: {
              isSynced: syncedOf(dir),
              syncRoot: () => join(dir, "synced"),
              rename: async (from, to) => {
                await refuse(from, to);
                if (calls.length < 2) return;
                // The copy has landed; now the source is edited in place.
                await writeFile(source, edited);
                if (restoreMtime) await utimes(source, 1_700_000_000, 1_700_000_000);
              },
            },
          }),
        ).rejects.toMatchObject({ code: "EIO" });
        expect(await readFile(source, "utf-8")).toBe(edited);
        await expect(stat(join(dir, "synced", "Take.mp4"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        // Nothing was set aside or marked as placed: the source is still the one to recover.
        expect(await readdir(join(dir, "scratch"))).toEqual(["take.mp4"]);
      },
    );

    it("a source rewritten after the copy keeps its newer bytes, and the copy the provider gave a new inode is still taken back", async () => {
      await mkdir(join(dir, "synced"), { recursive: true });
      await mkdir(join(dir, "scratch"), { recursive: true });
      const source = join(dir, "scratch", "take.mp4");
      const target = join(dir, "synced", "Take.mp4");
      await writeFile(source, "whole file");
      await utimes(source, 1_700_000_000, 1_700_000_000);
      const calls: Array<[string, string]> = [];
      const refuse = refusingOnce(calls);
      await expect(
        placeByRename(source, target, {
          deps: {
            isSynced: syncedOf(dir),
            syncRoot: () => join(dir, "synced"),
            rename: async (from, to) => {
              await refuse(from, to);
              if (calls.length < 2) return;
              // The provider re-creates the placed file (same bytes, another inode), then the
              // source is rewritten in place with the same size, mtime and inode.
              writeFileSync(`${target}.provider`, "whole file");
              renameSync(`${target}.provider`, target);
              await writeFile(source, "WHOLE FILE");
              await utimes(source, 1_700_000_000, 1_700_000_000);
            },
          },
        }),
      ).rejects.toMatchObject({ code: "EIO" });
      expect(await readFile(source, "utf-8")).toBe("WHOLE FILE");
      // No stale copy stays under the final name for the provider to upload.
      await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(join(dir, "synced"))).toEqual([]);
    });

    it("a file the provider delivers while the stale copy is being hashed is not deleted", async () => {
      await mkdir(join(dir, "synced"), { recursive: true });
      await mkdir(join(dir, "scratch"), { recursive: true });
      const source = join(dir, "scratch", "take.mp4");
      const target = join(dir, "synced", "Take.mp4");
      await writeFile(source, "whole file");
      await utimes(source, 1_700_000_000, 1_700_000_000);
      const calls: Array<[string, string]> = [];
      const refuse = refusingOnce(calls);
      // The take-back reads the name a second time (the first read is the check after the copy).
      // While it is being hashed, the provider delivers another file under the name; it holds
      // the very same bytes, so only a second look at the file can tell it apart.
      hooks.afterOpenRead = {
        path: target,
        nth: 2,
        seen: 0,
        run: () => {
          writeFileSync(`${target}.delivered`, "whole file");
          renameSync(`${target}.delivered`, target);
        },
      };
      await expect(
        placeByRename(source, target, {
          deps: {
            isSynced: syncedOf(dir),
            syncRoot: () => join(dir, "synced"),
            rename: async (from, to) => {
              await refuse(from, to);
              if (calls.length < 2) return;
              // The provider re-creates the placed file (another inode); the source is rewritten.
              writeFileSync(`${target}.provider`, "whole file");
              renameSync(`${target}.provider`, target);
              await writeFile(source, "WHOLE FILE");
              await utimes(source, 1_700_000_000, 1_700_000_000);
            },
          },
        }),
      ).rejects.toMatchObject({ code: "EIO" });
      expect(hooks.afterOpenRead?.seen).toBe(2);
      expect(await readFile(source, "utf-8")).toBe("WHOLE FILE");
      // The delivered file is not ours: it stays.
      expect(await readFile(target, "utf-8")).toBe("whole file");
      expect(await readdir(join(dir, "synced"))).toEqual(["Take.mp4"]);
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

    /** A synced folder `synced/` and a source in `scratch/`, with the provider root known. */
    async function stagedSetup(): Promise<{ from: string; to: string }> {
      await mkdir(join(dir, "synced"), { recursive: true });
      await mkdir(join(dir, "scratch"), { recursive: true });
      await writeFile(join(dir, "scratch", "take.mp4"), "whole file");
      return { from: join(dir, "scratch", "take.mp4"), to: join(dir, "synced", "Take.mp4") };
    }
    const stagedLeft = async () => readdir(join(dir, ".kaipu-staging")).catch(() => []);

    it("a file that took the name while the copy was staged is never replaced: taken, the source kept, nothing left staged", async () => {
      const { from, to } = await stagedSetup();
      const calls: Array<[string, string]> = [];
      // The provider delivers `Take.mp4` after the first look at the name (before anything is
      // copied) and before the check that precedes the staged copy's rename.
      hooks.atLstat = { path: to, nth: 2, seen: 0, run: () => writeFileSync(to, "someone else's") };
      const result = await placeByRename(from, to, {
        deps: {
          isSynced: syncedOf(dir),
          syncRoot: () => join(dir, "synced"),
          rename: refusingOnce(calls),
        },
      });
      expect(result).toBe("taken");
      expect(await readFile(to, "utf-8")).toBe("someone else's");
      expect(await readFile(from, "utf-8")).toBe("whole file");
      expect(await stagedLeft()).toEqual([]);
    });

    it("a staged copy whose final rename fails is removed and the source kept", async () => {
      const { from, to } = await stagedSetup();
      let calls = 0;
      await expect(
        placeByRename(from, to, {
          deps: {
            isSynced: syncedOf(dir),
            syncRoot: () => join(dir, "synced"),
            rename: async () => {
              calls += 1;
              throw Object.assign(new Error(calls === 1 ? "EXDEV" : "EACCES"), {
                code: calls === 1 ? "EXDEV" : "EACCES",
              });
            },
          },
        }),
      ).rejects.toMatchObject({ code: "EACCES" });
      expect(await readdir(join(dir, "synced"))).toEqual([]);
      expect(await readFile(from, "utf-8")).toBe("whole file");
      expect(await stagedLeft()).toEqual([]);
    });

    it("a source swapped for another file before the copy fails with ESTALE and copies nothing", async () => {
      const { from, to } = await stagedSetup();
      const expected = (await identityAt(from))!;
      await expect(
        placeByRename(from, to, {
          expect: expected,
          deps: {
            isSynced: syncedOf(dir),
            syncRoot: () => join(dir, "synced"),
            rename: async () => {
              // Between the check and the move another file takes the source's name.
              writeFileSync(join(dir, "scratch", "other.part"), "someone else's file");
              renameSync(join(dir, "scratch", "other.part"), from);
              throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
            },
          },
        }),
      ).rejects.toMatchObject({ code: "ESTALE" });
      expect(await readdir(join(dir, "synced"))).toEqual([]);
      expect(await readFile(from, "utf-8")).toBe("someone else's file");
      expect(await stagedLeft()).toEqual([]);
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

  it("across devices, a source edited in place after the copy is kept, and the stale copy is taken back (NIW2-912)", async () => {
    hooks.renameError = "EXDEV";
    await writeFile(join(dir, "take.part"), "bytes");
    // The same inode, new content: an identity check alone would pass and delete the edit.
    hooks.atOpenDir = {
      path: dir,
      run: () => writeFileSync(join(dir, "take.part"), "bytes + edit"),
    };
    await expect(
      placeByRename(join(dir, "take.part"), join(dir, "Take.mp4")),
    ).rejects.toMatchObject({ code: "EIO" });
    // The edit survives under the source's name; the stale copy is not left as if it were placed.
    expect(await readdir(dir)).toEqual(["take.part"]);
    expect(await readFile(join(dir, "take.part"), "utf-8")).toBe("bytes + edit");
  });

  it("across devices with stuck: rollback, a source edited in place after the copy fails and keeps the source", async () => {
    hooks.renameError = "EXDEV";
    await writeFile(join(dir, "take.part"), "bytes");
    hooks.atOpenDir = {
      path: dir,
      run: () => writeFileSync(join(dir, "take.part"), "bytes + edit"),
    };
    await expect(
      placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"), { stuck: "rollback" }),
    ).rejects.toMatchObject({ code: "EIO" });
    expect(await readFile(join(dir, "take.part"), "utf-8")).toBe("bytes + edit");
    expect(await readdir(dir)).toEqual(["take.part"]);
  });

  it("across devices, a destination rewritten in place after the copy is not the copy: taken, source kept", async () => {
    hooks.renameError = "EXDEV";
    await writeFile(join(dir, "take.part"), "bytes");
    // The same inode as the copy, other content: dev+ino cannot tell it from the copy.
    hooks.atOpenDir = { path: dir, run: () => writeFileSync(join(dir, "Take.mp4"), "rewritten") };
    expect(await placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"))).toBe("taken");
    expect(await readFile(join(dir, "take.part"), "utf-8")).toBe("bytes");
    expect(await readFile(join(dir, "Take.mp4"), "utf-8")).toBe("rewritten");
  });

  it("across devices, a provider that gives the copy a new inode but the same bytes does not make it 'taken'", async () => {
    hooks.renameError = "EXDEV";
    await writeFile(join(dir, "take.part"), "bytes");
    hooks.atOpenDir = {
      path: dir,
      run: () => {
        writeFileSync(join(dir, "provider.tmp"), "bytes");
        renameSync(join(dir, "provider.tmp"), join(dir, "Take.mp4"));
      },
    };
    expect(await placeByRename(join(dir, "take.part"), join(dir, "Take.mp4"))).not.toBe("taken");
    expect(await readFile(join(dir, "Take.mp4"), "utf-8")).toBe("bytes");
    await expect(stat(join(dir, "take.part"))).rejects.toMatchObject({ code: "ENOENT" });
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
      hooks.renameFailsTo = [join(dir, "Clip.mp4")];

      await expect(
        renameCaseOnlyByRename(join(dir, "clip.mp4"), join(dir, "Clip.mp4")),
      ).rejects.toMatchObject({ code: "EACCES" });

      expect(hooks.links).toBe(0);
      expect(await readdir(dir)).toEqual(["clip.mp4"]);
      expect(await readFile(join(dir, "clip.mp4"), "utf-8")).toBe("mine");
    });

    it("a different file that took the new name meanwhile is never replaced by the second step (NIW2-912)", async () => {
      await writeFile(join(dir, "clip.mp4"), "mine");
      hooks.foldCase = true;
      // Once the file is set aside at the temporary name, another file takes `Clip.mp4`. On a
      // volume that folds case that name is `clip.mp4` too, so the file cannot go back either:
      // it stays at the temporary name, which the error names, and nothing is overwritten.
      hooks.afterRename = async (to) => {
        if (basename(to).startsWith(".clip.mp4.case-")) {
          await writeFile(join(dir, "Clip.mp4"), "someone else's");
        }
      };

      await expect(
        renameCaseOnlyByRename(join(dir, "clip.mp4"), join(dir, "Clip.mp4")),
      ).rejects.toThrow(/\.clip\.mp4\.case-/);

      expect(await readFile(join(dir, "Clip.mp4"), "utf-8")).toBe("someone else's");
      const left = (await readdir(dir)).filter((name) => name.startsWith(".clip.mp4.case-"));
      expect(left).toHaveLength(1);
      expect(await readFile(join(dir, left[0]!), "utf-8")).toBe("mine");
    });

    it("a file whose second step AND move back both fail stays at the temporary name, and the error names it", async () => {
      await writeFile(join(dir, "clip.mp4"), "mine");
      // `foldCase` only makes the volume look case-insensitive (so the two-step path runs). Both the
      // rename onto the new name and the rename back onto the old one fail: this is the `catch`
      // around `moveBackByRename`'s placement, not the "name is occupied" branch.
      hooks.foldCase = true;
      hooks.renameFailsTo = [join(dir, "Clip.mp4"), join(dir, "clip.mp4")];

      const error = await renameCaseOnlyByRename(join(dir, "clip.mp4"), join(dir, "Clip.mp4")).then(
        () => null,
        (caught: unknown) => caught as NodeJS.ErrnoException,
      );

      expect(error?.code).toBe("EIO");
      expect(error?.message).toMatch(/\.clip\.mp4\.case-/);
      const names = await readdir(dir);
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^\.clip\.mp4\.case-/);
      expect(await readFile(join(dir, names[0]!), "utf-8")).toBe("mine");
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

describe("replaceConfirmed across volumes into a synced folder (by rename; NIW2-912)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-replace-synced-"));
    resetHooks();
    await mkdir(join(dir, "synced"), { recursive: true });
    await mkdir(join(dir, "scratch"), { recursive: true });
    await writeFile(join(dir, "scratch", "take.mp4"), "new bytes");
    await writeFile(join(dir, "synced", "Take.mp4"), "old bytes");
  });
  afterEach(async () => {
    setSyncRootResolver(() => null);
    setStagingResolver(() => null);
    await rm(dir, { recursive: true, force: true });
  });

  it("a destination the app's detection knows is synced is staged outside the folder too, with intoSynced false", async () => {
    setSyncRootResolver(() => join(dir, "synced"));
    // isSyncedPath(to) is now true, for the synced folder only (the ancestors stay plain).
    setStagingResolver((path) =>
      path.startsWith(join(dir, "synced")) ? join(dir, "scratch-staging") : null,
    );
    hooks.exdevOnce = true;
    await replaceConfirmed(
      join(dir, "scratch", "take.mp4"),
      join(dir, "synced", "Take.mp4"),
      true,
      false,
    );
    expect(await readFile(join(dir, "synced", "Take.mp4"), "utf-8")).toBe("new bytes");
    expect(await readdir(join(dir, "synced"))).toEqual(["Take.mp4"]);
    const final = (hooks.renames as Array<[string, string]>).at(-1)!;
    expect(final[0].startsWith(join(dir, ".kaipu-staging"))).toBe(true);
  });

  it("with no known provider root it fails with EXDEV, keeps the source and leaves the target alone", async () => {
    setSyncRootResolver(() => null);
    hooks.exdevOnce = true;
    await expect(
      replaceConfirmed(
        join(dir, "scratch", "take.mp4"),
        join(dir, "synced", "Take.mp4"),
        true,
        true,
      ),
    ).rejects.toMatchObject({ code: "EXDEV" });
    expect(await readFile(join(dir, "synced", "Take.mp4"), "utf-8")).toBe("old bytes");
    expect(await readFile(join(dir, "scratch", "take.mp4"), "utf-8")).toBe("new bytes");
    expect(await readdir(join(dir, "synced"))).toEqual(["Take.mp4"]);
  });

  it("with a known root the replacement is staged outside the folder and arrives by one rename", async () => {
    setSyncRootResolver(() => join(dir, "synced"));
    hooks.exdevOnce = true;
    await replaceConfirmed(
      join(dir, "scratch", "take.mp4"),
      join(dir, "synced", "Take.mp4"),
      true,
      true,
    );
    expect(await readFile(join(dir, "synced", "Take.mp4"), "utf-8")).toBe("new bytes");
    expect(await readdir(join(dir, "synced"))).toEqual(["Take.mp4"]); // no temp ever beside it
    const [refused, final] = hooks.renames as Array<[string, string]>;
    expect(refused![0].startsWith(join(dir, "scratch"))).toBe(true); // the refused move
    expect(final![0].startsWith(join(dir, ".kaipu-staging"))).toBe(true);
    expect(final![1]).toBe(join(dir, "synced", "Take.mp4"));
    await expect(stat(join(dir, "scratch", "take.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("sets the source aside when it cannot be verified after the copy, so a sweep never recovers the take twice", async () => {
    setSyncRootResolver(() => join(dir, "synced"));
    const source = join(dir, "scratch", "take.mp4");
    hooks.exdevOnce = true;
    // The source becomes unreadable right after the copy landed: hashing it fails.
    hooks.afterRename = async (to) => {
      if (to === join(dir, "synced", "Take.mp4")) await chmod(source, 0o000);
    };
    try {
      await replaceConfirmed(source, join(dir, "synced", "Take.mp4"), true, true);
    } finally {
      await chmod(source, 0o644).catch(() => {});
    }
    expect(await readFile(join(dir, "synced", "Take.mp4"), "utf-8")).toBe("new bytes");
    // The scratch file no longer holds a name the stranded sweep matches.
    expect(await readdir(join(dir, "scratch"))).not.toContain("take.mp4");
  });

  it("keeps a source rewritten in place after the copy, with the same size, mtime and inode", async () => {
    setSyncRootResolver(() => join(dir, "synced"));
    const source = join(dir, "scratch", "take.mp4");
    await utimes(source, 1_700_000_000, 1_700_000_000);
    hooks.exdevOnce = true;
    hooks.afterRename = async (to) => {
      if (to !== join(dir, "synced", "Take.mp4")) return;
      await writeFile(source, "NEW BYTES");
      await utimes(source, 1_700_000_000, 1_700_000_000);
    };
    await expect(
      replaceConfirmed(source, join(dir, "synced", "Take.mp4"), true, true),
    ).rejects.toMatchObject({ code: "EIO" });
    expect(await readFile(source, "utf-8")).toBe("NEW BYTES");
    expect(await readdir(join(dir, "scratch"))).toEqual(["take.mp4"]);
  });
});
