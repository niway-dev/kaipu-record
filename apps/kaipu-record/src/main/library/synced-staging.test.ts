import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { VaultTagRepository } from "./tag-repository";
import { LibraryVault } from "./library-vault";
import { atomicWriteFile, setStagingResolver } from "./atomic-write";
import { fixVault } from "./vault-reconcile";
import { sidecar } from "./vault-reconcile.test-helpers";
import { writeTranscriptFileAtomic } from "../transcription/transcript-file";
import type { Transcript } from "../transcription/transcript-file";
import { writeCanvas } from "../screenshots/screenshot-canvas";
import { saveTextCache } from "../screenshots/screenshot-text";
import { writeIdentity } from "../workspaces/identity";
import { SETTINGS_FILE, writeFolderOverrides } from "../workspaces/settings-overrides";
import { saveSession } from "./video-edit-session";

/**
 * Every atomic write under a synced workspace (spec, Synced folders; NIW2-912): no temp file is
 * ever created inside the folder the provider uploads. The fs calls that create a file are
 * recorded (a write handle, `writeFile`, `copyFile`), so each test asserts that nothing was
 * created under the folder except by the final rename, and that the rename's source was outside.
 * The same writer in a plain folder is the control: it does create its temp file beside the
 * target, which proves the recorder would catch a leak.
 */
const hooks = vi.hoisted(() => ({
  created: [] as string[],
  renames: [] as { from: string; to: string }[],
  vaultDir: "",
}));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  const writing = /^(w|wx|a|ax|r\+|w\+)$/;
  return {
    ...actual,
    open: async (path: string, flags?: string, ...rest: unknown[]) => {
      if (typeof flags === "string" && writing.test(flags)) hooks.created.push(String(path));
      return (actual.open as (...args: unknown[]) => Promise<unknown>)(path, flags, ...rest);
    },
    writeFile: async (path: string, ...rest: unknown[]) => {
      hooks.created.push(String(path));
      return (actual.writeFile as (...args: unknown[]) => Promise<void>)(path, ...rest);
    },
    copyFile: async (from: string, to: string, ...rest: unknown[]) => {
      hooks.created.push(String(to));
      return (actual.copyFile as (...args: unknown[]) => Promise<void>)(from, to, ...rest);
    },
    rename: async (from: string, to: string) => {
      hooks.renames.push({ from: String(from), to: String(to) });
      return actual.rename(from, to);
    },
  };
});
vi.mock("./vault-location", () => ({
  vaultDirectory: () => ({ path: hooks.vaultDir, isCustom: false }),
}));

let root: string;
let folder: string;
let staging: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kaipu-synced-staging-"));
  folder = join(root, "synced");
  staging = join(root, "scratch", "tmp");
  hooks.vaultDir = folder;
  await mkdir(join(folder, ".kaipu"), { recursive: true });
});
afterEach(async () => {
  setStagingResolver(() => null);
  await rm(root, { recursive: true, force: true });
});

const inside = (path: string): boolean => path.startsWith(folder + sep);
/** Start recording after the test's own seeding, which is allowed to write in the folder. */
function record(): void {
  hooks.created = [];
  hooks.renames = [];
}
const isTemp = (name: string): boolean => /\.(tmp|part)$/.test(name);
/**
 * What the folder saw of a temp file: any file created under it, and any rename that took a
 * temp-named file from inside it (a rename of an existing file, like an orphan's move, is not one).
 */
const leaks = (): string[] => [
  ...hooks.created.filter(inside),
  ...hooks.renames
    .filter((r) => inside(r.to) && inside(r.from) && isTemp(r.from))
    .map((r) => r.from),
];
const stagedPlacements = (): number =>
  hooks.renames.filter((r) => r.from.startsWith(staging) && inside(r.to)).length;
/** Every file of the folder, recursively, relative to it. */
async function tree(dir = folder, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await tree(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}
/** Install the resolver the app installs, for this one synced folder. */
const syncFolder = (): void => setStagingResolver((target) => (inside(target) ? staging : null));
const syncedVault = (): LibraryVault =>
  new LibraryVault(folder, "ws-synced", undefined, undefined, staging);
const png = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("atomicWriteFile", () => {
  it("stages in the folder the resolver names for the target, and the folder only sees the rename", async () => {
    syncFolder();
    record();
    await atomicWriteFile(join(folder, ".kaipu", "a.json"), "{}");

    expect(leaks()).toEqual([]);
    expect(stagedPlacements()).toBe(1);
    expect(await readFile(join(folder, ".kaipu", "a.json"), "utf-8")).toBe("{}");
    expect(await readdir(staging)).toEqual([]);
  });

  it("control: a target the resolver does not claim gets its temp file beside it", async () => {
    syncFolder();
    record();
    await atomicWriteFile(join(root, "elsewhere.json"), "{}");

    expect(hooks.created).toHaveLength(1);
    expect(hooks.created[0]).toMatch(/elsewhere\.json\..*\.tmp$/);
  });

  it("null names no staging at all, whatever the resolver says", async () => {
    syncFolder();
    record();
    await atomicWriteFile(join(folder, "plain.json"), "{}", "tmp", null);

    expect(hooks.created.filter(inside)).toHaveLength(1);
  });
});

describe("transcript", () => {
  const transcript = (): Transcript => ({
    schemaVersion: 1,
    model: { id: "test-model", revision: "abc123", files: { "encoder.onnx": "deadbeef" } },
    engine: { name: "sherpa-onnx-offline", version: "1.13.8" },
    media: { contentHash: "aGFzaA==", durationMs: 60_000 },
    createdAt: "2026-11-15T00:00:00Z",
    segments: [{ id: "s1", startMs: 0, endMs: 30_000, status: "ok" }],
    unresolved: [],
    words: [{ id: "w1", segmentId: "s1", text: "Hoy", startMs: 0, endMs: 320, logProb: -0.1 }],
  });
  const path = (): string => join(folder, ".kaipu", "Demo.transcript.json");

  it("stages outside the synced folder", async () => {
    syncFolder();
    record();
    await writeTranscriptFileAtomic(path(), transcript());

    expect(leaks()).toEqual([]);
    expect(stagedPlacements()).toBe(1);
    expect(JSON.parse(await readFile(path(), "utf-8")).schemaVersion).toBe(1);
  });

  it("control: a plain folder writes its temp file beside the transcript", async () => {
    record();
    await writeTranscriptFileAtomic(path(), transcript());
    expect(hooks.created.filter(inside)).toHaveLength(1);
  });
});

describe("canvas document and text cache", () => {
  const payload = { docJson: '{"items":[]}', assets: [{ assetId: "base", png: png("png") }] };
  const meta = (name: string): string => join(folder, ".kaipu", name);

  it("a canvas document and its assets stage outside the synced folder", async () => {
    record();
    await writeCanvas(syncedVault(), "shot", payload);

    expect(leaks()).toEqual([]);
    expect(stagedPlacements()).toBe(2);
    expect(await readFile(meta("shot.canvas.json"), "utf-8")).toBe('{"items":[]}');
    expect(await readFile(join(meta("shot.assets"), "base.png"), "utf-8")).toBe("png");
  });

  it("control: a plain folder writes both through temp files beside them", async () => {
    record();
    await writeCanvas(new LibraryVault(folder, "ws-plain"), "shot", payload);
    expect(hooks.created.filter(inside)).toHaveLength(2);
  });

  it("the text cache stages outside the synced folder", async () => {
    const vault = syncedVault();
    await writeCanvas(vault, "shot", payload);
    record();
    await saveTextCache(vault, "shot", { assets: [{ assetId: "base", words: [] }] }, payload);

    expect(leaks()).toEqual([]);
    expect(stagedPlacements()).toBe(1);
    expect(JSON.parse(await readFile(meta("shot.text.json"), "utf-8")).schemaVersion).toBe(1);
  });

  it("control: a plain folder writes the text cache through a temp file beside it", async () => {
    const vault = new LibraryVault(folder, "ws-plain");
    await writeCanvas(vault, "shot", payload);
    record();
    await saveTextCache(vault, "shot", { assets: [{ assetId: "base", words: [] }] }, payload);
    expect(hooks.created.filter(inside)).toHaveLength(1);
  });
});

describe("tag registry", () => {
  const repo = (vault: LibraryVault) =>
    new VaultTagRepository(
      () => vault,
      () => "d-test",
    );

  it("tags.json stages outside the synced folder", async () => {
    record();
    await repo(syncedVault()).create("Client X", "amber");

    expect(leaks()).toEqual([]);
    expect(stagedPlacements()).toBeGreaterThanOrEqual(1);
    const saved = JSON.parse(await readFile(join(folder, ".kaipu", "tags.json"), "utf-8"));
    expect(saved.tags.map((tag: { name: string }) => tag.name)).toEqual(["Client X"]);
  });

  it("control: a plain folder writes tags.json through a temp file beside it", async () => {
    record();
    await repo(new LibraryVault(folder, "ws-plain")).create("Client X", "amber");
    expect(hooks.created.filter((path) => inside(path) && isTemp(path)).length).toBeGreaterThan(0);
  });
});

describe("edit session and edit meta", () => {
  async function seedMedia(): Promise<void> {
    await writeFile(join(folder, "rec-1.mp4"), "video");
  }

  it("the session JSON and its freshness stamp stage outside the synced folder", async () => {
    await seedMedia();
    syncFolder();
    record();
    await saveSession("rec-1", { sessionJson: '{"version":1}', assets: [] });

    expect(leaks()).toEqual([]);
    expect(stagedPlacements()).toBe(2);
    expect(await readFile(join(folder, ".kaipu", "rec-1.edit.json"), "utf-8")).toBe(
      '{"version":1}',
    );
    expect(
      JSON.parse(await readFile(join(folder, ".kaipu", "rec-1.edit.meta.json"), "utf-8")),
    ).toMatchObject({ sourceSizeBytes: 5 });
  });

  it("control: a plain folder writes both through temp files beside them", async () => {
    await seedMedia();
    record();
    await saveSession("rec-1", { sessionJson: '{"version":1}', assets: [] });
    expect(hooks.created.filter(inside)).toHaveLength(2);
  });
});

describe("check and fix files: orphan manifest and run log", () => {
  async function seedOrphan(): Promise<void> {
    await writeFile(
      join(folder, ".kaipu", "Lost.json"),
      sidecar({ assetId: "lost", title: "Lost" }),
    );
    await writeFile(join(folder, ".kaipu", "Lost.jpg"), "poster");
  }

  it("manifest.json and the run log stage outside the synced folder", async () => {
    await seedOrphan();
    syncFolder();
    record();
    const report = await fixVault(folder, { cloud: "unknown", vault: syncedVault() });

    expect(report.movedToOrphans).toBeGreaterThan(0);
    expect(leaks()).toEqual([]);
    expect(stagedPlacements()).toBeGreaterThanOrEqual(3); // two manifest writes and the log
    const files = await tree();
    expect(files.filter((name) => name.endsWith("manifest.json"))).toHaveLength(1);
    expect(files.filter((name) => name.includes("/reconcile/"))).toHaveLength(1);
    expect(files.filter(isTemp)).toEqual([]);
    const manifest = JSON.parse(
      await readFile(join(folder, report.orphansDir!, "manifest.json"), "utf-8"),
    );
    expect(manifest.entries[0]).toMatchObject({ stem: "Lost", status: "complete" });
  });

  it("control: a plain folder writes them through temp files beside them", async () => {
    await seedOrphan();
    record();
    await fixVault(folder, { cloud: "unknown" });
    expect(hooks.created.filter((path) => inside(path) && isTemp(path)).length).toBeGreaterThan(0);
  });
});

describe("workspace identity and folder overrides", () => {
  const identity = {
    version: 1 as const,
    id: "0194f2c0-0000-7000-8000-000000000001",
    name: "Work",
    color: "sky" as const,
    initials: "W",
    createdAt: 1_700_000_000_000,
  };

  it("identity.json stages outside the synced folder", async () => {
    syncFolder();
    record();
    await writeIdentity(folder, identity);

    expect(leaks()).toEqual([]);
    expect(stagedPlacements()).toBe(1);
    expect(
      JSON.parse(await readFile(join(folder, ".kaipu", "workspace", "identity.json"), "utf-8")),
    ).toMatchObject({ id: identity.id });
    expect((await tree()).filter(isTemp)).toEqual([]);
  });

  it("control: a plain folder writes identity.json through a temp file beside it", async () => {
    record();
    await writeIdentity(folder, identity);
    expect(hooks.created.filter(inside)).toHaveLength(1);
  });

  it("the folder's settings file stages outside the synced folder", async () => {
    syncFolder();
    record();
    const sha = await writeFolderOverrides(folder, {});

    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(leaks()).toEqual([]);
    expect(stagedPlacements()).toBe(1);
    expect(JSON.parse(await readFile(join(folder, SETTINGS_FILE), "utf-8"))).toMatchObject({
      version: 1,
    });
  });

  it("control: a plain folder writes the settings file through a temp file beside it", async () => {
    record();
    await writeFolderOverrides(folder, {});
    expect(hooks.created.filter(inside)).toHaveLength(1);
  });
});
