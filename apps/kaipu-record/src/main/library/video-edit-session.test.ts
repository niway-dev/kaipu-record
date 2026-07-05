import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("./vault-location", () => ({
  vaultDirectory: () => ({ path: state.dir, isCustom: false }),
}));

import { deleteVideoEditSession, loadSession, saveSession } from "./video-edit-session";

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
});
