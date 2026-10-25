import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile, withLock } from "./atomic-write";

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
