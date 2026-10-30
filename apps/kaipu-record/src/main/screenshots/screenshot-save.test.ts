import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemGoneError, LibraryVault } from "../library/library-vault";

let vault: LibraryVault;

vi.mock("../library", () => ({
  currentVault: () => vault,
  broadcastLibraryChanged: vi.fn(),
}));

import { saveScreenshotToVault } from "./screenshot-save";

describe("saveScreenshotToVault", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-shot-"));
    vault = new LibraryVault(directory);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("removes the new PNG when its sidecar write fails, so a retry cannot orphan it", async () => {
    vi.spyOn(vault, "writeMeta").mockRejectedValue(new Error("disk full"));
    await expect(saveScreenshotToVault(Buffer.from("png"), { title: "Shot" })).rejects.toThrow(
      "disk full",
    );
    expect((await readdir(directory)).filter((n) => n.endsWith(".png"))).toEqual([]);
    // The reserved stem is released too: no stub sidecar is left behind.
    expect(await readdir(join(directory, ".kaipu"))).toEqual([]);
  });

  it("names a new shot after its title", async () => {
    const saved = await saveScreenshotToVault(Buffer.from("png"), {
      title: "Kaipu Screenshot 2026-10-29 at 13.51.00",
    });
    expect(saved).toMatchObject({
      id: "Kaipu Screenshot 2026-10-29 at 13.51.00",
      title: "Kaipu Screenshot 2026-10-29 at 13.51.00",
      kind: "screenshot",
    });
    expect(await readdir(directory)).toContain("Kaipu Screenshot 2026-10-29 at 13.51.00.png");
  });

  it("gives a second shot with the same title ' (2)' instead of overwriting the first", async () => {
    const first = await saveScreenshotToVault(Buffer.from("one"), { title: "Shot" });
    const second = await saveScreenshotToVault(Buffer.from("two"), { title: "Shot" });
    expect([first.id, second.id]).toEqual(["Shot", "Shot (2)"]);
    expect((await readFile(join(directory, "Shot.png"))).toString()).toBe("one");
    expect((await readFile(join(directory, "Shot (2).png"))).toString()).toBe("two");
  });

  it("refuses to overwrite an item that is gone (deleted meanwhile)", async () => {
    const saved = await saveScreenshotToVault(Buffer.from("png"), { title: "Shot" });
    await vault.remove(saved.id);
    await expect(
      saveScreenshotToVault(Buffer.from("edit"), {
        title: "Shot",
        overwriteId: saved.id,
        overwriteAssetId: saved.assetId,
      }),
    ).rejects.toBeInstanceOf(ItemGoneError);
    expect((await readdir(directory)).filter((n) => n.endsWith(".png"))).toEqual([]);
  });

  it("keeps the PNG when an overwrite's sidecar write fails", async () => {
    await vault.writeImage("existing", Buffer.from("old"));
    const { assetId } = (await vault.describe("existing"))!;
    // The overwrite merges its sidecar under the names lock, through the locked writer.
    vi.spyOn(
      vault as never as { writeMetaLocked: () => Promise<void> },
      "writeMetaLocked",
    ).mockRejectedValue(new Error("disk full"));
    await expect(
      saveScreenshotToVault(Buffer.from("new"), {
        title: "Shot",
        overwriteId: "existing",
        overwriteAssetId: assetId,
      }),
    ).rejects.toThrow("disk full");
    expect((await readdir(directory)).filter((n) => n.endsWith(".png"))).toEqual(["existing.png"]);
    // The new bytes were already written; only a brand-new item is rolled back.
    expect((await readFile(join(directory, "existing.png"))).toString()).toBe("new");
  });

  it("an overwrite racing a rename never resurrects the old name", async () => {
    const saved = await saveScreenshotToVault(Buffer.from("one"), { title: "shot" });
    const writeImage = vault.writeImage.bind(vault);
    let renamed: Promise<unknown> | null = null;
    vi.spyOn(vault, "writeImage").mockImplementation(async (id, png) => {
      // The user renames the shot just as the overwrite is about to write.
      renamed ??= new LibraryVault(directory).renameItem(saved, "New shot");
      await Promise.race([renamed, new Promise((r) => setTimeout(r, 100))]);
      return writeImage(id, png);
    });
    const overwrite = saveScreenshotToVault(Buffer.from("edit"), {
      title: "shot",
      overwriteId: saved.id,
      overwriteAssetId: saved.assetId,
    }).catch((error: unknown) => error);
    await overwrite;
    await renamed;
    const listed = await vault.list();
    expect(listed.map((r) => r.assetId)).toEqual([saved.assetId]);
    expect((await readdir(directory)).filter((n) => n.endsWith(".png"))).toHaveLength(1);
  });

  it("follows the item to its new id when it was renamed before the overwrite", async () => {
    const saved = await saveScreenshotToVault(Buffer.from("one"), { title: "shot" });
    await vault.renameItem(saved, "New shot");
    const result = await saveScreenshotToVault(Buffer.from("edit"), {
      title: "New shot",
      overwriteId: saved.id,
      overwriteAssetId: saved.assetId,
    });
    expect(result).toMatchObject({ id: "New shot", assetId: saved.assetId });
    expect((await readFile(join(directory, "New shot.png"))).toString()).toBe("edit");
    expect((await readdir(directory)).filter((n) => n.endsWith(".png"))).toEqual(["New shot.png"]);
  });

  it("does not overwrite another item that took the old name", async () => {
    const first = await saveScreenshotToVault(Buffer.from("one"), { title: "shot" });
    await vault.renameItem(first, "Moved");
    const other = await saveScreenshotToVault(Buffer.from("other"), { title: "shot" });
    expect(other.id).toBe(first.id); // the stem was free again
    const result = await saveScreenshotToVault(Buffer.from("edit"), {
      title: "Moved",
      overwriteId: first.id,
      overwriteAssetId: first.assetId,
    });
    expect(result).toMatchObject({ id: "Moved", assetId: first.assetId });
    expect((await readFile(join(directory, "shot.png"))).toString()).toBe("other");
  });

  it("refuses an overwrite that does not name the identity it expects", async () => {
    // Rename A Shot → Moved, then B takes "Shot": an identity-less overwrite of "Shot"
    // would write A's edits over B.
    const a = await saveScreenshotToVault(Buffer.from("A"), { title: "Shot" });
    await vault.renameItem(a, "Moved");
    const b = await saveScreenshotToVault(Buffer.from("B"), { title: "Shot" });
    expect(b.id).toBe("Shot");
    await expect(
      saveScreenshotToVault(Buffer.from("edited A"), { title: "Shot", overwriteId: "Shot" }),
    ).rejects.toThrow(/overwriteAssetId/);
    expect((await readFile(join(directory, "Shot.png"))).toString()).toBe("B");
    expect((await readFile(join(directory, "Moved.png"))).toString()).toBe("A");
  });
});
