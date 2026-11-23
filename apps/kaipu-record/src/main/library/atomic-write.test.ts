import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  atomicWriteFile,
  STALE_STAGING_MS,
  sweepVolumeStaging,
  VOLUME_STAGING_DIR,
  withLock,
} from "./atomic-write";

describe("withLock", () => {
  it("runs same-key tasks one at a time, in order", async () => {
    const log: string[] = [];
    const task = (n: number, ms: number) =>
      withLock("k", async () => {
        log.push(`start${n}`);
        await sleep(ms);
        log.push(`end${n}`);
      });
    await Promise.all([task(1, 20), task(2, 5), task(3, 1)]);
    expect(log).toEqual(["start1", "end1", "start2", "end2", "start3", "end3"]);
  });

  it("does not block different keys", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const a = withLock("a", () => gate);
    const b = await withLock("b", async () => "b-done");
    expect(b).toBe("b-done");
    release();
    await a;
  });

  it("keeps going after a task rejects", async () => {
    const first = withLock("k", async () => {
      throw new Error("boom");
    });
    const second = withLock("k", async () => "ok");
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });
});

describe("atomicWriteFile", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-atomic-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("replaces the target and leaves no temp file", async () => {
    const target = join(directory, "f.json");
    await atomicWriteFile(target, "one");
    await atomicWriteFile(target, "two");
    expect(await readFile(target, "utf-8")).toBe("two");
    expect(await readdir(directory)).toEqual(["f.json"]);
  });

  it("removes its temp file and keeps the old content when the write fails", async () => {
    const target = join(directory, "f.json");
    await atomicWriteFile(target, "old");
    // A target under a missing directory makes `open` fail.
    await expect(atomicWriteFile(join(directory, "missing", "g.json"), "x")).rejects.toThrow();
    expect(await readFile(target, "utf-8")).toBe("old");
    expect((await readdir(directory)).filter((n) => n.includes(".tmp"))).toEqual([]);
  });
});

describe("sweepVolumeStaging (a crash mid-copy leaves a file the provider never sees)", () => {
  let base: string;
  let target: string;
  let staging: string;
  const NOW = Date.now();
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "kaipu-volume-staging-"));
    target = join(base, "provider", "folder", "Take.mp4");
    staging = join(base, VOLUME_STAGING_DIR);
    await mkdir(join(base, "provider", "folder"), { recursive: true });
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });
  const deps = () => ({
    isSynced: (path: string) => path.startsWith(join(base, "provider")),
    syncRoot: () => join(base, "provider"),
  });
  const leave = async (name: string, ageMs: number): Promise<void> => {
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, name), "half");
    const when = new Date(NOW - ageMs);
    await utimes(join(staging, name), when, when);
  };

  it("removes only our own leftovers that are older than the threshold", async () => {
    await leave("Take.mp4.1a2b3c4d.part", STALE_STAGING_MS + 60_000);
    await leave("x.json.123.0b9d6c5e-1111-4222-8333-444455556666.tmp", STALE_STAGING_MS + 60_000);
    await leave("Fresh.mp4.5e6f7a8b.part", 60_000); // a copy that may still be running
    await leave("notes.txt", STALE_STAGING_MS * 10); // not a name this app gives a file

    const removed = await sweepVolumeStaging(target, { ...deps(), now: NOW });

    expect(removed).toBe(2);
    expect((await readdir(staging)).sort()).toEqual(["Fresh.mp4.5e6f7a8b.part", "notes.txt"]);
  });

  it("does not create the staging folder where there is none", async () => {
    expect(await sweepVolumeStaging(target, { ...deps(), now: NOW })).toBe(0);
    await expect(readdir(staging)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does nothing for a folder that is not synced", async () => {
    await leave("Take.mp4.1a2b3c4d.part", STALE_STAGING_MS + 60_000);
    const plain = { isSynced: () => false, syncRoot: () => join(base, "provider"), now: NOW };
    expect(await sweepVolumeStaging(target, plain)).toBe(0);
    expect(await readdir(staging)).toHaveLength(1);
  });
});
