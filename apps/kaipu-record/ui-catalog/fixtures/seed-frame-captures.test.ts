import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURE_FILES, RECORDING_CUTS } from "./make-fixtures";
import { ASSETS, ITEM_IDS, seedCatalogVault } from "./seed-vault";

describe("the “Weekly sync frame” seed", () => {
  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  // Stand-in files named like the real fixtures: the seed copies them by name.
  async function seed(frameCaptures: boolean): Promise<string> {
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
      frameCaptures,
      fixturesDir: fixtures,
    });
    return vault;
  }

  it("adds a screenshot whose sidecar names “Weekly sync” as its source recording", async () => {
    const vault = await seed(true);
    const sidecar = JSON.parse(
      readFileSync(path.join(vault, ".kaipu", `${ITEM_IDS.weeklyFrame}.json`), "utf8"),
    );
    expect(sidecar).toEqual(
      expect.objectContaining({
        assetId: ASSETS.weeklyFrame,
        title: "Weekly sync frame",
        sourceVideoAssetId: ASSETS.weeklySync,
      }),
    );
    expect(existsSync(path.join(vault, `${ITEM_IDS.weeklyFrame}.png`))).toBe(true);
  });

  it("leaves the default vault alone", async () => {
    const vault = await seed(false);
    expect(existsSync(path.join(vault, `${ITEM_IDS.weeklyFrame}.png`))).toBe(false);
  });
});
