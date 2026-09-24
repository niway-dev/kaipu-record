import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("./vault-location", () => ({
  vaultDirectory: () => ({ path: state.dir, isCustom: false }),
}));

import { saveSession, sessionMetaPath } from "./video-edit-session";
import { hasEditSession, probeEditing, probeEditSession } from "./edit-project-probe";

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
    await writeFile(join(dir, "r.mp4"), "v");
    await saveSession("r", { sessionJson: "{}", assets: [], exported: true });
    const stamp = (await probeEditSession(dir, "r")).exportedSavedAt;

    // A plain edit must neither clear the stamp (that would claim it was never
    // exported) nor advance it (that would claim the new edit is already in a file).
    await saveSession("r", { sessionJson: '{"v":2}', assets: [] });
    const after = await probeEditSession(dir, "r");
    expect(after.exportedSavedAt).toBe(stamp);
    expect(after.savedAt).not.toBe(after.exportedSavedAt);
  });
});
