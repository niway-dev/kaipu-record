import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synced folders (decision 15): a take of a synced workspace writes no `.part` inside the
// folder, and is placed without a hard link. `link` is counted, never needed.
const hooks = vi.hoisted(() => ({
  links: [] as string[],
  /** A rename into this folder is refused as a cross-volume move (EXDEV). */
  exdevInto: null as string | null,
}));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (from: string, to: string) => {
      hooks.links.push(to);
      return actual.link(from, to);
    },
    rename: async (from: string, to: string) => {
      if (
        hooks.exdevInto !== null &&
        String(to).startsWith(hooks.exdevInto) &&
        String(to).endsWith(".mp4")
      ) {
        throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
      }
      return actual.rename(from, to);
    },
  };
});

const { RecordingWriter } = await import("./recording-writer");
const { LibraryVault } = await import("../library/library-vault");
const { recoverStrandedRecordings } = await import("./stranded-recordings");

describe("RecordingWriter — a synced workspace", () => {
  let root: string;
  let vaultDir: string;
  let scratch: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rw-synced-"));
    vaultDir = join(root, "My Drive", "Kaipu");
    scratch = join(root, "userData", "workspace-scratch", "ws-1", "tmp");
    await (await import("node:fs/promises")).mkdir(vaultDir, { recursive: true });
    hooks.links = [];
    hooks.exdevInto = null;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  const writer = () =>
    new RecordingWriter({
      vaultDir: () => vaultDir,
      now: () => 5000,
      stagingFor: (dir) => (dir === vaultDir ? scratch : null),
    });

  it("stages the take in the scratch folder, never inside the synced folder, and never links", async () => {
    const w = writer();
    const { tempPath } = await w.create("s1");
    expect(tempPath.startsWith(scratch)).toBe(true);
    expect(await readdir(join(vaultDir, ".kaipu", "tmp")).catch(() => [])).toEqual([]);
    await w.write("s1", new TextEncoder().encode("bytes").buffer, 0);
    const rec = await w.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 });
    expect(rec.filePath).toBe(join(vaultDir, "T.mp4"));
    expect(hooks.links).toEqual([]);
    expect((await stat(rec.filePath)).nlink).toBe(1);
    expect(await readdir(scratch)).toEqual([]);
  });

  it("a plain workspace finalizes a take with a hard link (the control for the no-link cases)", async () => {
    const w = new RecordingWriter({
      vaultDir: () => vaultDir,
      now: () => 5000,
      stagingFor: () => null,
    });
    await w.create("s1");
    await w.write("s1", new TextEncoder().encode("bytes").buffer, 0);
    await w.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 });
    expect(hooks.links.length).toBeGreaterThan(0);
  });

  describe("a plain workspace's stranded take saved into a folder the user picked", () => {
    async function strand(isSyncedFolder: (dir: string) => Promise<boolean>) {
      const w = new RecordingWriter({
        vaultDir: () => vaultDir,
        now: () => 5000,
        stagingFor: () => null,
        isSyncedFolder,
      });
      const { tempPath } = await w.create("s1");
      await w.write("s1", new TextEncoder().encode("screen").buffer, 0);
      vi.spyOn(LibraryVault.prototype, "writeMeta").mockImplementationOnce(async () => {
        throw new Error("disk full");
      });
      await expect(
        w.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 }),
      ).rejects.toThrow();
      hooks.links = []; // what finalize and the take-back did is not what is measured here
      const picked = join(root, "GoogleDrive-me", "My Drive", "mine.mp4");
      await mkdir(join(root, "GoogleDrive-me", "My Drive"), { recursive: true });
      return { w, tempPath, picked };
    }

    it("inside a provider folder, moves by rename: no hard link, no temp file beside it", async () => {
      const asked: string[] = [];
      const { w, tempPath, picked } = await strand(async (dir) => {
        asked.push(dir);
        return true;
      });
      await writeFile(picked, "old take");
      await w.salvage("s1", picked);
      expect(asked).toEqual([join(root, "GoogleDrive-me", "My Drive")]);
      expect(hooks.links).toEqual([]);
      expect(await readFile(picked, "utf-8")).toBe("screen");
      expect((await stat(picked)).nlink).toBe(1);
      expect(await readdir(join(root, "GoogleDrive-me", "My Drive"))).toEqual(["mine.mp4"]);
      await expect(stat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("outside a provider folder, still the usual placement (the control)", async () => {
      const { w, picked } = await strand(async () => false);
      await w.salvage("s1", picked);
      expect(hooks.links.length).toBeGreaterThan(0);
      expect(await readFile(picked, "utf-8")).toBe("screen");
    });

    it("a detection that fails counts as synced: rename is always safe", async () => {
      const { w, picked } = await strand(async () => {
        throw new Error("no answer");
      });
      await w.salvage("s1", picked);
      expect(hooks.links).toEqual([]);
      expect(await readFile(picked, "utf-8")).toBe("screen");
    });
  });

  it("a plain workspace keeps staging in .kaipu/tmp", async () => {
    const w = new RecordingWriter({
      vaultDir: () => vaultDir,
      now: () => 5000,
      stagingFor: () => null,
    });
    const { tempPath } = await w.create("s1");
    expect(tempPath.startsWith(join(vaultDir, ".kaipu", "tmp"))).toBe(true);
    await w.abort("s1");
  });

  it("the stranded sweep recovers a take left in the scratch folder, without a link", async () => {
    const w = writer();
    await w.create("s1");
    await w.write("s1", new TextEncoder().encode("bytes").buffer, 0);
    // The app dies here: the part stays in the scratch folder.
    const result = await recoverStrandedRecordings({
      vaultDir,
      extraStagingDirs: [scratch],
      placeByRename: true,
      title: "Recovered",
      now: () => Date.now() + 10 * 60_000,
    });
    expect(result.recovered).toHaveLength(1);
    expect(hooks.links).toEqual([]);
    expect(await readdir(scratch)).toEqual([]);
  });

  it("the sweep still reads .kaipu/tmp/ of a folder that became synced", async () => {
    const before = new RecordingWriter({ vaultDir: () => vaultDir, now: () => 5000 });
    await before.create("s0");
    await before.write("s0", new TextEncoder().encode("old").buffer, 0);
    const result = await recoverStrandedRecordings({
      vaultDir,
      extraStagingDirs: [scratch],
      placeByRename: true,
      title: "Recovered",
      now: () => Date.now() + 10 * 60_000,
    });
    expect(result.recovered).toHaveLength(1);
    expect(hooks.links).toEqual([]);
  });

  it("a scratch take is placed by rename even when this launch did not detect the folder as synced", async () => {
    const w = writer();
    await w.create("s1");
    await w.write("s1", new TextEncoder().encode("bytes").buffer, 0);
    const result = await recoverStrandedRecordings({
      vaultDir,
      extraStagingDirs: [scratch],
      placeByRename: false,
      title: "Recovered",
      now: () => Date.now() + 10 * 60_000,
    });
    expect(result.recovered).toHaveLength(1);
    expect(hooks.links).toEqual([]);
  });

  it("a scratch take across volumes is never copied beside its target when no folder outside the provider can stage it", async () => {
    // A folder the path rule does not call synced: this launch's detection missed it, and no
    // provider root is known. The take in the scratch folder exists only because the workspace
    // was synced when it was recorded.
    const missed = join(root, "Elsewhere", "Kaipu");
    await mkdir(missed, { recursive: true });
    const tempPath = join(scratch, "kaipu-rec-s1.mp4.part");
    await mkdir(scratch, { recursive: true });
    await writeFile(tempPath, "bytes");
    hooks.exdevInto = missed;
    const result = await recoverStrandedRecordings({
      vaultDir: missed,
      extraStagingDirs: [scratch],
      placeByRename: false,
      title: "Recovered",
      now: () => Date.now() + 10 * 60_000,
    });
    expect(result.recovered).toEqual([]);
    expect(result.failed).toEqual([tempPath]);
    expect(await readFile(tempPath, "utf-8")).toBe("bytes");
    expect((await readdir(missed)).filter((name) => name.endsWith(".mp4"))).toEqual([]);
  });

  it("a failed sidecar write takes the take back out of the folder by rename, never a link", async () => {
    const w = writer();
    const { tempPath } = await w.create("s1");
    await w.write("s1", new TextEncoder().encode("bytes").buffer, 0);
    vi.spyOn(LibraryVault.prototype, "writeMeta").mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    await expect(
      w.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toThrow();
    expect(hooks.links).toEqual([]);
    expect(await readFile(tempPath, "utf-8")).toBe("bytes");
    await expect(stat(join(vaultDir, "T.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  const webcamMeta = {
    startOffsetMs: 120,
    offsetQuality: "exact" as const,
    width: 640,
    height: 480,
    fps: 30,
  };

  it("a take with a webcam stages both parts in the scratch folder and places both by rename", async () => {
    const w = writer();
    await w.create("s1");
    const webcam = await w.create("s1", "webcam");
    expect(webcam.tempPath.startsWith(scratch)).toBe(true);
    await w.write("s1", new TextEncoder().encode("screen").buffer, 0);
    await w.write("s1", new TextEncoder().encode("camera").buffer, 0, "webcam");
    const rec = await w.finalize("s1", {
      title: "T",
      durationSeconds: 1,
      durationMs: 1000,
      webcam: webcamMeta,
    });
    const webcamFile = join(vaultDir, ".kaipu", "T.webcam.mp4");
    // A hard link of either file into the synced folder would rename its cloud item.
    expect(hooks.links).toEqual([]);
    expect(rec.webcam).toBeTruthy();
    expect(await readFile(webcamFile, "utf-8")).toBe("camera");
    expect((await stat(webcamFile)).nlink).toBe(1);
    expect((await stat(rec.filePath)).nlink).toBe(1);
    expect(await readdir(scratch)).toEqual([]);
    expect((await readdir(join(vaultDir, ".kaipu"))).filter((n) => n.endsWith(".part"))).toEqual(
      [],
    );
  });

  it("a failed sidecar write takes both the screen and the webcam back to scratch by rename", async () => {
    const w = writer();
    const { tempPath } = await w.create("s1");
    const webcam = await w.create("s1", "webcam");
    await w.write("s1", new TextEncoder().encode("screen").buffer, 0);
    await w.write("s1", new TextEncoder().encode("camera").buffer, 0, "webcam");
    vi.spyOn(LibraryVault.prototype, "writeMeta").mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    await expect(
      w.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000, webcam: webcamMeta }),
    ).rejects.toThrow();
    expect(hooks.links).toEqual([]);
    expect(await readFile(tempPath, "utf-8")).toBe("screen");
    expect(await readFile(webcam.tempPath, "utf-8")).toBe("camera");
    await expect(stat(join(vaultDir, "T.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(vaultDir, ".kaipu", "T.webcam.mp4"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("a salvaged take (and its webcam) leaves scratch by rename, never a link, wherever the user saves it", async () => {
    const w = writer();
    const { tempPath } = await w.create("s1");
    const webcam = await w.create("s1", "webcam");
    await w.write("s1", new TextEncoder().encode("screen").buffer, 0);
    await w.write("s1", new TextEncoder().encode("camera").buffer, 0, "webcam");
    vi.spyOn(LibraryVault.prototype, "writeMeta").mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    await expect(
      w.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000, webcam: webcamMeta }),
    ).rejects.toThrow();
    // The save dialog can point at another synced folder (a link there leaves the item unsynced).
    const picked = join(root, "OneDrive", "mine.mp4");
    await mkdir(join(root, "OneDrive"), { recursive: true });
    await writeFile(picked, "old take");
    await w.salvage("s1", picked);
    expect(hooks.links).toEqual([]);
    expect(await readFile(picked, "utf-8")).toBe("screen");
    expect(await readFile(join(root, "OneDrive", "mine.webcam.mp4"), "utf-8")).toBe("camera");
    expect((await stat(picked)).nlink).toBe(1);
    await expect(stat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(webcam.tempPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
