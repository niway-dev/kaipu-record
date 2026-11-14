import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { recordingAt, sourceAxis } from "../../src/renderer/src/features/video-editor/source-axis";
import { parseSession } from "../../src/renderer/src/features/video-editor/session";
import { toLayout } from "../../src/renderer/src/features/video-editor/timeline";
import { FIXTURE_FILES, RECORDING_CUTS } from "./make-fixtures";
import {
  ASSETS,
  JOINED_MISSING_ASSET,
  JOINED_OFFSET,
  joinedScene,
  seedCatalogVault,
} from "./seed-vault";

describe("joinedScene", () => {
  it("is a version 2 session the editor's reader accepts, clips alternating A, B, A", () => {
    const session = parseSession(
      JSON.stringify({ version: 2, scene: joinedScene("present", 12) }),
      12,
    );
    expect(session).not.toBeNull();
    const { scene } = session!;
    expect(scene.sources).toEqual([
      expect.objectContaining({
        assetId: ASSETS.joinedSecond,
        title: "Checkout bug",
        offset: JOINED_OFFSET,
        durationSeconds: 7,
      }),
    ]);
    const axis = sourceAxis(12, scene.sources);
    const owners = toLayout(scene.items).map((entry) => {
      const found = recordingAt(axis, entry.sourceStart);
      return found ? found.recording.sourceId : "none";
    });
    expect(owners).toEqual([null, "join-b", null]);
  });

  it("joins a recording that is not in the vault for the missing state", () => {
    const session = parseSession(
      JSON.stringify({ version: 2, scene: joinedScene("missing", 9) }),
      9,
    );
    expect(session?.scene.sources?.[0].assetId).toBe(JOINED_MISSING_ASSET);
  });
});

describe("the “Different aspect” seed", () => {
  // Each test's temp directories are removed once the file's tests have run.
  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("joins a 1080x1080 recording whose media is the square fixture", async () => {
    // Stand-in files named like the real fixtures: the seed copies them by name, so each one
    // carries its own name and the copy under test can be told apart.
    const fixtures = mkdtempSync(path.join(tmpdir(), "kaipu-seed-fixtures-"));
    tempDirs.push(fixtures);
    const names = [
      FIXTURE_FILES.countdown,
      FIXTURE_FILES.joinedCut,
      FIXTURE_FILES.joinedSquareCut,
      FIXTURE_FILES.thumbnail,
      FIXTURE_FILES.webcam,
      FIXTURE_FILES.gif,
      FIXTURE_FILES.colorsShot,
      FIXTURE_FILES.photoShot,
      ...FIXTURE_FILES.screens,
      ...RECORDING_CUTS.map(FIXTURE_FILES.cut),
    ];
    for (const name of names) writeFileSync(path.join(fixtures, name), name);
    const vault = mkdtempSync(path.join(tmpdir(), "kaipu-seed-vault-"));
    tempDirs.push(vault);
    await seedCatalogVault(vault, {
      now: 1_700_000_000_000,
      content: "demo",
      joinedRecordings: true,
      fixturesDir: fixtures,
    });
    const meta = path.join(vault, ".kaipu");
    const readJson = (file: string): any => JSON.parse(readFileSync(file, "utf8"));

    const edit = readJson(path.join(meta, "Different aspect.edit.json"));
    expect(edit.version).toBe(2);
    expect(edit.scene.sources).toEqual([
      expect.objectContaining({
        id: "join-sq",
        assetId: ASSETS.squareSecond,
        offset: JOINED_OFFSET,
        width: 1080,
        height: 1080,
      }),
    ]);
    // The opened recording stays 16:9, the joined one is 1:1.
    expect(readJson(path.join(meta, "Different aspect.json")).capture).toEqual(
      expect.objectContaining({ width: 1920, height: 1080 }),
    );
    const square = readJson(path.join(meta, "Square recording.json"));
    expect(square.assetId).toBe(ASSETS.squareSecond);
    expect(square.capture).toEqual(expect.objectContaining({ width: 1080, height: 1080 }));
    expect(readFileSync(path.join(vault, "Square recording.mp4"), "utf8")).toBe(
      FIXTURE_FILES.joinedSquareCut,
    );
    // The existing joined recording keeps the 16:9 file.
    expect(readFileSync(path.join(vault, "Checkout bug.mp4"), "utf8")).toBe(
      FIXTURE_FILES.joinedCut,
    );
  });
});
