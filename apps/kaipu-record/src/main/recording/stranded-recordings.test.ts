import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STAGING_DIR } from "./recording-writer";
import { recoverStrandedRecordings } from "./stranded-recordings";

describe("recoverStrandedRecordings", () => {
  let vaultDir: string;
  let fallbackTempDir: string;
  const now = Date.UTC(2026, 9, 15, 12, 0, 0);
  const old = new Date(now - 10 * 60_000);

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "sweep-vault-"));
    fallbackTempDir = await mkdtemp(join(tmpdir(), "sweep-tmp-"));
    await mkdir(join(vaultDir, STAGING_DIR), { recursive: true });
  });
  afterEach(async () => {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(fallbackTempDir, { recursive: true, force: true });
  });

  async function part(dir: string, name: string, content: string, at = old) {
    const path = join(dir, name);
    await writeFile(path, content);
    await utimes(path, at, at);
    return path;
  }

  it("recovers an old staged part into the vault as a recovered recording", async () => {
    await part(join(vaultDir, STAGING_DIR), "kaipu-rec-session-1.mp4.part", "bytes");
    const result = await recoverStrandedRecordings({
      vaultDir,
      fallbackTempDir,
      title: "Recovered recording",
      now: () => now,
    });
    expect(result.recovered).toHaveLength(1);
    const id = result.recovered[0];
    expect((await readFile(join(vaultDir, `${id}.mp4`))).toString()).toBe("bytes");
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", `${id}.json`), "utf-8"));
    expect(sidecar.title).toBe("Recovered recording");
    expect(await readdir(join(vaultDir, STAGING_DIR))).toHaveLength(0);
  });

  it("also sweeps the fallback temp dir", async () => {
    await part(fallbackTempDir, "kaipu-rec-session-2.mp4.part", "b");
    const result = await recoverStrandedRecordings({
      vaultDir,
      fallbackTempDir,
      title: "Recovered recording",
      now: () => now,
    });
    expect(result.recovered).toHaveLength(1);
  });

  it("leaves a part younger than two minutes alone", async () => {
    const path = await part(
      fallbackTempDir,
      "kaipu-rec-session-3.mp4.part",
      "b",
      new Date(now - 30_000),
    );
    const result = await recoverStrandedRecordings({
      vaultDir,
      fallbackTempDir,
      title: "Recovered recording",
      now: () => now,
    });
    expect(result.recovered).toHaveLength(0);
    expect((await readFile(path)).toString()).toBe("b");
  });

  it("deletes an empty part and ignores other names", async () => {
    await part(fallbackTempDir, "kaipu-rec-session-4.mp4.part", "");
    await part(fallbackTempDir, "unrelated.txt", "x");
    const result = await recoverStrandedRecordings({
      vaultDir,
      fallbackTempDir,
      title: "Recovered recording",
      now: () => now,
    });
    expect(result.discarded).toBe(1);
    expect(await readdir(fallbackTempDir)).toEqual(["unrelated.txt"]);
  });

  it("gives two parts with the same mtime second distinct ids", async () => {
    await part(fallbackTempDir, "kaipu-rec-a.mp4.part", "a");
    await part(fallbackTempDir, "kaipu-rec-b.mp4.part", "b");
    const result = await recoverStrandedRecordings({
      vaultDir,
      fallbackTempDir,
      title: "Recovered recording",
      now: () => now,
    });
    expect(new Set(result.recovered).size).toBe(2);
  });

  it("returns an empty result when the staging folder is missing", async () => {
    await rm(join(vaultDir, STAGING_DIR), { recursive: true, force: true });
    const result = await recoverStrandedRecordings({
      vaultDir,
      fallbackTempDir,
      title: "Recovered recording",
      now: () => now,
    });
    expect(result).toEqual({ recovered: [], discarded: 0, failed: [] });
  });
});
