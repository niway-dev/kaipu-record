import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultCaptureName } from "@shared/default-capture-name";
import { LibraryVault } from "./library-vault";
import { fixVault, resumeOrphanManifests, scanVault } from "./vault-reconcile";
import { listFiles, makeVault, sidecar, snapshot } from "./vault-reconcile.test-helpers";

/** From the n-th call on, every `rename` fails: a crash (or a dead drive) at that point. */
const failure = vi.hoisted(() => ({ from: Infinity, calls: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(async (from: string, to: string) => {
      failure.calls += 1;
      if (failure.calls >= failure.from) {
        throw Object.assign(new Error("EIO: injected"), { code: "EIO" });
      }
      return actual.rename(from, to);
    }),
  };
});

const T0 = new Date(2026, 9, 29, 19, 57, 30).getTime();
const noWait = { delaysMs: [], sleep: async () => {} };

let directory = "";
afterEach(async () => {
  failure.from = Infinity;
  failure.calls = 0;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

const fix = (cloud: ReadonlySet<string> | "unknown" = "unknown", extra = {}) =>
  fixVault(directory, { cloud, retry: noWait, now: () => T0 + 60_000, ...extra });
const fixable = async (cloud: ReadonlySet<string> | "unknown" = "unknown") =>
  (await scanVault({ directory, cloud })).findings.filter((f) => f.fixable);
const json = async (path: string) => JSON.parse(await readFile(join(directory, path), "utf8"));

/** Every edge case at once (the plan's fixture). */
function edgeCaseVault(): Record<string, Parameters<typeof makeVault>[0][string]> {
  const files: Record<string, Parameters<typeof makeVault>[0][string]> = {
    // Old automatic titles, two in the same second (N6).
    "recording-2026-10-30-00-57-30.mp4": "payload:legacy-a",
    ".kaipu/recording-2026-10-30-00-57-30.json": sidecar({
      assetId: "legacy-a",
      createdAt: T0,
      title: "Recording — 10/29/2026, 7:57:30 PM",
      tagIds: ["tag-1"],
    }),
    ".kaipu/recording-2026-10-30-00-57-30.jpg": "payload:legacy-a-poster",
    ".kaipu/recording-2026-10-30-00-57-30.edit.json": "payload:legacy-a-session",
    "recording-2026-10-30-00-57-30-b.mp4": "payload:legacy-b",
    ".kaipu/recording-2026-10-30-00-57-30-b.json": sidecar({
      assetId: "legacy-b",
      createdAt: T0,
      title: "Recording — 10/29/2026, 7:57:30 PM",
    }),
    "screenshot-2026-10-15T21-37-10-853Z.png": "payload:shot",
    ".kaipu/screenshot-2026-10-15T21-37-10-853Z.json": sidecar({ assetId: "shot" }),
    // A 6-item chain: titles B…F over files A…E, F free.
    // A 2-item cycle.
    "X.mp4": "payload:x",
    ".kaipu/X.json": sidecar({ assetId: "x", title: "Y", createdAt: T0 }),
    "Y.mp4": "payload:y",
    ".kaipu/Y.json": sidecar({ assetId: "y", title: "X", createdAt: T0 + 1 }),
    // A rename in Finder: new media, old record.
    "Renamed in Finder.mp4": "payload:finder",
    ".kaipu/Before.json": sidecar({ assetId: "finder", title: "Before", tagIds: ["t"] }),
    ".kaipu/Before.jpg": "payload:finder-poster",
    // Cloud-only, and a record whose identity is in the catalog.
    ".kaipu/Cloud.json": sidecar({ assetId: "cloud-0", localRemovedAt: 1 }),
    ".kaipu/InCatalog.json": sidecar({ assetId: "cloud-1", title: "In catalog" }),
    // Ownerless companions.
    ".kaipu/Lost.jpg": "payload:lost",
    // Listed only.
    "Pair.mp4": "payload:pair-v",
    "Pair.png": "payload:pair-p",
    "Bad.mp4": "payload:bad",
    ".kaipu/Bad.json": "{corrupt",
    "A1.mp4": "payload:dup-1",
    ".kaipu/A1.json": sidecar({ assetId: "dup", title: "Dup one" }),
    "A2.mp4": "payload:dup-2",
    ".kaipu/A2.json": sidecar({ assetId: "dup", title: "Dup two" }),
    "Demo.mp4": "payload:shared-1",
    ".kaipu/Demo.json": sidecar({ assetId: "s1", title: "Shared one" }),
    "Demo.edit.mp4": "payload:shared-2",
    ".kaipu/Demo.edit.json": sidecar({ assetId: "s2", title: "Shared two" }),
    "Upper.MP4": "payload:upper",
  };
  for (const [i, from] of ["A", "B", "C", "D", "E"].entries()) {
    const to = String.fromCharCode(from.charCodeAt(0) + 1);
    files[`${from}.mp4`] = `payload:chain-${from}`;
    files[`.kaipu/${from}.json`] = sidecar({
      assetId: `chain-${from}`,
      title: to,
      createdAt: T0 + i,
    });
  }
  // 101 items titled "Demo copy" (N11).
  for (let i = 1; i <= 101; i++) {
    files[`dc${i}.mp4`] = `payload:dc${i}`;
    files[`.kaipu/dc${i}.json`] = sidecar({
      assetId: `dc${i}`,
      title: "Demo copy",
      createdAt: T0 + i,
    });
  }
  return files;
}

describe("fixVault — every edge case at once", () => {
  // One Fix all over the plan's fixture, shared by the assertions below (it takes seconds).
  const cloud = new Set(["cloud-1"]);
  let vaultDir = "";
  let report: Awaited<ReturnType<typeof fixVault>>;
  let cloudOnlyBefore = "";
  beforeAll(async () => {
    vaultDir = await makeVault(edgeCaseVault());
    cloudOnlyBefore = await readFile(join(vaultDir, ".kaipu", "Cloud.json"), "utf8");
    report = await fixVault(vaultDir, { cloud, retry: noWait, now: () => T0 + 60_000 });
  }, 60_000);
  afterAll(async () => {
    await rm(vaultDir, { recursive: true, force: true });
  });
  const read = (path: string) => readFile(join(vaultDir, path), "utf8");
  const readJson = async (path: string) => JSON.parse(await read(path));

  it("leaves only listed findings, with nothing failed or kept", async () => {
    expect(report.failed).toEqual([]);
    expect(report.kept).toEqual([]);
    const { findings } = await scanVault({ directory: vaultDir, cloud });
    expect(findings.filter((f) => f.fixable)).toEqual([]);
    expect(findings.map((f) => f.kind).sort()).toEqual([
      "duplicate-identity",
      "duplicate-identity",
      "not-recognized",
      "shared-companion",
      "shared-companion",
      "stem-conflict",
      "stem-conflict",
      "unreadable-record",
    ]);
  });

  it("old titles become the default name, with suffixes in capture order (N6), tags and companions kept", async () => {
    const name = defaultCaptureName("recording", new Date(T0));
    expect(await readJson(`.kaipu/${name}.json`)).toMatchObject({
      assetId: "legacy-a",
      title: name,
      tagIds: ["tag-1"],
    });
    expect(await read(`${name}.mp4`)).toBe("payload:legacy-a");
    expect(await read(`.kaipu/${name}.jpg`)).toBe("payload:legacy-a-poster");
    expect(await read(`.kaipu/${name}.edit.json`)).toBe("payload:legacy-a-session");
    expect((await readJson(`.kaipu/${name} (2).json`)).assetId).toBe("legacy-b");
  });

  it("a chain moves without suffixes; a cycle ends with one ' (2)'; 101 equal titles all align", async () => {
    for (const stem of ["B", "C", "D", "E", "F"]) {
      const from = String.fromCharCode(stem.charCodeAt(0) - 1);
      expect((await readJson(`.kaipu/${stem}.json`)).assetId, stem).toBe(`chain-${from}`);
      expect(await read(`${stem}.mp4`)).toBe(`payload:chain-${from}`);
    }
    const root = await readdir(vaultDir);
    expect(root).not.toContain("A.mp4");
    const cycle = root.filter((n) => /^[XY]( \(2\))?\.mp4$/.test(n)).sort();
    expect(cycle).toHaveLength(2);
    expect(cycle.filter((n) => n.includes("(2)"))).toHaveLength(1);
    const copies = root.filter((n) => n.startsWith("Demo copy"));
    expect(copies).toHaveLength(101);
    expect(copies).toContain("Demo copy.mp4");
    expect(copies).toContain("Demo copy (99).mp4");
  });

  it("a Finder rename becomes a new item; its old record goes to orphans with a manifest", async () => {
    const items = await new LibraryVault(vaultDir).list();
    const adopted = items.find((i) => i.id === "Renamed in Finder")!;
    expect(adopted.title).toBe("Renamed in Finder");
    expect(adopted.assetId).not.toBe("finder");
    expect(report.orphansDir).toMatch(/^\.kaipu\/orphans\/[^/]+$/);
    const manifest = await readJson(`${report.orphansDir}/manifest.json`);
    const entry = manifest.entries.find((e: { assetId?: string }) => e.assetId === "finder");
    expect(entry).toMatchObject({ status: "complete", title: "Before" });
    expect(await read(`${report.orphansDir}/Before.jpg`)).toBe("payload:finder-poster");
    expect((await readJson(`${report.orphansDir}/Before.json`)).tagIds).toEqual(["t"]);
  });

  it("a record whose identity is in the catalog becomes cloud-only; one already cloud-only is untouched", async () => {
    expect((await readJson(".kaipu/InCatalog.json")).localRemovedAt).toBe(T0 + 60_000);
    expect(await read(".kaipu/Cloud.json")).toBe(cloudOnlyBefore);
  });

  // Last: it runs Fix all again.
  it("a second Fix all finds nothing to do and only writes its own log", async () => {
    const before = await snapshot(vaultDir);
    const again = await fixVault(vaultDir, { cloud, retry: noWait, now: () => T0 + 60_000 });
    expect(again).toMatchObject({ fixed: 0, movedToOrphans: 0, failed: [], kept: [] });
    expect(again.orphansDir).toBeNull();
    const after = await snapshot(vaultDir);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    expect(changed.every((k) => k.startsWith(".kaipu/reconcile"))).toBe(true);
  });
});

describe("fixVault — renames are planned from a fresh scan", () => {
  it("an adopted fullwidth name is titled as on disk, then moves to its NFKC stem", async () => {
    directory = await makeVault({ "\uFF21.mp4": "payload:fullwidth" });
    const report = await fix();
    expect(report).toMatchObject({ fixed: 1, failed: [], kept: [] });
    expect(await readFile(join(directory, "A.mp4"), "utf8")).toBe("payload:fullwidth");
    expect((await json(".kaipu/A.json")).title).toBe("\uFF21");
    expect(await fixable()).toEqual([]);
  });
});

describe("fixVault — kept, not forced", () => {
  it("an item open in the editor keeps its name (C2); the next press picks it up", async () => {
    directory = await makeVault({
      "old.mp4": "v",
      ".kaipu/old.json": sidecar({ assetId: "e1", title: "New" }),
    });
    const report = await fix("unknown", {
      isEditing: (_id: string, assetId: string) => assetId === "e1",
    });
    expect(report.kept).toEqual([{ path: "old.mp4", reason: "editing" }]);
    expect(await readdir(directory)).toContain("old.mp4");
    const next = await fix();
    expect(next.fixed).toBe(1);
    expect(await readdir(directory)).toContain("New.mp4");
  });
});

describe("fixVault — every payload survives a failure at any point", () => {
  it("fails every rename from the n-th on, then a clean run finishes the job", async () => {
    const small = {
      "recording-2026-10-30-00-57-30.mp4": "payload:a",
      ".kaipu/recording-2026-10-30-00-57-30.json": sidecar({
        assetId: "a",
        createdAt: T0,
        title: "Recording — 10/29/2026, 7:57:30 PM",
        tagIds: ["tag-a"],
      }),
      ".kaipu/recording-2026-10-30-00-57-30.jpg": "payload:a-poster",
      ".kaipu/recording-2026-10-30-00-57-30.assets/s.png": "payload:a-slide",
      "X.mp4": "payload:x",
      ".kaipu/X.json": sidecar({ assetId: "x", title: "Y", createdAt: T0 }),
      "Y.mp4": "payload:y",
      ".kaipu/Y.json": sidecar({ assetId: "y", title: "X", createdAt: T0 + 1 }),
      "Fresh.mp4": "payload:fresh",
      ".kaipu/Gone.json": sidecar({ assetId: "gone", title: "Gone" }),
      ".kaipu/Gone.jpg": "payload:gone-poster",
      ".kaipu/Lost.jpg": "payload:lost",
    };
    const payloads = Object.values(small).filter((v) => v.startsWith("payload:"));
    const identities = ["a", "x", "y", "gone"];

    // Count the renames a clean run makes, then fail from each of them.
    directory = await makeVault(small);
    failure.calls = 0;
    await fix();
    const total = failure.calls;
    await rm(directory, { recursive: true, force: true });
    expect(total).toBeGreaterThan(5);

    for (let n = 1; n <= total; n++) {
      directory = await makeVault(small);
      failure.calls = 0;
      failure.from = n;
      await fix().catch(() => undefined);
      failure.from = Infinity;

      const contents = await Promise.all(
        (await listFiles(directory)).map((path) => readFile(join(directory, path), "utf8")),
      );
      for (const payload of payloads) expect(contents, `${payload} after #${n}`).toContain(payload);
      for (const id of identities) {
        expect(
          contents.some((c) => c.includes(`"assetId": "${id}"`) || c.includes(`"assetId":"${id}"`)),
          `identity ${id} after #${n}`,
        ).toBe(true);
      }

      const report = await fix();
      expect(report.failed, `retry after #${n}`).toEqual([]);
      expect(await fixable(), `converged after #${n}`).toEqual([]);
      await rm(directory, { recursive: true, force: true });
    }
    directory = "";
  });
});

describe("orphan manifests", () => {
  it("a pending entry is completed into its own run folder; a reused source is not taken", async () => {
    directory = await makeVault({
      ".kaipu/orphans/run-1/manifest.json": JSON.stringify({
        version: 1,
        runId: "run-1",
        entries: [
          {
            kind: "missing-media",
            stem: "Gone",
            title: "Gone",
            assetId: "g",
            status: "pending",
            files: [
              { from: ".kaipu/Gone.jpg", to: "Gone.jpg" },
              { from: ".kaipu/Gone.json", to: "Gone.json" },
            ],
          },
        ],
      }),
      // The poster moved before the crash; a new capture since reused the stem's poster path.
      ".kaipu/orphans/run-1/Gone.jpg": "payload:old-poster",
      ".kaipu/Gone.jpg": "payload:new-poster",
      ".kaipu/Gone.json": sidecar({ assetId: "g", title: "Gone" }),
    });
    const result = await resumeOrphanManifests(directory);
    expect(result.conflicts).toEqual([".kaipu/Gone.jpg"]);
    expect(await readFile(join(directory, ".kaipu", "Gone.jpg"), "utf8")).toBe(
      "payload:new-poster",
    );
    expect(await readFile(join(directory, ".kaipu/orphans/run-1/Gone.jpg"), "utf8")).toBe(
      "payload:old-poster",
    );
    expect((await json(".kaipu/orphans/run-1/Gone.json")).assetId).toBe("g");
    expect((await json(".kaipu/orphans/run-1/manifest.json")).entries[0].status).toBe("complete");
  });

  it("each run gets its own folder, and an orphan destination is never overwritten", async () => {
    directory = await makeVault({ ".kaipu/Lost.jpg": "one" });
    const first = await fix();
    await writeFile(join(directory, ".kaipu", "Lost.jpg"), "two");
    const second = await fix();
    expect(first.orphansDir).not.toBe(second.orphansDir);
    expect(await readFile(join(directory, first.orphansDir!, "Lost.jpg"), "utf8")).toBe("one");
    expect(await readFile(join(directory, second.orphansDir!, "Lost.jpg"), "utf8")).toBe("two");
  });
});

describe("an unreadable record survives everything (F9)", () => {
  it("scan → fix another item → refresh → backfill leaves it byte-identical", async () => {
    directory = await makeVault({
      "Bad.mp4": "v",
      ".kaipu/Bad.json": '{"title": "Mine", "tagIds": ["x"]',
      "other.mp4": "v",
      ".kaipu/other.json": sidecar({ assetId: "o", title: "Other" }),
    });
    const before = await readFile(join(directory, ".kaipu", "Bad.json"));
    await scanVault({ directory, cloud: "unknown" });
    await fix();
    const vault = new LibraryVault(directory);
    expect((await vault.list()).find((i) => i.id === "Bad")!.readable).toBe(false);
    await vault.backfill("Bad", { durationSeconds: 1, thumbnail: null }).catch(() => undefined);
    expect(await readFile(join(directory, ".kaipu", "Bad.json"))).toEqual(before);
    expect(await readdir(directory)).toContain("Other.mp4");
  });
});

describe("the tag registry belongs to the vault, never to media named `tags`", () => {
  it("tags.mp4 is listed only; Fix all, a refresh and every mutation leave the registry byte-identical", async () => {
    const registry = JSON.stringify({ version: 1, tags: [{ id: "t1", name: "Work" }] }, null, 2);
    directory = await makeVault({
      "tags.mp4": "payload:tags-media",
      ".kaipu/tags.json": registry,
      "other.mp4": "payload:other",
      ".kaipu/other.json": sidecar({ assetId: "o", title: "Other" }),
    });
    const registryBytes = () => readFile(join(directory, ".kaipu", "tags.json"), "utf8");

    const scanned = (await scanVault({ directory, cloud: "unknown" })).findings;
    expect(scanned.find((f) => f.path === "tags.mp4")).toMatchObject({ fixable: false });

    const report = await fix();
    expect(report.failed).toEqual([]);
    expect(await registryBytes()).toBe(registry);
    expect(await readdir(directory)).toEqual(expect.arrayContaining(["tags.mp4", "Other.mp4"]));

    const vault = new LibraryVault(directory);
    const listed = await vault.list();
    expect(listed.find((i) => i.id === "tags")!.readable).toBe(false);
    for (const mutation of [
      () => vault.renameItem({ id: "tags", assetId: "x" }, "Renamed"),
      () => vault.writeMeta("tags", { title: "x" }),
      () => vault.adoptMedia("tags", { title: "x", createdAt: T0 }),
      () => vault.removeLocalCopy("tags"),
    ]) {
      await mutation().catch(() => undefined);
    }
    expect(await registryBytes()).toBe(registry);
    expect(await readFile(join(directory, "tags.mp4"), "utf8")).toBe("payload:tags-media");
    expect(await fixable()).toEqual([]);
  });
});

describe("scanVault — 10k items (F8)", () => {
  it("scans a 10k-item vault (smoke timing, no threshold)", { timeout: 120_000 }, async () => {
    directory = await makeVault({});
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 10_000; i++) {
      writes.push(writeFile(join(directory, `item ${i}.mp4`), "v"));
      writes.push(
        writeFile(
          join(directory, ".kaipu", `item ${i}.json`),
          sidecar({ assetId: `i${i}`, title: `item ${i}` }),
        ),
      );
      if (writes.length > 500) await Promise.all(writes.splice(0));
    }
    await Promise.all(writes);
    const started = performance.now();
    const { findings } = await scanVault({ directory, cloud: "unknown" });
    console.info(`[reconcile] 10k-item scan: ${Math.round(performance.now() - started)} ms`);
    expect(findings).toEqual([]);
  });
});
