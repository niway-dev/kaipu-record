import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseSession } from "../../src/renderer/src/features/video-editor/session";
import { FIXTURE_FILES, RECORDING_CUTS } from "./make-fixtures";
import { ASSETS, clipsScene, LONG_SEQUENCE_CLIPS, seedCatalogVault } from "./seed-vault";

describe("clipsScene", () => {
  it("is a session the editor's reader accepts: the clips in order, no slides", () => {
    const clips = [
      [0, 4],
      [4, 8],
      [8, 12],
    ] as const;
    const session = parseSession(JSON.stringify({ version: 1, scene: clipsScene(clips) }), 12);
    expect(session).not.toBeNull();
    expect(
      session!.scene.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        ...(item.kind === "clip" ? { start: item.sourceStart, end: item.sourceEnd } : {}),
      })),
    ).toEqual([
      { id: "clip-1", kind: "clip", start: 0, end: 4 },
      { id: "clip-2", kind: "clip", start: 4, end: 8 },
      { id: "clip-3", kind: "clip", start: 8, end: 12 },
    ]);
  });
});

describe("the split “Weekly sync” seed", () => {
  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  async function seed(splitWeeklySync: boolean, manyClipsRecording = false): Promise<string> {
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
      splitWeeklySync,
      manyClipsRecording,
      fixturesDir: fixtures,
    });
    return vault;
  }

  const editPath = (vault: string) => path.join(vault, ".kaipu", "Weekly sync.edit.json");

  it("saves three 4 s clips as “Weekly sync”'s edit", async () => {
    const vault = await seed(true);
    const saved = JSON.parse(readFileSync(editPath(vault), "utf8"));
    expect(saved.scene.items).toEqual([
      { id: "clip-1", kind: "clip", sourceStart: 0, sourceEnd: 4 },
      { id: "clip-2", kind: "clip", sourceStart: 4, sourceEnd: 8 },
      { id: "clip-3", kind: "clip", sourceStart: 8, sourceEnd: 12 },
    ]);
  });

  it("makes “Weekly sync” 12 s long, not just its edit", async () => {
    const vault = await seed(true);
    const sidecar = JSON.parse(
      readFileSync(path.join(vault, ".kaipu", "Weekly sync.json"), "utf8"),
    );
    expect(sidecar.durationSeconds).toBe(12);
  });

  it("leaves the default vault without a saved edit for it", async () => {
    const vault = await seed(false);
    expect(existsSync(editPath(vault))).toBe(false);
  });

  describe("the “Long sequence” seed", () => {
    const longEdit = (vault: string) => path.join(vault, ".kaipu", "Long sequence.edit.json");
    const sidecar = (vault: string) => path.join(vault, ".kaipu", "Long sequence.json");

    it("saves ten consecutive 1.2 s clips that cover the 12 s media, in an edit the reader accepts", async () => {
      const vault = await seed(true, true);
      const saved = JSON.parse(readFileSync(longEdit(vault), "utf8"));
      expect(saved.scene.items).toHaveLength(10);
      const session = parseSession(JSON.stringify(saved), 12);
      expect(session).not.toBeNull();
      const spans = session!.scene.items.map((item) =>
        item.kind === "clip" ? [item.sourceStart, item.sourceEnd] : null,
      );
      expect(spans).toEqual(LONG_SEQUENCE_CLIPS.map(([a, b]) => [a, b]));
      expect(spans[0]).toEqual([0, 1.2]);
      expect(spans[9]).toEqual([10.8, 12]);
      for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBe(spans[i - 1]![1]);
      expect(JSON.parse(readFileSync(sidecar(vault), "utf8"))).toMatchObject({
        assetId: ASSETS.longSequence,
        title: "Long sequence",
        durationSeconds: 12,
      });
    });

    it("is off by default: no recording and no edit for it", async () => {
      const vault = await seed(true);
      expect(existsSync(sidecar(vault))).toBe(false);
      expect(existsSync(longEdit(vault))).toBe(false);
    });

    it("leaves “Weekly sync” as its own three clips", async () => {
      const vault = await seed(true, true);
      const saved = JSON.parse(readFileSync(editPath(vault), "utf8"));
      expect(saved.scene.items).toHaveLength(3);
    });
  });
});
