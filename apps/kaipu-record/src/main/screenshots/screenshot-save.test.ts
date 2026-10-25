import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryVault } from "../library/library-vault";

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
