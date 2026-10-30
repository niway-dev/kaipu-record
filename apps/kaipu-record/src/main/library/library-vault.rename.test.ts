import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fsp from "node:fs/promises";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCaptureName } from "@shared/default-capture-name";
import { AMBIGUOUS_IDENTITY_MARKER, ITEM_NOT_FOUND_MARKER } from "@shared/types/library-storage";
import { EditorSessions } from "./editor-sessions";
import {
  AmbiguousIdentityError,
  DEFAULT_RENAME_RETRY,
  ItemGoneError,
  ItemNotFoundError,
  LibraryVault,
  type RetryPolicy,
  SharedCompanionError,
} from "./library-vault";

/** Whether the temp dir folds case (macOS APFS, Windows NTFS) — false on Linux CI. */
const CASE_INSENSITIVE_TMP = await (async () => {
  const dir = await mkdtemp(join(tmpdir(), "kaipu-case-"));
  try {
    await writeFile(join(dir, "probe"), "");
    return (
      (await readdir(dir)).length === 1 &&
      (await fsp.stat(join(dir, "PROBE")).then(
        () => true,
        () => false,
      ))
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
})();

/** Rename by the id a caller saw, with the identity it holds there (as the IPC does). */
async function renameById(
  v: LibraryVault,
  id: string,
  title: string,
  options?: Parameters<LibraryVault["renameItem"]>[2],
) {
  return v.renameItem(
    { id, assetId: (await v.describe(id))?.assetId ?? "missing" },
    title,
    options,
  );
}

/**
 * `rename` of a vault media file can be made to fail on demand; every other call (and
 * every atomic sidecar write, which also renames) passes through to the real one.
 */
const renameFailure = vi.hoisted(() => ({
  codes: [] as string[],
  calls: 0,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(async (from: string, to: string) => {
      const isMediaMove = /\.(mp4|webm|png|gif)$/.test(String(from)) && !from.endsWith(".part");
      if (isMediaMove) {
        renameFailure.calls += 1;
        const code = renameFailure.codes.shift();
        if (code) throw Object.assign(new Error(`${code}: mocked`), { code });
      }
      return actual.rename(from, to);
    }),
  };
});

const noWait: RetryPolicy = { delaysMs: [150, 400, 900], sleep: async () => {} };
const canChmod = process.platform !== "win32" && process.getuid?.() !== 0;

describe("LibraryVault.renameItem", () => {
  let directory: string;
  let meta: string;
  let vault: LibraryVault;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-rename-"));
    meta = join(directory, ".kaipu");
    vault = new LibraryVault(directory);
    renameFailure.codes = [];
    renameFailure.calls = 0;
  });

  afterEach(async () => {
    await chmod(meta, 0o700).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });

  const readJson = async (path: string): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(path, "utf-8"));

  /** A recording with every companion the vault knows about. */
  async function seedFullItem(id: string, ext = ".mp4"): Promise<void> {
    await mkdir(join(meta, `${id}.assets`), { recursive: true });
    await writeFile(join(directory, `${id}${ext}`), "media-bytes");
    await writeFile(
      join(meta, `${id}.json`),
      JSON.stringify({
        sidecarVersion: 2,
        assetId: "asset-1",
        title: "Old",
        createdAt: 1000,
        tagIds: ["tag-a"],
        contentSha256: "hash",
        hashedSizeBytes: 11,
        hashedMtimeMs: 5,
      }),
    );
    await writeFile(join(meta, `${id}.jpg`), "poster");
    await writeFile(join(meta, `${id}.cursor.json`), '{"version":1}');
    await writeFile(join(meta, `${id}.cursor.json.tmp`), "half");
    await writeFile(join(meta, `${id}.edit.json`), '{"scene":1}');
    await writeFile(join(meta, `${id}.edit.meta.json`), '{"savedAt":1}');
    await writeFile(join(meta, `${id}.assets`, "slide-1.png"), "slide");
  }

  it("moves the media and every companion to the stem the title derives", async () => {
    await seedFullItem("recording-2026-10-29-13-51-00");

    const result = await renameById(
      vault,
      "recording-2026-10-29-13-51-00",
      "Sprint demo: part 1/2?",
    );

    const newId = "Sprint demo part 1 2";
    expect(result.file).toBe("renamed");
    expect(result.recording.id).toBe(newId);
    expect(result.recording.title).toBe("Sprint demo: part 1/2?");
    expect(result.recording.assetId).toBe("asset-1");
    expect(result.recording.tagIds).toEqual(["tag-a"]);
    expect(await readdir(directory)).toEqual([".kaipu", `${newId}.mp4`]);
    expect((await readdir(meta)).sort()).toEqual(
      [
        `${newId}.assets`,
        `${newId}.cursor.json`,
        `${newId}.edit.json`,
        `${newId}.edit.meta.json`,
        `${newId}.jpg`,
        `${newId}.json`,
      ].sort(),
    );
    expect(await readFile(join(meta, `${newId}.jpg`), "utf-8")).toBe("poster");
    expect(await readFile(join(meta, `${newId}.edit.json`), "utf-8")).toBe('{"scene":1}');
    expect(await readFile(join(meta, `${newId}.assets`, "slide-1.png"), "utf-8")).toBe("slide");
    const sidecar = await readJson(join(meta, `${newId}.json`));
    expect(sidecar).toMatchObject({
      title: "Sprint demo: part 1/2?",
      assetId: "asset-1",
      tagIds: ["tag-a"],
      contentSha256: "hash",
      createdAt: 1000,
    });
    // The list shows one item, under the new id.
    expect((await vault.list()).map((r) => r.id)).toEqual([newId]);
  });

  it("is 'unchanged' and leaves the file alone when the stem does not change", async () => {
    await seedFullItem("Demo");
    const result = await renameById(vault, "Demo", "Demo?");
    expect(result).toMatchObject({ file: "unchanged", recording: { id: "Demo", title: "Demo?" } });
    expect(await readdir(directory)).toContain("Demo.mp4");
    expect((await readJson(join(meta, "Demo.json"))).title).toBe("Demo?");
  });

  // On Linux (CI) the temp dir is case-sensitive, so "Demo" is simply a free stem; the
  // in-place branch for APFS/NTFS only runs where the filesystem folds case.
  it("moves the file on a case-only rename (any filesystem)", async () => {
    await seedFullItem("demo");
    const result = await renameById(vault, "demo", "Demo");
    expect(result).toMatchObject({
      file: "renamed",
      recording: { id: "Demo", assetId: "asset-1" },
    });
    expect(await readdir(directory)).toEqual([".kaipu", "Demo.mp4"]);
    const companions = await readdir(meta);
    expect(companions).toContain("Demo.json");
    expect(companions).toContain("Demo.edit.json");
    expect(companions).not.toContain("demo.json");
    expect((await readJson(join(meta, "Demo.json"))).title).toBe("Demo");
  });

  it.runIf(CASE_INSENSITIVE_TMP)(
    "takes the in-place branch on a case-folding filesystem (APFS/NTFS)",
    async () => {
      await seedFullItem("demo");
      // The folded name is taken by the item itself: only the in-place move lands it.
      expect(await vault.isStemFree("Demo")).toBe(false);
      const result = await renameById(vault, "demo", "Demo");
      expect(result).toMatchObject({ file: "renamed", recording: { id: "Demo" } });
      expect(await readdir(directory)).toEqual([".kaipu", "Demo.mp4"]);
    },
  );

  it("adds ' (2)' when another item already has the name", async () => {
    await writeFile(join(directory, "Taken.webm"), "other");
    await seedFullItem("mine");
    const result = await renameById(vault, "mine", "Taken");
    expect(result.recording.id).toBe("Taken (2)");
    expect(result.recording.title).toBe("Taken");
    expect(await readFile(join(directory, "Taken.webm"), "utf-8")).toBe("other");
    expect(await readdir(directory)).toContain("Taken (2).mp4");
  });

  it("treats an orphan sidecar (a cloud-only item) as taken", async () => {
    await writeFile(join(directory, "cloudy.mp4"), "x");
    await writeFile(join(directory, "mine.mp4"), "y");
    await vault.describe("cloudy");
    await vault.removeLocalCopy("cloudy");
    const result = await renameById(vault, "mine", "cloudy");
    expect(result.recording.id).toBe("cloudy (2)");
    expect((await readJson(join(meta, "cloudy.json"))).localRemovedAt).toEqual(expect.any(Number));
  });

  it("does not treat a reverse-ordered ' (2)' as a collision with itself", async () => {
    await writeFile(join(directory, "Demo.mp4"), "other");
    await seedFullItem("Demo (2)");
    const result = await renameById(vault, "Demo (2)", "Demo");
    expect(result).toMatchObject({ file: "unchanged", recording: { id: "Demo (2)" } });
  });

  it("reuses the leftovers of an earlier interrupted rename of the same item", async () => {
    await seedFullItem("old");
    // A crash after step 4 left a sidecar (and a poster) for the target, without media.
    await writeFile(join(meta, "Target.json"), JSON.stringify({ assetId: "asset-1" }));
    await writeFile(join(meta, "Target.jpg"), "stale");
    const result = await renameById(vault, "old", "Target");
    expect(result).toMatchObject({ file: "renamed", recording: { id: "Target" } });
    expect(await readFile(join(meta, "Target.jpg"), "utf-8")).toBe("poster");
    expect((await readJson(join(meta, "Target.json"))).title).toBe("Target");
  });

  it("from reconcile, never reuses a leftover: it takes the next vacant name", async () => {
    await seedFullItem("old");
    await writeFile(join(meta, "Target.json"), JSON.stringify({ assetId: "asset-1" }));
    await writeFile(join(meta, "Target.jpg"), "a cloud-only poster");
    const result = await renameById(vault, "old", "Target", { allowLeftover: false });
    expect(result).toMatchObject({ file: "renamed", recording: { id: "Target (2)" } });
    expect(await readFile(join(meta, "Target.jpg"), "utf-8")).toBe("a cloud-only poster");
  });

  it("from reconcile, refuses a source whose companions another live item owns, before any write", async () => {
    await writeFile(join(directory, "Demo.mp4"), "v");
    await writeFile(join(directory, "Demo.edit.mp4"), "v2");
    await mkdir(meta, { recursive: true });
    const demoEdit = JSON.stringify({ assetId: "asset-2", title: "Other" });
    await writeFile(join(meta, "Demo.json"), JSON.stringify({ assetId: "asset-1", title: "Demo" }));
    await writeFile(join(meta, "Demo.edit.json"), demoEdit);
    for (const [id, assetId] of [
      ["Demo", "asset-1"],
      ["Demo.edit", "asset-2"],
    ] as const) {
      await expect(
        vault.renameItem({ id, assetId }, "Renamed", { refuseSharedCompanions: true }),
      ).rejects.toBeInstanceOf(SharedCompanionError);
    }
    expect(await readFile(join(meta, "Demo.edit.json"), "utf-8")).toBe(demoEdit);
    expect((await readdir(directory)).sort()).toEqual([".kaipu", "Demo.edit.mp4", "Demo.mp4"]);
  });

  it("does not reuse another item's leftover", async () => {
    await seedFullItem("old");
    await writeFile(join(meta, "Target.json"), JSON.stringify({ assetId: "someone-else" }));
    const result = await renameById(vault, "old", "Target");
    expect(result.recording.id).toBe("Target (2)");
  });

  it("falls back to the default name when nothing of the title survives", async () => {
    await writeFile(join(directory, "x.png"), "png");
    await mkdir(meta, { recursive: true });
    await writeFile(join(meta, "x.json"), JSON.stringify({ assetId: "a", createdAt: 0 }));
    const result = await renameById(vault, "x", "???");
    expect(result.recording.id).toBe(defaultCaptureName("screenshot", new Date(0)));
    expect(result.recording.title).toBe("???");
  });

  it("names a legacy item without a sidecar and gives it an identity", async () => {
    await writeFile(join(directory, "legacy.webm"), "v");
    const result = await renameById(vault, "legacy", "Named");
    expect(result.file).toBe("renamed");
    expect(result.recording.assetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readdir(meta)).toEqual(["Named.json"]);
  });

  it.each(["Demo.edit", "Demo.cursor", "Demo.edit.meta", "Demo.EDIT"])(
    "renaming Demo to %j never lands on Demo's own companion paths",
    async (title) => {
      // No edit project, no cursor track: the overlapping paths are free on disk.
      await writeFile(join(directory, "Demo.mp4"), "v");
      await mkdir(meta, { recursive: true });
      await writeFile(
        join(meta, "Demo.json"),
        JSON.stringify({ assetId: "asset-1", title: "Demo", tagIds: ["tag-a"] }),
      );
      const result = await renameById(vault, "Demo", title);
      expect(result.recording).toMatchObject({ assetId: "asset-1", tagIds: ["tag-a"], title });
      const [listed] = await vault.list();
      expect(listed).toMatchObject({ id: result.recording.id, assetId: "asset-1" });
      expect((await vault.list()).map((r) => r.assetId)).toEqual(["asset-1"]);
    },
  );

  it.each(["Demo.curſor", "Demo.\uFF45\uFF44\uFF49\uFF54", "Demo.EDİT"])(
    "a Unicode alias of a companion tail (%j) neither renames onto Demo's paths nor loses its identity",
    async (title) => {
      await writeFile(join(directory, "Demo.mp4"), "v");
      await mkdir(meta, { recursive: true });
      await writeFile(
        join(meta, "Demo.json"),
        JSON.stringify({ assetId: "asset-1", tagIds: ["t"] }),
      );
      const result = await renameById(vault, "Demo", title);
      expect(result.recording.id).not.toMatch(/\.(curs|edit)/i);
      expect(result.recording).toMatchObject({ assetId: "asset-1", tagIds: ["t"], title });
      expect((await vault.list()).map((r) => r.assetId)).toEqual(["asset-1"]);
    },
  );

  it("never allocates a stem that aliases the tag registry (tagſ)", async () => {
    const id = await vault.allocateId({ kind: "screenshot", title: "tagſ", createdAt: 1 });
    expect(id).toBe("Kaipu tags");
    expect(await readdir(meta)).not.toContain("tags.json");
  });

  it("never names an item after a file the vault owns (.kaipu/tags.json)", async () => {
    // No tag registry yet: its path is free on disk, but it is not the item's to take.
    await writeFile(join(directory, "clip.mp4"), "v");
    const result = await renameById(vault, "clip", "tags");
    expect(result.recording.id).not.toMatch(/^tags$/i);
    expect(await readdir(meta)).not.toContain("tags.json");
  });

  it("does not move onto a stem whose companions overlap the source's", async () => {
    // A legacy item whose id already ends in ".edit" (renamed in Finder).
    await writeFile(join(directory, "Demo.edit.mp4"), "v");
    await mkdir(meta, { recursive: true });
    await writeFile(join(meta, "Demo.edit.json"), JSON.stringify({ assetId: "asset-1" }));
    const result = await renameById(vault, "Demo.edit", "Demo");
    expect(result.recording.assetId).toBe("asset-1");
    expect((await vault.list()).map((r) => r.assetId)).toEqual(["asset-1"]);
  });

  it("a stale id (a toast's Retry) follows its item and never renames the one that took its name", async () => {
    // A is "Shot"; A moves to "Moved"; a new capture B takes "Shot".
    await writeFile(join(directory, "Shot.png"), "A");
    await mkdir(meta, { recursive: true });
    await writeFile(join(meta, "Shot.json"), JSON.stringify({ assetId: "asset-A", title: "Shot" }));
    await vault.renameItem({ id: "Shot", assetId: "asset-A" }, "Moved");
    const b = await vault.allocateId({ kind: "screenshot", title: "Shot", createdAt: 1 });
    await vault.writeImage(b, Buffer.from("B"));
    const bAsset = (await vault.describe(b))!.assetId;

    // A's Retry still names "Shot".
    const result = await vault.renameItem({ id: "Shot", assetId: "asset-A" }, "Final A");
    expect(result.recording).toMatchObject({ id: "Final A", assetId: "asset-A", title: "Final A" });
    expect(await vault.describe("Shot")).toMatchObject({ assetId: bAsset, title: "Shot" });
    expect(await readFile(join(directory, "Shot.png"), "utf-8")).toBe("B");
  });

  it("refuses a rename whose identity no item has, even if the id names a file", async () => {
    await seedFullItem("clip");
    await expect(
      vault.renameItem({ id: "clip", assetId: "someone-else" }, "New"),
    ).rejects.toBeInstanceOf(ItemNotFoundError);
    expect((await vault.describe("clip"))!.title).toBe("Old");
  });

  it("throws ItemNotFoundError (with the IPC marker) for an id without media", async () => {
    await expect(renameById(vault, "ghost", "X")).rejects.toBeInstanceOf(ItemNotFoundError);
    await expect(renameById(vault, "ghost", "X")).rejects.toThrow(ITEM_NOT_FOUND_MARKER);
    await expect(renameById(vault, "../escape", "X")).rejects.toBeInstanceOf(ItemNotFoundError);
    expect(await readdir(directory)).toEqual([]);
  });

  it("serializes a double commit: the second rename follows the item it names", async () => {
    await seedFullItem("clip");
    const target = { id: "clip", assetId: "asset-1" };
    const [first, second] = await Promise.all([
      vault.renameItem(target, "One"),
      new LibraryVault(directory).renameItem(target, "Two"),
    ]);
    expect(first.recording.id).toBe("One");
    expect(second.recording).toMatchObject({ id: "Two", assetId: "asset-1" });
    expect((await vault.list()).map((r) => r.id)).toEqual(["Two"]);
  });

  it("rejects with ItemNotFoundError once the item it names is deleted", async () => {
    await seedFullItem("clip");
    await vault.remove("clip");
    await expect(vault.renameItem({ id: "clip", assetId: "asset-1" }, "New")).rejects.toThrow(
      ITEM_NOT_FOUND_MARKER,
    );
  });

  it("keeps the old name, but saves the title, while an export is busy", async () => {
    await seedFullItem("clip");
    const result = await renameById(vault, "clip", "New", { isBusy: () => true });
    expect(result).toMatchObject({
      file: "kept-old-name",
      reason: "busy",
      recording: { id: "clip", title: "New" },
    });
    expect(renameFailure.calls).toBe(0);
    expect(await readdir(directory)).toContain("clip.mp4");
    expect(await readdir(meta)).not.toContain("New.json");
  });

  it("keeps the old name, but saves the title, while the item is open in the video editor", async () => {
    await seedFullItem("clip");
    const isEditing = vi.fn(
      (id: string, assetId: string) => id === "clip" && assetId === "asset-1",
    );
    const result = await renameById(vault, "clip", "New", { isEditing });
    expect(result).toMatchObject({
      file: "kept-old-name",
      reason: "editing",
      recording: { id: "clip", title: "New" },
    });
    expect(isEditing).toHaveBeenCalledWith("clip", "asset-1");
    expect(renameFailure.calls).toBe(0);
    expect(await readdir(directory)).toContain("clip.mp4");
    expect(await readFile(join(meta, "clip.edit.json"), "utf-8")).toBe('{"scene":1}');
  });

  it("an editor acquiring the item mid-rename waits for the move and gets the new id", async () => {
    await seedFullItem("clip");
    const sessions = new EditorSessions();
    let acquired: Promise<string | null> | null = null;
    const result = await renameById(vault, "clip", "New", {
      isEditing: (id, assetId) => {
        // The editor opens while the rename is about to copy companions.
        acquired ??= new LibraryVault(directory).acquireForEditor("asset-1", (heldId) =>
          sessions.openIfCurrent(1, 0, heldId, "asset-1"),
        );
        return sessions.isOpen(id, assetId);
      },
    });
    expect(result.file).toBe("renamed");
    // Serialized behind the rename: the editor loads and writes under the new id.
    await expect(acquired).resolves.toBe("New");
    expect(sessions.isOpen("New", "")).toBe(true);
    expect(sessions.isOpen("clip", "")).toBe(false);
  });

  it("a rename after the editor acquired the item keeps the file's name", async () => {
    await seedFullItem("clip");
    const sessions = new EditorSessions();
    const id = await vault.acquireForEditor("asset-1", (heldId) =>
      sessions.openIfCurrent(1, 0, heldId, "asset-1"),
    );
    expect(id).toBe("clip");
    const result = await renameById(vault, "clip", "New", {
      isEditing: (itemId, assetId) => sessions.isOpen(itemId, assetId),
    });
    expect(result).toMatchObject({ file: "kept-old-name", reason: "editing" });
  });

  it("an acquisition queued behind a rename is refused if its window went away meanwhile", async () => {
    await seedFullItem("clip");
    const sessions = new EditorSessions();
    // The rename holds the names lock while it retries a locked file.
    let release!: () => void;
    renameFailure.codes = ["EBUSY"];
    const renaming = renameById(vault, "clip", "New", {
      retry: { delaysMs: [150], sleep: () => new Promise<void>((r) => (release = r)) },
      isEditing: (id, assetId) => sessions.isOpen(id, assetId),
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    // The editor's request arrives (generation captured), then its window reloads.
    const generation = sessions.generation(7);
    const acquiring = new LibraryVault(directory).acquireForEditor("asset-1", (id) =>
      sessions.openIfCurrent(7, generation, id, "asset-1"),
    );
    sessions.releaseOwner(7);
    release();
    await expect(renaming).resolves.toMatchObject({ file: "renamed" });
    await expect(acquiring).resolves.toBeNull();
    expect(sessions.isOpen("New", "asset-1")).toBe(false);
    // Nothing is left holding the item: the next rename moves the file.
    await expect(
      renameById(vault, "New", "Newer", { isEditing: (id, a) => sessions.isOpen(id, a) }),
    ).resolves.toMatchObject({ file: "renamed" });
  });

  it("acquiring an item that is gone resolves null and holds nothing", async () => {
    const hold = vi.fn();
    await expect(vault.acquireForEditor("nobody", hold)).resolves.toBeNull();
    expect(hold).not.toHaveBeenCalled();
  });

  it("retries a locked file and renames once it is released", async () => {
    await seedFullItem("clip");
    renameFailure.codes = ["EBUSY", "EPERM"];
    const sleep = vi.fn(async () => {});
    const result = await renameById(vault, "clip", "New", { retry: { ...noWait, sleep } });
    expect(result.file).toBe("renamed");
    expect(renameFailure.calls).toBe(3);
    expect(sleep.mock.calls).toEqual([[150], [400]]);
  });

  it("keeps the old name after three retries on a locked file, and cleans the new companions", async () => {
    await seedFullItem("clip");
    renameFailure.codes = ["EPERM", "EPERM", "EACCES", "EBUSY"];
    const sleep = vi.fn(async () => {});
    const result = await renameById(vault, "clip", "New", { retry: { ...noWait, sleep } });
    expect(result).toMatchObject({
      file: "kept-old-name",
      reason: "locked",
      recording: { id: "clip", title: "New", assetId: "asset-1" },
    });
    expect(renameFailure.calls).toBe(4);
    expect(sleep.mock.calls).toEqual([[150], [400], [900]]);
    expect(await readdir(directory)).toEqual([".kaipu", "clip.mp4"]);
    expect((await readdir(meta)).filter((n) => n.startsWith("New"))).toEqual([]);
    expect(await readFile(join(meta, "clip.edit.json"), "utf-8")).toBe('{"scene":1}');
  });

  it("defaults to three retries, ≈1.5 s in total", () => {
    expect(DEFAULT_RENAME_RETRY.delaysMs).toEqual([150, 400, 900]);
  });

  it("does not retry an unexpected error: kept-old-name, reason io", async () => {
    await seedFullItem("clip");
    renameFailure.codes = ["EXDEV"];
    const result = await renameById(vault, "clip", "New", { retry: noWait });
    expect(result).toMatchObject({ file: "kept-old-name", reason: "io" });
    expect(renameFailure.calls).toBe(1);
  });

  it.skipIf(!canChmod)("keeps the old item whole when a companion cannot be copied", async () => {
    await seedFullItem("clip");
    await chmod(join(meta, "clip.assets", "slide-1.png"), 0o000);
    try {
      const result = await renameById(vault, "clip", "New", { retry: noWait });
      expect(result).toMatchObject({
        file: "kept-old-name",
        reason: "io",
        recording: { id: "clip", title: "New" },
      });
      expect(renameFailure.calls).toBe(0);
      expect((await readdir(meta)).filter((n) => n.startsWith("New"))).toEqual([]);
      expect(await readdir(directory)).toContain("clip.mp4");
    } finally {
      await chmod(join(meta, "clip.assets", "slide-1.png"), 0o600);
    }
  });

  it.skipIf(!canChmod)("rejects when even the title cannot be written", async () => {
    await seedFullItem("clip");
    await chmod(meta, 0o500);
    await expect(renameById(vault, "clip", "New")).rejects.toThrow();
    await chmod(meta, 0o700);
    expect(await readdir(directory)).toContain("clip.mp4");
    expect((await readJson(join(meta, "clip.json"))).title).toBe("Old");
  });
});

describe("LibraryVault.allocateId", () => {
  let directory: string;
  let vault: LibraryVault;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-allocate-"));
    vault = new LibraryVault(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const at = new Date(2026, 9, 29, 13, 51, 0).getTime();

  it("derives the stem from the title and writes a stub sidecar", async () => {
    const title = defaultCaptureName("recording", new Date(at));
    const id = await vault.allocateId({ kind: "recording", title, createdAt: at });
    expect(id).toBe("Kaipu Recording 2026-10-29 at 13.51.00");
    const stub = JSON.parse(await readFile(join(directory, ".kaipu", `${id}.json`), "utf-8"));
    expect(stub).toMatchObject({ sidecarVersion: 2, createdAt: at, title });
    expect(stub.assetId).toMatch(/^[0-9a-f-]{36}$/);
    // A stub without media is invisible.
    expect(await vault.list()).toEqual([]);
  });

  it("gives two concurrent allocations of the same title distinct ids", async () => {
    const input = { kind: "screenshot" as const, title: "Shot", createdAt: at };
    const ids = await Promise.all([
      vault.allocateId(input),
      new LibraryVault(directory).allocateId(input),
      new LibraryVault(directory).allocateId(input),
    ]);
    expect(ids.sort()).toEqual(["Shot", "Shot (2)", "Shot (3)"]);
  });

  it("skips a stem taken by media without a sidecar", async () => {
    await writeFile(join(directory, "Shot.png"), "png");
    expect(await vault.allocateId({ kind: "screenshot", title: "Shot", createdAt: at })).toBe(
      "Shot (2)",
    );
  });

  it("sanitizes an explicit stem and still resolves collisions", async () => {
    const input = { kind: "recording" as const, title: "Recovered", createdAt: at };
    expect(await vault.allocateId({ ...input, stem: "Base (recovered)" })).toBe("Base (recovered)");
    expect(await vault.allocateId({ ...input, stem: "Base (recovered)" })).toBe(
      "Base (recovered) (2)",
    );
    expect(await vault.allocateId({ ...input, stem: "a/b" })).toBe("a b");
  });

  it("never allocates a reserved or companion-shaped stem", async () => {
    const input = { kind: "screenshot" as const, createdAt: at };
    expect(await vault.allocateId({ ...input, title: "tags" })).not.toMatch(/^tags$/i);
    expect(await vault.allocateId({ ...input, title: "Shot.edit" })).not.toMatch(/\.edit$/i);
    expect(await vault.allocateId({ ...input, title: "x", stem: "y.cursor" })).not.toMatch(
      /\.cursor$/i,
    );
  });

  it("falls back to the default name for an empty title", async () => {
    expect(await vault.allocateId({ kind: "gif", title: "  ", createdAt: at })).toBe(
      "Kaipu GIF 2026-10-29 at 13.51.00",
    );
  });

  it("frees the stem again when the stub is removed", async () => {
    const id = await vault.allocateId({ kind: "screenshot", title: "Shot", createdAt: at });
    await vault.remove(id);
    expect(await vault.isStemFree(id)).toBe(true);
    expect(await vault.allocateId({ kind: "screenshot", title: "Shot", createdAt: at })).toBe(id);
  });
});

describe("LibraryVault — writeMeta guard and companions", () => {
  let directory: string;
  let vault: LibraryVault;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-guard-"));
    vault = new LibraryVault(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("refuses to create a sidecar for an id with neither sidecar nor media", async () => {
    await expect(vault.writeMeta("gone", { title: "X" })).rejects.toBeInstanceOf(ItemGoneError);
    expect(await fsp.readdir(directory).catch(() => [])).not.toContain(".kaipu");
  });

  it("still writes a sidecar for a legacy item that only has media", async () => {
    await writeFile(join(directory, "legacy.mp4"), "v");
    await vault.writeMeta("legacy", { title: "X" });
    expect((await vault.describe("legacy"))?.title).toBe("X");
  });

  it("does not resurrect the old stem when a write lands after a rename", async () => {
    await writeFile(join(directory, "old.mp4"), "v");
    await renameById(vault, "old", "New");
    await expect(vault.writeMeta("old", { tagIds: ["t"] })).rejects.toBeInstanceOf(ItemGoneError);
    await expect(vault.markOpenedInEditor("old")).rejects.toBeInstanceOf(ItemGoneError);
    expect(await readdir(join(directory, ".kaipu"))).toEqual(["New.json"]);
  });

  it("remove() deletes every companion, edit session and assets included", async () => {
    const meta = join(directory, ".kaipu");
    await mkdir(join(meta, "clip.assets"), { recursive: true });
    await writeFile(join(directory, "clip.mp4"), "v");
    for (const suffix of [".json", ".jpg", ".cursor.json", ".edit.json", ".edit.meta.json"]) {
      await writeFile(join(meta, `clip${suffix}`), "{}");
    }
    await writeFile(join(meta, "clip.assets", "a.png"), "png");
    await vault.remove("clip");
    expect(await readdir(directory)).toEqual([".kaipu"]);
    expect(await readdir(meta)).toEqual([]);
  });

  it("lists every companion path an id owns", () => {
    const paths = vault.companionPaths("x");
    expect(Object.values(paths).map((p) => p.slice(directory.length + 1))).toEqual([
      join(".kaipu", "x.json"),
      join(".kaipu", "x.jpg"),
      join(".kaipu", "x.cursor.json"),
      join(".kaipu", "x.cursor.json.tmp"),
      join(".kaipu", "x.edit.json"),
      join(".kaipu", "x.edit.meta.json"),
      join(".kaipu", "x.assets"),
    ]);
  });
});

describe("LibraryVault — an identity two files claim (copied item)", () => {
  let directory: string;
  let meta: string;
  let vault: LibraryVault;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-dup-"));
    meta = join(directory, ".kaipu");
    vault = new LibraryVault(directory);
    await mkdir(meta, { recursive: true });
    // "Shot" and a Finder copy of it, sidecar included: both claim asset-A.
    for (const id of ["Shot", "Shot copy"]) {
      await writeFile(join(directory, `${id}.png`), `bytes of ${id}`);
      await writeFile(join(meta, `${id}.json`), JSON.stringify({ assetId: "asset-A", title: id }));
    }
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const untouched = async (): Promise<void> => {
    expect((await readdir(directory)).sort()).toEqual([".kaipu", "Shot copy.png", "Shot.png"]);
    expect(await readFile(join(directory, "Shot.png"), "utf-8")).toBe("bytes of Shot");
    expect(await readFile(join(directory, "Shot copy.png"), "utf-8")).toBe("bytes of Shot copy");
  };

  it("a rename by a stale id refuses instead of picking one, and changes nothing", async () => {
    const renaming = vault.renameItem({ id: "Gone", assetId: "asset-A" }, "New");
    await expect(renaming).rejects.toBeInstanceOf(AmbiguousIdentityError);
    await expect(vault.renameItem({ id: "Gone", assetId: "asset-A" }, "New")).rejects.toThrow(
      AMBIGUOUS_IDENTITY_MARKER,
    );
    await untouched();
    expect((await vault.sidecar("Shot")).title).toBe("Shot");
  });

  it("a rename by the id the caller holds still works (the fast path is unambiguous)", async () => {
    const result = await vault.renameItem({ id: "Shot", assetId: "asset-A" }, "Mine");
    expect(result).toMatchObject({ file: "renamed", recording: { id: "Mine" } });
    expect(await readFile(join(directory, "Shot copy.png"), "utf-8")).toBe("bytes of Shot copy");
  });

  it("an editor acquisition refuses and holds nothing", async () => {
    const hold = vi.fn(() => true);
    await expect(vault.acquireForEditor("asset-A", hold)).rejects.toBeInstanceOf(
      AmbiguousIdentityError,
    );
    expect(hold).not.toHaveBeenCalled();
  });

  it("a screenshot overwrite by a stale id refuses and replaces no bytes", async () => {
    await expect(
      vault.overwriteImage("Gone", Buffer.from("edit"), { title: "x" }, "asset-A"),
    ).rejects.toBeInstanceOf(AmbiguousIdentityError);
    await untouched();
  });
});

describe("LibraryVault — an identity claimed across media kinds", () => {
  let directory: string;
  let meta: string;
  let vault: LibraryVault;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-kinds-"));
    meta = join(directory, ".kaipu");
    vault = new LibraryVault(directory);
    await mkdir(meta, { recursive: true });
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const claim = async (id: string, ext: string): Promise<void> => {
    await writeFile(join(directory, `${id}${ext}`), `bytes of ${id}`);
    await writeFile(join(meta, `${id}.json`), JSON.stringify({ assetId: "asset-A", title: id }));
  };

  it("a stale overwrite refuses when a screenshot and a recording both claim the identity", async () => {
    await claim("Shot", ".png");
    await claim("Clip", ".mp4");
    await expect(
      vault.overwriteImage("Gone", Buffer.from("edit"), { title: "x" }, "asset-A"),
    ).rejects.toBeInstanceOf(AmbiguousIdentityError);
    expect(await readFile(join(directory, "Shot.png"), "utf-8")).toBe("bytes of Shot");
  });

  it("an overwrite never writes a PNG beside a recording that holds the identity", async () => {
    await claim("Clip", ".mp4");
    await expect(
      vault.overwriteImage("Clip", Buffer.from("png"), { title: "x" }, "asset-A"),
    ).rejects.toBeInstanceOf(ItemGoneError);
    await expect(
      vault.overwriteImage("Gone", Buffer.from("png"), { title: "x" }, "asset-A"),
    ).rejects.toBeInstanceOf(ItemGoneError);
    expect((await readdir(directory)).sort()).toEqual([".kaipu", "Clip.mp4"]);
  });
});
