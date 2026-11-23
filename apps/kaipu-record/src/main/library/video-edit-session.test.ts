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

  it("deleteVideoEditSession also removes edit.meta.json", async () => {
    await saveSession("rec-1", { sessionJson: "{}", assets: [] });
    await deleteVideoEditSession("rec-1");
    await expect(readFile(join(vaultDir, ".kaipu", "rec-1.edit.meta.json"))).rejects.toThrow();
  });
});
