import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { LibraryVault } from "./library-vault";
import { fixVault, resumeOrphanManifests, scanVault } from "./vault-reconcile";
import { listFiles, makeVault, sidecar } from "./vault-reconcile.test-helpers";

/**
 * A fault injector over `node:fs/promises`: every wrapped call is counted, and `fail`
 * decides whether it throws EIO instead. `open` with a write flag stands for a sidecar or
 * manifest write (`atomicWriteFile`); the handle it returns is wrapped too, so a write,
 * a sync or a close of that handle can fail as well.
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
  /** Handle methods that can fail, by the op name they are counted under. */
  const HANDLE_OPS: Record<string, string> = {
    write: "handle-write",
    writeFile: "handle-write",
    sync: "handle-sync",
    datasync: "handle-sync",
    close: "handle-close",
  };
  const wrapHandle = (handle: Awaited<ReturnType<typeof actual.open>>, path: string) =>
    new Proxy(handle, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        const op = typeof prop === "string" ? HANDLE_OPS[prop] : undefined;
        if (!op || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          const index = faults.calls.length;
          faults.calls.push({ op, path });
          if (faults.fail?.(op, path, index)) {
            // A failed close still releases the descriptor: only the caller sees the error.
            if (op === "handle-close") await target.close();
            throw Object.assign(new Error(`EIO: injected ${op} ${path}`), { code: "EIO" });
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  const open = (async (...args: Parameters<typeof actual.open>) =>
    args[1] && args[1] !== "r"
      ? wrapHandle(await openForWrite(...args), String(args[0]))
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
    link: wrap("link", actual.link),
    unlink: wrap("unlink", actual.unlink),
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

const fix = () => fixVault(directory, { cloud: "unknown", retry: noWait, now: () => T0 });
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

describe("Fix all — every payload survives one failed call at any point", () => {
  // Every kind of action: a retitle and rename with companions, a cycle, an adoption, a
  // dead record with its companions, an ownerless companion.
  const small = {
    "recording-2026-10-30-00-57-30.mp4": "payload:a",
    ".kaipu/recording-2026-10-30-00-57-30.json": sidecar({
      assetId: "a",
      createdAt: T0,
      title: "Recording — 10/29/2026, 7:57:30 PM",
      tagIds: ["tag-a"],
    }),
    ".kaipu/recording-2026-10-30-00-57-30.jpg": "payload:a-poster",
    ".kaipu/recording-2026-10-30-00-57-30.edit.json": "payload:a-session",
    ".kaipu/recording-2026-10-30-00-57-30.assets/s.png": "payload:a-slide",
    "X.mp4": "payload:x",
    ".kaipu/X.json": sidecar({ assetId: "x", title: "Y", createdAt: T0, tagIds: ["tag-x"] }),
    "Y.mp4": "payload:y",
    ".kaipu/Y.json": sidecar({ assetId: "y", title: "X", createdAt: T0 + 1 }),
    "Fresh.mp4": "payload:fresh",
    ".kaipu/Gone.json": sidecar({ assetId: "gone", title: "Gone", tagIds: ["tag-gone"] }),
    ".kaipu/Gone.jpg": "payload:gone-poster",
    ".kaipu/Lost.jpg": "payload:lost",
  };
  const payloads = Object.values(small).filter((v) => v.startsWith("payload:"));
  /** Each live item: its media payload, its tags and its companions (suffix → payload). */
  const LIVE = {
    a: {
      media: "payload:a",
      tagIds: ["tag-a"],
      companions: {
        ".jpg": "payload:a-poster",
        ".edit.json": "payload:a-session",
        ".assets/s.png": "payload:a-slide",
      },
    },
    x: { media: "payload:x", tagIds: ["tag-x"], companions: {} },
    y: { media: "payload:y", tagIds: undefined, companions: {} },
  };
  // Mutation boundaries are injected at every call. `access` is the stem probe: a clean run
  // makes ~130 of them, the same few checks repeated per candidate path, so it is sampled
  // (the first, every 8th and the last call) to keep the suite fast. Every other read is
  // small enough to stay exhaustive.
  const OPS = [
    "lstat",
    "stat",
    "access",
    "readFile",
    "copyFile",
    "cp",
    "write",
    "handle-write",
    "handle-sync",
    "handle-close",
    "rename",
    "link",
    "unlink",
  ];
  const SAMPLE_EVERY: Record<string, number> = { access: 8 };
  const injectionPoints = (op: string, count: number): number[] => {
    const every = SAMPLE_EVERY[op] ?? 1;
    const points = new Set<number>();
    for (let n = 1; n <= count; n++) if (n === 1 || n === count || n % every === 0) points.add(n);
    return [...points];
  };

  /** Every file's content, by vault-relative path. */
  const contentsOf = async (): Promise<Map<string, string>> => {
    const files = await listFiles(directory);
    return new Map(await Promise.all(files.map(async (path) => [path, await read(path)] as const)));
  };
  const parse = (text: string | undefined): Record<string, unknown> | null => {
    if (text === undefined) return null;
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  /**
   * Nothing is lost and no identity is detached: each live item's media is in the root, and
   * the record at its stem carries its identity, its tags and its companions. The dead
   * record is a record (at its old path, or in an orphan bundle). After a clean retry its
   * poster is in the same bundle, and every manifest entry is complete.
   */
  const expectSurvival = async (label: string, settled: boolean): Promise<void> => {
    const contents = await contentsOf();
    const all = [...contents.values()];
    for (const payload of payloads) expect(all, `${payload} ${label}`).toContain(payload);

    for (const [assetId, item] of Object.entries(LIVE)) {
      const media = [...contents].filter(([, c]) => c === item.media).map(([path]) => path);
      expect(media, `${assetId}'s media ${label}`).toHaveLength(1);
      const path = media[0]!;
      expect(path, `${assetId}'s media stays in the root ${label}`).not.toContain("/");
      const stem = path.slice(0, path.lastIndexOf("."));
      const record = parse(contents.get(`.kaipu/${stem}.json`));
      expect(record?.assetId, `${assetId}'s record at "${stem}" ${label}`).toBe(assetId);
      expect(record?.tagIds, `${assetId}'s tags ${label}`).toEqual(item.tagIds);
      for (const [suffix, payload] of Object.entries(item.companions)) {
        expect(contents.get(`.kaipu/${stem}${suffix}`), `${assetId}'s ${suffix} ${label}`).toBe(
          payload,
        );
      }
    }

    const records = [...contents]
      .filter(([path]) => path.endsWith("/Gone.json"))
      .filter(([, c]) => parse(c)?.assetId === "gone")
      .map(([path]) => path);
    expect(records, `gone's record ${label}`).toHaveLength(1);
    const record = records[0]!;
    expect(parse(contents.get(record))?.tagIds, `gone's tags ${label}`).toEqual(["tag-gone"]);
    if (!settled) return;

    // The retry finished every bundle where it was started.
    expect(record, `gone's record ${label}`).toMatch(/^\.kaipu\/orphans\/[^/]+\/Gone\.json$/);
    const bundle = record.slice(0, -"Gone.json".length);
    expect(contents.get(`${bundle}Gone.jpg`), `gone's poster in its bundle ${label}`).toBe(
      "payload:gone-poster",
    );
    const manifests = [...contents].filter(([path]) => path.endsWith("/manifest.json"));
    const entries = manifests.flatMap(
      ([, c]) => (parse(c)?.entries ?? []) as { stem: string; status: string }[],
    );
    expect(
      entries.filter((e) => e.stem === "Gone"),
      `gone's manifest entry ${label}`,
    ).toHaveLength(1);
    expect(
      entries.every((e) => e.status === "complete"),
      `manifests complete ${label}`,
    ).toBe(true);
    expect(contents.get(`${bundle}manifest.json`), `gone's bundle manifest ${label}`).toBeDefined();
  };

  it(
    "injects EIO at each read, copy, sidecar open, write, sync, close or move, then a clean run converges",
    { timeout: 180_000 },
    async () => {
      // The calls a clean run makes, per operation.
      directory = await makeVault(small);
      faults.calls = [];
      await fix();
      const clean = faults.calls;
      await expectSurvival("after a clean run", true);
      await rm(directory, { recursive: true, force: true });
      const counts = Object.fromEntries(
        OPS.map((op) => [op, clean.filter((c) => c.op === op).length]),
      );
      for (const op of OPS.filter((op) => op !== "stat" && op !== "access")) {
        expect(counts[op], op).toBeGreaterThan(0);
      }
      // The orphan moves are among the placements (`safe-place` links a file).
      expect(clean.some((c) => c.op === "link" && c.path.includes(".kaipu/Gone.json"))).toBe(true);

      for (const op of OPS) {
        for (const n of injectionPoints(op, counts[op]!)) {
          const label = `after ${op} #${n}`;
          directory = await makeVault(small);
          faults.calls = [];
          let seen = 0;
          faults.fail = (called) => called === op && ++seen === n;
          await fix().catch(() => undefined);
          faults.fail = null;
          await expectSurvival(label, false);

          const report = await fix();
          expect(report.failed, `retry ${label}`).toEqual([]);
          const left = (await scanVault({ directory, cloud: "unknown" })).findings;
          expect(
            left.filter((f) => f.fixable),
            `converged ${label}`,
          ).toEqual([]);
          await expectSurvival(`after the retry ${label}`, true);
          await rm(directory, { recursive: true, force: true });
        }
      }
      directory = "";
    },
  );
});

describe("an orphan run whose manifest cannot be read stops Fix all (fail closed)", () => {
  const MANIFEST = ".kaipu/orphans/run-1/manifest.json";
  const brokenVault = (manifest: string) =>
    makeVault({
      [MANIFEST]: manifest,
      ".kaipu/orphans/run-1/Gone.json": sidecar({ assetId: "g", title: "Gone" }),
      // The bundle's file that had not moved yet, and an unrelated item Fix all would rename.
      ".kaipu/Gone.jpg": "poster",
      "Demo.mp4": "video",
      ".kaipu/Demo.json": sidecar({ assetId: "d", title: "Renamed" }),
    });

  it.each([
    ["unreadable (EACCES)", "eacces"],
    ["corrupt JSON", "{ not json"],
    ["a bad schema", JSON.stringify({ version: 1, runId: "run-1", entries: [{ files: 3 }] })],
  ])("%s: listed by the scan, and nothing is moved, classified or renamed", async (_name, raw) => {
    directory = await brokenVault(raw === "eacces" ? pendingManifest() : raw);
    const manifestPath = join(directory, MANIFEST);
    const { chmod } = await import("node:fs/promises");
    if (raw === "eacces") await chmod(manifestPath, 0o000);
    try {
      const scan = await scanVault({ directory, cloud: "unknown" });
      expect(scan.findings).toContainEqual(
        expect.objectContaining({ kind: "unreadable-orphan-run", fixable: false, path: MANIFEST }),
      );
      // Names only: a manifest without read permission cannot be snapshotted.
      const names = async () =>
        (await readdir(directory, { recursive: true }))
          .filter((path) => !path.startsWith(".kaipu/reconcile"))
          .sort();
      const before = await names();

      const report = await fix();
      expect(report.failed).toContainEqual({
        path: MANIFEST,
        error: expect.stringContaining("needs attention"),
      });
      expect(report.remaining).toContainEqual(
        expect.objectContaining({ kind: "unreadable-orphan-run", path: MANIFEST }),
      );
      expect(report.movedToOrphans).toBe(0);
      expect(report.fixed).toBe(0);
      // Only the run log is new: the poster waits, Demo keeps its name, no second run folder.
      expect(await names()).toEqual(before);
      expect(await read(".kaipu/Gone.jpg")).toBe("poster");
    } finally {
      if (raw === "eacces") await chmod(manifestPath, 0o600);
    }
  });

  it("a run folder without a manifest yet, or a stray file, is not a broken run", async () => {
    directory = await makeVault({
      ".kaipu/orphans/run-empty": { dir: true },
      ".kaipu/orphans/.DS_Store": "x",
    });
    const scan = await scanVault({ directory, cloud: "unknown" });
    expect(scan.findings).toEqual([]);
    expect((await fix()).failed).toEqual([]);
  });
});
