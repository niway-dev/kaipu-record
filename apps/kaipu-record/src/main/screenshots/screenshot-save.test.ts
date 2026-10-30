import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_WORKSPACE } from "@shared/types/workspaces";
import { LibraryVault } from "../library/library-vault";
import { WorkspaceGate } from "../workspaces/gate";

let vault: LibraryVault;
let gate: WorkspaceGate;
let probe: () => void;

vi.mock("../library", () => ({
  currentVault: () => vault,
  broadcastLibraryChanged: vi.fn(),
}));

vi.mock("../workspaces", () => ({
  workspaceGate: () => gate,
  activeWorkspace: () => ({ id: gate.stamp.workspaceId }),
  requireCaptureWorkspace: async () => probe(),
}));

import { saveEditedScreenshot, saveScreenshotToVault } from "./screenshot-save";

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

describe("saveEditedScreenshot (the editor's Save)", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-shot-"));
    vault = new LibraryVault(directory);
    gate = new WorkspaceGate("ws-pending");
    probe = () => {};
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const pngs = async (): Promise<string[]> =>
    (await readdir(directory)).filter((n) => n.endsWith(".png"));

  it("saves under the stamp the window sent", async () => {
    const saved = await saveEditedScreenshot(gate.stamp, Buffer.from("png"), { title: "Shot" });
    expect(saved.title).toBe("Shot");
    expect(await pngs()).toHaveLength(1);
  });

  it("when probing the folder rebinds the stamp, it refuses before writing: a save the window reports as stale never wrote", async () => {
    const sent = gate.stamp;
    // The active entry was pending and adopts its folder's id during the availability probe.
    probe = () => void gate.adopt("ws-pending", "ws-real", "ws-real");

    await expect(saveEditedScreenshot(sent, Buffer.from("png"), { title: "Shot" })).rejects.toThrow(
      STALE_WORKSPACE,
    );

    // The preload rejects an answer whose stamp changed meanwhile, so a write here would be
    // a saved item the user is told failed, and a second Save would duplicate it.
    expect(await pngs()).toEqual([]);
  });
});
