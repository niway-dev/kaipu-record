import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCaptureName } from "@shared/default-capture-name";
import { parseMediaUrl } from "@shared/media-url";
import { EvictedFileError } from "./dataless";
import {
  LibraryVault,
  SYNCED_LIST_CONCURRENCY,
  SYNCED_LIST_STALL_LIMIT,
  SYNCED_SIDECAR_READ_TIMEOUT_MS,
  humanizeId,
} from "./library-vault";

/** Rename by the id a caller saw, with the identity it holds there (as the IPC does). */
async function renameById(
  v: LibraryVault,
  id: string,
  title: string,
  options?: Parameters<LibraryVault["renameItem"]>[2],
) {
  return v.renameItem(
    { id, assetId: (await v.describe(id))?.assetId ?? "missing" },
    title,
    options,
  );
}

describe("LibraryVault", () => {
  let directory: string;
  let vault: LibraryVault;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-vault-"));
    vault = new LibraryVault(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const writeRecording = (id: string, bytes = 2048): Promise<void> =>
    writeFile(join(directory, `${id}.webm`), Buffer.alloc(bytes));

  const writeSidecar = async (id: string, data: object): Promise<void> => {
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(join(directory, ".kaipu", `${id}.json`), JSON.stringify(data));
  };

  it("returns an empty list when the vault has no recordings", async () => {
    expect(await vault.list()).toEqual([]);
  });

  it("never recreates a missing root: an unplugged workspace fails to list instead of reading as empty", async () => {
    const gone = join(directory, "unplugged");
    await expect(new LibraryVault(gone).list()).rejects.toThrow();
    await expect(stat(gone)).rejects.toThrow();
  });

  it("stamps the workspace id on the media URLs it hands out", async () => {
    const scoped = new LibraryVault(directory, "ws-1");
    await writeFile(join(directory, "shot.png"), Buffer.alloc(16));
    await writeRecording("take");
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(join(directory, ".kaipu", "take.jpg"), Buffer.alloc(8));

    const byId = new Map((await scoped.list()).map((r) => [r.id, r]));

    expect(byId.get("shot")?.thumbnailUrl).toMatch(
      /^kaipu-media:\/\/screenshot\/shot\?v=\d+&w=ws-1$/,
    );
    expect(byId.get("take")?.thumbnailUrl).toMatch(/^kaipu-media:\/\/thumb\/take\?v=\d+&w=ws-1$/);
    expect(await scoped.countMedia()).toBe(2);
  });

  it("derives a title and reads the real size from disk", async () => {
    await writeRecording("alpha-clip", 4096);
    const [recording] = await vault.list();
    expect(recording.id).toBe("alpha-clip");
    expect(recording.title).toBe("alpha-clip");
    expect(recording.sizeBytes).toBe(4096);
    expect(recording.durationSeconds).toBe(0);
  });

  it("ignores non-webm files", async () => {
    await writeRecording("clip");
    await writeFile(join(directory, "notes.txt"), "hello");
    expect((await vault.list()).map((r) => r.id)).toEqual(["clip"]);
  });

  it("sorts recordings newest-first by sidecar createdAt", async () => {
    await writeRecording("older");
    await writeRecording("newer");
    await writeSidecar("older", { createdAt: 1000 });
    await writeSidecar("newer", { createdAt: 5000 });
    expect((await vault.list()).map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("prefers sidecar title and duration over derived values", async () => {
    await writeRecording("clip");
    await writeSidecar("clip", { title: "My Demo", durationSeconds: 42 });
    const [recording] = await vault.list();
    expect(recording.title).toBe("My Demo");
    expect(recording.durationSeconds).toBe(42);
  });

  it("round-trips capture metadata through the sidecar, and reads null without it", async () => {
    await writeRecording("framed");
    await writeRecording("legacy");
    await vault.writeMeta("framed", {
      durationSeconds: 5,
      capture: {
        mode: "area",
        width: 1280,
        height: 720,
        ratio: "16:9",
        displayId: 2,
      },
    });
    expect((await vault.describe("framed"))?.capture).toEqual({
      mode: "area",
      width: 1280,
      height: 720,
      ratio: "16:9",
      displayId: 2,
    });
    expect((await vault.describe("legacy"))?.capture).toBeNull();
  });

  it("reads a malformed capture value as null", async () => {
    await writeRecording("bad");
    await writeSidecar("bad", {
      capture: { mode: "tab", width: 1, height: 1 },
    });
    expect((await vault.describe("bad"))?.capture).toBeNull();
  });

  it("stamps an item as opened in an editor, keeping its other fields", async () => {
    await writeRecording("clip");
    await writeSidecar("clip", { title: "My Demo", createdAt: 1000 });
    expect((await vault.list())[0]).toMatchObject({ editorOpenedAt: null, editorSavedAt: null });

    await vault.markOpenedInEditor("clip", 5000);

    expect((await vault.list())[0]).toMatchObject({
      title: "My Demo",
      createdAt: 1000,
      editorOpenedAt: 5000,
      editorSavedAt: null,
    });
  });

  it("reads a manual-save stamp and ignores a malformed one", async () => {
    await writeRecording("good");
    await writeRecording("bad");
    await writeSidecar("good", { editorSavedAt: 7000 });
    await writeSidecar("bad", { editorSavedAt: "yesterday", editorOpenedAt: null });
    const byId = Object.fromEntries((await vault.list()).map((r) => [r.id, r]));
    expect(byId.good.editorSavedAt).toBe(7000);
    expect(byId.bad).toMatchObject({ editorSavedAt: null, editorOpenedAt: null });
  });

  it("writes, reads and removes the cursor track sidecar", async () => {
    await writeRecording("rec");
    expect(await vault.readCursorTrack("rec")).toBeNull();
    await vault.writeCursorTrack("rec", '{"version":1}');
    expect(await vault.readCursorTrack("rec")).toBe('{"version":1}');
    expect(await readdir(join(directory, ".kaipu"))).not.toContain("rec.cursor.json.tmp");
    await vault.remove("rec");
    expect(await vault.readCursorTrack("rec")).toBeNull();
  });

  it("never downloads an evicted cursor track: it throws instead of reading null", async () => {
    await writeRecording("rec");
    await vault.writeCursorTrack("rec", '{"version":1}');
    const track = vault.cursorTrackPath("rec");
    const read = vi.fn(async () => "never");
    const synced = new LibraryVault(
      directory,
      null,
      { readText: read } as never,
      async () => new Set([track]),
    );
    await expect(synced.readCursorTrack("rec")).rejects.toBeInstanceOf(EvictedFileError);
    expect(read).not.toHaveBeenCalled();
  });

  it("gives up on a stalled cursor track read in a synced vault and says so", async () => {
    vi.useFakeTimers();
    try {
      const synced = new LibraryVault(
        directory,
        null,
        { readText: () => new Promise<string>(() => {}) } as never,
        async () => new Set(),
      );
      const result = synced.readCursorTrack("rec").catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(SYNCED_SIDECAR_READ_TIMEOUT_MS + 1);
      expect(await result).toMatchObject({ code: "ETIMEDOUT" });
    } finally {
      vi.useRealTimers();
    }
  });

  describe("listing a synced folder with many items", () => {
    const seed = async (count: number): Promise<string[]> => {
      const ids = Array.from({ length: count }, (_, i) => `clip-${String(i).padStart(3, "0")}`);
      for (const id of ids) {
        await writeRecording(id);
        await writeSidecar(id, { assetId: `asset-${id}`, sidecarVersion: 2 });
      }
      return ids;
    };

    it("reads at most SYNCED_LIST_CONCURRENCY sidecars at once", async () => {
      const ids = await seed(40);
      let inFlight = 0;
      let peak = 0;
      const reader = {
        readText: async (path: string) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setImmediate(resolve));
          inFlight -= 1;
          return readFile(path, "utf-8");
        },
      };
      const synced = new LibraryVault(directory, null, reader, async () => new Set());

      const listed = await synced.list();

      expect(listed).toHaveLength(ids.length);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(SYNCED_LIST_CONCURRENCY);
    });

    it("stops asking a provider that stalled on several sidecars: the rest list read-only", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const ids = await seed(40);
        const read = vi.fn(() => new Promise<string>(() => {}));
        const synced = new LibraryVault(directory, null, { readText: read }, async () => new Set());

        const pending = synced.list();
        for (let i = 0; i < 20; i += 1) {
          await new Promise((resolve) => setImmediate(resolve));
          await vi.advanceTimersByTimeAsync(SYNCED_SIDECAR_READ_TIMEOUT_MS + 1);
        }
        const listed = await pending;

        // Every item is still listed (read-only); only the first wave, plus the few reads that
        // started before the limit was seen, ever hit the provider (not all 40).
        expect(listed).toHaveLength(ids.length);
        expect(listed.every((item) => item.metadataIssue === "unreadable")).toBe(true);
        expect(read.mock.calls.length).toBeLessThanOrEqual(
          SYNCED_LIST_CONCURRENCY + SYNCED_LIST_STALL_LIMIT,
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("still reads a track that is simply absent as null in a synced vault", async () => {
    const synced = new LibraryVault(directory, null, undefined, async () => new Set());
    expect(await synced.readCursorTrack("nothing")).toBeNull();
  });

  it("removes a cursor track temp file left behind by an interrupted write", async () => {
    await writeRecording("rec");
    await vault.writeCursorTrack("rec", "{}");
    await writeFile(`${vault.cursorTrackPath("rec")}.tmp`, "half", "utf-8");
    await vault.remove("rec");
    expect(await readdir(join(directory, ".kaipu"))).not.toContain("rec.cursor.json.tmp");
  });

  it("removes the transcript with the recording and keeps it when only the local copy goes", async () => {
    await writeRecording("rec");
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    const path = vault.companionPaths("rec").transcript;
    expect(path).toBe(join(directory, ".kaipu", "rec.transcript.json"));
    await writeFile(path, '{"schemaVersion":1,"segments":[]}');
    await vault.removeLocalCopy("rec");
    expect(await readFile(path, "utf-8")).toBe('{"schemaVersion":1,"segments":[]}');
    await writeRecording("other");
    await writeFile(vault.companionPaths("other").transcript, "{}");
    await vault.remove("other");
    expect(await readdir(join(directory, ".kaipu"))).not.toContain("other.transcript.json");
  });

  it("removes the webcam file with the recording (ADR 0037)", async () => {
    await writeRecording("rec");
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(vault.webcamFilePath("rec"), "webcam");
    await vault.remove("rec");
    expect(await readdir(join(directory, ".kaipu"))).not.toContain("rec.webcam.mp4");
  });

  describe("webcam track (ADR 0037)", () => {
    const webcamMeta = {
      startOffsetMs: 120.5,
      offsetQuality: "exact",
      width: 1280,
      height: 720,
      fps: 30,
      recordedLayout: {
        shape: "circle",
        size: "medium",
        mirrored: true,
        framing: { enabled: false, zoom: 1, centerX: 0.5, centerY: 0.5 },
      },
    };

    const writeWebcamFile = async (id: string): Promise<void> => {
      await mkdir(join(directory, ".kaipu"), { recursive: true });
      await writeFile(vault.webcamFilePath(id), "webcam");
    };

    it("describe exposes the sidecar's webcam when the file exists", async () => {
      await writeRecording("rec");
      await writeSidecar("rec", { webcam: webcamMeta });
      await writeWebcamFile("rec");
      const described = await vault.describe("rec");
      expect(described?.webcam).toMatchObject({
        startOffsetMs: 120.5,
        offsetQuality: "exact",
        width: 1280,
        height: 720,
        fps: 30,
        recordedLayout: { shape: "circle", mirrored: true },
      });
    });

    it("describe gives no webcam when the sidecar names one but the file is gone", async () => {
      await writeRecording("rec");
      await writeSidecar("rec", { webcam: webcamMeta });
      expect((await vault.describe("rec"))?.webcam ?? null).toBeNull();
    });

    it("describe gives no webcam for a recording without the field, even with a stray file", async () => {
      await writeRecording("rec");
      await writeWebcamFile("rec");
      expect((await vault.describe("rec"))?.webcam ?? null).toBeNull();
    });

    describe("thumbnail with the bubble (NIW2-845)", () => {
      const jpg = (): Buffer => Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
      const writeScreenThumb = async (id: string): Promise<void> => {
        await mkdir(join(directory, ".kaipu"), { recursive: true });
        await writeFile(vault.thumbnailPath(id), Buffer.from([0xff, 0xd8, 0xff]));
      };

      it("describe says a webcam recording's thumbnail still needs the bubble", async () => {
        await writeRecording("rec");
        await writeSidecar("rec", { webcam: webcamMeta });
        await writeWebcamFile("rec");
        await writeScreenThumb("rec");
        expect((await vault.describe("rec"))?.thumbnailNeedsWebcam).toBe(true);
      });

      it("describe does not ask for it on a plain recording, or when the webcam file is gone", async () => {
        await writeRecording("plain");
        await writeSidecar("plain", {});
        await writeScreenThumb("plain");
        expect((await vault.describe("plain"))?.thumbnailNeedsWebcam ?? false).toBe(false);

        await writeRecording("gone");
        await writeSidecar("gone", { webcam: webcamMeta });
        await writeScreenThumb("gone");
        expect((await vault.describe("gone"))?.thumbnailNeedsWebcam ?? false).toBe(false);
      });

      it("writeWebcamThumbnail replaces the jpg and sets the marker in one step", async () => {
        await writeRecording("rec");
        await writeSidecar("rec", { assetId: "asset-rec", title: "Keep", webcam: webcamMeta });
        await writeWebcamFile("rec");
        await writeScreenThumb("rec");

        const updated = await vault.writeWebcamThumbnail("rec", "asset-rec", jpg());

        expect(updated?.thumbnailNeedsWebcam).toBe(false);
        expect((await readFile(vault.thumbnailPath("rec"))).equals(jpg())).toBe(true);
        const sidecar = JSON.parse(await readFile(vault.sidecarPath("rec"), "utf-8"));
        expect(sidecar.thumbnailWebcam).toBe(1);
        expect(sidecar).toMatchObject({ assetId: "asset-rec", title: "Keep" });
        expect((await vault.describe("rec"))?.thumbnailNeedsWebcam).toBe(false);
      });

      it("a later plain thumbnail write clears the marker, so the bubble is asked for again", async () => {
        await writeRecording("rec");
        await writeSidecar("rec", { assetId: "asset-rec", webcam: webcamMeta });
        await writeWebcamFile("rec");
        await vault.writeWebcamThumbnail("rec", "asset-rec", jpg());
        expect((await vault.describe("rec"))?.thumbnailNeedsWebcam).toBe(false);

        await vault.writeThumbnail("rec", Buffer.from([0xff, 0xd8, 0xff]));

        expect((await vault.describe("rec"))?.thumbnailNeedsWebcam).toBe(true);
      });

      it("the thumbnail URL carries the jpg's mtime, so a rewritten jpg is not served from cache", async () => {
        await writeRecording("rec");
        await writeSidecar("rec", { webcam: webcamMeta });
        await writeWebcamFile("rec");
        await writeScreenThumb("rec");
        const url = (await vault.describe("rec"))?.thumbnailUrl ?? "";
        expect(url).toMatch(/^kaipu-media:\/\/thumb\/rec\?v=\d+$/);
        expect(parseMediaUrl(url)).toMatchObject({ kind: "thumb", id: "rec" });

        // Rewritten with a later mtime, the same jpg gets a different URL.
        const later = new Date(Date.now() + 60_000);
        await utimes(vault.thumbnailPath("rec"), later, later);
        const rewritten = (await vault.describe("rec"))?.thumbnailUrl ?? "";
        expect(rewritten).toMatch(/^kaipu-media:\/\/thumb\/rec\?v=\d+$/);
        expect(rewritten).not.toBe(url);
      });

      it("refuses a recording without a webcam track and leaves its thumbnail alone", async () => {
        await writeRecording("plain");
        await writeSidecar("plain", { assetId: "asset-plain" });
        await writeScreenThumb("plain");
        const before = await readFile(vault.thumbnailPath("plain"));
        await expect(vault.writeWebcamThumbnail("plain", "asset-plain", jpg())).resolves.toBeNull();
        expect((await readFile(vault.thumbnailPath("plain"))).equals(before)).toBe(true);
      });

      it("refuses when the id now carries another recording, and leaves its thumbnail alone", async () => {
        // Composited for one recording; by the time it is written, the id names another
        // (a workspace switch, or a file put back under the same name).
        await writeRecording("rec");
        await writeSidecar("rec", { assetId: "asset-other", webcam: webcamMeta });
        await writeWebcamFile("rec");
        await writeScreenThumb("rec");
        const before = await readFile(vault.thumbnailPath("rec"));

        await expect(vault.writeWebcamThumbnail("rec", "asset-rec", jpg())).resolves.toBeNull();

        expect((await readFile(vault.thumbnailPath("rec"))).equals(before)).toBe(true);
        expect((await vault.describe("rec"))?.thumbnailNeedsWebcam).toBe(true);
      });
    });

    it("rename moves the webcam file with the item, still paired (ADR 0035)", async () => {
      await writeRecording("rec");
      await writeSidecar("rec", { assetId: "asset-rec", webcam: webcamMeta });
      await writeWebcamFile("rec");
      const result = await vault.renameItem({ id: "rec", assetId: "asset-rec" }, "Renamed");
      expect(result.file).toBe("renamed");
      const described = await vault.describe("Renamed");
      expect(described?.title).toBe("Renamed");
      expect(described?.webcam).toBeTruthy();
      const meta = await readdir(join(directory, ".kaipu"));
      expect(meta).toContain("Renamed.webcam.mp4");
      expect(meta).not.toContain("rec.webcam.mp4");
    });
  });

  it("keeps the cursor track when only the local copy is removed", async () => {
    await writeRecording("rec");
    await vault.writeCursorTrack("rec", "{}");
    await vault.removeLocalCopy("rec");
    expect(await vault.readCursorTrack("rec")).toBe("{}");
  });

  it("removes the video and its sidecar", async () => {
    await writeRecording("clip");
    await vault.writeMeta("clip", { title: "X" });
    await vault.remove("clip");

    expect(await vault.list()).toHaveLength(0);
    expect(await readdir(directory)).not.toContain("clip.webm");
  });

  it("mints a stable assetId for a legacy item and persists it without touching other fields", async () => {
    await writeRecording("legacy");
    await writeSidecar("legacy", { title: "Old", durationSeconds: 7, createdAt: 123 });

    const first = await vault.describe("legacy");
    expect(first?.assetId).toMatch(/^[0-9a-f-]{36}$/);
    const second = await vault.describe("legacy");
    expect(second?.assetId).toBe(first?.assetId);

    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "legacy.json"), "utf-8"));
    expect(sidecar).toMatchObject({
      title: "Old",
      durationSeconds: 7,
      createdAt: 123,
      sidecarVersion: 2,
    });
    expect(sidecar.assetId).toBe(first?.assetId);
  });

  it("gives two files different assetIds and never derives the id from the filename", async () => {
    await writeRecording("one");
    await writeRecording("two");
    const [a, b] = await Promise.all([vault.describe("one"), vault.describe("two")]);
    expect(a?.assetId).not.toBe(b?.assetId);
    expect(a?.assetId).not.toBe("one");
  });

  it.skipIf(process.platform === "win32")(
    "still lists when the sidecar directory is read-only (identity is in memory only)",
    async () => {
      await writeRecording("ro");
      await mkdir(join(directory, ".kaipu"), { recursive: true });
      await chmod(join(directory, ".kaipu"), 0o500);
      try {
        const [rec] = await vault.list();
        expect(rec.id).toBe("ro");
        expect(rec.assetId).toMatch(/^[0-9a-f-]{36}$/);
      } finally {
        await chmod(join(directory, ".kaipu"), 0o700);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "reuses the minted assetId for a read-only vault across separate LibraryVault instances",
    async () => {
      await writeRecording("ro");
      await mkdir(join(directory, ".kaipu"), { recursive: true });
      await chmod(join(directory, ".kaipu"), 0o500);
      try {
        const first = await new LibraryVault(directory).describe("ro");
        const second = await new LibraryVault(directory).describe("ro");
        expect(second?.assetId).toBe(first?.assetId);
      } finally {
        await chmod(join(directory, ".kaipu"), 0o700);
      }
    },
  );

  it("exposes provenance and the cached hash only while it matches the file", async () => {
    await writeRecording("exp", 10);
    const info = await stat(join(directory, "exp.webm"));
    await writeSidecar("exp", {
      assetId: "11111111-1111-4111-8111-111111111111",
      derivedFromAssetId: "22222222-2222-4222-8222-222222222222",
      contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      hashedSizeBytes: 10,
      hashedMtimeMs: info.mtimeMs,
      hashedCtimeMs: info.ctimeMs,
      hashedIno: info.ino,
    });
    expect(await vault.describe("exp")).toMatchObject({
      assetId: "11111111-1111-4111-8111-111111111111",
      derivedFromAssetId: "22222222-2222-4222-8222-222222222222",
      contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    });
    await writeRecording("exp", 11); // bytes changed → cached hash is stale
    expect((await vault.describe("exp"))?.contentSha256).toBeNull();
  });

  it('exposes an MP4 export\'s preset and fingerprint, reading the legacy "original" as maximum (NIW2-218) and "youtube" as youtube-1440', async () => {
    await writeRecording("share");
    await writeSidecar("share", { exportPreset: "balanced", exportFingerprint: "whole" });
    await writeRecording("legacy");
    await writeSidecar("legacy", { exportPreset: "original" });
    await writeRecording("old-youtube");
    await writeSidecar("old-youtube", { exportPreset: "youtube", exportFingerprint: "whole" });
    await writeRecording("plain");
    await writeSidecar("plain", { exportPreset: "tiktok" });
    expect((await vault.describe("share"))?.export).toEqual({
      preset: "balanced",
      fingerprint: "whole",
      destination: null,
    });
    expect((await vault.describe("legacy"))?.export).toEqual({
      preset: "maximum",
      fingerprint: null,
      destination: null,
    });
    // The 1920×1080 YouTube export (before NIW2-564) reads as YouTube 1440p.
    expect((await vault.describe("old-youtube"))?.export).toEqual({
      preset: "youtube-1440",
      fingerprint: "whole",
      destination: null,
    });
    expect((await vault.describe("plain"))?.export).toBeNull();
  });

  it("reads back where a copy is going, and ignores a destination it does not know", async () => {
    await writeRecording("email");
    await writeSidecar("email", {
      exportPreset: "balanced",
      exportFingerprint: "whole",
      exportDestination: "email",
    });
    await writeRecording("odd");
    await writeSidecar("odd", {
      exportPreset: "balanced",
      exportFingerprint: "whole",
      exportDestination: "fax",
    });
    expect((await vault.describe("email"))?.export?.destination).toBe("email");
    expect((await vault.describe("odd"))?.export?.destination).toBeNull();
  });

  it("ensureContentHash computes once, caches by size+mtime, and recomputes after a change", async () => {
    await writeRecording("h", 100);
    const first = await vault.ensureContentHash("h");
    expect(first?.contentSha256).toHaveLength(44);
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "h.json"), "utf-8"));
    expect(sidecar).toMatchObject({ contentSha256: first?.contentSha256, hashedSizeBytes: 100 });
    expect((await vault.describe("h"))?.contentSha256).toBe(first?.contentSha256);

    await writeFile(join(directory, "h.webm"), Buffer.alloc(100, 9));
    const second = await vault.ensureContentHash("h");
    expect(second?.contentSha256).not.toBe(first?.contentSha256);
    expect(await vault.ensureContentHash("missing")).toBeNull();
  });

  it("removeLocalCopy deletes only the media file and keeps identity, thumbnail, session and assets", async () => {
    await writeRecording("keep");
    await vault.writeMeta("keep", {
      title: "Keep",
      assetId: "33333333-3333-4333-8333-333333333333",
    });
    await vault.writeThumbnail("keep", Buffer.from([1]));
    await mkdir(join(directory, ".kaipu", "keep.assets"), { recursive: true });
    await writeFile(join(directory, ".kaipu", "keep.edit.json"), "{}");
    await writeFile(join(directory, ".kaipu", "keep.assets", "a.png"), "png");

    await vault.removeLocalCopy("keep");

    expect(await readdir(directory)).not.toContain("keep.webm");
    const files = await readdir(join(directory, ".kaipu"));
    expect(files).toEqual(
      expect.arrayContaining(["keep.json", "keep.jpg", "keep.edit.json", "keep.assets"]),
    );
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "keep.json"), "utf-8"));
    expect(sidecar.assetId).toBe("33333333-3333-4333-8333-333333333333");
    expect(typeof sidecar.localRemovedAt).toBe("number");
    expect(await vault.describe("keep")).toBeNull();
    expect(await vault.list()).toHaveLength(0);
  });

  it("removeLocalCopy propagates a failure to delete the media file", async () => {
    await expect(vault.removeLocalCopy("nope")).rejects.toThrow();
  });

  it("keeps every field when many writeMeta calls run at once across instances", async () => {
    await writeRecording("clip");
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        new LibraryVault(directory).writeMeta("clip", { [`field${i}`]: i } as never),
      ),
    );
    const raw = await readFile(join(directory, ".kaipu", "clip.json"), "utf-8");
    const sidecar = JSON.parse(raw); // must not throw
    expect(sidecar.sidecarVersion).toBe(2);
    for (let i = 0; i < 40; i++) expect(sidecar[`field${i}`]).toBe(i);
    expect((await readdir(join(directory, ".kaipu"))).filter((n) => n.includes(".tmp"))).toEqual(
      [],
    );
  });

  it("mints one assetId when separate instances describe the same new item at once", async () => {
    await writeRecording("fresh");
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() => new LibraryVault(directory).describe("fresh")),
    );
    const ids = new Set(results.map((r) => r?.assetId));
    expect(ids.size).toBe(1);
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "fresh.json"), "utf-8"));
    expect(sidecar.assetId).toBe([...ids][0]);
  });

  it("does not lose the title when a rename races the identity mint", async () => {
    await writeRecording("race");
    const [described, renamed] = await Promise.all([
      vault.describe("race"),
      renameById(new LibraryVault(directory), "race", "Mine"),
    ]);
    const sidecar = JSON.parse(await readFile(join(directory, ".kaipu", "Mine.json"), "utf-8"));
    expect(sidecar.title).toBe("Mine");
    expect(renamed.recording.assetId).toBe(sidecar.assetId);
    // A describe that loses the race to the move sees no item, never a second identity.
    if (described) expect(described.assetId).toBe(sidecar.assetId);
    expect(await readdir(join(directory, ".kaipu"))).toEqual(["Mine.json"]);
  });
});

describe("LibraryVault — screenshots", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("lists a saved screenshot as kind=screenshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-")); // reuse existing helpers/imports
    dirs.push(dir);
    const vault = new LibraryVault(dir);
    await vault.writeImage("shot-1", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const items = await vault.list();
    const shot = items.find((i) => i.id === "shot-1");
    expect(shot?.kind).toBe("screenshot");
    expect(shot?.filePath.endsWith("shot-1.png")).toBe(true);
    // URL carries a `?v=<mtime>` cache-bust token so an in-place overwrite refreshes.
    expect(shot?.thumbnailUrl).toMatch(/^kaipu-media:\/\/screenshot\/shot-1\?v=\d+$/);
  });

  it("writeImage replaces a screenshot without leaving temp files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-"));
    dirs.push(dir);
    const vault = new LibraryVault(dir);
    await vault.writeImage("shot", Buffer.from("one"));
    await vault.writeImage("shot", Buffer.from("two"), { replace: true });
    expect((await readFile(join(dir, "shot.png"))).toString()).toBe("two");
    expect((await readdir(dir)).filter((n) => n.endsWith(".part"))).toEqual([]);
  });

  it("writeImage of a new shot never replaces a file at its path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-"));
    dirs.push(dir);
    const vault = new LibraryVault(dir);
    await writeFile(join(dir, "shot.png"), "someone else's");
    await expect(vault.writeImage("shot", Buffer.from("mine"))).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(join(dir, "shot.png"), "utf-8")).toBe("someone else's");
    expect(await readdir(dir)).toEqual(["shot.png"]);
  });

  it("writeGif never replaces a file at its path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vault-"));
    dirs.push(dir);
    const vault = new LibraryVault(dir);
    await writeFile(join(dir, "loop.gif"), "someone else's");
    await expect(vault.writeGif("loop", new Uint8Array([1, 2]))).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(join(dir, "loop.gif"), "utf-8")).toBe("someone else's");
    expect(await readdir(dir)).toEqual(["loop.gif"]);
  });

  // chmod does not stop root (some CI containers), so the write would succeed there.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "writeImage keeps the original when the write fails",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "vault-"));
      dirs.push(dir);
      const vault = new LibraryVault(dir);
      await vault.writeImage("shot", Buffer.from("original"));
      await chmod(dir, 0o500);
      try {
        await expect(vault.writeImage("shot", Buffer.from("new"))).rejects.toThrow();
      } finally {
        await chmod(dir, 0o700);
      }
      expect((await readFile(join(dir, "shot.png"))).toString()).toBe("original");
    },
  );
});

describe("LibraryVault — mp4 + thumbnails", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempVault(): Promise<LibraryVault> {
    const dir = await mkdtemp(join(tmpdir(), "vault-mp4-"));
    dirs.push(dir);
    return new LibraryVault(dir);
  }

  it("discovers .mp4 recordings", async () => {
    const vault = await tempVault();
    const file = await vault.filePath("rec-1");
    expect(file.endsWith("rec-1.mp4")).toBe(true);
    await writeFile(file, "data");
    const list = await vault.list();
    expect(list.map((r) => r.id)).toContain("rec-1");
  });

  it("writeMeta + describe surface title, duration and thumbnail url", async () => {
    const vault = await tempVault();
    await writeFile(await vault.filePath("rec-2"), "data");
    await vault.writeMeta("rec-2", { title: "Demo", durationSeconds: 12, createdAt: 111 });
    await vault.writeThumbnail("rec-2", Buffer.from([0xff, 0xd8, 0xff]));
    const rec = await vault.describe("rec-2");
    expect(rec).toMatchObject({
      id: "rec-2",
      title: "Demo",
      durationSeconds: 12,
      createdAt: 111,
      thumbnailUrl: expect.stringMatching(/^kaipu-media:\/\/thumb\/rec-2\?v=\d+$/),
    });
  });

  it("backfill persists duration + thumbnail for an orphan and returns the updated recording", async () => {
    const vault = await tempVault();
    await writeFile(await vault.filePath("orphan-1"), "data"); // orphan mp4, no sidecar
    expect(await vault.describe("orphan-1")).toMatchObject({
      durationSeconds: 0,
      thumbnailUrl: null,
    });

    const updated = await vault.backfill("orphan-1", {
      durationSeconds: 54,
      thumbnail: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    });

    expect(updated).toMatchObject({
      durationSeconds: 54,
      thumbnailUrl: expect.stringMatching(/^kaipu-media:\/\/thumb\/orphan-1\?v=\d+$/),
    });
    // A fresh describe re-reads the sidecar + thumbnail file, proving persistence.
    expect(await vault.describe("orphan-1")).toMatchObject({
      durationSeconds: 54,
      thumbnailUrl: expect.stringMatching(/^kaipu-media:\/\/thumb\/orphan-1\?v=\d+$/),
    });
  });

  it("backfill without a thumbnail writes duration only", async () => {
    const vault = await tempVault();
    await writeFile(await vault.filePath("orphan-2"), "data");

    const updated = await vault.backfill("orphan-2", { durationSeconds: 10, thumbnail: null });

    expect(updated).toMatchObject({ durationSeconds: 10, thumbnailUrl: null });
  });
});

describe("humanizeId", () => {
  it("renders a legacy recording stem as the default name for its (UTC) timestamp", () => {
    expect(humanizeId("recording-2026-10-29-13-51-00")).toBe(
      defaultCaptureName("recording", new Date(Date.UTC(2026, 9, 29, 13, 51, 0))),
    );
  });

  it("renders a legacy screenshot stem, milliseconds and all", () => {
    expect(humanizeId("screenshot-2026-10-29T13-51-00-800Z")).toBe(
      defaultCaptureName("screenshot", new Date(Date.UTC(2026, 9, 29, 13, 51, 0))),
    );
  });

  it("keeps a recovered legacy stem readable", () => {
    expect(humanizeId("recording-2026-10-29-13-51-00-recovered")).toMatch(/^Kaipu Recording /);
  });

  it("returns any other stem as is", () => {
    expect(humanizeId("Kaipu Recording 2026-10-29 at 13.51.00")).toBe(
      "Kaipu Recording 2026-10-29 at 13.51.00",
    );
    expect(humanizeId("my_clip-final")).toBe("my_clip-final");
    expect(humanizeId("  padded ")).toBe("padded");
    expect(humanizeId("")).toBe("Recording");
  });
});

describe("LibraryVault — media URLs (NIW2-560 review)", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-urls-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["Demo #1", "50% done", "What? Why", "a%2Fb"])(
    "thumbnail URLs address the item %j exactly",
    async (id) => {
      const vault = new LibraryVault(directory);
      await writeFile(join(directory, `${id}.png`), "png");
      await writeFile(join(directory, `${id} clip.mp4`), "v");
      await mkdir(join(directory, ".kaipu"), { recursive: true });
      await writeFile(join(directory, ".kaipu", `${id} clip.jpg`), "jpg");
      const shot = await vault.describe(id);
      expect(parseMediaUrl(shot!.thumbnailUrl!)).toEqual({ kind: "screenshot", id });
      expect(new URL(shot!.thumbnailUrl!).searchParams.get("v")).toMatch(/^\d+$/);
      const clip = await vault.describe(`${id} clip`);
      expect(parseMediaUrl(clip!.thumbnailUrl!)).toEqual({ kind: "thumb", id: `${id} clip` });
    },
  );
});
