import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GifSaveMeta } from "@shared/types/ipc";
import type { EvictionProbe } from "./dataless";
import { saveGif } from "./gif-save";
import { importVideoFile } from "./import-video";
import { LibraryVault } from "./library-vault";
import { fixVault } from "./vault-reconcile";
import { sidecar } from "./vault-reconcile.test-helpers";

/**
 * Writers in a synced workspace (spec, decisions 4 and 15): they stage outside the folder the
 * provider uploads and place by `rename`, never by a hard link (a hard link inside a Google
 * Drive folder renames the cloud item). `link` is counted and every `rename` is recorded, so
 * each test asserts both, and the control shows the same writer does link in a plain folder.
 */
const hooks = vi.hoisted(() => ({ links: 0, renames: [] as { from: string; to: string }[] }));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (from: string, to: string) => {
      hooks.links += 1;
      return actual.link(from, to);
    },
    rename: async (from: string, to: string) => {
      hooks.renames.push({ from: String(from), to: String(to) });
      return actual.rename(from, to);
    },
  };
});

const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b]);
const noEviction: EvictionProbe = async () => new Set();

let root: string;
let folder: string;
let staging: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kaipu-synced-writers-"));
  folder = join(root, "synced");
  staging = join(root, "scratch", "tmp");
  await mkdir(join(folder, ".kaipu"), { recursive: true });
  hooks.links = 0;
  hooks.renames = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const synced = (probe = noEviction): LibraryVault =>
  new LibraryVault(folder, "ws-synced", undefined, probe, staging);
const stagedRenames = (): { from: string; to: string }[] =>
  hooks.renames.filter((r) => r.from.startsWith(staging));
/** The staged renames that placed a media file (a sidecar or a poster goes to `.kaipu/`). */
const stagedMedia = (): { from: string; to: string }[] =>
  stagedRenames().filter((r) => !r.to.startsWith(join(folder, ".kaipu")));

describe("GIF export", () => {
  const meta: GifSaveMeta = {
    title: "Demo",
    durationSeconds: 1,
    width: 1,
    height: 1,
    fps: 10,
    thumbnail: null,
    derivedFromAssetId: null,
  };

  it("stages in the scratch folder and places by rename, with no hard link", async () => {
    const vault = synced();
    const saved = await saveGif({ vaultDir: () => folder, vault: () => vault }, GIF, meta);

    expect(hooks.links).toBe(0);
    expect(stagedMedia()).toHaveLength(1);
    expect(stagedMedia()[0]!.to).toBe(join(folder, `${saved.id}.gif`));
    expect(await readFile(join(folder, `${saved.id}.gif`))).toEqual(Buffer.from(GIF));
    // Nothing of the staging is left behind, in either folder.
    expect(await readdir(staging)).toEqual([]);
    expect((await readdir(folder)).filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  it("control: a plain folder still places by link, so this test would catch one", async () => {
    await saveGif({ vaultDir: () => folder }, GIF, meta);
    expect(hooks.links).toBeGreaterThan(0);
  });
});

describe("screenshot writer", () => {
  it("a new PNG stages in the scratch folder and places by rename", async () => {
    const vault = synced();
    await vault.writeImage("shot", Buffer.from("png"));

    expect(hooks.links).toBe(0);
    expect(stagedMedia()).toHaveLength(1);
    expect(await readFile(join(folder, "shot.png"), "utf-8")).toBe("png");
  });

  it("replacing the PNG stages in the scratch folder too: no .part is ever inside the folder", async () => {
    await writeFile(join(folder, "shot.png"), "old");
    const vault = synced();
    await vault.writeImage("shot", Buffer.from("new"), { replace: true });

    expect(stagedMedia()).toHaveLength(1);
    expect(stagedMedia()[0]!.to).toBe(join(folder, "shot.png"));
    expect(hooks.renames.filter((r) => r.from.startsWith(folder))).toEqual([]);
    expect(await readFile(join(folder, "shot.png"), "utf-8")).toBe("new");
    expect(await readdir(staging)).toEqual([]);
  });

  it("control: a plain folder replaces through a temp file beside the PNG", async () => {
    await writeFile(join(folder, "shot.png"), "old");
    await new LibraryVault(folder, "ws-plain").writeImage("shot", Buffer.from("new"), {
      replace: true,
    });
    expect(hooks.renames.filter((r) => r.from.startsWith(folder))).toHaveLength(1);
  });
});

describe("video import", () => {
  it("copies into the scratch folder, probes the copy, and places by rename", async () => {
    const source = join(root, "source.mp4");
    await writeFile(source, "video-bytes");
    const probe = vi.fn(async (path: string) => {
      expect(path.startsWith(staging)).toBe(true);
      return { durationSeconds: 5, width: 10, height: 10 };
    });

    const result = await importVideoFile(source, {
      vaultDir: () => folder,
      vault: synced,
      newId: () => "Imported",
      now: () => 1_000,
      probe,
    });

    expect(typeof result).toBe("object");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(hooks.links).toBe(0);
    expect(stagedMedia()).toHaveLength(1);
    expect(await readFile(join(folder, "Imported.mp4"), "utf-8")).toBe("video-bytes");
    expect((await readdir(folder)).filter((name) => name.endsWith(".part"))).toEqual([]);
  });
});

describe("rename", () => {
  async function seed(id: string): Promise<void> {
    await writeFile(join(folder, `${id}.mp4`), "media");
    await writeFile(
      join(folder, ".kaipu", `${id}.json`),
      sidecar({ assetId: "asset-1", title: "Old", createdAt: Date.UTC(2026, 9, 30, 12) }),
    );
  }
  const rename = (vault: LibraryVault, id: string, title: string) =>
    vault.renameItem({ id, assetId: "asset-1" }, title);

  it("moves the media by rename, never by a hard link", async () => {
    await seed("old");
    const result = await rename(synced(), "old", "Sprint demo");

    expect(result.file).toBe("renamed");
    expect(hooks.links).toBe(0);
    expect(await readFile(join(folder, `${result.recording.id}.mp4`), "utf-8")).toBe("media");
  });

  // On a case-sensitive volume `Demo` is simply a free name, so this is the ordinary rename;
  // the temporary-name hop itself is pinned in safe-place.by-rename.test.ts (renameCaseOnlyByRename).
  it("a case-only title change also goes by rename: no hard link, whatever the volume's case rules", async () => {
    await seed("demo");
    const result = await rename(synced(), "demo", "Demo");

    expect(result.file).toBe("renamed");
    expect(hooks.links).toBe(0);
    expect(await readdir(folder)).toContain("Demo.mp4");
    expect(await readdir(folder)).not.toContain("demo.mp4");
    expect((await readdir(folder)).filter((name) => name.includes(".case"))).toEqual([]);
    expect(await readFile(join(folder, "Demo.mp4"), "utf-8")).toBe("media");
  });

  it("control: a plain folder does link on a case-only rename, so this test would catch one", async () => {
    await seed("demo");
    await new LibraryVault(folder, "ws-plain").renameItem(
      { id: "demo", assetId: "asset-1" },
      "Demo",
    );
    expect(hooks.links).toBeGreaterThan(0);
  });

  it("keeps the old name, and the title, when a companion is offloaded: copying it would download it", async () => {
    await seed("old");
    const poster = join(folder, ".kaipu", "old.jpg");
    await writeFile(poster, "poster");

    const vault = synced(async (paths) => new Set(paths.filter((path) => path === poster)));
    const result = await rename(vault, "old", "Sprint demo");

    expect(result).toMatchObject({ file: "kept-old-name", reason: "evicted" });
    expect(result.recording.title).toBe("Sprint demo");
    expect(await readFile(join(folder, "old.mp4"), "utf-8")).toBe("media");
    expect(await readdir(folder)).not.toContain("Sprint demo.mp4");
    // The new sidecar was written before the companions were checked: the refusal removes it.
    expect(
      (await readdir(join(folder, ".kaipu"))).filter((n) => n.startsWith("Sprint demo")),
    ).toEqual([]);
  });
});

describe("sidecar, poster and cursor track writes", () => {
  it("stage in the scratch folder: no temp file is created inside the synced folder", async () => {
    const vault = synced();
    await vault.writeThumbnail("clip", Buffer.from("jpg"));
    await vault.writeCursorTrack("clip", "{}");
    const { id } = await vault.reserve({ kind: "recording", title: "Clip", createdAt: 1 });

    const staged = stagedRenames().map((r) => r.to);
    expect(staged).toContain(join(folder, ".kaipu", "clip.jpg"));
    expect(staged).toContain(join(folder, ".kaipu", `${id}.json`));
    // Every rename that reached the folder started in the scratch folder.
    expect(hooks.renames.filter((r) => r.from.startsWith(folder))).toEqual([]);
    expect(await readdir(staging)).toEqual([]);
    expect((await readdir(join(folder, ".kaipu"))).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("control: a plain folder writes through a temp file beside the target", async () => {
    await new LibraryVault(folder, "ws-plain").writeThumbnail("clip", Buffer.from("jpg"));
    expect(hooks.renames.filter((r) => r.from.startsWith(folder))).toHaveLength(1);
  });
});

describe("Check and fix files", () => {
  async function seedOrphan(): Promise<void> {
    await writeFile(
      join(folder, ".kaipu", "Lost.json"),
      sidecar({ assetId: "lost", title: "Lost" }),
    );
    await writeFile(join(folder, ".kaipu", "Lost.jpg"), "poster");
  }

  it("moves an orphan into the run folder by rename, never by a hard link", async () => {
    await seedOrphan();
    const report = await fixVault(folder, { cloud: "unknown", vault: synced() });

    expect(report.movedToOrphans).toBeGreaterThan(0);
    expect(hooks.links).toBe(0);
    expect(await readFile(join(folder, report.orphansDir!, "Lost.jpg"), "utf-8")).toBe("poster");
  });

  it("control: a plain folder places the orphan by link", async () => {
    await seedOrphan();
    await fixVault(folder, { cloud: "unknown" });
    expect(hooks.links).toBeGreaterThan(0);
  });
});
