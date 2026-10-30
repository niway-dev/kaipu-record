import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_IMPORT_FILES } from "@shared/import-video";
import {
  importTitle,
  importVideoFile,
  importVideoFiles,
  probeVideoFile,
  validateImportSource,
  type ImportVideoDeps,
  type ProbeVideo,
} from "./import-video";
import { LibraryVault } from "./library-vault";

/** A real 3 s 1280 × 720 H.264 MP4 (the E2E suite's fixture). */
const SAMPLE_MP4 = join(__dirname, "../../../e2e/fixtures/sample.mp4");

const okProbe: ProbeVideo = async () => ({ durationSeconds: 42, width: 1920, height: 1080 });
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

describe("importVideoFile", () => {
  let root: string;
  let vaultDir: string;
  let sources: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kaipu-import-"));
    vaultDir = join(root, "vault");
    sources = join(root, "sources");
    await mkdir(sources, { recursive: true });
  });

  afterEach(async () => {
    await chmod(vaultDir, 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const deps = (over: Partial<ImportVideoDeps> = {}): ImportVideoDeps => ({
    vaultDir: () => vaultDir,
    newId: () => "imported-2026-10-30-12-00-00",
    now: () => NOW,
    probe: okProbe,
    ...over,
  });

  const source = async (name: string, bytes: Buffer = Buffer.from("video bytes")) => {
    const path = join(sources, name);
    await writeFile(path, bytes);
    return path;
  };

  /** Everything in the vault, `.kaipu/` included, so a stray temp or sidecar shows up. */
  const vaultFiles = async (): Promise<string[]> => {
    const top = await readdir(vaultDir).catch(() => [] as string[]);
    const meta = await readdir(join(vaultDir, ".kaipu")).catch(() => [] as string[]);
    return [...top.filter((f) => f !== ".kaipu"), ...meta.map((f) => `.kaipu/${f}`)].sort();
  };

  it("copies the file in as a recording marked imported, and leaves the source untouched", async () => {
    const src = await source("IMG_1234.MOV");
    const before = await stat(src);

    const item = await importVideoFile(src, deps());

    expect(item).toMatchObject({
      id: "imported-2026-10-30-12-00-00",
      kind: "recording",
      title: "IMG_1234",
      durationSeconds: 42,
      createdAt: NOW,
      derivedFromAssetId: null,
      capture: { mode: "import", width: 1920, height: 1080, ratio: null },
    });
    // The container is kept, lowercased so the vault recognises it.
    expect(await vaultFiles()).toEqual([
      ".kaipu/imported-2026-10-30-12-00-00.json",
      "imported-2026-10-30-12-00-00.mov",
    ]);
    expect(await readFile(join(vaultDir, "imported-2026-10-30-12-00-00.mov"), "utf-8")).toBe(
      "video bytes",
    );
    const after = await stat(src);
    expect(await readFile(src, "utf-8")).toBe("video bytes");
    expect(after.mtimeMs).toBe(before.mtimeMs);
    // Listed like any recording, with a stable identity.
    const [listed] = await new LibraryVault(vaultDir).list();
    expect(listed?.assetId).toBe((item as { assetId: string }).assetId);
  });

  it("refuses a file the probe cannot read, and leaves nothing behind", async () => {
    const src = await source("broken.mp4");
    const outcome = await importVideoFile(src, deps({ probe: async () => "unreadable" }));
    expect(outcome).toBe("unreadable");
    expect(await vaultFiles()).toEqual([]);
  });

  it("refuses a file without a video track, and leaves nothing behind", async () => {
    const src = await source("voice-memo.mp4");
    const outcome = await importVideoFile(src, deps({ probe: async () => "no-video-track" }));
    expect(outcome).toBe("no-video-track");
    expect(await vaultFiles()).toEqual([]);
  });

  it("cleans the staged copy up when the probe throws", async () => {
    const src = await source("clip.mp4");
    const outcome = await importVideoFile(
      src,
      deps({
        probe: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(outcome).toBe("copy-failed");
    expect(await vaultFiles()).toEqual([]);
  });

  it("reports copy-failed when the vault cannot be written", async () => {
    await mkdir(vaultDir, { recursive: true });
    await chmod(vaultDir, 0o555);
    const src = await source("clip.mp4");
    expect(await importVideoFile(src, deps())).toBe("copy-failed");
    await chmod(vaultDir, 0o755);
    expect(await vaultFiles()).toEqual([]);
  });

  it("never overwrites an existing item: a clash gets the next free id", async () => {
    const first = await importVideoFile(await source("a.mp4", Buffer.from("A")), deps());
    const second = await importVideoFile(await source("b.mp4", Buffer.from("B")), deps());
    expect((first as { id: string }).id).toBe("imported-2026-10-30-12-00-00");
    expect((second as { id: string }).id).toBe("imported-2026-10-30-12-00-00-2");
    expect(await readFile(join(vaultDir, "imported-2026-10-30-12-00-00.mp4"), "utf-8")).toBe("A");
    expect(await readFile(join(vaultDir, "imported-2026-10-30-12-00-00-2.mp4"), "utf-8")).toBe("B");
  });

  it("does not reuse the id of an item whose local copy was removed (its sidecar stays)", async () => {
    await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
    await writeFile(
      join(vaultDir, ".kaipu", "imported-2026-10-30-12-00-00.json"),
      JSON.stringify({ assetId: "cloud-only", localRemovedAt: 1 }),
    );
    const item = await importVideoFile(await source("c.webm"), deps());
    expect((item as { id: string }).id).toBe("imported-2026-10-30-12-00-00-2");
  });

  it("refuses a file that is already in the vault (a card dragged back in)", async () => {
    const first = (await importVideoFile(await source("a.mp4"), deps())) as { filePath: string };
    const before = await vaultFiles();
    expect(await importVideoFile(first.filePath, deps())).toBe("already-in-library");
    await mkdir(join(vaultDir, ".kaipu", "drag"), { recursive: true });
    await writeFile(join(vaultDir, ".kaipu", "drag", "Demo.mp4"), "x");
    expect(await importVideoFile(join(vaultDir, ".kaipu", "drag", "Demo.mp4"), deps())).toBe(
      "already-in-library",
    );
    expect((await vaultFiles()).filter((f) => !f.startsWith(".kaipu/drag"))).toEqual(before);
  });

  it("reads a real MP4 with the default probe", async () => {
    const item = await importVideoFile(SAMPLE_MP4, deps({ probe: undefined }));
    expect(item).toMatchObject({
      durationSeconds: 3,
      capture: { mode: "import", width: 1280, height: 720 },
    });
  });
});

describe("validateImportSource", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-import-src-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts an existing video file, case-insensitively", async () => {
    await writeFile(join(dir, "Zoom Meeting.MP4"), "x");
    expect(await validateImportSource(join(dir, "Zoom Meeting.MP4"))).toEqual({
      ok: true,
      path: join(dir, "Zoom Meeting.MP4"),
      ext: ".mp4",
    });
  });

  it("refuses other extensions, missing files, folders and relative paths", async () => {
    await writeFile(join(dir, "notes.txt"), "x");
    await mkdir(join(dir, "folder.mp4"));
    expect(await validateImportSource(join(dir, "notes.txt"))).toEqual({
      ok: false,
      reason: "unsupported-type",
    });
    expect(await validateImportSource(join(dir, "gone.mov"))).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await validateImportSource(join(dir, "folder.mp4"))).toEqual({
      ok: false,
      reason: "not-a-file",
    });
    expect(await validateImportSource("relative/clip.mp4")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("importVideoFiles", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kaipu-import-batch-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (): ImportVideoDeps => {
    let n = 0;
    return {
      vaultDir: () => join(root, "vault"),
      newId: () => `imported-${++n}`,
      probe: async (path) =>
        (await readFile(path, "utf-8")) === "audio" ? "no-video-track" : okProbe(path),
    };
  };

  it("imports the good files and reports each bad one by name", async () => {
    await writeFile(join(root, "good.mp4"), "video");
    await writeFile(join(root, "memo.m4v"), "audio");
    await writeFile(join(root, "doc.pdf"), "pdf");

    const result = await importVideoFiles(
      [join(root, "good.mp4"), join(root, "memo.m4v"), join(root, "doc.pdf"), 42],
      deps(),
    );

    expect(result.canceled).toBe(false);
    expect(result.imported.map((r) => r.title)).toEqual(["good"]);
    expect(result.failed).toEqual([
      { fileName: "memo.m4v", reason: "no-video-track" },
      { fileName: "doc.pdf", reason: "unsupported-type" },
    ]);
  });

  it("refuses a payload that is not a list", async () => {
    expect(await importVideoFiles("/etc/passwd", deps())).toEqual({
      imported: [],
      failed: [],
      canceled: false,
    });
  });

  it("caps one call at MAX_IMPORT_FILES", async () => {
    const paths = Array.from({ length: MAX_IMPORT_FILES + 1 }, (_, i) => join(root, `${i}.txt`));
    const result = await importVideoFiles(paths, deps());
    expect(result.failed.at(-1)).toEqual({
      fileName: `${MAX_IMPORT_FILES}.txt`,
      reason: "too-many",
    });
  });
});

describe("importTitle", () => {
  it("is the file name without its extension", () => {
    expect(importTitle("/Users/me/Movies/Zoom Meeting 2026.mp4")).toBe("Zoom Meeting 2026");
    expect(importTitle("/tmp/.mov")).toBe(".mov");
  });
});

describe("probeVideoFile", () => {
  it("refuses a file that is not a media container", async () => {
    expect(await probeVideoFile(join(__dirname, "import-video.ts"))).toBe("unreadable");
  });
});
