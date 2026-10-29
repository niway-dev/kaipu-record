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

  it("refuses to overwrite an id that no longer has media (renamed meanwhile)", async () => {
    const saved = await saveScreenshotToVault(Buffer.from("png"), { title: "Shot" });
    await vault.renameItem(saved.id, "Renamed");
    await expect(
      saveScreenshotToVault(Buffer.from("edit"), { title: "Shot", overwriteId: saved.id }),
    ).rejects.toBeInstanceOf(ItemGoneError);
    expect((await readdir(directory)).filter((n) => n.endsWith(".png"))).toEqual(["Renamed.png"]);
  });

  it("keeps the PNG when an overwrite's sidecar write fails", async () => {
    await vault.writeImage("existing", Buffer.from("old"));
    vi.spyOn(vault, "writeMeta").mockRejectedValue(new Error("disk full"));
    await expect(
      saveScreenshotToVault(Buffer.from("new"), { title: "Shot", overwriteId: "existing" }),
    ).rejects.toThrow("disk full");
    expect((await readdir(directory)).filter((n) => n.endsWith(".png"))).toEqual(["existing.png"]);
    // The new bytes were already written; only a brand-new item is rolled back.
    expect((await readFile(join(directory, "existing.png"))).toString()).toBe("new");
  });
});
