import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryVault } from "./library-vault";

describe("LibraryVault", () => {
  let directory: string;
  let vault: LibraryVault;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-vault-"));
    vault = new LibraryVault(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const writeRecording = (id: string, bytes = 2048): Promise<void> =>
    writeFile(join(directory, `${id}.webm`), Buffer.alloc(bytes));

  const writeSidecar = async (id: string, data: object): Promise<void> => {
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(join(directory, ".kaipu", `${id}.json`), JSON.stringify(data));
  };

  it("returns an empty list when the vault has no recordings", async () => {
    expect(await vault.list()).toEqual([]);
  });

  it("derives a title and reads the real size from disk", async () => {
    await writeRecording("alpha-clip", 4096);
    const [recording] = await vault.list();
    expect(recording.id).toBe("alpha-clip");
    expect(recording.title).toBe("Alpha Clip");
    expect(recording.sizeBytes).toBe(4096);
    expect(recording.durationSeconds).toBe(0);
  });

  it("ignores non-webm files", async () => {
    await writeRecording("clip");
    await writeFile(join(directory, "notes.txt"), "hello");
    expect((await vault.list()).map((r) => r.id)).toEqual(["clip"]);
  });

  it("sorts recordings newest-first by sidecar createdAt", async () => {
    await writeRecording("older");
    await writeRecording("newer");
    await writeSidecar("older", { createdAt: 1000 });
    await writeSidecar("newer", { createdAt: 5000 });
    expect((await vault.list()).map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("prefers sidecar title and duration over derived values", async () => {
    await writeRecording("clip");
    await writeSidecar("clip", { title: "My Demo", durationSeconds: 42 });
    const [recording] = await vault.list();
    expect(recording.title).toBe("My Demo");
    expect(recording.durationSeconds).toBe(42);
  });

  it("renames via the sidecar without touching the video file", async () => {
    await writeRecording("clip");
    await vault.rename("clip", "Renamed");

    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "clip.json"), "utf-8"));
    expect(sidecar.title).toBe("Renamed");
    expect((await vault.list())[0].title).toBe("Renamed");
    expect(await readdir(directory)).toContain("clip.webm");
  });

  it("removes the video and its sidecar", async () => {
    await writeRecording("clip");
    await vault.rename("clip", "X");
    await vault.remove("clip");

    expect(await vault.list()).toHaveLength(0);
    expect(await readdir(directory)).not.toContain("clip.webm");
  });
});

describe("LibraryVault — mp4 + thumbnails", () => {
  async function tempVault(): Promise<LibraryVault> {
    const dir = await mkdtemp(join(tmpdir(), "vault-mp4-"));
    return new LibraryVault(dir);
  }

  it("discovers .mp4 recordings", async () => {
    const vault = await tempVault();
    const file = await vault.filePath("rec-1");
    expect(file.endsWith("rec-1.mp4")).toBe(true);
    await writeFile(file, "data");
    const list = await vault.list();
    expect(list.map((r) => r.id)).toContain("rec-1");
  });

  it("writeMeta + describe surface title, duration and thumbnail url", async () => {
    const vault = await tempVault();
    await writeFile(await vault.filePath("rec-2"), "data");
    await vault.writeMeta("rec-2", { title: "Demo", durationSeconds: 12, createdAt: 111 });
    await vault.writeThumbnail("rec-2", Buffer.from([0xff, 0xd8, 0xff]));
    const rec = await vault.describe("rec-2");
    expect(rec).toMatchObject({
      id: "rec-2",
      title: "Demo",
      durationSeconds: 12,
      createdAt: 111,
      thumbnailUrl: "kaipu-media://thumb/rec-2",
    });
  });
});
