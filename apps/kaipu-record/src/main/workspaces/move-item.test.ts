import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      "Demo.cursor.json",
      "Demo.edit.json",
      "Demo.edit.meta.json",
      "Demo.jpg",
      "Demo.json",
      "Demo.mp4",
      "Demo.webcam.mp4",
    ]);
    const moved = await new LibraryVault(dst.directory).describe("Demo");
    expect(moved?.assetId).toBe(item.assetId);
    expect(moved?.title).toBe("Demo take");
    expect(await readFile(join(dst.directory, "Demo.mp4"))).toEqual(item.media);
    expect(await readdir(journalDir)).toEqual([]);
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
    expect(await filesOf(src.directory, "Demo")).toHaveLength(8);
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

  it("stages a synced target's copy in its scratch folder, never inside the synced folder", async () => {
    const item = await seedItem(src.directory);
    const target: MoveSide = { ...dst, scratch: join(root, "scratch", "dst") };
    const stagedIn: string[] = [];
    await moveItem(
      { source: src, target, id: item.id },
      deps({
        hooks: {
          after: async (step) => {
            if (step === "media-copied") {
              stagedIn.push(...(await readdir(join(root, "scratch", "dst", "tmp"))));
              expect(await readdir(join(dst.directory, ".kaipu", "tmp")).catch(() => [])).toEqual(
                [],
              );
            }
          },
        },
      }),
    );
    expect(stagedIn).toHaveLength(1);
    expect(await readdir(join(dst.directory, ".kaipu", "tmp")).catch(() => [])).toEqual([]);
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
