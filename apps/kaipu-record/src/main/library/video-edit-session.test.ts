import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("./vault-location", () => ({
  vaultDirectory: () => ({ path: state.dir, isCustom: false }),
}));

import {
  deleteVideoEditSession,
  EditProjectUnreadableError,
  ExportStampUnreadableError,
  loadSession,
  saveSession,
  saveSessionLocked,
} from "./video-edit-session";
import { ItemMovedError, withItemLock } from "./item-lock";
import { LibraryVault } from "./library-vault";

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("video-edit-session", () => {
  let vaultDir: string;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "kaipu-video-edit-"));
    state.dir = vaultDir;
  });

  afterEach(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });

  it("a save queued behind a move of the item writes nothing and says item-moved (ADR 0033)", async () => {
    await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
    await writeFile(join(vaultDir, "rec-1.mp4"), "video");
    let release!: () => void;
    // The move holds the item lock and takes the media away.
    const move = withItemLock("ws", "rec-1", async () => {
      await new Promise<void>((resolve) => (release = resolve));
      await rm(join(vaultDir, "rec-1.mp4"));
    });
    const save = saveSessionLocked("ws", "rec-1", {
      sessionJson: '{"version":1}',
      assets: [{ assetId: "asset-a", bytes: bytesOf("png") }],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    release();
    await move;
    await expect(save).rejects.toBeInstanceOf(ItemMovedError);
    expect(await readdir(join(vaultDir, ".kaipu"))).toEqual([]);
  });

  it("round-trips a session with no assets", async () => {
    await saveSession("rec-1", { sessionJson: '{"version":1}', assets: [] });
    const loaded = await loadSession("rec-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionJson).toBe('{"version":1}');
    expect(loaded!.assets).toEqual([]);
  });

  it("round-trips a session with slide asset bytes", async () => {
    await saveSession("rec-1", {
      sessionJson: '{"version":1}',
      assets: [{ assetId: "asset-a", bytes: bytesOf("png-bytes-a") }],
    });
    const loaded = await loadSession("rec-1");
    expect(loaded!.assets).toHaveLength(1);
    expect(loaded!.assets[0].assetId).toBe("asset-a");
    expect(Buffer.from(loaded!.assets[0].bytes).toString()).toBe("png-bytes-a");
  });

  it("refuses to save over an item whose record is unreadable, before writing anything (F9)", async () => {
    await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
    await writeFile(join(vaultDir, "rec-1.mp4"), "video");
    await writeFile(join(vaultDir, ".kaipu", "rec-1.json"), "{corrupt");
    await expect(
      saveSession("rec-1", {
        sessionJson: '{"version":1}',
        assets: [{ assetId: "asset-a", bytes: bytesOf("png") }],
      }),
    ).rejects.toThrow(/vault-unreadable-record/);
    // Nothing of the session was written. The only other file is the one copy of the corrupt
    // record the vault keeps aside on first read (NIW2-568); the record itself is untouched.
    const files = (await readdir(join(vaultDir, ".kaipu"))).sort();
    expect(files.filter((f) => !f.startsWith("rec-1.json.corrupt-"))).toEqual(["rec-1.json"]);
    expect(await readFile(join(vaultDir, ".kaipu", "rec-1.json"), "utf8")).toBe("{corrupt");
  });

  it("returns null when no session was ever saved", async () => {
    expect(await loadSession("never-saved")).toBeNull();
  });

  it("writes atomically: no .tmp file left behind after a save", async () => {
    await saveSession("rec-1", { sessionJson: "{}", assets: [] });
    const files = await readdir(join(vaultDir, ".kaipu"));
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    expect(files).toContain("rec-1.edit.json");
  });

  it("prunes asset files no longer referenced by a later save", async () => {
    await saveSession("rec-1", {
      sessionJson: "{}",
      assets: [
        { assetId: "keep", bytes: bytesOf("keep-bytes") },
        { assetId: "drop", bytes: bytesOf("drop-bytes") },
      ],
    });
    // Second save only references "keep" — "drop"'s file must be pruned.
    await saveSession("rec-1", {
      sessionJson: "{}",
      assets: [{ assetId: "keep", bytes: bytesOf("keep-bytes") }],
    });

    const assetFiles = await readdir(join(vaultDir, ".kaipu", "rec-1.assets"));
    expect(assetFiles).toEqual(["keep.png"]);

    const loaded = await loadSession("rec-1");
    expect(loaded!.assets.map((a) => a.assetId)).toEqual(["keep"]);
  });

  it("deleteVideoEditSession removes the session json and the assets directory", async () => {
    await saveSession("rec-1", {
      sessionJson: "{}",
      assets: [{ assetId: "a", bytes: bytesOf("x") }],
    });
    await deleteVideoEditSession("rec-1");

    expect(await loadSession("rec-1")).toBeNull();
    await expect(readdir(join(vaultDir, ".kaipu", "rec-1.assets"))).rejects.toThrow();
  });

  it("deleteVideoEditSession is a no-op (does not throw) when nothing was ever saved", async () => {
    await expect(deleteVideoEditSession("nope")).resolves.toBeUndefined();
  });

  it("does not clobber another recording's session or assets", async () => {
    await saveSession("rec-1", {
      sessionJson: '{"id":"one"}',
      assets: [{ assetId: "a1", bytes: bytesOf("one") }],
    });
    await saveSession("rec-2", {
      sessionJson: '{"id":"two"}',
      assets: [{ assetId: "a2", bytes: bytesOf("two") }],
    });

    await deleteVideoEditSession("rec-1");

    expect(await loadSession("rec-1")).toBeNull();
    const remaining = await loadSession("rec-2");
    expect(remaining!.sessionJson).toBe('{"id":"two"}');
    expect(remaining!.assets.map((a) => a.assetId)).toEqual(["a2"]);
  });

  // Sanity check that the temp+rename write actually landed real content, not just
  // that the read-back API agrees with itself.
  it("the session file on disk is valid, complete JSON", async () => {
    await saveSession("rec-1", { sessionJson: '{"version":1,"scene":{}}', assets: [] });
    const raw = await readFile(join(vaultDir, ".kaipu", "rec-1.edit.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, scene: {} });
  });

  it("writes edit.meta.json with the source file's size and mtime and the asset ids", async () => {
    const { writeFile: wf, stat } = await import("node:fs/promises");
    await wf(join(vaultDir, "rec-1.mp4"), "source-bytes");
    const info = await stat(join(vaultDir, "rec-1.mp4"));
    await saveSession("rec-1", {
      sessionJson: "{}",
      assets: [{ assetId: "a1", bytes: bytesOf("x") }],
    });
    const meta = JSON.parse(
      await readFile(join(vaultDir, ".kaipu", "rec-1.edit.meta.json"), "utf-8"),
    );
    expect(meta).toMatchObject({
      sourceSizeBytes: info.size,
      sourceMtimeMs: info.mtimeMs,
      assetIds: ["a1"],
    });
    expect(typeof meta.savedAt).toBe("number");
  });

  describe("in a synced folder (NIW2-912)", () => {
    const metaPath = (): string => join(vaultDir, ".kaipu", "rec-1.edit.meta.json");
    /** The active workspace's vault, as `currentVault` builds it: a probe says what is offloaded. */
    const syncedVault = (offloaded: (path: string) => boolean) => () =>
      new LibraryVault(
        vaultDir,
        "ws",
        undefined,
        async (paths) => new Set(paths.filter(offloaded)),
        join(vaultDir, "..", "scratch-tmp"),
      );

    it("an export stamp that cannot be read now refuses the whole save before anything is written", async () => {
      await writeFile(join(vaultDir, "rec-1.mp4"), "source-bytes");
      await saveSession("rec-1", {
        sessionJson: '{"scene":"exported"}',
        assets: [{ assetId: "kept", bytes: bytesOf("k") }],
        exported: true,
      });
      const before = await readFile(metaPath(), "utf-8");
      expect(JSON.parse(before).exportedSavedAt).toEqual(expect.any(Number));
      await new Promise((resolve) => setTimeout(resolve, 5));

      // The provider has offloaded the meta file: reading it would download it (or stall).
      await expect(
        saveSession(
          "rec-1",
          { sessionJson: '{"edited":true}', assets: [{ assetId: "other", bytes: bytesOf("o") }] },
          syncedVault((path) => path.endsWith(".edit.meta.json")),
        ),
      ).rejects.toBeInstanceOf(ExportStampUnreadableError);

      // Nothing was touched: the session, the assets and the meta still describe the same scene,
      // so the badge and the dependency probe read the truth.
      expect(await readFile(metaPath(), "utf-8")).toBe(before);
      expect(await readFile(join(vaultDir, ".kaipu", "rec-1.edit.json"), "utf-8")).toBe(
        '{"scene":"exported"}',
      );
      expect(await readdir(join(vaultDir, ".kaipu", "rec-1.assets"))).toEqual(["kept.png"]);
    });

    it("the refused save goes through once the meta can be read again", async () => {
      await writeFile(join(vaultDir, "rec-1.mp4"), "source-bytes");
      await saveSession("rec-1", { sessionJson: "{}", assets: [], exported: true });
      const stamp = JSON.parse(await readFile(metaPath(), "utf-8")).exportedSavedAt;
      await expect(
        saveSession(
          "rec-1",
          { sessionJson: '{"edited":true}', assets: [] },
          syncedVault((path) => path.endsWith(".edit.meta.json")),
        ),
      ).rejects.toBeInstanceOf(ExportStampUnreadableError);
      await saveSession(
        "rec-1",
        { sessionJson: '{"edited":true}', assets: [] },
        syncedVault(() => false),
      );
      expect(await readFile(join(vaultDir, ".kaipu", "rec-1.edit.json"), "utf-8")).toBe(
        '{"edited":true}',
      );
      expect(JSON.parse(await readFile(metaPath(), "utf-8")).exportedSavedAt).toBe(stamp);
    });

    it("a readable export stamp is carried forward as before", async () => {
      await writeFile(join(vaultDir, "rec-1.mp4"), "source-bytes");
      await saveSession("rec-1", { sessionJson: "{}", assets: [], exported: true });
      const stamp = JSON.parse(await readFile(metaPath(), "utf-8")).exportedSavedAt;
      await saveSession(
        "rec-1",
        { sessionJson: "{}", assets: [] },
        syncedVault(() => false),
      );
      expect(JSON.parse(await readFile(metaPath(), "utf-8")).exportedSavedAt).toBe(stamp);
    });

    it("a meta that is missing or not JSON still means nothing is known to be exported", async () => {
      await writeFile(join(vaultDir, "rec-1.mp4"), "source-bytes");
      await saveSession("rec-1", { sessionJson: "{}", assets: [] });
      expect(JSON.parse(await readFile(metaPath(), "utf-8")).exportedSavedAt).toBeNull();
      await writeFile(metaPath(), "{ not json");
      await saveSession("rec-1", { sessionJson: "{}", assets: [] });
      expect(JSON.parse(await readFile(metaPath(), "utf-8")).exportedSavedAt).toBeNull();
    });

    it("the export stamp is read through the workspace's vault: the provider is asked about the meta file", async () => {
      await writeFile(join(vaultDir, "rec-1.mp4"), "source-bytes");
      const asked: string[] = [];
      await saveSession(
        "rec-1",
        { sessionJson: "{}", assets: [] },
        () =>
          new LibraryVault(
            vaultDir,
            "ws",
            undefined,
            async (paths) => {
              asked.push(...paths);
              return new Set();
            },
            join(vaultDir, "..", "scratch-tmp"),
          ),
      );
      expect(asked.some((path) => path.endsWith("rec-1.edit.meta.json"))).toBe(true);
    });
  });

  describe("a save that stays refused changes nothing in the folder (NIW2-912)", () => {
    const metaOffloaded = () =>
      new LibraryVault(
        vaultDir,
        "ws",
        undefined,
        async (paths) => new Set(paths.filter((path) => path.endsWith(".edit.meta.json"))),
        join(vaultDir, "..", "scratch-tmp"),
      );

    beforeEach(async () => {
      await writeFile(join(vaultDir, "rec-1.mp4"), "source-bytes");
      await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
      await writeFile(
        join(vaultDir, ".kaipu", "rec-1.json"),
        JSON.stringify({ sidecarVersion: 2, assetId: "asset-1" }),
      );
      // A project saved earlier, with its export record, which the provider then offloads.
      await saveSession("rec-1", { sessionJson: '{"scene":"old"}', assets: [], exported: true });
    });

    const refused = () =>
      saveSessionLocked(
        "ws",
        "rec-1",
        {
          sessionJson: '{"scene":"edited"}',
          assets: [{ assetId: "slide", bytes: bytesOf("png") }],
        },
        metaOffloaded,
      );

    it("leaves the saved project, its assets and its meta as they were, and keeps no copy elsewhere", async () => {
      await expect(refused()).rejects.toBeInstanceOf(ExportStampUnreadableError);

      expect(await readFile(join(vaultDir, ".kaipu", "rec-1.edit.json"), "utf-8")).toBe(
        '{"scene":"old"}',
      );
      expect(await readdir(join(vaultDir, ".kaipu", "rec-1.assets"))).toEqual([]);
    });

    it("tells an offloaded export record apart from a stalled one in the message", async () => {
      const evicted = await refused().catch((error: unknown) => error as Error);
      expect(evicted).toBeInstanceOf(ExportStampUnreadableError);
      // Nothing is downloading it and retrying never will: say where the files are and what to do.
      expect((evicted as Error).message).toMatch(/only in the cloud/);
      expect((evicted as Error).message).not.toMatch(/kept on this computer/);
      expect((evicted as Error).message).not.toMatch(/try again/i);
    });
  });

  describe("an export record that is there but cannot be read (NIW2-912)", () => {
    it("refuses with the stalled-provider message, not the offloaded one, and writes nothing", async () => {
      await writeFile(join(vaultDir, "rec-1.mp4"), "source-bytes");
      await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
      await writeFile(
        join(vaultDir, ".kaipu", "rec-1.json"),
        JSON.stringify({ sidecarVersion: 2, assetId: "asset-1" }),
      );
      await saveSession("rec-1", { sessionJson: '{"scene":"old"}', assets: [], exported: true });
      // The record is local (not evicted) but the read fails: a provider that is not answering.
      const stalled = () =>
        new LibraryVault(
          vaultDir,
          "ws",
          {
            readText: (path) =>
              path.endsWith(".edit.meta.json")
                ? Promise.reject(Object.assign(new Error("offline"), { code: "EIO" }))
                : readFile(path, "utf-8"),
          },
          async () => new Set(),
          join(vaultDir, "..", "scratch-tmp"),
        );

      const failure = await saveSessionLocked(
        "ws",
        "rec-1",
        { sessionJson: '{"scene":"edited"}', assets: [] },
        stalled,
      ).catch((error: unknown) => error as ExportStampUnreadableError);

      expect(failure).toBeInstanceOf(ExportStampUnreadableError);
      expect((failure as ExportStampUnreadableError).reason).toBe("unreadable");
      expect((failure as Error).message).toMatch(/not answering/);
      expect((failure as Error).message).not.toMatch(/only in the cloud/);
      expect(await readFile(join(vaultDir, ".kaipu", "rec-1.edit.json"), "utf-8")).toBe(
        '{"scene":"old"}',
      );
    });
  });

  describe("opening a project that cannot be read (NIW2-912)", () => {
    const meta = (): string => join(vaultDir, ".kaipu");
    const syncedVault = () =>
      new LibraryVault(
        vaultDir,
        "ws",
        undefined,
        async () => new Set(),
        join(vaultDir, "..", "scratch-tmp"),
      );

    beforeEach(async () => {
      await writeFile(join(vaultDir, "rec-1.mp4"), "source-bytes");
      await mkdir(meta(), { recursive: true });
      await writeFile(
        join(meta(), "rec-1.json"),
        JSON.stringify({ sidecarVersion: 2, assetId: "asset-1" }),
      );
      await saveSession("rec-1", {
        sessionJson: '{"scene":"saved"}',
        assets: [{ assetId: "slide", bytes: bytesOf("png") }],
      });
    });

    it("opens a readable project in a synced workspace", async () => {
      const loaded = await loadSession("rec-1", syncedVault);
      expect(loaded?.sessionJson).toBe('{"scene":"saved"}');
      expect(loaded?.assets.map((a) => a.assetId)).toEqual(["slide"]);
    });

    it("rejects when the project file cannot be read: it is not a new project", async () => {
      // A directory where the file should be: readFile fails with EISDIR, not ENOENT.
      await rm(join(meta(), "rec-1.edit.json"));
      await mkdir(join(meta(), "rec-1.edit.json"));
      await expect(loadSession("rec-1", syncedVault)).rejects.toBeInstanceOf(
        EditProjectUnreadableError,
      );
      await expect(loadSession("rec-1")).rejects.toBeInstanceOf(EditProjectUnreadableError);
    });

    it("rejects when a slide cannot be read instead of dropping it", async () => {
      await rm(join(meta(), "rec-1.assets", "slide.png"));
      await mkdir(join(meta(), "rec-1.assets", "slide.png"));
      await expect(loadSession("rec-1", syncedVault)).rejects.toBeInstanceOf(
        EditProjectUnreadableError,
      );
    });

    it("rejects, in a synced workspace, when the meta cannot be read", async () => {
      await rm(join(meta(), "rec-1.edit.meta.json"));
      await mkdir(join(meta(), "rec-1.edit.meta.json"));
      await expect(loadSession("rec-1", syncedVault)).rejects.toBeInstanceOf(
        EditProjectUnreadableError,
      );
    });

    it("rejects, in a synced workspace, when the item's record cannot be read", async () => {
      await writeFile(join(meta(), "rec-1.json"), "{not json");
      await expect(loadSession("rec-1", syncedVault)).rejects.toBeInstanceOf(
        EditProjectUnreadableError,
      );
    });

    it("rejects, in a synced workspace, when the meta arrived before the project file", async () => {
      await rm(join(meta(), "rec-1.edit.json"));
      await expect(loadSession("rec-1", syncedVault)).rejects.toBeInstanceOf(
        EditProjectUnreadableError,
      );
      // A plain workspace has no such wait: no project file is a new project.
      expect(await loadSession("rec-1")).toBeNull();
    });

    it("still returns null for an item that never had a project", async () => {
      expect(await loadSession("never-saved", syncedVault)).toBeNull();
    });
  });

  it("deleteVideoEditSession also removes edit.meta.json", async () => {
    await saveSession("rec-1", { sessionJson: "{}", assets: [] });
    await deleteVideoEditSession("rec-1");
    await expect(readFile(join(vaultDir, ".kaipu", "rec-1.edit.meta.json"))).rejects.toThrow();
  });
});
