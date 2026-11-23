import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("./vault-location", () => ({
  vaultDirectory: () => ({ path: state.dir, isCustom: false }),
}));

import { saveSession, sessionMetaPath } from "./video-edit-session";
import {
  hasEditSession,
  probeEditing,
  probeEditSession,
  probeTranscribedAt,
  probeWebcam,
} from "./edit-project-probe";

describe("probeEditing", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-probe-"));
    state.dir = dir;
    await mkdir(join(dir, ".kaipu"), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const local = (id: string, derivedFromAssetId: string | null = null) => ({
    id,
    filePath: join(dir, `${id}.mp4`),
    derivedFromAssetId,
  });

  it("needs-source when there is no local file", async () => {
    expect(await probeEditing(dir, null)).toBe("needs-source");
  });

  it("project-available for a plain recording without a session", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    expect(await probeEditing(dir, local("r"))).toBe("project-available");
    expect(await hasEditSession(dir, "r")).toBe(false);
  });

  it("exported-only for an export without a session", async () => {
    await writeFile(join(dir, "e.mp4"), "v");
    expect(await probeEditing(dir, local("e", "src-asset"))).toBe("exported-only");
  });

  it("project-available when the session matches the source and all assets exist", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    await saveSession("r", {
      sessionJson: "{}",
      assets: [{ assetId: "a1", bytes: new Uint8Array([1]).buffer }],
    });
    expect(await probeEditing(dir, local("r"))).toBe("project-available");
    expect(await hasEditSession(dir, "r")).toBe(true);
  });

  it("missing-dependencies when the source changed or an asset is gone", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    await saveSession("r", {
      sessionJson: "{}",
      assets: [{ assetId: "a1", bytes: new Uint8Array([1]).buffer }],
    });
    await rm(join(dir, ".kaipu", "r.assets", "a1.png"));
    expect(await probeEditing(dir, local("r"))).toBe("missing-dependencies");

    await writeFile(join(dir, "s.mp4"), "v");
    await saveSession("s", { sessionJson: "{}", assets: [] });
    await writeFile(join(dir, "s.mp4"), "changed-bytes");
    const info = await stat(join(dir, "s.mp4"));
    expect(info.size).not.toBe(1);
    expect(await probeEditing(dir, local("s"))).toBe("missing-dependencies");
  });

  it("project-available for a legacy session saved before .edit.meta.json existed", async () => {
    await writeFile(join(dir, "legacy.mp4"), "v");
    // A session written directly, the way it looked before this branch: `.edit.json`
    // with no matching `.edit.meta.json` sidecar.
    await writeFile(join(dir, ".kaipu", "legacy.edit.json"), "{}");
    expect(await hasEditSession(dir, "legacy")).toBe(true);
    expect(await probeEditing(dir, local("legacy"))).toBe("project-available");
  });

  it("missing-dependencies when .edit.meta.json exists but is corrupt", async () => {
    await writeFile(join(dir, "corrupt.mp4"), "v");
    await writeFile(join(dir, ".kaipu", "corrupt.edit.json"), "{}");
    await writeFile(sessionMetaPath(dir, "corrupt"), "{not json");
    expect(await probeEditing(dir, local("corrupt"))).toBe("missing-dependencies");
  });

  it("reads .edit.meta.json through the reader it is given (a synced workspace's bounded one)", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    await writeFile(join(dir, ".kaipu", "r.edit.json"), "{}");
    await writeFile(sessionMetaPath(dir, "r"), "{}");
    const read: string[] = [];
    const info = await stat(join(dir, "r.mp4"));
    const reader = async (path: string): Promise<string> => {
      read.push(path);
      return JSON.stringify({
        sourceSizeBytes: info.size,
        sourceMtimeMs: info.mtimeMs,
        assetIds: [],
        savedAt: 7,
      });
    };
    expect(await probeEditing(dir, local("r"), reader)).toBe("project-available");
    expect((await probeEditSession(dir, "r", reader)).savedAt).toBe(7);
    expect(read).toEqual([sessionMetaPath(dir, "r"), sessionMetaPath(dir, "r")]);
  });

  it("an offloaded or stalled .edit.meta.json is unknown, not missing-dependencies", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    await writeFile(join(dir, ".kaipu", "r.edit.json"), "{}");
    await writeFile(sessionMetaPath(dir, "r"), "{}");
    for (const code of ["EVICTED", "ETIMEDOUT"]) {
      const refuse = async (): Promise<string> => {
        throw Object.assign(new Error("not readable now"), { code });
      };
      // Unknown counts as fine: the same answer as a session saved before the meta existed.
      expect(await probeEditing(dir, local("r"), refuse)).toBe("project-available");
      expect(await probeEditSession(dir, "r", refuse)).toEqual({
        savedAt: null,
        exportedSavedAt: null,
      });
    }
    // A file that was read and is corrupt is still a real problem.
    const corrupt = async (): Promise<string> => "{not json";
    expect(await probeEditing(dir, local("r"), corrupt)).toBe("missing-dependencies");
  });

  it("probeEditSession returns the session's savedAt, or null without a session", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    expect(await probeEditSession(dir, "r")).toEqual({ savedAt: null, exportedSavedAt: null });
    await saveSession("r", { sessionJson: "{}", assets: [] });
    const { savedAt } = await probeEditSession(dir, "r");
    expect(typeof savedAt).toBe("number");
    expect(savedAt).toBeGreaterThan(0);
  });

  it("probeEditSession returns nulls for a session without meta or with corrupt meta", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    await writeFile(join(dir, ".kaipu", "r.edit.json"), "{}");
    expect(await probeEditSession(dir, "r")).toEqual({ savedAt: null, exportedSavedAt: null });
    await writeFile(sessionMetaPath(dir, "r"), "not json");
    expect(await probeEditSession(dir, "r")).toEqual({ savedAt: null, exportedSavedAt: null });
  });

  it("reports exportedSavedAt only for the save that carried `exported`", async () => {
    await writeFile(join(dir, "r.mp4"), "v");
    await saveSession("r", { sessionJson: "{}", assets: [] });
    expect((await probeEditSession(dir, "r")).exportedSavedAt).toBeNull();

    await saveSession("r", { sessionJson: "{}", assets: [], exported: true });
    const exported = await probeEditSession(dir, "r");
    // The export save stamps its OWN savedAt: equality is what the badge reads as
    // "every edit is in a file", and it cannot race a slow encode.
    expect(exported.exportedSavedAt).toBe(exported.savedAt);
  });

  it("keeps the export stamp across later saves, so it reads as edited-since-export", async () => {
    // `savedAt` is Date.now(): two saves inside one millisecond (a fast CI runner)
    // would stamp the same value, so the clock is pinned to two distinct instants.
    const clock = vi.spyOn(Date, "now");
    try {
      await writeFile(join(dir, "r.mp4"), "v");
      clock.mockReturnValue(1_000);
      await saveSession("r", { sessionJson: "{}", assets: [], exported: true });
      const stamp = (await probeEditSession(dir, "r")).exportedSavedAt;
      expect(stamp).toBe(1_000);

      // A plain edit must neither clear the stamp (that would claim it was never
      // exported) nor advance it (that would claim the new edit is already in a file).
      clock.mockReturnValue(2_000);
      await saveSession("r", { sessionJson: '{"v":2}', assets: [] });
      const after = await probeEditSession(dir, "r");
      expect(after.exportedSavedAt).toBe(stamp);
      expect(after.savedAt).toBe(2_000);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("probeWebcam", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-probe-webcam-"));
    await mkdir(join(dir, ".kaipu"), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const sidecar = (id: string, data: object) =>
    writeFile(join(dir, ".kaipu", `${id}.json`), JSON.stringify(data));

  it("none for a recording that never had a webcam", async () => {
    await sidecar("r", { title: "x" });
    expect(await probeWebcam(dir, "r")).toBe("none");
    expect(await probeWebcam(dir, "no-sidecar")).toBe("none");
  });

  it("present when the file exists", async () => {
    await sidecar("r", { webcam: { startOffsetMs: 0 } });
    await writeFile(join(dir, ".kaipu", "r.webcam.mp4"), "w");
    expect(await probeWebcam(dir, "r")).toBe("present");
  });

  it("reads the sidecar through the reader it is given (a synced workspace's bounded one)", async () => {
    await sidecar("r", { webcam: { startOffsetMs: 0 } });
    const read: string[] = [];
    const reader = async (path: string): Promise<string> => {
      read.push(path);
      throw Object.assign(new Error("not downloaded"), { code: "EVICTED" });
    };
    // A refused read is "no webcam recorded", and nothing was read behind the reader's back.
    expect(await probeWebcam(dir, "r", reader)).toBe("none");
    expect(read).toEqual([join(dir, ".kaipu", "r.json")]);
  });

  it("missing when the sidecar names a webcam but the file is gone", async () => {
    await sidecar("r", {
      webcam: { startOffsetMs: 0, offsetQuality: "exact", width: 1280, height: 720, fps: 30 },
    });
    expect(await probeWebcam(dir, "r")).toBe("missing");
  });

  it("none when the sidecar's webcam field is malformed, as describe() reads it", async () => {
    await sidecar("r", { webcam: { startOffsetMs: 0 } });
    expect(await probeWebcam(dir, "r")).toBe("none");
  });
});

describe("probeTranscribedAt", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-probe-transcript-"));
    await mkdir(join(dir, ".kaipu"), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the transcript file's mtime without reading it", async () => {
    const path = join(dir, ".kaipu", "r.transcript.json");
    // Not valid JSON on purpose: the probe must not parse the file.
    await writeFile(path, "not json");
    expect(await probeTranscribedAt(dir, "r")).toBe(Math.trunc((await stat(path)).mtimeMs));
  });

  it("is null when the item has no transcript file", async () => {
    expect(await probeTranscribedAt(dir, "r")).toBeNull();
  });

  it("is null when the metadata folder does not exist", async () => {
    expect(await probeTranscribedAt(join(dir, "missing"), "r")).toBeNull();
  });

  it("is null when the transcript path is not a regular file", async () => {
    await mkdir(join(dir, ".kaipu", "r.transcript.json"));
    expect(await probeTranscribedAt(dir, "r")).toBeNull();
  });
});
