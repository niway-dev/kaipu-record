import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultCaptureName } from "@shared/default-capture-name";
import { PLACED_MARKER_SUFFIX } from "../library/safe-place";
import { STAGING_DIR } from "./recording-writer";
import { PLACED_PARTS_DIR, recoverStrandedRecordings } from "./stranded-recordings";

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
    expect(id).toBe(`${defaultCaptureName("recording", old)} (recovered)`);
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", `${id}.json`), "utf-8"));
    expect(sidecar.title).toBe("Recovered recording");
    expect(sidecar.assetId).toEqual(expect.any(String));
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
    const base = `${defaultCaptureName("recording", old)} (recovered)`;
    expect([...result.recovered].sort()).toEqual([base, `${base} (2)`]);
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

  // A marker says a part's bytes were placed in the vault; it never authorizes deleting the
  // part (sixth review of NIW2-561, S4): the destination may hold a stranger's file by now.
  describe("a part with a placement marker", () => {
    const sweep = () =>
      recoverStrandedRecordings({ vaultDir, fallbackTempDir, title: "Recovered", now: () => now });

    async function marked(destinationContent: string) {
      const staging = join(vaultDir, STAGING_DIR);
      const path = await part(staging, "kaipu-rec-session-abcd.mp4.part", "original");
      const destination = join(vaultDir, "Take.mp4");
      await writeFile(destination, destinationContent);
      await writeFile(
        `${path}${PLACED_MARKER_SUFFIX}`,
        JSON.stringify({ version: 1, destination, size: "original".length }),
      );
      return { staging, path, destination };
    }

    it("is not recovered a second time, and is kept out of the sweep, never deleted", async () => {
      const { staging, destination } = await marked("original");
      const result = await sweep();
      expect(result.recovered).toEqual([]);
      expect(await readdir(staging)).toEqual([PLACED_PARTS_DIR]);
      const kept = join(staging, PLACED_PARTS_DIR, "kaipu-rec-session-abcd.mp4.part");
      expect(await readFile(kept, "utf-8")).toBe("original");
      expect(await readFile(destination, "utf-8")).toBe("original");
    });

    it("keeps the only remaining original when a same-size file replaced its destination", async () => {
      const { staging, destination } = await marked("incoming");
      await sweep();
      expect(await readFile(destination, "utf-8")).toBe("incoming");
      const kept = join(staging, PLACED_PARTS_DIR, "kaipu-rec-session-abcd.mp4.part");
      expect(await readFile(kept, "utf-8")).toBe("original");
    });

    it("removes a marker whose part is gone", async () => {
      const staging = join(vaultDir, STAGING_DIR);
      const marker = join(staging, `kaipu-rec-session-gone.mp4.part${PLACED_MARKER_SUFFIX}`);
      await writeFile(marker, JSON.stringify({ version: 1, destination: "/nowhere", size: 1 }));
      await sweep();
      expect(await readdir(staging)).toEqual([]);
    });
  });
});
