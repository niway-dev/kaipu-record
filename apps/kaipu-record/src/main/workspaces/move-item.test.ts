import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { setStagingResolver } from "../library/atomic-write";
import { sha256FileBase64 } from "../library/content-hash";
import { DragLedger } from "../library/drag-ledger";
import { ItemMovedError, withItemLock } from "../library/item-lock";
import { LibraryVault } from "../library/library-vault";
import { VaultTagRepository } from "../library/tag-repository";
import type { Tag } from "@kaipu/domain/constants";
import {
  healMoves,
  MOVE_STEPS,
  moveItem,
  SimulatedCrash,
  type MoveJournal,
  type MoverDeps,
  type MoveSide,
  type MoveStep,
} from "./move-item";

/** Records the files created and the renames made, to see what a synced folder is shown. */
const seen = vi.hoisted(() => ({
  created: [] as string[],
  renames: [] as { from: string; to: string }[],
}));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  const writing = /^(w|wx|a|ax|r\+|w\+)$/;
  return {
    ...actual,
    open: async (path: string, flags?: string, ...rest: unknown[]) => {
      if (typeof flags === "string" && writing.test(flags)) seen.created.push(String(path));
      return (actual.open as (...args: unknown[]) => Promise<unknown>)(path, flags, ...rest);
    },
    rename: async (from: string, to: string) => {
      seen.renames.push({ from: String(from), to: String(to) });
      return actual.rename(from, to);
    },
  };
});

let root: string;
let src: MoveSide;
let dst: MoveSide;
let journalDir: string;

const exdev = async (): Promise<void> => {
  throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
};

function deps(extra: Partial<MoverDeps> = {}): MoverDeps {
  return { journalDir, deviceId: () => "d-test", ...extra };
}

const heal = (extra: Partial<Parameters<typeof healMoves>[0]> = {}) =>
  healMoves({ journalDir, resolve: async (side) => side.directory, ...extra });

interface Seeded {
  id: string;
  assetId: string;
  media: Buffer;
  webcam: Buffer;
}

/** A recording with every file an item owns today, and two tags. */
async function seedItem(dir: string, id = "Demo", options: { tags?: string[] } = {}) {
  const vault = new LibraryVault(dir);
  const repo = new VaultTagRepository(
    () => vault,
    () => "d-src",
  );
  const tags: Tag[] = [];
  for (const name of options.tags ?? ["Client X", "Draft"])
    tags.push(await repo.create(name, "amber"));
  const media = randomBytes(64 * 1024);
  const webcam = randomBytes(16 * 1024);
  await writeFile(join(dir, `${id}.mp4`), media);
  const info = await stat(join(dir, `${id}.mp4`));
  const assetId = `asset-${id}`;
  const meta = join(dir, ".kaipu");
  await mkdir(join(meta, `${id}.assets`), { recursive: true });
  await writeFile(
    join(meta, `${id}.json`),
    JSON.stringify({
      sidecarVersion: 2,
      assetId,
      title: "Demo take",
      createdAt: 1_700_000_000_000,
      derivedFromAssetId: null,
      tagIds: tags.map((t) => t.id),
      tagNames: tags.map((t) => t.name),
    }),
  );
  await writeFile(join(meta, `${id}.jpg`), "thumb");
  await writeFile(join(meta, `${id}.cursor.json`), "[]");
  await writeFile(join(meta, `${id}.edit.json`), '{"scene":1}');
  await writeFile(
    join(meta, `${id}.edit.meta.json`),
    JSON.stringify({
      sourceSizeBytes: info.size,
      sourceMtimeMs: info.mtimeMs,
      assetIds: ["slide"],
      savedAt: 1,
      exportedSavedAt: null,
    }),
  );
  await writeFile(join(meta, `${id}.canvas.json`), '{"items":[]}');
  await writeFile(join(meta, `${id}.text.json`), '{"schemaVersion":1,"assets":{}}');
  await writeFile(join(meta, `${id}.transcript.json`), '{"schemaVersion":1,"segments":[]}');
  await writeFile(join(meta, `${id}.assets`, "slide.png"), "png");
  await writeFile(join(meta, `${id}.webcam.mp4`), webcam);
  return { id, assetId, media, webcam } satisfies Seeded;
}

async function filesOf(dir: string, id: string): Promise<string[]> {
  const all = [
    ...(await readdir(dir)).filter((n) => n.startsWith(id)),
    ...(await readdir(join(dir, ".kaipu")).catch(() => [])).filter((n) => n.startsWith(id)),
  ];
  return all.sort();
}

/** Every listed copy of `assetId` across both workspaces. */
async function copiesOf(assetId: string): Promise<{ dir: string; id: string }[]> {
  const out: { dir: string; id: string }[] = [];
  for (const side of [src, dst]) {
    for (const item of await new LibraryVault(side.directory).list()) {
      if (item.assetId === assetId) out.push({ dir: side.directory, id: item.id });
    }
  }
  return out;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kaipu-move-"));
  src = { workspaceId: "ws-src", directory: join(root, "src") };
  dst = { workspaceId: "ws-dst", directory: join(root, "dst") };
  journalDir = join(root, "userData", "workspace-moves");
  await mkdir(src.directory);
  await mkdir(dst.directory);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("moveItem — same volume", () => {
  it("links the media and moves every file of the item, keeping its identity", async () => {
    const item = await seedItem(src.directory);
    const outcome = await moveItem({ source: src, target: dst, id: item.id }, deps());
    expect(outcome).toEqual({ ok: true, id: "Demo", newId: "Demo", mode: "linked" });

    expect(await filesOf(src.directory, "Demo")).toEqual([]);
    expect(await filesOf(dst.directory, "Demo")).toEqual([
      "Demo.assets",
      "Demo.canvas.json",
      "Demo.cursor.json",
      "Demo.edit.json",
      "Demo.edit.meta.json",
      "Demo.jpg",
      "Demo.json",
      "Demo.mp4",
      "Demo.text.json",
      "Demo.transcript.json",
      "Demo.webcam.mp4",
    ]);
    const moved = await new LibraryVault(dst.directory).describe("Demo");
    expect(moved?.assetId).toBe(item.assetId);
    expect(moved?.title).toBe("Demo take");
    expect(await readFile(join(dst.directory, "Demo.mp4"))).toEqual(item.media);
    expect(await readdir(journalDir)).toEqual([]);
  });

  it("stamps the linked file after the source name is gone, so the next transcript open does not re-hash", async () => {
    const item = await seedItem(src.directory);
    // The source has a cached hash, so the move can stamp the target without hashing.
    await new LibraryVault(src.directory).ensureContentHash(item.id);
    const outcome = await moveItem({ source: src, target: dst, id: item.id }, deps());
    expect(outcome).toMatchObject({ ok: true, mode: "linked" });
    // Unlinking the source name changes the shared inode's ctime; the stamp must match that.
    expect(await new LibraryVault(dst.directory).cachedContentHash("Demo")).toMatchObject({
      status: "hit",
    });
  });

  it("gives a colliding stem a suffix and never overwrites the item already there", async () => {
    const item = await seedItem(src.directory);
    await writeFile(join(dst.directory, "Demo.mp4"), "someone else");
    const outcome = await moveItem({ source: src, target: dst, id: item.id }, deps());
    expect(outcome).toMatchObject({ ok: true, newId: "Demo (2)" });
    expect(await readFile(join(dst.directory, "Demo.mp4"), "utf-8")).toBe("someone else");
    expect(await readFile(join(dst.directory, "Demo (2).mp4"))).toEqual(item.media);
    expect(await readFile(join(dst.directory, ".kaipu", "Demo (2).edit.json"), "utf-8")).toBe(
      '{"scene":1}',
    );
    expect((await new LibraryVault(dst.directory).describe("Demo (2)"))?.assetId).toBe(
      item.assetId,
    );
  });

  it("refuses when the target already holds the same item (a copied folder)", async () => {
    const item = await seedItem(src.directory);
    await seedItem(dst.directory, "Elsewhere");
    await writeFile(
      join(dst.directory, ".kaipu", "Elsewhere.json"),
      JSON.stringify({ sidecarVersion: 2, assetId: item.assetId }),
    );
    const outcome = await moveItem({ source: src, target: dst, id: item.id }, deps());
    expect(outcome).toEqual({ ok: false, id: "Demo", reason: "already-there" });
    expect(await filesOf(src.directory, "Demo")).toHaveLength(11);
  });

  it("refuses an id that holds another item now", async () => {
    await seedItem(src.directory);
    const outcome = await moveItem(
      { source: src, target: dst, id: "Demo", expectedAssetId: "someone-else" },
      deps(),
    );
    expect(outcome).toMatchObject({ ok: false, reason: "not-found" });
  });
});

describe("moveItem — across volumes (EXDEV)", () => {
  it("copies, verifies the sha256, places, then deletes the source; caches stay fresh", async () => {
    const item = await seedItem(src.directory);
    const outcome = await moveItem(
      { source: src, target: dst, id: item.id },
      deps({ fs: { link: exdev } }),
    );
    expect(outcome).toMatchObject({ ok: true, newId: "Demo", mode: "copied" });
    expect(await filesOf(src.directory, "Demo")).toEqual([]);
    expect(await readFile(join(dst.directory, "Demo.mp4"))).toEqual(item.media);
    expect(await readFile(join(dst.directory, ".kaipu", "Demo.webcam.mp4"))).toEqual(item.webcam);
    expect(await readFile(join(dst.directory, ".kaipu", "Demo.canvas.json"), "utf-8")).toBe(
      '{"items":[]}',
    );
    expect(await readFile(join(dst.directory, ".kaipu", "Demo.text.json"), "utf-8")).toBe(
      '{"schemaVersion":1,"assets":{}}',
    );
    expect(await readFile(join(dst.directory, ".kaipu", "Demo.transcript.json"), "utf-8")).toBe(
      '{"schemaVersion":1,"segments":[]}',
    );

    // The hash cache matches the new file, and the edit project is still fresh (decision 8).
    const moved = await new LibraryVault(dst.directory).describe("Demo");
    expect(moved?.contentSha256).toBe(await sha256FileBase64(join(dst.directory, "Demo.mp4")));
    const now = await stat(join(dst.directory, "Demo.mp4"));
    const meta = JSON.parse(
      await readFile(join(dst.directory, ".kaipu", "Demo.edit.meta.json"), "utf-8"),
    );
    expect(meta).toMatchObject({ sourceSizeBytes: now.size, sourceMtimeMs: now.mtimeMs });
    // No staging left behind.
    expect(await readdir(join(dst.directory, ".kaipu", "tmp")).catch(() => [])).toEqual([]);
  });

  it("a copy that keeps its mtime still gets the stamp of the new file, so it is not re-hashed", async () => {
    const item = await seedItem(src.directory);
    // A whole second, so restoring it through utimes reads back exactly.
    const kept = 1_700_000_000;
    await utimes(join(src.directory, "Demo.mp4"), kept, kept);
    const outcome = await moveItem(
      { source: src, target: dst, id: item.id },
      deps({
        fs: { link: exdev },
        hooks: {
          // The copy is made with a new mtime; put the source's back, as a tool that keeps it would.
          after: async (step) => {
            if (step !== "media-verified") return;
            const staged = join(dst.directory, ".kaipu", "tmp");
            for (const dir of await readdir(staged)) {
              await utimes(join(staged, dir, "Demo.mp4"), kept, kept);
            }
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true, mode: "copied" });
    const now = await stat(join(dst.directory, "Demo.mp4"));
    // The mtime is the one the source had, so the early return for "unchanged" is taken, and the
    // stamp was still rewritten for the new file (its own ctime and inode).
    expect(now.mtimeMs).toBe(kept * 1000);
    const vault = new LibraryVault(dst.directory);
    const sidecar = await vault.sidecar("Demo");
    expect(sidecar).toMatchObject({
      hashedSizeBytes: now.size,
      hashedMtimeMs: now.mtimeMs,
      hashedCtimeMs: now.ctimeMs,
      hashedIno: now.ino,
    });
    expect(await vault.cachedContentHash("Demo")).toMatchObject({ status: "hit" });
  });

  it("aborts on a checksum mismatch and leaves the source untouched", async () => {
    const item = await seedItem(src.directory);
    const before = await filesOf(src.directory, "Demo");
    const outcome = await moveItem(
      { source: src, target: dst, id: item.id },
      deps({
        fs: {
          link: exdev,
          sha256: async (path) =>
            path.includes(join(".kaipu", "tmp")) ? "corrupt" : sha256FileBase64(path),
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, id: "Demo", reason: "checksum-mismatch" });
    expect(await filesOf(src.directory, "Demo")).toEqual(before);
    expect(await readFile(join(src.directory, "Demo.mp4"))).toEqual(item.media);
    expect(await filesOf(dst.directory, "Demo")).toEqual([]);
    expect(await readdir(journalDir)).toEqual([]);
  });

  it("refuses when the target drive has no room", async () => {
    const item = await seedItem(src.directory);
    const outcome = await moveItem(
      { source: src, target: dst, id: item.id },
      deps({ fs: { link: exdev, freeBytes: async () => 1024 } }),
    );
    expect(outcome).toMatchObject({ ok: false, reason: "no-room" });
    expect(await filesOf(dst.directory, "Demo")).toEqual([]);
  });
});

describe("moveItem — a synced side (decision 15; NIW2-577): copy, verify at the final path, delete", () => {
  const noLink = (calls: string[]) => async (_from: string, to: string) => {
    calls.push(to);
    throw new Error("a synced workspace must never be hard-linked");
  };

  for (const synced of ["source", "target", "both"] as const) {
    it(`never hard-links when the ${synced} is synced, though both are on one device`, async () => {
      const item = await seedItem(src.directory);
      const source: MoveSide =
        synced !== "target" ? { ...src, scratch: join(root, "scratch", "src") } : src;
      const target: MoveSide =
        synced !== "source" ? { ...dst, scratch: join(root, "scratch", "dst") } : dst;
      const links: string[] = [];
      const hashed: string[] = [];
      const outcome = await moveItem(
        { source, target, id: item.id },
        deps({
          fs: {
            link: noLink(links),
            sha256: async (path) => {
              hashed.push(path);
              return sha256FileBase64(path);
            },
          },
        }),
      );
      expect(outcome).toMatchObject({ ok: true, newId: "Demo", mode: "copied" });
      expect(links).toEqual([]);
      // Verified where it now lives, not only in staging.
      expect(hashed).toContain(join(dst.directory, "Demo.mp4"));
      expect((await stat(join(dst.directory, "Demo.mp4"))).nlink).toBe(1);
      expect((await stat(join(dst.directory, ".kaipu", "Demo.webcam.mp4"))).nlink).toBe(1);
      expect(await readFile(join(dst.directory, "Demo.mp4"))).toEqual(item.media);
      expect(await filesOf(src.directory, "Demo")).toEqual([]);
      expect(await readdir(journalDir)).toEqual([]);
    });
  }

  it("refuses an evicted source before reading a byte of it (the renderer's list may be old)", async () => {
    const item = await seedItem(src.directory);
    const source: MoveSide = { ...src, scratch: join(root, "scratch", "src") };
    const read: string[] = [];
    const before = await filesOf(src.directory, "Demo");
    const outcome = await moveItem(
      { source, target: dst, id: item.id },
      deps({
        fs: {
          evicted: async (paths) => new Set(paths.filter((p) => p.endsWith("Demo.mp4"))),
          sha256: async (path) => {
            read.push(path);
            return sha256FileBase64(path);
          },
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, id: "Demo", reason: "evicted" });
    expect(read).toEqual([]);
    expect(await filesOf(dst.directory, "Demo")).toEqual([]);
    expect(await filesOf(src.directory, "Demo")).toEqual(before);
  });

  it("refuses when only a companion or an asset is evicted, before anything is written", async () => {
    for (const [index, suffix] of [".jpg", ".transcript.json", ".assets/slide.png"].entries()) {
      const item = await seedItem(src.directory, `Clip${index}`, {
        tags: index === 0 ? undefined : [],
      });
      await writeFile(join(src.directory, ".kaipu", `${item.id}.transcript.json`), "{}");
      await writeFile(join(src.directory, ".kaipu", `${item.id}.assets`, "slide.png"), "png");
      const source: MoveSide = { ...src, scratch: join(root, "scratch", "src") };
      const read: string[] = [];
      const outcome = await moveItem(
        { source, target: dst, id: item.id },
        deps({
          fs: {
            evicted: async (paths) =>
              new Set(paths.filter((p) => p.endsWith(`${item.id}${suffix}`))),
            sha256: async (path) => {
              read.push(path);
              return sha256FileBase64(path);
            },
          },
        }),
      );
      expect(outcome).toEqual({ ok: false, id: item.id, reason: "evicted" });
      expect(read).toEqual([]);
      expect(await readdir(journalDir).catch(() => [])).toEqual([]); // no journal was written
      expect(await filesOf(dst.directory, item.id)).toEqual([]);
    }
  });

  it("refuses as io, not evicted, when the assets folder cannot be listed", async () => {
    const item = await seedItem(src.directory);
    // A file where the folder should be: readdir fails with ENOTDIR, not ENOENT.
    await rm(join(src.directory, ".kaipu", `${item.id}.assets`), { recursive: true, force: true });
    await writeFile(join(src.directory, ".kaipu", `${item.id}.assets`), "not a folder");
    const source: MoveSide = { ...src, scratch: join(root, "scratch", "src") };
    const read: string[] = [];
    const outcome = await moveItem(
      { source, target: dst, id: item.id },
      deps({
        fs: {
          evicted: async () => new Set(),
          sha256: async (path) => {
            read.push(path);
            return sha256FileBase64(path);
          },
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, id: item.id, reason: "io" });
    expect(read).toEqual([]);
    expect(await filesOf(dst.directory, item.id)).toEqual([]);
  });

  it("stages a synced target's copy in its scratch folder, never inside the synced folder", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const stagedIn: string[] = [];
    // Observed inside the hook, asserted outside it: `moveItem` turns an error thrown in a hook
    // into a refusal, so an `expect` there could never fail this test.
    let inFolderDuringCopy: string[] | null = null;
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        hooks: {
          after: async (step) => {
            if (step === "media-copied") {
              stagedIn.push(...(await readdir(join(root, "scratch", "dst", "tmp"))));
              inFolderDuringCopy = await readdir(join(dst.directory, ".kaipu", "tmp")).catch(
                () => [],
              );
            }
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true, id: item.id });
    expect(stagedIn).toHaveLength(1);
    expect(inFolderDuringCopy).toEqual([]);
    expect(await readdir(join(dst.directory, ".kaipu", "tmp")).catch(() => [])).toEqual([]);
  });

  it("a source that changed after it was copied is kept, and the move is left for review", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        hooks: {
          // A provider brings a newer version of the source in after the copy was verified.
          after: async (step) => {
            if (step === "committed") await appendFile(join(src.directory, "Demo.mp4"), "newer");
          },
        },
      }),
    );
    // The item is in the target, and the outcome says the original stayed: never a plain "moved".
    expect(outcome).toMatchObject({ ok: true, id: "Demo", keptOriginal: "source-changed" });
    expect((await stat(join(src.directory, "Demo.mp4"))).size).toBe(item.media.length + 5);
    expect(
      await readFile(join(target.directory, `${(outcome as { newId: string }).newId}.mp4`)),
    ).toEqual(item.media);
    const journals = await readdir(journalDir);
    expect(journals).toHaveLength(1);
    expect(JSON.parse(await readFile(join(journalDir, journals[0]!), "utf-8"))).toMatchObject({
      quarantined: "source media changed after the move committed",
    });
  });

  it("a source edit project saved after the copy is kept with its media, and the move is left for review", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        hooks: {
          // Another Mac saves the edit project into the synced source folder during the copy.
          after: async (step) => {
            if (step === "committed") {
              await writeFile(join(src.directory, ".kaipu", "Demo.edit.json"), '{"scene":2}');
            }
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true, id: "Demo", keptOriginal: "source-changed" });
    expect(await readFile(join(src.directory, "Demo.mp4"))).toEqual(item.media);
    expect(await readFile(join(src.directory, ".kaipu", "Demo.edit.json"), "utf-8")).toBe(
      '{"scene":2}',
    );
    const journals = await readdir(journalDir);
    expect(JSON.parse(await readFile(join(journalDir, journals[0]!), "utf-8"))).toMatchObject({
      quarantined: "source edit project changed after the move committed",
    });
  });

  it("a source record that now belongs to another item is not deleted with the media", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        hooks: {
          after: async (step) => {
            if (step === "committed") {
              const path = join(src.directory, ".kaipu", "Demo.json");
              const record = JSON.parse(await readFile(path, "utf-8"));
              await writeFile(path, JSON.stringify({ ...record, assetId: "someone-else" }));
            }
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true, keptOriginal: "source-changed" });
    expect(await readFile(join(src.directory, "Demo.mp4"))).toEqual(item.media);
  });

  it("a source whose only difference is its mtime, with the same bytes, is removed as normal", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        hooks: {
          // A provider touches the file's mtime after the copy was verified; the bytes are the same.
          after: async (step) => {
            if (step === "committed") {
              const later = new Date(Date.now() + 60_000);
              await utimes(join(src.directory, "Demo.mp4"), later, later);
            }
          },
        },
      }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome).not.toHaveProperty("keptOriginal");
    expect(await filesOf(src.directory, "Demo")).toEqual([]);
    expect(await readdir(journalDir).catch(() => [])).toEqual([]);
  });

  it("a source whose mtime changed and whose bytes differ is kept", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        hooks: {
          after: async (step) => {
            if (step === "committed") {
              // Same size, different bytes, newer mtime.
              const path = join(src.directory, "Demo.mp4");
              await writeFile(path, randomBytes(item.media.length));
              const later = new Date(Date.now() + 60_000);
              await utimes(path, later, later);
            }
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true, keptOriginal: "source-changed" });
    expect((await stat(join(src.directory, "Demo.mp4"))).size).toBe(item.media.length);
  });

  it("an evicted source that looks changed is kept without reading it", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const source: MoveSide = { ...src, scratch: join(root, "scratch", "src") };
    let committed = false;
    const hashed: string[] = [];
    const outcome = await moveItem(
      { source, target, id: item.id },
      deps({
        fs: {
          evicted: async (paths) =>
            new Set(committed ? paths.filter((p) => p.endsWith("Demo.mp4")) : []),
          sha256: async (path) => {
            if (committed) hashed.push(path);
            return sha256FileBase64(path);
          },
        },
        hooks: {
          after: async (step) => {
            if (step === "committed") {
              committed = true;
              const later = new Date(Date.now() + 60_000);
              await utimes(join(src.directory, "Demo.mp4"), later, later);
            }
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: true, keptOriginal: "source-changed" });
    expect(hashed).toEqual([]); // nothing was hashed after the commit: reading it would download it
    expect(await readFile(join(src.directory, "Demo.mp4"))).toEqual(item.media);
  });

  it("refuses with no-room when the staging volume of a synced target is full, not the target's", async () => {
    const item = await seedItem(src.directory);
    const scratch = join(root, "scratch", "dst");
    const target: MoveSide = { ...dst, scratch };
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        fs: { freeBytes: async (directory) => (directory === scratch ? 1024 : 1e12) },
      }),
    );
    expect(outcome).toMatchObject({ ok: false, reason: "no-room" });
    expect(await filesOf(dst.directory, "Demo")).toEqual([]);
    expect(await readFile(join(src.directory, "Demo.mp4"))).toEqual(item.media);
  });

  it("a failing re-hash at the final path leaves no stray media in the target", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        fs: {
          sha256: async (path) => {
            if (path === join(dst.directory, "Demo.mp4")) {
              throw Object.assign(new Error("read failed"), { code: "EIO" });
            }
            return sha256FileBase64(path);
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ ok: false, reason: "io" });
    expect(await filesOf(dst.directory, "Demo")).toEqual([]);
    expect(await readFile(join(src.directory, "Demo.mp4"))).toEqual(item.media);
    expect(await readdir(journalDir)).toEqual([]);
  });

  it("a mismatch at the final path rolls the target back and leaves the source intact", async () => {
    const item = await seedItem(src.directory);
    const before = await filesOf(src.directory, "Demo");
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        fs: {
          sha256: async (path) =>
            path === join(dst.directory, "Demo.mp4") ? "corrupt" : sha256FileBase64(path),
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, id: "Demo", reason: "checksum-mismatch" });
    expect(await filesOf(src.directory, "Demo")).toEqual(before);
    expect(await filesOf(dst.directory, "Demo")).toEqual([]);
    expect(await readdir(journalDir)).toEqual([]);
  });

  it("a rollback leaves a file that is not the one the move placed (a foreign file at the final name)", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const finalPath = join(dst.directory, "Demo.mp4");
    let calls = 0;
    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({
        fs: {
          sha256: async (path) => {
            if (path !== finalPath) return sha256FileBase64(path);
            // The placed file is replaced by another one (a provider rewrote it, or someone put
            // one there) before the check that fails; the rollback must not remove that file.
            calls += 1;
            await rm(finalPath);
            await writeFile(finalPath, "someone else's file");
            return "corrupt";
          },
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, id: "Demo", reason: "checksum-mismatch" });
    expect(calls).toBe(1);
    expect(await readFile(finalPath, "utf-8")).toBe("someone else's file");
    expect(await readFile(join(src.directory, "Demo.mp4"))).toEqual(item.media);
  });

  it("healing asks once per workspace, and not at all for the target of an entry whose source is away", async () => {
    const crash = deps({
      hooks: {
        after: (at) => {
          if (at === "media-placed") throw new SimulatedCrash(at);
        },
      },
    });
    for (const id of ["Demo", "Other"]) {
      await seedItem(src.directory, id, { tags: [] });
      await expect(moveItem({ source: src, target: dst, id }, crash)).rejects.toBeInstanceOf(
        SimulatedCrash,
      );
    }
    // The target's provider does not answer: each answer would cost the availability bound.
    const asked: string[] = [];
    const report = await heal({
      resolve: async (side) => {
        asked.push(side.workspaceId);
        return side.workspaceId === dst.workspaceId ? null : side.directory;
      },
    });
    expect(report).toMatchObject({ healed: 0, waiting: 2 });
    expect(asked.filter((w) => w === dst.workspaceId)).toHaveLength(1);
  });

  it("healing does not ask for the target while the source is not connected", async () => {
    const item = await seedItem(src.directory);
    await expect(
      moveItem(
        { source: src, target: dst, id: item.id },
        deps({
          hooks: {
            after: (at) => {
              if (at === "media-placed") throw new SimulatedCrash(at);
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    const asked: string[] = [];
    await heal({
      resolve: async (side) => {
        asked.push(side.workspaceId);
        return side.workspaceId === src.workspaceId ? null : side.directory;
      },
    });
    expect(asked).toEqual([src.workspaceId]);
  });

  it("healing waits, without reading, while the target copy is offloaded on a synced side", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    await expect(
      moveItem(
        { source: src, target, id: item.id },
        deps({
          hooks: {
            after: (at) => {
              if (at === "media-placed") throw new SimulatedCrash(at);
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SimulatedCrash);

    // The copy has a new mtime, so a heal would hash it: the provider has offloaded it since.
    const sha256 = vi.fn(async (path: string) => sha256FileBase64(path));
    const offloaded = join(dst.directory, "Demo.mp4");
    const report = await heal({
      fs: { sha256, evicted: async (paths) => new Set(paths.filter((p) => p === offloaded)) },
    });
    expect(report).toMatchObject({ healed: 0, waiting: 1 });
    expect(sha256).not.toHaveBeenCalled();
    expect(await readdir(journalDir)).toHaveLength(1);

    // Downloaded: the same heal finishes the move.
    expect(await heal({ fs: { evicted: async () => new Set() } })).toMatchObject({
      healed: 1,
      waiting: 0,
    });
  });

  it("a crash after the staged copy is verified heals from the scratch folder", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    await expect(
      moveItem(
        { source: src, target, id: item.id },
        deps({
          hooks: {
            after: (at) => {
              if (at === "media-verified") throw new SimulatedCrash(at);
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    await rm(join(src.directory, "Demo.mp4"));
    await heal();
    expect(await copiesOf(item.assetId)).toEqual([{ dir: dst.directory, id: "Demo" }]);
    expect(await readFile(join(dst.directory, "Demo.mp4"))).toEqual(item.media);
    expect(await readdir(join(root, "scratch", "dst", "tmp")).catch(() => [])).toEqual([]);
  });
});

describe("moveItem — a synced target never sees a temp file (NIW2-912)", () => {
  const isTemp = (path: string): boolean => /\.(tmp|part)$/.test(path);
  const insideTarget = (path: string): boolean => path.startsWith(dst.directory + sep);
  const tempsInTarget = (): string[] => [
    ...seen.created.filter((path) => insideTarget(path) && isTemp(path)),
    ...seen.renames
      .filter((r) => insideTarget(r.from) && insideTarget(r.to) && isTemp(r.from))
      .map((r) => r.from),
  ];

  afterEach(() => setStagingResolver(() => null));

  it("the target's tag registry, sidecar and freshness stamp are staged in its scratch folder", async () => {
    const item = await seedItem(src.directory);
    const scratch = join(root, "scratch", "dst");
    const target: MoveSide = { ...dst, scratch };
    setStagingResolver((path) => (insideTarget(path) ? join(scratch, "tmp") : null));
    seen.created = [];
    seen.renames = [];

    const outcome = await moveItem(
      { source: src, target, id: item.id },
      deps({ fs: { link: exdev } }),
    );

    expect(outcome).toMatchObject({ ok: true, mode: "copied" });
    expect(tempsInTarget()).toEqual([]);
    expect(
      seen.renames.filter((r) => r.from.startsWith(join(scratch, "tmp")) && insideTarget(r.to))
        .length,
    ).toBeGreaterThanOrEqual(3);
    const stamped = JSON.parse(
      await readFile(join(dst.directory, ".kaipu", "Demo.edit.meta.json"), "utf-8"),
    );
    const now = await stat(join(dst.directory, "Demo.mp4"));
    expect(stamped).toMatchObject({ sourceSizeBytes: now.size, sourceMtimeMs: now.mtimeMs });
    expect(await readdir(join(dst.directory, ".kaipu"))).toContain("tags.json");
  });

  it("control: without staging, the same move writes its temp files beside the target's", async () => {
    const item = await seedItem(src.directory);
    seen.created = [];
    seen.renames = [];

    await moveItem({ source: src, target: dst, id: item.id }, deps({ fs: { link: exdev } }));

    expect(tempsInTarget().length).toBeGreaterThan(0);
  });
});

describe("moveItem — refusals that touch nothing", () => {
  it("refuses an item whose sidecar cannot be read (metadataIssue)", async () => {
    await seedItem(src.directory);
    await writeFile(join(src.directory, ".kaipu", "Demo.json"), "{ truncated");
    const outcome = await moveItem({ source: src, target: dst, id: "Demo" }, deps());
    expect(outcome).toMatchObject({ ok: false, reason: "metadata-issue" });
    expect(await readFile(join(src.directory, ".kaipu", "Demo.json"), "utf-8")).toBe("{ truncated");
    expect(await filesOf(dst.directory, "Demo")).toEqual([]);
  });

  it("refuses a disconnected destination", async () => {
    await seedItem(src.directory);
    const gone = { workspaceId: "ws-gone", directory: join(root, "unplugged") };
    const outcome = await moveItem({ source: src, target: gone, id: "Demo" }, deps());
    expect(outcome).toMatchObject({ ok: false, reason: "target-unavailable" });
    await expect(stat(gone.directory)).rejects.toThrow();
  });

  it("refuses when the target's tag registry cannot be trusted", async () => {
    await seedItem(src.directory);
    await mkdir(join(dst.directory, ".kaipu"), { recursive: true });
    await writeFile(join(dst.directory, ".kaipu", "tags.json"), "not json");
    const outcome = await moveItem({ source: src, target: dst, id: "Demo" }, deps());
    expect(outcome).toMatchObject({ ok: false, reason: "tags-unreadable" });
    expect(await filesOf(dst.directory, "Demo")).toEqual([]);
  });

  it("refuses an item dragged under 10 s ago, and removes older drag copies first", async () => {
    await seedItem(src.directory);
    let now = 1_000_000;
    const ledger = new DragLedger(() => now);
    const dragDir = join(src.directory, ".kaipu", "drag", "u1");
    await mkdir(dragDir, { recursive: true });
    await writeFile(join(dragDir, "Demo take.mp4"), "bytes");
    ledger.record({ workspaceId: src.workspaceId, itemId: "Demo", dir: dragDir });

    now += 5_000;
    const early = await moveItem(
      { source: src, target: dst, id: "Demo" },
      deps({ dragLedger: ledger }),
    );
    expect(early).toMatchObject({ ok: false, reason: "dragged-just-now" });

    now += 10_000;
    const later = await moveItem(
      { source: src, target: dst, id: "Demo" },
      deps({ dragLedger: ledger }),
    );
    expect(later).toMatchObject({ ok: true });
    await expect(stat(dragDir)).rejects.toThrow();
  });
});

describe("moveItem — tags", () => {
  it("maps tags by slug to the target's, and creates the missing ones with name and color", async () => {
    const target = new VaultTagRepository(
      () => new LibraryVault(dst.directory),
      () => "d-dst",
    );
    const existing = await target.create("client x", "lime");
    const item = await seedItem(src.directory);
    await moveItem({ source: src, target: dst, id: item.id }, deps());

    const live = await target.liveTags();
    const draft = live.find((t) => t.slug === "draft");
    expect(draft).toMatchObject({ name: "Draft", color: "amber" });
    expect(live.filter((t) => t.slug === existing.slug)).toHaveLength(1);
    const moved = JSON.parse(await readFile(join(dst.directory, ".kaipu", "Demo.json"), "utf-8"));
    expect(moved.tagIds).toEqual([existing.id, draft!.id]);
    expect(moved.tagNames).toEqual(["client x", "Draft"]);
  });
});

describe("the item lock", () => {
  it("waits for a writer in flight; a write queued behind the move finds the item gone", async () => {
    await seedItem(src.directory);
    const order: string[] = [];
    let release!: () => void;
    const writer = withItemLock(src.workspaceId, "Demo", async () => {
      order.push("save-start");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("save-end");
    });
    const move = moveItem({ source: src, target: dst, id: "Demo" }, deps()).then((outcome) => {
      order.push("move-done");
      return outcome;
    });
    // A save the editor queues after the move asked for the lock.
    const late = withItemLock(src.workspaceId, "Demo", async () => {
      if (!(await new LibraryVault(src.directory).hasMedia("Demo"))) {
        throw new ItemMovedError("Demo");
      }
      order.push("late-wrote");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["save-start"]);
    release();
    await writer;
    expect(await move).toMatchObject({ ok: true });
    await expect(late).rejects.toBeInstanceOf(ItemMovedError);
    expect(order).toEqual(["save-start", "save-end", "move-done"]);
    expect(await filesOf(src.directory, "Demo")).toEqual([]);
  });
});

describe("crash at each step, then healing", () => {
  for (const mode of ["linked", "copied"] as const) {
    for (const step of MOVE_STEPS) {
      if (mode === "linked" && (step === "media-copied" || step === "media-verified")) continue;
      it(`${mode}: after ${step} leaves exactly one listed, intact copy`, async () => {
        const item = await seedItem(src.directory);
        const crash = (at: MoveStep) => {
          if (at === step) throw new SimulatedCrash(at);
        };
        await expect(
          moveItem(
            { source: src, target: dst, id: item.id },
            deps({
              hooks: { after: crash },
              ...(mode === "copied" ? { fs: { link: exdev } } : {}),
            }),
          ),
        ).rejects.toBeInstanceOf(SimulatedCrash);

        const report = await heal();
        expect(report.quarantined).toEqual([]);
        expect(await readdir(journalDir)).toEqual([]);
        const copies = await copiesOf(item.assetId);
        expect(copies).toHaveLength(1);
        const [only] = copies;
        expect(await readFile(join(only!.dir, `${only!.id}.mp4`))).toEqual(item.media);
        // The transcript stays with the surviving copy, rolled back or forward.
        expect(
          await readFile(join(only!.dir, ".kaipu", `${only!.id}.transcript.json`), "utf-8"),
        ).toBe('{"schemaVersion":1,"segments":[]}');
        // Rolled back or forward, the other side holds no file of the item.
        const other = only!.dir === src.directory ? dst.directory : src.directory;
        expect(await filesOf(other, "Demo")).toEqual([]);
      });
    }
  }

  it("rolls forward when the app died between the media placement and the journal update", async () => {
    const item = await seedItem(src.directory);
    await expect(
      moveItem(
        { source: src, target: dst, id: item.id },
        deps({
          hooks: {
            after: (at) => {
              if (at === "media-placed") throw new SimulatedCrash(at);
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    const [entry] = await readdir(journalDir);
    const journal = JSON.parse(await readFile(join(journalDir, entry!), "utf-8")) as MoveJournal;
    expect(journal.phase).toBe("copying");
    await heal();
    expect(await copiesOf(item.assetId)).toEqual([{ dir: dst.directory, id: "Demo" }]);
  });
});

describe("healing never deletes the only copy", () => {
  async function crashAt(step: MoveStep, link = exdev): Promise<MoveJournal> {
    await expect(
      moveItem(
        { source: src, target: dst, id: "Demo" },
        deps({
          fs: { link },
          hooks: {
            after: (at) => {
              if (at === step) throw new SimulatedCrash(at);
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    const [entry] = await readdir(journalDir);
    return JSON.parse(await readFile(join(journalDir, entry!), "utf-8")) as MoveJournal;
  }

  it("cleans a truncated target next to an intact source", async () => {
    const item = await seedItem(src.directory);
    await crashAt("companions-copied");
    await writeFile(join(dst.directory, "Demo.mp4"), item.media.subarray(0, 100));
    await heal();
    expect(await copiesOf(item.assetId)).toEqual([{ dir: src.directory, id: "Demo" }]);
    expect(await filesOf(dst.directory, "Demo")).toEqual([]);
  });

  it("never reads a transcript file as the record of an interrupted reservation", async () => {
    const item = await seedItem(src.directory);
    await crashAt("journal-written");
    // A file that merely names the same asset must not be taken for a record without media.
    const stray = join(dst.directory, ".kaipu", "Stray.transcript.json");
    await mkdir(join(dst.directory, ".kaipu"), { recursive: true });
    await writeFile(stray, JSON.stringify({ assetId: item.assetId, segments: [] }));
    await heal();
    expect(await readFile(stray, "utf-8")).toContain(item.assetId);
    expect(await copiesOf(item.assetId)).toEqual([{ dir: src.directory, id: "Demo" }]);
  });

  it("keeps an unverifiable target when the source is gone, and surfaces the entry", async () => {
    const item = await seedItem(src.directory);
    await crashAt("companions-copied");
    await writeFile(join(dst.directory, "Demo.mp4"), item.media.subarray(0, 100));
    await rm(join(src.directory, "Demo.mp4"));
    const report = await heal();
    expect(report.quarantined).toHaveLength(1);
    expect(await readFile(join(dst.directory, "Demo.mp4"))).toEqual(item.media.subarray(0, 100));
    // A second run does not act on a quarantined entry either.
    expect((await heal()).quarantined).toHaveLength(1);
    expect(await readdir(journalDir)).toHaveLength(1);
  });

  it("places a verified copy left in staging when neither side has the media", async () => {
    const item = await seedItem(src.directory);
    await crashAt("media-verified");
    await rm(join(src.directory, "Demo.mp4"));
    await heal();
    expect(await copiesOf(item.assetId)).toEqual([{ dir: dst.directory, id: "Demo" }]);
    expect(await readFile(join(dst.directory, "Demo.mp4"))).toEqual(item.media);
  });

  it("rebuilds a missing target record from the source record when rolling forward", async () => {
    const item = await seedItem(src.directory);
    await crashAt("media-placed");
    await rm(join(dst.directory, ".kaipu", "Demo.json"));
    await heal();
    const moved = await new LibraryVault(dst.directory).describe("Demo");
    expect(moved?.assetId).toBe(item.assetId);
    expect(await filesOf(src.directory, "Demo")).toEqual([]);
  });

  it("waits while a workspace is not connected", async () => {
    await seedItem(src.directory);
    await crashAt("media-placed");
    const report = await heal({
      resolve: async (side) => (side.workspaceId === dst.workspaceId ? null : side.directory),
    });
    expect(report).toMatchObject({ healed: 0, waiting: 1 });
    expect(await readdir(journalDir)).toHaveLength(1);
  });
});

// chmod-based failures need an OS that enforces directory permissions (not Windows, not root).
const enforcesPermissions = process.platform !== "win32" && process.getuid?.() !== 0;

describe("review findings on a move (PR 479)", () => {
  async function crashAfterPlacement(): Promise<void> {
    await expect(
      moveItem(
        { source: src, target: dst, id: "Demo" },
        deps({
          hooks: {
            after: (at) => {
              if (at === "media-placed") throw new SimulatedCrash(at);
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SimulatedCrash);
  }

  it("refuses an id that is not a plain stem, and never touches a file outside the workspace", async () => {
    await seedItem(src.directory);
    const outside = join(root, "outside.mp4");
    await writeFile(outside, "not yours");
    for (const id of ["../outside", "..", "a/b", ".hidden", ""]) {
      const outcome = await moveItem({ source: src, target: dst, id }, deps());
      expect(outcome).toEqual({ ok: false, id, reason: "not-found" });
    }
    expect(await readFile(outside, "utf-8")).toBe("not yours");
    // No record was minted outside the vault either.
    await expect(stat(join(root, "outside.json"))).rejects.toThrow();
    expect(await readdir(journalDir).catch(() => [])).toEqual([]);
  });

  it("healing leaves a different item that took the source stem alone", async () => {
    const item = await seedItem(src.directory);
    await crashAfterPlacement();
    // The stem is free again in the source (the app was closed, the item deleted) and a new
    // recording takes it before the roll-forward gets to run.
    await rm(join(src.directory, "Demo.mp4"));
    for (const name of await readdir(join(src.directory, ".kaipu"))) {
      if (name.startsWith("Demo")) {
        await rm(join(src.directory, ".kaipu", name), { recursive: true, force: true });
      }
    }
    await writeFile(join(src.directory, "Demo.mp4"), "a newer recording");
    await writeFile(
      join(src.directory, ".kaipu", "Demo.json"),
      JSON.stringify({ sidecarVersion: 2, assetId: "someone-else", title: "New" }),
    );

    const report = await heal();
    expect(report.quarantined).toEqual([]);
    expect(await readFile(join(src.directory, "Demo.mp4"), "utf-8")).toBe("a newer recording");
    expect(
      JSON.parse(await readFile(join(src.directory, ".kaipu", "Demo.json"), "utf-8")).assetId,
    ).toBe("someone-else");
    // The moved item is whole in the target, and the journal is done.
    expect((await new LibraryVault(dst.directory).describe("Demo"))?.assetId).toBe(item.assetId);
    expect(await readdir(journalDir)).toEqual([]);
  });

  it("healing keeps and surfaces a source whose edit project changed after the commit", async () => {
    const item = await seedItem(src.directory);
    await crashAfterPlacement();
    // The target was unplugged at the next start; the user kept editing the item in the source.
    const edited = join(src.directory, ".kaipu", "Demo.edit.json");
    await rm(edited);
    await writeFile(edited, '{"scene":2,"newer":true}');

    const report = await heal();
    expect(report.healed).toBe(0);
    expect(report.quarantined).toHaveLength(1);
    expect(await readFile(edited, "utf-8")).toBe('{"scene":2,"newer":true}');
    expect(await readFile(join(src.directory, "Demo.mp4"))).toEqual(item.media);
    expect(await readdir(journalDir)).toHaveLength(1);
  });

  it("healing keeps and surfaces a source whose media changed after the commit", async () => {
    await seedItem(src.directory);
    await crashAfterPlacement();
    await rm(join(src.directory, "Demo.mp4"));
    await writeFile(join(src.directory, "Demo.mp4"), "overwritten screenshot, longer than before");

    const report = await heal();
    expect(report.quarantined).toHaveLength(1);
    expect(await readFile(join(src.directory, "Demo.mp4"), "utf-8")).toBe(
      "overwritten screenshot, longer than before",
    );
    expect(await stat(join(src.directory, ".kaipu", "Demo.json"))).toBeTruthy();
  });

  it.skipIf(!enforcesPermissions)(
    "healing keeps the journal and the source record when the source media cannot be removed",
    async () => {
      await seedItem(src.directory);
      // A copy, so the source is a separate file; then the source folder refuses deletions.
      await expect(
        moveItem(
          { source: src, target: dst, id: "Demo" },
          deps({
            fs: { link: exdev },
            hooks: {
              after: (at) => {
                if (at === "media-placed") throw new SimulatedCrash(at);
              },
            },
          }),
        ),
      ).rejects.toBeInstanceOf(SimulatedCrash);
      await chmod(src.directory, 0o500);
      try {
        const report = await heal();
        expect(report).toMatchObject({ healed: 0, waiting: 1 });
        expect(await readdir(journalDir)).toHaveLength(1);
        expect(await stat(join(src.directory, ".kaipu", "Demo.json"))).toBeTruthy();
      } finally {
        await chmod(src.directory, 0o700);
      }
      // A later run, once the file can be removed, finishes the move.
      const later = await heal();
      expect(later.healed).toBe(1);
      expect(await filesOf(src.directory, "Demo")).toEqual([]);
    },
  );

  it("healing a move leaves other items' drag copies alone", async () => {
    await seedItem(src.directory);
    const otherDrag = join(src.directory, ".kaipu", "drag", "u-other");
    await mkdir(otherDrag, { recursive: true });
    await writeFile(join(otherDrag, "Other.mp4"), "being read by a drop target");
    await crashAfterPlacement();
    expect((await heal()).healed).toBe(1);
    expect(await readFile(join(otherDrag, "Other.mp4"), "utf-8")).toBe(
      "being read by a drop target",
    );
  });

  it.skipIf(!enforcesPermissions)(
    "reports a move whose post-commit healing throws as done, with the real mode",
    async () => {
      const item = await seedItem(src.directory);
      const outcome = await moveItem(
        { source: src, target: dst, id: "Demo" },
        deps({
          hooks: {
            // The media is placed (the commit); then the journal folder stops accepting writes.
            after: async (at) => {
              if (at !== "media-placed") return;
              await chmod(journalDir, 0o500);
              throw new Error("boom after the commit");
            },
          },
        }),
      );
      await chmod(journalDir, 0o700);
      expect(outcome).toEqual({ ok: true, id: "Demo", newId: "Demo", mode: "linked" });
      // The journal is left for the next healing run, which finishes the source side.
      expect((await heal()).healed).toBe(1);
      expect(await copiesOf(item.assetId)).toEqual([{ dir: dst.directory, id: "Demo" }]);
    },
  );
});
