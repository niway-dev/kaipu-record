import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ dir: "" }));
vi.mock("./vault-location", () => ({
  vaultDirectory: () => ({ path: state.dir, isCustom: false }),
}));

import { saveSession } from "./video-edit-session";
import { hasEditSession, probeEditing } from "./edit-project-probe";

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
});
