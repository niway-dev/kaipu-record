import { afterEach, describe, expect, it } from "vitest";
import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { defaultCaptureName } from "@shared/default-capture-name";
import { humanizeId } from "./library-vault";
import { isStaleAutoTitle, scanVault, type ScanFinding } from "./vault-reconcile";
import { makeVault, sidecar, snapshot } from "./vault-reconcile.test-helpers";

const CREATED = new Date(2026, 9, 29, 19, 57, 30).getTime();
const canChmod = process.platform !== "win32" && process.getuid?.() !== 0;

let directory = "";
afterEach(async () => {
  if (!directory) return;
  await chmod(join(directory, ".kaipu"), 0o755).catch(() => {});
  await rm(directory, { recursive: true, force: true });
  directory = "";
});

async function scan(
  files: Parameters<typeof makeVault>[0],
  cloud: ReadonlySet<string> | "unknown" = "unknown",
) {
  directory = await makeVault(files);
  const { findings } = await scanVault({ directory, cloud });
  const at = (path: string): ScanFinding | undefined => findings.find((f) => f.path === path);
  return { findings, at };
}

describe("isStaleAutoTitle (N1, N12)", () => {
  it.each([
    "Recording — 10/29/2026, 7:57:30 PM",
    "Recording — 10/29/2026, 7:57:30 PM",
    "Screenshot — 29/10/2026, 19:57:30",
    "Screenshot — 29.10.2026, 19:57:30",
    "Screenshot — 2026/10/29 19:57:30",
    "Pasted image — 2026. 10. 29. 오후 7:57:30",
    "Imagen pegada — 29/10/2026, 7:57:30 p. m.",
    "Captura — 29/10/2026, 7:57:30 a. m.",
    "Recording — 2026/10/29 午後7:57:30",
    "Screenshot — 2026-10-07",
  ])("%s is an old automatic title", (title) => {
    expect(isStaleAutoTitle(title)).toBe(true);
  });

  it.each([
    "Recording — my demo",
    "Recording — 10/29/2026 final",
    "Recording 10/29/2026",
    "Demo — 10/29/2026",
    "Recording — ",
    "Kaipu Recording 2026-10-29 at 19.57.30",
  ])("%s is user-written (or new)", (title) => {
    expect(isStaleAutoTitle(title)).toBe(false);
  });
});

describe("scanVault — names", () => {
  it("finds old automatic titles, legacy untitled items and stems that do not follow their title", async () => {
    const { findings, at } = await scan({
      "recording-2026-10-30-00-57-30.mp4": "v",
      ".kaipu/recording-2026-10-30-00-57-30.json": sidecar({
        assetId: "a1",
        createdAt: CREATED,
        title: "Recording — 10/29/2026, 7:57:30 PM",
      }),
      // N5: the kind comes from the extension, not from the title.
      "Shot.png": "p",
      ".kaipu/Shot.json": sidecar({
        assetId: "a2",
        createdAt: CREATED,
        title: "Recording — 1/2/2026",
      }),
      "screenshot-2026-10-15T21-37-10-853Z.png": "p",
      ".kaipu/screenshot-2026-10-15T21-37-10-853Z.json": sidecar({ assetId: "a3" }),
      "Demo.mp4": "v",
      ".kaipu/Demo.json": sidecar({ assetId: "a4", title: "Demo" }),
      "Demo (2).mp4": "v",
      ".kaipu/Demo (2).json": sidecar({ assetId: "a5", title: "Demo" }),
      "Old name.mp4": "v",
      ".kaipu/Old name.json": sidecar({ assetId: "a6", title: "Sprint: part 1/2" }),
      // N8: a case-only difference is a mismatch.
      "lower.mp4": "v",
      ".kaipu/lower.json": sidecar({ assetId: "a7", title: "Lower" }),
      // N7: an NFD stem is aligned with its NFC title.
      "Café.mp4": "v",
      ".kaipu/Café.json": sidecar({ assetId: "a8", title: "Café" }),
      // N3: a title that sanitizes to nothing takes the default name.
      "q.mp4": "v",
      ".kaipu/q.json": sidecar({ assetId: "a9", createdAt: CREATED, title: "???" }),
      // I2: a v1 sidecar without an identity is not a finding.
      "V1.mp4": "v",
      ".kaipu/V1.json": JSON.stringify({ title: "V1" }),
    });

    expect(at("recording-2026-10-30-00-57-30.mp4")).toMatchObject({
      kind: "stale-auto-title",
      fixable: true,
      newTitle: defaultCaptureName("recording", new Date(CREATED)),
      newName: `${defaultCaptureName("recording", new Date(CREATED))}.mp4`,
    });
    expect(at("Shot.png")).toMatchObject({
      kind: "stale-auto-title",
      newTitle: defaultCaptureName("screenshot", new Date(CREATED)),
    });
    expect(at("screenshot-2026-10-15T21-37-10-853Z.png")).toMatchObject({
      kind: "untitled-legacy",
      newTitle: humanizeId("screenshot-2026-10-15T21-37-10-853Z"),
    });
    expect(at("Old name.mp4")).toMatchObject({
      kind: "name-mismatch",
      title: "Sprint: part 1/2",
      newName: "Sprint part 1 2.mp4",
    });
    expect(at("lower.mp4")?.kind).toBe("name-mismatch");
    expect(at("q.mp4")).toMatchObject({
      kind: "name-mismatch",
      newName: `${defaultCaptureName("recording", new Date(CREATED))}.mp4`,
    });
    for (const aligned of ["Demo.mp4", "Demo (2).mp4", "Café.mp4", "V1.mp4"]) {
      expect(at(aligned), aligned).toBeUndefined();
    }
    expect(findings).toHaveLength(6);
  });

  it("adopts media without a record, under its disk name (a legacy stem reads as its default name)", async () => {
    const { at } = await scan({
      "Fresh.mp4": "v",
      "recording-2026-10-30-00-57-30.mp4": "v",
    });
    expect(at("Fresh.mp4")).toMatchObject({
      kind: "missing-sidecar",
      fixable: true,
      newTitle: "Fresh",
    });
    expect(at("recording-2026-10-30-00-57-30.mp4")).toMatchObject({
      kind: "missing-sidecar",
      newTitle: humanizeId("recording-2026-10-30-00-57-30"),
    });
  });
});

describe("scanVault — what the folder may contain", () => {
  it("skips dotfiles, partial files, subfolders and non-media; reports an uppercase extension", async () => {
    const { findings, at } = await scan({
      ".DS_Store": "x",
      "._Demo.mp4": "x",
      ".Demo.mp4.icloud": "x",
      "Thumbs.db": "x",
      "desktop.ini": "x",
      "notes.txt": "x",
      "Part.mp4.part": "x",
      "Down.mp4.crdownload": "x",
      "Empty.mp4": "",
      ".kaipu/Empty.jpg": "j",
      "Sub/A.mp4": "v",
      "Folder.mp4": { dir: true },
      "real/Target.mp4": "v",
      "Link.mp4": { symlink: "real/Target.mp4" },
      ".kaipu/Link.json": sidecar({ assetId: "l1", title: "Something else" }),
      "Upper.MP4": "v",
      ".kaipu/Upper.json": sidecar({ assetId: "u1", title: "Upper" }),
      ".kaipu/Upper.jpg": "j",
    });
    expect(at("Upper.MP4")).toMatchObject({ kind: "not-recognized", fixable: false });
    // Present-but-ignored media protects its companions (F3, F4, F5).
    expect(findings).toHaveLength(1);
  });

  it("an unreachable folder is an error, never an empty vault (F7)", async () => {
    await expect(
      scanVault({ directory: join("/nonexistent", "kaipu-vault"), cloud: "unknown" }),
    ).rejects.toThrow();
  });

  it.skipIf(!canChmod)("an unreadable .kaipu folder is an error too (F7)", async () => {
    directory = await makeVault({ "Demo.mp4": "v", ".kaipu/Demo.json": sidecar({ assetId: "d" }) });
    await chmod(join(directory, ".kaipu"), 0o000);
    await expect(scanVault({ directory, cloud: "unknown" })).rejects.toThrow();
  });
});

describe("scanVault — records without media, and orphans", () => {
  it("classifies dead records: cloud-only untouched, catalog → cloud-only, remnants and the rest → orphans", async () => {
    const { findings, at } = await scan(
      {
        // M3: renamed or deleted in Finder.
        ".kaipu/Gone.json": sidecar({ assetId: "g1", title: "Gone" }),
        ".kaipu/Gone.jpg": "j",
        ".kaipu/Gone.edit.json": "{}",
        ".kaipu/Gone.assets/s1.png": "p",
        // M1: cloud-only, never touched, with its companions.
        ".kaipu/Cloud.json": sidecar({ assetId: "c0", localRemovedAt: 1 }),
        ".kaipu/Cloud.jpg": "j",
        // M2: its identity is in the cached catalog.
        ".kaipu/InCatalog.json": sidecar({ assetId: "c1", title: "In catalog" }),
        // A committed rename's remnant: the identity lives at another stem with media,
        // even though the catalog knows it (classified before M2).
        "New.mp4": "v",
        ".kaipu/New.json": sidecar({ assetId: "r1", title: "New" }),
        ".kaipu/Old.json": sidecar({ assetId: "r1", title: "New" }),
        ".kaipu/Old.jpg": "j",
        // M4: companions with no owner at all.
        ".kaipu/Lost.jpg": "j",
        ".kaipu/Lost.cursor.json": "{}",
        // M4 protected: owned both ways (Talk's edit session).
        "Talk.mp4": "v",
        ".kaipu/Talk.json": sidecar({ assetId: "t1", title: "Talk" }),
        ".kaipu/Talk.edit.json": "{}",
        ".kaipu/Talk.edit.meta.json": "{}",
        ".kaipu/Talk.assets/x.png": "p",
        // M5: never touched.
        ".kaipu/tags.json": "{}",
        ".kaipu/reconcile/old.json": "{}",
        ".kaipu/orphans/run/manifest.json": JSON.stringify({
          version: 1,
          runId: "run",
          entries: [],
        }),
        ".kaipu/drag/Demo.mp4": "v",
        ".kaipu/tmp/kaipu-rec-1.mp4.part": "v",
        ".kaipu/X.cursor.json.tmp": "{}",
        ".kaipu/X.json.123.abcd.tmp": "{}",
        ".kaipu/README": "x",
      },
      new Set(["c1", "r1"]),
    );
    expect(at(".kaipu/Gone.json")).toMatchObject({
      kind: "missing-media",
      action: "to-orphans",
      title: "Gone",
    });
    expect([...at(".kaipu/Gone.json")!.files!].sort()).toEqual([
      ".kaipu/Gone.assets",
      ".kaipu/Gone.edit.json",
      ".kaipu/Gone.jpg",
      ".kaipu/Gone.json",
    ]);
    expect(at(".kaipu/InCatalog.json")).toMatchObject({
      kind: "missing-media",
      action: "cloud-only",
    });
    expect(at(".kaipu/Old.json")).toMatchObject({ kind: "missing-media", action: "to-orphans" });
    expect([...at(".kaipu/Old.json")!.files!].sort()).toEqual([
      ".kaipu/Old.jpg",
      ".kaipu/Old.json",
    ]);
    const lost = findings.filter((f) => f.kind === "orphan-companion");
    expect(lost.flatMap((f) => f.files ?? []).sort()).toEqual([
      ".kaipu/Lost.cursor.json",
      ".kaipu/Lost.jpg",
    ]);
    expect(findings).toHaveLength(3 + lost.length);
  });

  it("legacy shared companion paths: both items listed, nothing orphaned (M7)", async () => {
    const { findings, at } = await scan({
      "Demo.mp4": "v",
      ".kaipu/Demo.json": sidecar({ assetId: "d1", title: "Something" }),
      "Demo.edit.mp4": "v",
      ".kaipu/Demo.edit.json": sidecar({ assetId: "d2", title: "Other" }),
    });
    expect(at("Demo.mp4")).toMatchObject({ kind: "shared-companion", fixable: false });
    expect(at("Demo.edit.mp4")).toMatchObject({ kind: "shared-companion", fixable: false });
    expect(findings).toHaveLength(2);
  });
});

describe("scanVault — listed, never fixed", () => {
  it("duplicate identities, two media on one stem and unreadable records", async () => {
    const { findings, at } = await scan({
      "A.mp4": "v",
      ".kaipu/A.json": sidecar({ assetId: "same", title: "A" }),
      "A copy.mp4": "v",
      ".kaipu/A copy.json": sidecar({ assetId: "same", title: "A" }),
      "Pair.mp4": "v",
      "Pair.png": "p",
      ".kaipu/Pair.json": sidecar({ assetId: "p1", title: "Whatever" }),
      "Bad.mp4": "v",
      ".kaipu/Bad.json": "{corrupt",
      ".kaipu/Bad.jpg": "j",
      ".kaipu/Dead.json": "[]",
      ".kaipu/Dead.jpg": "j",
    });
    expect(at("A.mp4")?.kind).toBe("duplicate-identity");
    expect(at("A copy.mp4")?.kind).toBe("duplicate-identity");
    expect(at("Pair.mp4")?.kind).toBe("stem-conflict");
    expect(at("Pair.png")?.kind).toBe("stem-conflict");
    expect(at(".kaipu/Bad.json")).toMatchObject({ kind: "unreadable-record", fixable: false });
    expect(at(".kaipu/Dead.json")).toMatchObject({ kind: "unreadable-record", fixable: false });
    expect(findings.every((f) => !f.fixable)).toBe(true);
    expect(findings).toHaveLength(6);
  });
});

describe("scanVault — a stem shared with ignored media (F3, F4, F5)", () => {
  it("is a stem conflict for every media file on it, recognized or not", async () => {
    const { findings, at } = await scan({
      "Demo.mp4": "v",
      ".kaipu/Demo.json": sidecar({ assetId: "d", title: "Renamed" }),
      "Demo.PNG": "ignored",
      ".kaipu/Demo.jpg": "j",
      "Blank.mp4": "v",
      ".kaipu/Blank.json": sidecar({ assetId: "b", title: "Other" }),
      "Blank.png": "",
      "real/Target.png": "p",
      "Linked.mp4": "v",
      "Linked.png": { symlink: "real/Target.png" },
    });
    for (const path of [
      "Demo.mp4",
      "Demo.PNG",
      "Blank.mp4",
      "Blank.png",
      "Linked.mp4",
      "Linked.png",
    ]) {
      expect(at(path)).toMatchObject({ kind: "stem-conflict", fixable: false });
    }
    expect(findings).toHaveLength(6);
  });
});

describe("scanVault — only reads", () => {
  it("leaves every byte and mtime as it was", async () => {
    directory = await makeVault({
      "legacy.mp4": "v",
      ".kaipu/Gone.json": sidecar({ assetId: "g" }),
      ".kaipu/Lost.jpg": "j",
      "V1.mp4": "v",
      ".kaipu/V1.json": JSON.stringify({ title: "Old title" }),
      "Bad.mp4": "v",
      ".kaipu/Bad.json": "{corrupt",
    });
    const before = await snapshot(directory);
    await scanVault({ directory, cloud: new Set(["g"]) });
    expect(await snapshot(directory)).toEqual(before);
  });
});
