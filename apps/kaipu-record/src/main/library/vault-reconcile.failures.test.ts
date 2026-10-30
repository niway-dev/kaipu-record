import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LibraryVault } from "./library-vault";
import { resumeOrphanManifests } from "./vault-reconcile";
import { makeVault, sidecar } from "./vault-reconcile.test-helpers";

/**
 * A fault injector over `node:fs/promises`: every wrapped call is counted, and `fail`
 * decides whether it throws EIO instead. `open` with a write flag stands for a sidecar or
 * manifest write (`atomicWriteFile`).
 */
const faults = vi.hoisted(() => ({
  fail: null as null | ((op: string, path: string, index: number) => boolean),
  calls: [] as { op: string; path: string }[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const wrap = <F extends (...args: never[]) => Promise<unknown>>(op: string, fn: F): F =>
    (async (...args: Parameters<F>) => {
      const path = String(args[0]);
      const index = faults.calls.length;
      faults.calls.push({ op, path });
      if (faults.fail?.(op, path, index)) {
        throw Object.assign(new Error(`EIO: injected ${op} ${path}`), { code: "EIO" });
      }
      return fn(...args);
    }) as F;
  const openForWrite = wrap("write", actual.open);
  const openForRead = wrap("open", actual.open);
  const open = ((...args: Parameters<typeof actual.open>) =>
    args[1] && args[1] !== "r"
      ? openForWrite(...args)
      : openForRead(...args)) as typeof actual.open;
  return {
    ...actual,
    lstat: wrap("lstat", actual.lstat),
    stat: wrap("stat", actual.stat),
    access: wrap("access", actual.access),
    readFile: wrap("readFile", actual.readFile),
    copyFile: wrap("copyFile", actual.copyFile),
    cp: wrap("cp", actual.cp),
    rename: wrap("rename", actual.rename),
    open,
  };
});

const T0 = new Date(2026, 9, 29, 19, 57, 30).getTime();
const noWait = { delaysMs: [], sleep: async () => {} };

let directory = "";
afterEach(async () => {
  faults.fail = null;
  faults.calls = [];
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

const read = (path: string) => readFile(join(directory, path), "utf8");
const pendingManifest = () =>
  JSON.stringify({
    version: 1,
    runId: "run-1",
    entries: [
      {
        kind: "missing-media",
        stem: "Gone",
        assetId: "g",
        status: "pending",
        files: [
          { from: ".kaipu/Gone.jpg", to: "Gone.jpg" },
          { from: ".kaipu/Gone.json", to: "Gone.json" },
        ],
      },
    ],
  });

describe("orphan replay — only ENOENT means absent", () => {
  it("a destination that cannot be checked is never overwritten; the entry stays pending", async () => {
    directory = await makeVault({
      ".kaipu/orphans/run-1/manifest.json": pendingManifest(),
      // The original poster already moved; a new capture reused the old path since.
      ".kaipu/orphans/run-1/Gone.jpg": "payload:original-orphan",
      ".kaipu/Gone.jpg": "payload:new-capture-poster",
      ".kaipu/Gone.json": sidecar({ assetId: "g", title: "Gone" }),
    });
    const destination = join(directory, ".kaipu/orphans/run-1/Gone.jpg");
    faults.fail = (op, path) => (op === "lstat" || op === "stat") && path === destination;

    const result = await resumeOrphanManifests(directory);
    faults.fail = null;

    expect(await read(".kaipu/orphans/run-1/Gone.jpg")).toBe("payload:original-orphan");
    expect(await read(".kaipu/Gone.jpg")).toBe("payload:new-capture-poster");
    expect(result.failed).toContain(".kaipu/Gone.jpg");
    const manifest = JSON.parse(await read(".kaipu/orphans/run-1/manifest.json"));
    expect(manifest.entries[0].status).toBe("pending");

    // The next run, with the disk healthy again, sees the conflict and keeps both.
    const again = await resumeOrphanManifests(directory);
    expect(again.conflicts).toEqual([".kaipu/Gone.jpg"]);
    expect(await read(".kaipu/orphans/run-1/Gone.jpg")).toBe("payload:original-orphan");
    expect(await read(".kaipu/Gone.jpg")).toBe("payload:new-capture-poster");
  });

  it("a source that cannot be checked is not recorded as missing", async () => {
    directory = await makeVault({
      ".kaipu/orphans/run-1/manifest.json": pendingManifest(),
      ".kaipu/Gone.jpg": "payload:poster",
      ".kaipu/Gone.json": sidecar({ assetId: "g", title: "Gone" }),
    });
    const source = join(directory, ".kaipu/Gone.jpg");
    faults.fail = (op, path) => (op === "lstat" || op === "stat") && path === source;
    const result = await resumeOrphanManifests(directory);
    faults.fail = null;
    expect(result.failed).toContain(".kaipu/Gone.jpg");
    const manifest = JSON.parse(await read(".kaipu/orphans/run-1/manifest.json"));
    expect(manifest.entries[0].status).toBe("pending");
    expect(manifest.entries[0].files[0].state).not.toBe("missing");

    await resumeOrphanManifests(directory);
    expect(await read(".kaipu/orphans/run-1/Gone.jpg")).toBe("payload:poster");
  });
});

describe("vault writes — only ENOENT means absent", () => {
  it("a rename never deletes a companion it could not check, so could not copy", async () => {
    directory = await makeVault({
      "Old.mp4": "payload:media",
      ".kaipu/Old.json": sidecar({ assetId: "o", title: "Old" }),
      ".kaipu/Old.jpg": "payload:poster",
    });
    const poster = join(directory, ".kaipu/Old.jpg");
    faults.fail = (op, path) => op === "access" && path === poster;
    const result = await new LibraryVault(directory)
      .renameItem({ id: "Old", assetId: "o" }, "New", { retry: noWait })
      .catch((error: unknown) => error);
    faults.fail = null;
    expect(result).toMatchObject({ file: "kept-old-name" });
    expect(await read(".kaipu/Old.jpg")).toBe("payload:poster");
    expect(await read("Old.mp4")).toBe("payload:media");
  });

  it("a stem whose record cannot be checked is not free: its record is never overwritten", async () => {
    const record = sidecar({ assetId: "cloud", title: "Taken", localRemovedAt: 1 });
    directory = await makeVault({ ".kaipu/Taken.json": record });
    const path = join(directory, ".kaipu/Taken.json");
    faults.fail = (op, p) => op === "access" && p === path;
    await new LibraryVault(directory)
      .allocateId({ kind: "recording", title: "Taken", createdAt: T0 })
      .catch(() => undefined);
    faults.fail = null;
    expect(await read(".kaipu/Taken.json")).toBe(record);
  });
});
