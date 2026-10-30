import { lstat, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Volumes without hard links, short writes, files arriving between two steps and failing
// removals cannot be produced portably on a real disk, so the primitives are wrapped. Each
// hook is off unless a test sets it.
const hooks = vi.hoisted(() => ({
  linkError: null as null | string,
  /** Runs once, right before `link`/`open(…, "wx")`/`rename` touches a path ending in `onPath`. */
  arrival: null as null | { onPath: string; run: (path: string) => Promise<void> },
  /** Byte cap per `write` on handles opened "wx" (a short write); 0 = no progress at all. */
  writeCap: null as null | number,
  /** Fail the nth write (1-based) on a "wx" handle. */
  failWriteAt: null as null | number,
  failSync: false,
  failUnlink: new Set<string>(),
  failRename: null as null | ((from: string, to: string) => boolean),
  /** The first `close` / first `stat` of a "wx" handle fails. */
  failClose: false,
  failFirstStat: false,
  /** Runs right before the failing write throws (`failWriteAt`). */
  onWriteFail: null as null | (() => Promise<void>),
  /**
   * Case-insensitive volume, modelled with a hard link: removing or renaming away `name`
   * also drops `variant`, as both are one directory entry there.
   */
  fold: null as null | { name: string; variant: string },
  /** Runs once, right after a `link` to a path ending in `onPath` succeeds. */
  afterLink: null as null | { onPath: string; run: (path: string) => Promise<void> },
  /** Runs right before a `rename` onto `to` (another process acting in that window). */
  onRename: null as null | ((from: string, to: string) => Promise<void>),
  /** Paths whose next `lstat` fails with EIO. */
  failLstat: new Set<string>(),
}));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  const arrive = async (path: string) => {
    const hook = hooks.arrival;
    if (hook && path.endsWith(hook.onPath)) {
      hooks.arrival = null;
      await hook.run(path);
    }
  };
  return {
    ...actual,
    link: async (from: string, to: string) => {
      await arrive(to);
      if (hooks.linkError) {
        throw Object.assign(new Error(hooks.linkError), { code: hooks.linkError });
      }
      await actual.link(from, to);
      const after = hooks.afterLink;
      if (after && to.endsWith(after.onPath)) {
        hooks.afterLink = null;
        await after.run(to);
      }
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (hooks.failLstat.delete(String(args[0]))) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      return actual.lstat(...args);
    },
    open: async (path: string, flags?: string, mode?: number) => {
      if (flags === "wx") await arrive(path);
      const handle = await actual.open(path, flags, mode);
      if (flags !== "wx") return handle;
      let writes = 0;
      const write = handle.write.bind(handle) as (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => Promise<{ bytesWritten: number; buffer: Buffer }>;
      const sync = handle.sync.bind(handle);
      const close = handle.close.bind(handle);
      const stat = handle.stat.bind(handle) as typeof handle.stat;
      let stats = 0;
      return Object.assign(handle, {
        close: async () => {
          await close();
          if (hooks.failClose) {
            hooks.failClose = false;
            throw Object.assign(new Error("EIO"), { code: "EIO" });
          }
        },
        stat: async (options?: { bigint?: boolean }) => {
          stats += 1;
          if (hooks.failFirstStat && stats === 1) {
            throw Object.assign(new Error("EIO"), { code: "EIO" });
          }
          return stat(options as never);
        },
        write: async (buffer: Buffer, offset: number, length: number, position: number) => {
          writes += 1;
          if (hooks.failWriteAt === writes) {
            await hooks.onWriteFail?.();
            throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
          }
          if (hooks.writeCap === 0) return { bytesWritten: 0, buffer };
          const cap = hooks.writeCap ?? length;
          return write(buffer, offset, Math.min(cap, length), position);
        },
        sync: async () => {
          if (hooks.failSync) throw Object.assign(new Error("EIO"), { code: "EIO" });
          return sync();
        },
      });
    },
    unlink: async (path: string) => {
      if (hooks.failUnlink.has(path)) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      await actual.unlink(path);
      if (hooks.fold?.name === path) await actual.unlink(hooks.fold.variant).catch(() => {});
    },
    rename: async (from: string, to: string) => {
      await arrive(to);
      await hooks.onRename?.(from, to);
      if (hooks.failRename?.(from, to)) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      await actual.rename(from, to);
      if (hooks.fold?.name === from) await actual.unlink(hooks.fold.variant).catch(() => {});
    },
  };
});

import {
  PLACED_MARKER_SUFFIX,
  PLACED_SUFFIX,
  placeNoReplace,
  readPlacementMarker,
  renameCaseOnly,
  replaceConfirmed,
} from "./safe-place";

afterEach(() => {
  hooks.linkError = null;
  hooks.arrival = null;
  hooks.writeCap = null;
  hooks.failWriteAt = null;
  hooks.failSync = false;
  hooks.failUnlink.clear();
  hooks.failRename = null;
  hooks.failClose = false;
  hooks.failFirstStat = false;
  hooks.onWriteFail = null;
  hooks.fold = null;
  hooks.afterLink = null;
  hooks.onRename = null;
  hooks.failLstat.clear();
  vi.restoreAllMocks();
});

const NO_LINK_CODES = ["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EMLINK"];

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "safe-place-"));
}

/** A source of `size` bytes (several copy chunks when large) and a free destination. */
async function pair(content: string | Buffer = "new recording") {
  const dir = await folder();
  const from = join(dir, "source.part");
  await writeFile(from, content);
  return { dir, from, to: join(dir, "Dest.mp4") };
}

const read = (path: string) => readFile(path, "utf-8");
const gone = (path: string) => expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });

describe("placeNoReplace", () => {
  it("staging mode: a source that cannot be checked after placing is set aside, not left sweepable", async () => {
    const { dir, from, to } = await pair();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The check before removing the source fails once, right after the link.
    hooks.afterLink = { onPath: "Dest.mp4", run: async () => void hooks.failLstat.add(from) };
    expect(await placeNoReplace(from, to, { stuck: "set-aside" })).toBe("placed");
    expect(await read(to)).toBe("new recording");
    const names = await readdir(dir);
    // The staging name the stranded sweep matches is gone, or a marker says it was placed.
    const setAside =
      !names.includes(basename(from)) || names.includes(`${basename(from)}${PLACED_MARKER_SUFFIX}`);
    expect(setAside).toBe(true);
  });

  it("places with a hard link and removes the source", async () => {
    const { dir, from, to } = await pair();
    expect(await placeNoReplace(from, to)).toBe("placed");
    expect(await read(to)).toBe("new recording");
    expect(await readdir(dir)).toEqual(["Dest.mp4"]);
  });

  it("never replaces an existing file: taken, source kept", async () => {
    const { from, to } = await pair();
    await writeFile(to, "other recording");
    expect(await placeNoReplace(from, to)).toBe("taken");
    expect(await read(to)).toBe("other recording");
    expect(await read(from)).toBe("new recording");
  });

  it("is taken when a file arrives right before the link", async () => {
    const { from, to } = await pair();
    hooks.arrival = { onPath: "Dest.mp4", run: (path) => writeFile(path, "other recording") };
    expect(await placeNoReplace(from, to)).toBe("taken");
    expect(await read(to)).toBe("other recording");
    expect(await read(from)).toBe("new recording");
  });

  it("propagates a missing source", async () => {
    const dir = await folder();
    await expect(placeNoReplace(join(dir, "nope"), join(dir, "x"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("propagates a link error that is not about hard-link support, creating nothing", async () => {
    const { from, to } = await pair();
    hooks.linkError = "EIO";
    await expect(placeNoReplace(from, to)).rejects.toMatchObject({ code: "EIO" });
    await gone(to);
    expect(await read(from)).toBe("new recording");
  });

  describe.each(NO_LINK_CODES)("without hard links (%s)", (code) => {
    it("copies exclusively, then removes the source", async () => {
      const { dir, from, to } = await pair();
      hooks.linkError = code;
      expect(await placeNoReplace(from, to)).toBe("placed");
      expect(await read(to)).toBe("new recording");
      expect(await readdir(dir)).toEqual(["Dest.mp4"]);
    });

    it("is taken when a file arrives before the exclusive create", async () => {
      const { from, to } = await pair();
      hooks.linkError = code;
      // The first touch of the destination is the (failing) link; the file arrives right
      // after it, before the exclusive create.
      hooks.arrival = {
        onPath: "Dest.mp4",
        run: async () => {
          hooks.arrival = { onPath: "Dest.mp4", run: (p) => writeFile(p, "other") };
        },
      };
      expect(await placeNoReplace(from, to)).toBe("taken");
      expect(await read(to)).toBe("other");
      expect(await read(from)).toBe("new recording");
    });
  });

  it("continues short writes until every byte is written", async () => {
    const content = Buffer.alloc((1 << 20) * 2 + 12345, 7);
    content.write("head", 0);
    content.write("tail", content.length - 4);
    const { from, to } = await pair(content);
    hooks.linkError = "EPERM";
    hooks.writeCap = 4097;
    expect(await placeNoReplace(from, to)).toBe("placed");
    expect((await readFile(to)).equals(content)).toBe(true);
    await gone(from);
  });

  it("fails a write that makes no progress, removing its own file and keeping the source", async () => {
    const { from, to } = await pair();
    hooks.linkError = "EPERM";
    hooks.writeCap = 0;
    await expect(placeNoReplace(from, to)).rejects.toMatchObject({ code: "EIO" });
    await gone(to);
    expect(await read(from)).toBe("new recording");
  });

  it.each([1, 2])("a copy failing at write %i removes only its own file", async (at) => {
    const { from, to } = await pair(Buffer.alloc((1 << 20) + 10, 1));
    hooks.linkError = "EXDEV";
    hooks.failWriteAt = at;
    await expect(placeNoReplace(from, to)).rejects.toMatchObject({ code: "ENOSPC" });
    await gone(to);
    expect((await readFile(from)).length).toBe((1 << 20) + 10);
  });

  it("a failed fsync removes its own file and keeps the source", async () => {
    const { from, to } = await pair();
    hooks.linkError = "EXDEV";
    hooks.failSync = true;
    await expect(placeNoReplace(from, to)).rejects.toMatchObject({ code: "EIO" });
    await gone(to);
    expect(await read(from)).toBe("new recording");
  });

  it("a failure before the destination exists creates and removes nothing", async () => {
    const dir = await folder();
    const from = join(dir, "source.part");
    await writeFile(from, "new recording");
    const to = join(dir, "missing-folder", "Dest.mp4");
    hooks.linkError = "EXDEV";
    await expect(placeNoReplace(from, to)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await read(from)).toBe("new recording");
  });

  it("never removes a file that replaced its copy before the cleanup", async () => {
    const { dir, from, to } = await pair();
    const foreign = join(dir, "foreign");
    await writeFile(foreign, "other recording");
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    hooks.linkError = "EXDEV";
    hooks.failWriteAt = 1;
    // Another process renames its file over the half-made copy before the cleanup runs.
    hooks.onWriteFail = () => fs.rename(foreign, to);
    await expect(placeNoReplace(from, to)).rejects.toMatchObject({ code: "ENOSPC" });
    expect(await read(to)).toBe("other recording");
    expect(await read(from)).toBe("new recording");
  });

  it.each([
    ["the copy's close fails", () => (hooks.failClose = true)],
    ["the copy's first stat fails", () => (hooks.failFirstStat = true)],
  ])("%s: its own file is removed and the source kept", async (_name, arm) => {
    const { dir, from, to } = await pair();
    hooks.linkError = "EXDEV";
    arm();
    await expect(placeNoReplace(from, to)).rejects.toMatchObject({ code: "EIO" });
    expect(await read(from)).toBe("new recording");
    expect(await readdir(dir)).toEqual(["source.part"]);
  });

  describe("a source that cannot be removed after placing", () => {
    it("set-aside (default): renamed out of the sweep's pattern", async () => {
      const { dir, from, to } = await pair();
      hooks.failUnlink.add(from);
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await placeNoReplace(from, to)).toBe("placed");
      const names = await readdir(dir);
      expect(names).toContain("Dest.mp4");
      expect(names.some((n) => n.startsWith("source.part-") && n.endsWith(PLACED_SUFFIX))).toBe(
        true,
      );
    });

    it("set-aside: a marker records the placement when even the rename fails", async () => {
      const { from, to } = await pair();
      hooks.linkError = "EPERM";
      hooks.failUnlink.add(from);
      hooks.failRename = (source) => source === from;
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await placeNoReplace(from, to)).toBe("placed");
      expect(await readPlacementMarker(from)).toEqual({
        version: 1,
        destination: to,
        size: "new recording".length,
      });
      expect(await read(`${from}${PLACED_MARKER_SUFFIX}`)).toContain("Dest.mp4");
    });

    it("set-aside: logs when the marker cannot be written either", async () => {
      const { from, to } = await pair();
      hooks.failUnlink.add(from);
      // Neither the set-aside nor the marker's atomic rename can land.
      hooks.failRename = (source, target) =>
        source === from || target === `${from}${PLACED_MARKER_SUFFIX}`;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await placeNoReplace(from, to)).toBe("placed");
      expect(error).toHaveBeenCalled();
      expect(await readPlacementMarker(from)).toBeNull();
    });

    it.each(["link", "copy"])("rollback (%s): the placement is undone", async (how) => {
      const { from, to } = await pair();
      if (how === "copy") hooks.linkError = "EPERM";
      hooks.failUnlink.add(from);
      await expect(placeNoReplace(from, to, { stuck: "rollback" })).rejects.toMatchObject({
        code: "EPERM",
      });
      await gone(to);
      expect(await read(from)).toBe("new recording");
    });
  });
});

describe("renameCaseOnly", () => {
  it("on a free name (case-sensitive volume) is a plain exclusive placement", async () => {
    const { dir, from } = await pair();
    const to = join(dir, "SOURCE.part");
    const sensitive = (await lstat(to).catch(() => null)) === null;
    if (!sensitive) return; // this machine's tmp is case-insensitive: covered below
    expect(await renameCaseOnly(from, to)).toBe("placed");
    expect(await readdir(dir)).toEqual(["SOURCE.part"]);
  });

  it("is taken when a different file holds the new name", async () => {
    const dir = await folder();
    const from = join(dir, "a.mp4");
    const to = join(dir, "b.mp4"); // stands for the case variant: a different inode
    await writeFile(from, "mine");
    await writeFile(to, "theirs");
    expect(await renameCaseOnly(from, to)).toBe("taken");
    expect(await read(to)).toBe("theirs");
    expect(await read(from)).toBe("mine");
  });

  // The same file under both names, as on a case-insensitive volume (APFS, NTFS, exFAT): a
  // hard link whose second name disappears with the first (`hooks.fold`).
  async function sameEntry() {
    const dir = await folder();
    const from = join(dir, "clip.mp4");
    const to = join(dir, "Clip-variant.mp4");
    await writeFile(from, "mine");
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    await fs.link(from, to);
    hooks.fold = { name: from, variant: to };
    return { dir, from, to, fs };
  }

  it.each([null, ...NO_LINK_CODES])(
    "renames the same file through a temporary sibling (link error: %s)",
    async (linkError) => {
      const { dir, from, to } = await sameEntry();
      const identity = await lstat(from);
      hooks.linkError = linkError;
      expect(await renameCaseOnly(from, to)).toBe("placed");
      // A link keeps the file itself; without hard links it is an exclusive copy (never a
      // replacing rename onto the new name).
      if (linkError === null) expect((await lstat(to)).ino).toBe(identity.ino);
      expect(await read(to)).toBe("mine");
      expect(await readdir(dir)).toEqual(["Clip-variant.mp4"]);
    },
  );

  it.each([null, "EPERM"])(
    "puts the file back when a different file takes the new name between the steps (%s)",
    async (linkError) => {
      const { dir, from, to } = await sameEntry();
      hooks.linkError = linkError;
      hooks.arrival = { onPath: "Clip-variant.mp4", run: (path) => writeFile(path, "theirs") };
      expect(await renameCaseOnly(from, to)).toBe("taken");
      expect(await read(to)).toBe("theirs");
      expect(await read(from)).toBe("mine");
      expect((await readdir(dir)).sort()).toEqual(["Clip-variant.mp4", "clip.mp4"]);
    },
  );

  it("a real case-only rename, where this machine's temp folder is case-insensitive", async () => {
    const dir = await folder();
    const from = join(dir, "clip.mp4");
    await writeFile(from, "mine");
    const to = join(dir, "Clip.mp4");
    if ((await lstat(to).catch(() => null)) === null) return; // case-sensitive: nothing to show
    expect(await renameCaseOnly(from, to)).toBe("placed");
    expect(await readdir(dir)).toEqual(["Clip.mp4"]);
    expect(await read(to)).toBe("mine");
  });
});

describe("replaceConfirmed", () => {
  it("replaces the destination and removes the source", async () => {
    const { dir, from, to } = await pair();
    await writeFile(to, "old recording");
    await replaceConfirmed(from, to);
    expect(await read(to)).toBe("new recording");
    expect(await readdir(dir)).toEqual(["Dest.mp4"]);
  });

  it.each(["link", "copy"])(
    "a failed final rename (%s) leaves the original and the source intact",
    async (how) => {
      const { dir, from, to } = await pair();
      await writeFile(to, "old recording");
      if (how === "copy") hooks.linkError = "EXDEV";
      hooks.failRename = (_from, target) => target === to;
      await expect(replaceConfirmed(from, to)).rejects.toMatchObject({ code: "EACCES" });
      expect(await read(to)).toBe("old recording");
      expect(await read(from)).toBe("new recording");
      expect((await readdir(dir)).sort()).toEqual(["Dest.mp4", "source.part"]);
    },
  );

  it.each([
    ["a failed write", () => (hooks.failWriteAt = 1)],
    ["a failed fsync", () => (hooks.failSync = true)],
    ["no progress", () => (hooks.writeCap = 0)],
  ])("%s while copying never touches the existing destination", async (_name, arm) => {
    const { dir, from, to } = await pair();
    await writeFile(to, "old recording");
    hooks.linkError = "EXDEV";
    arm();
    await expect(replaceConfirmed(from, to)).rejects.toBeTruthy();
    expect(await read(to)).toBe("old recording");
    expect(await read(from)).toBe("new recording");
    expect((await readdir(dir)).sort()).toEqual(["Dest.mp4", "source.part"]);
  });

  it("a failure before anything is created leaves the destination", async () => {
    const { from, to } = await pair();
    await writeFile(to, "old recording");
    hooks.linkError = "EIO";
    await expect(replaceConfirmed(from, to)).rejects.toMatchObject({ code: "EIO" });
    expect(await read(to)).toBe("old recording");
  });

  it("works when the destination does not exist yet", async () => {
    const { from, to } = await pair();
    await replaceConfirmed(from, to);
    expect(await read(to)).toBe("new recording");
    await gone(from);
  });
});

describe("renameCaseOnly when the file cannot return to its old name", () => {
  it("keeps it at the temporary name and fails, removing nothing", async () => {
    const dir = await folder();
    const from = join(dir, "clip.mp4");
    const to = join(dir, "Clip-variant.mp4");
    await writeFile(from, "mine");
    const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    await fs.link(from, to);
    hooks.fold = { name: from, variant: to };
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A different file takes the new name between the steps, and the old one too (as both
    // names fold to one entry on a case-insensitive volume).
    hooks.arrival = {
      onPath: "Clip-variant.mp4",
      run: async (path) => {
        await fs.writeFile(path, "theirs");
        await fs.writeFile(from, "theirs too");
      },
    };
    await expect(renameCaseOnly(from, to)).rejects.toMatchObject({ code: "EIO" });
    const names = await readdir(dir);
    const temp = names.find((n) => n.startsWith(".clip.mp4.case-"));
    expect(temp).toBeDefined();
    expect(await read(join(dir, temp!))).toBe("mine");
    expect(await read(to)).toBe("theirs");
  });
});

// The threat model (ADR 0033 "Placing a file"): a path's observed stranger identity is never
// authority to delete, and when ownership is uncertain the bytes are kept.
describe("a file that replaces one of our names mid-operation", () => {
  const actualFs = () => vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

  it("placeNoReplace keeps a file that replaced the source after placing", async () => {
    const { dir, from, to } = await pair();
    const fs = await actualFs();
    await writeFile(join(dir, "foreign"), "theirs");
    vi.spyOn(console, "error").mockImplementation(() => {});
    hooks.afterLink = { onPath: "Dest.mp4", run: () => fs.rename(join(dir, "foreign"), from) };
    expect(await placeNoReplace(from, to)).toBe("placed");
    expect(await read(to)).toBe("new recording");
    expect(await read(from)).toBe("theirs");
  });

  it.each([
    ["a different file", false],
    ["an unreadable name", true],
  ])("case-only: never removes %s at the new name after linking", async (_name, unreadable) => {
    const dir = await folder();
    const from = join(dir, "clip.mp4");
    const to = join(dir, "Clip-variant.mp4");
    await writeFile(from, "mine");
    const fs = await actualFs();
    await fs.link(from, to);
    hooks.fold = { name: from, variant: to };
    await writeFile(join(dir, "foreign"), "theirs");
    vi.spyOn(console, "error").mockImplementation(() => {});
    hooks.afterLink = {
      onPath: "Clip-variant.mp4",
      run: async (path) => {
        await fs.rename(join(dir, "foreign"), path);
        if (unreadable) hooks.failLstat.add(path);
      },
    };
    await renameCaseOnly(from, to).catch(() => {});
    expect(await read(to)).toBe("theirs");
    const names = await readdir(dir);
    const kept = names.filter((n) => n !== "Clip-variant.mp4");
    expect(await Promise.all(kept.map((n) => read(join(dir, n))))).toContain("mine");
  });

  it("case-only without hard links never renames onto the new name", async () => {
    const dir = await folder();
    const from = join(dir, "clip.mp4");
    const to = join(dir, "Clip-variant.mp4");
    await writeFile(from, "mine");
    const fs = await actualFs();
    await fs.link(from, to);
    hooks.fold = { name: from, variant: to };
    const foreign = join(dir, "foreign");
    await writeFile(foreign, "theirs");
    hooks.linkError = "EPERM";
    // Another process moves its file onto the new name just before any rename onto it.
    hooks.onRename = async (_source, target) => {
      if (target === to) await fs.rename(foreign, to);
    };
    expect(await renameCaseOnly(from, to)).toBe("placed");
    expect(await read(to)).toBe("mine");
    expect(await read(foreign)).toBe("theirs");
  });
});
