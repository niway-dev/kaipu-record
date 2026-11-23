import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryVault } from "../library/library-vault";
import { WorkspaceGate } from "../workspaces/gate";

let vault: LibraryVault;
let gate: WorkspaceGate;

vi.mock("../library", () => ({
  currentVault: () => vault,
  broadcastLibraryChanged: vi.fn(),
}));

vi.mock("../workspaces", () => ({
  workspaceGate: () => gate,
  activeWorkspace: () => ({ id: gate.stamp.workspaceId }),
  requireCaptureWorkspace: async () => {},
}));

import { readCanvas } from "./screenshot-canvas";
import { saveCaptureToWorkspace, saveScreenshotToVault } from "./screenshot-save";

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
const doc = (...assetIds: string[]): string =>
  JSON.stringify({
    items: [
      ...assetIds.map((assetId) => ({ kind: "image", assetId })),
      { kind: "arrow", id: "a1" },
    ],
  });

describe("screenshot canvas storage", () => {
  let directory: string;
  let meta: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-canvas-"));
    meta = join(directory, ".kaipu");
    vault = new LibraryVault(directory);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips the document verbatim and each asset's bytes", async () => {
    const docJson = doc("img-1", "img-2");
    const saved = await saveScreenshotToVault(Buffer.from("png"), {
      title: "Shot",
      canvas: {
        docJson,
        assets: [
          { assetId: "img-1", png: bytes("one") },
          { assetId: "img-2", png: bytes("two") },
        ],
      },
    });
    const read = await readCanvas(vault, saved.id);
    expect(read?.docJson).toBe(docJson);
    expect(Buffer.from(read!.assets["img-1"]!).toString()).toBe("one");
    expect(Buffer.from(read!.assets["img-2"]!).toString()).toBe("two");
  });

  it("a save without canvas writes only the PNG and its sidecar (quiet capture path too)", async () => {
    gate = new WorkspaceGate("ws-1");
    const quiet = await saveCaptureToWorkspace("ws-1", Buffer.from("png"), { title: "Quiet" });
    const plain = await saveScreenshotToVault(Buffer.from("png"), { title: "Plain" });
    expect((await readdir(meta)).sort()).toEqual([`${plain.id}.json`, `${quiet.id}.json`].sort());
    expect((await readdir(directory)).filter((n) => n.endsWith(".png")).sort()).toEqual(
      [`${plain.id}.png`, `${quiet.id}.png`].sort(),
    );
  });

  it("a second save with another asset set deletes the superseded asset", async () => {
    const first = await saveScreenshotToVault(Buffer.from("png"), {
      title: "Shot",
      canvas: { docJson: doc("old"), assets: [{ assetId: "old", png: bytes("secret") }] },
    });
    await saveScreenshotToVault(Buffer.from("png2"), {
      title: "Shot",
      overwriteId: first.id,
      overwriteAssetId: first.assetId,
      canvas: { docJson: doc("new"), assets: [{ assetId: "new", png: bytes("fresh") }] },
    });
    expect(await readdir(join(meta, `${first.id}.assets`))).toEqual(["new.png"]);
    expect((await readCanvas(vault, first.id))?.docJson).toBe(doc("new"));
  });

  it("an overwrite without canvas removes the document and the assets directory", async () => {
    const first = await saveScreenshotToVault(Buffer.from("png"), {
      title: "Shot",
      canvas: { docJson: doc("a"), assets: [{ assetId: "a", png: bytes("x") }] },
    });
    await saveScreenshotToVault(Buffer.from("flat"), {
      title: "Shot",
      overwriteId: first.id,
      overwriteAssetId: first.assetId,
    });
    expect((await readdir(meta)).sort()).toEqual([`${first.id}.json`]);
    expect(await readCanvas(vault, first.id)).toBeNull();
  });

  it("an invalid asset id skips the canvas part and removes an existing document", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await saveScreenshotToVault(Buffer.from("png"), {
      title: "Shot",
      canvas: { docJson: doc("a"), assets: [{ assetId: "a", png: bytes("x") }] },
    });
    const next = await saveScreenshotToVault(Buffer.from("png2"), {
      title: "Shot",
      overwriteId: first.id,
      overwriteAssetId: first.assetId,
      canvas: { docJson: doc("b"), assets: [{ assetId: "../evil", png: bytes("x") }] },
    });
    expect(warn).toHaveBeenCalled();
    expect(await readCanvas(vault, next.id)).toBeNull();
    expect((await readFile(join(directory, `${next.id}.png`))).toString()).toBe("png2");
    expect((await readdir(meta)).sort()).toEqual([`${next.id}.json`]);
  });

  it("a canvas failure does not fail the save and leaves no document", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await saveScreenshotToVault(Buffer.from("png"), { title: "Shot" });
    // A file where the assets directory must go makes the asset write fail.
    await writeFile(vault.companionPaths(first.id).assetsDir, "blocker");
    const saved = await saveScreenshotToVault(Buffer.from("png2"), {
      title: "Shot",
      overwriteId: first.id,
      overwriteAssetId: first.assetId,
      canvas: { docJson: doc("a"), assets: [{ assetId: "a", png: bytes("x") }] },
    });
    expect(saved.id).toBe(first.id);
    expect((await readFile(join(directory, `${first.id}.png`))).toString()).toBe("png2");
    expect(await readCanvas(vault, first.id)).toBeNull();
    expect(await readdir(meta)).not.toContain(`${first.id}.canvas.json`);
  });

  it("a failed asset write leaves no old unredacted asset on disk (NIW2-799)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await saveScreenshotToVault(Buffer.from("png"), {
      title: "Shot",
      canvas: { docJson: doc("old"), assets: [{ assetId: "old", png: bytes("secret") }] },
    });
    const { assetsDir } = vault.companionPaths(first.id);
    // A directory where the second new asset must land makes that write fail after the first
    // one succeeded, before the superseded asset would be deleted.
    await mkdir(join(assetsDir, "next.png"));
    await saveScreenshotToVault(Buffer.from("png2"), {
      title: "Shot",
      overwriteId: first.id,
      overwriteAssetId: first.assetId,
      canvas: {
        docJson: doc("fresh", "next"),
        assets: [
          { assetId: "fresh", png: bytes("redacted") },
          { assetId: "next", png: bytes("x") },
        ],
      },
    });
    expect(await readdir(assetsDir).catch(() => [])).not.toContain("old.png");
    expect(await readCanvas(vault, first.id)).toBeNull();
    expect(await readdir(meta)).not.toContain(`${first.id}.canvas.json`);
  });

  describe("readCanvas fallbacks", () => {
    async function seed(docJson: string, assets: Record<string, string> = {}): Promise<void> {
      const paths = vault.companionPaths("S");
      await mkdir(paths.assetsDir, { recursive: true });
      for (const [id, text] of Object.entries(assets)) {
        await writeFile(join(paths.assetsDir, `${id}.png`), text);
      }
      await writeFile(paths.canvasDoc, docJson);
    }

    it("returns null when there is no document", async () => {
      expect(await readCanvas(vault, "S")).toBeNull();
    });

    it("returns null for corrupt JSON", async () => {
      await seed("{not json");
      expect(await readCanvas(vault, "S")).toBeNull();
    });

    it("returns null when an asset file is missing", async () => {
      await seed(doc("a", "b"), { a: "x" });
      expect(await readCanvas(vault, "S")).toBeNull();
    });

    it("returns null for an invalid asset id in the document", async () => {
      await seed(doc("../x"));
      expect(await readCanvas(vault, "S")).toBeNull();
    });

    it("rejects on a read error other than a missing file", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await seed(doc("a"));
      await mkdir(join(vault.companionPaths("S").assetsDir, "a.png"), { recursive: true });
      const error = await readCanvas(vault, "S").catch((e: Error) => e);
      expect(error).toMatchObject({ code: "EISDIR" });
      // The message carries the code, never a path.
      expect((error as Error).message).toBe("canvas document read failed: EISDIR");
    });

    describe("in a synced workspace (AC13)", () => {
      /** A synced vault whose provider has offloaded exactly the paths `evicted` names. */
      function syncedVault(evicted: (paths: string) => boolean): LibraryVault {
        return new LibraryVault(
          directory,
          "ws-1",
          undefined,
          async (paths) => new Set(paths.filter(evicted)),
        );
      }

      it("refuses an offloaded canvas document instead of downloading it", async () => {
        await seed(doc("a"), { a: "x" });
        const doc0 = vault.companionPaths("S").canvasDoc;
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await expect(
          readCanvas(
            syncedVault((p) => p === doc0),
            "S",
          ),
        ).rejects.toMatchObject({
          code: "EVICTED",
        });
      });

      it("refuses an offloaded asset while the document is local", async () => {
        await seed(doc("a"), { a: "x" });
        const asset = join(vault.companionPaths("S").assetsDir, "a.png");
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await expect(
          readCanvas(
            syncedVault((p) => p === asset),
            "S",
          ),
        ).rejects.toMatchObject({
          code: "EVICTED",
        });
      });

      it("reads a document whose files are all local", async () => {
        await seed(doc("a"), { a: "x" });
        const read = await readCanvas(
          syncedVault(() => false),
          "S",
        );
        expect(read?.docJson).toBe(doc("a"));
      });
    });

    it("returns null for an id that would leave the metadata folder", async () => {
      await seed(doc("a"), { a: "x" });
      expect(await readCanvas(vault, "../.kaipu/S")).toBeNull();
      expect(await readCanvas(vault, "S")).not.toBeNull();
    });

    it("returns null for a document over 5 MB", async () => {
      await seed(JSON.stringify({ items: [], pad: "x".repeat(5 * 1024 * 1024) }));
      expect(await readCanvas(vault, "S")).toBeNull();
    });
  });
});
