import { test, expect } from "@playwright/test";
import path from "node:path";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import {
  localIdForAssetId,
  openEditor,
  RECORDING_ASSET_ID,
  RECORDING_ID,
} from "../e2e/helpers/launch";
import { measureAvSync, type AvSyncReport } from "../e2e/helpers/av-sync";
import { startScenario } from "./helpers";

/**
 * A/V sync of a real export (NIW2-807). Each fixture in `fixtures/av-sync/` is a 10 s take with
 * a white flash and a 1 kHz beep that start on the same instant at 2, 4, 6 and 8 s; the README
 * there says how each was made. The scenario exports it twice through the real app, once whole
 * and once with two cuts, and measures every event's audio-minus-video offset with ffmpeg.
 *
 * The export must not change what the source shows: each export's offsets equal the source's
 * own, and the flashes land where the cuts put them. `report.json` in the output folder holds
 * every number; the exported files are kept next to it.
 *
 * `AV_SYNC_FIXTURES=ffmpeg,mb161` picks fixtures (default: all of them).
 */

const FIXTURE_DIR = path.join(__dirname, "fixtures", "av-sync");
const ALL_FIXTURES = ["ffmpeg", "mb161", "mb166"];
const DURATION = 10;

const SCENES = {
  whole: {
    items: [{ id: "clip-1", kind: "clip", sourceStart: 0, sourceEnd: DURATION }],
    expectedFlashes: [2, 4, 6, 8],
  },
  // Cut 0–0.5 s and 3.0–3.7 s: the events at 2, 4, 6, 8 s land at 1.5, 2.8, 4.8, 6.8 s. The
  // second clip starts mid-take, so its audio is trimmed on both sides of the cut.
  cuts: {
    items: [
      { id: "clip-1", kind: "clip", sourceStart: 0.5, sourceEnd: 3 },
      { id: "clip-2", kind: "clip", sourceStart: 3.7, sourceEnd: DURATION },
    ],
    expectedFlashes: [1.5, 2.8, 4.8, 6.8],
  },
} as const;

type SceneName = keyof typeof SCENES;

function seedFor(fixture: string, scene: SceneName) {
  return async (vaultDir: string): Promise<void> => {
    const meta = path.join(vaultDir, ".kaipu");
    await mkdir(meta, { recursive: true });
    await copyFile(
      path.join(FIXTURE_DIR, `${fixture}.mp4`),
      path.join(vaultDir, `${RECORDING_ID}.mp4`),
    );
    await writeFile(
      path.join(meta, `${RECORDING_ID}.json`),
      JSON.stringify({
        sidecarVersion: 2,
        assetId: RECORDING_ASSET_ID,
        title: `AV sync ${fixture}`,
        durationSeconds: DURATION,
        createdAt: 1_700_000_000_000,
      }),
    );
    await writeFile(
      path.join(meta, `${RECORDING_ID}.edit.json`),
      JSON.stringify({
        version: 1,
        scene: { items: SCENES[scene].items, overlays: [], audioMuted: false, mutedRanges: [] },
      }),
    );
  };
}

test("export keeps the source's A/V sync, whole and across cuts", async () => {
  test.skip(process.platform === "linux", "WebCodecs H.264 encoding unavailable on Linux");
  test.setTimeout(15 * 60_000);
  const fixtures = (process.env.AV_SYNC_FIXTURES ?? ALL_FIXTURES.join(",")).split(",");
  const report: Record<string, { source: AvSyncReport; exports: Record<string, AvSyncReport> }> =
    {};
  let first = true;
  let outDir = "";

  for (const fixture of fixtures) {
    const source = await measureAvSync(path.join(FIXTURE_DIR, `${fixture}.mp4`));
    report[fixture] = { source, exports: {} };
    for (const scene of Object.keys(SCENES) as SceneName[]) {
      const s = await startScenario("av-sync", {
        keepOutput: !first,
        videoName: `video-${fixture}-${scene}`,
        seedVault: seedFor(fixture, scene),
      });
      first = false;
      outDir = s.outDir;
      try {
        await openEditor(s.page);
        await expect
          .poll(() => s.page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
            timeout: 15_000,
          })
          .toBeGreaterThan(0);
        await s.page.getByRole("button", { name: "Export", exact: true }).click();
        await s.page
          .getByRole("alertdialog")
          .getByRole("button", { name: /^Export( |$)/ })
          .click();
        const ready = s.page.getByRole("region", { name: "Your export is ready" });
        await expect(ready).toBeVisible({ timeout: 120_000 });
        await ready.getByRole("button", { name: /in your Library$/ }).click();
        await expect
          .poll(() => s.page.evaluate(() => location.hash), { timeout: 15_000 })
          .toMatch(/^#\/library\/.+/);
        const assetId = (await s.page.evaluate(() => location.hash)).replace("#/library/", "");
        const localId = await localIdForAssetId(s.vaultDir, assetId);
        const kept = path.join(s.outDir, `export-${fixture}-${scene}.mp4`);
        await copyFile(path.join(s.vaultDir, `${localId}.mp4`), kept);
        report[fixture]!.exports[scene] = await measureAvSync(kept);
      } finally {
        await s.finish();
      }
    }
  }

  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  for (const [fixture, { source, exports }] of Object.entries(report)) {
    console.log(`[av-sync] ${fixture} source offsets ms: ${source.offsetsMs.join(", ")}`);
    for (const [scene, r] of Object.entries(exports)) {
      console.log(
        `[av-sync] ${fixture} ${scene}: flashes ${r.flashes.map((f) => f.toFixed(4)).join(", ")}` +
          ` | offsets ms ${r.offsetsMs.join(", ")}`,
      );
    }
  }

  for (const [fixture, { source, exports }] of Object.entries(report)) {
    for (const [scene, r] of Object.entries(exports)) {
      const expected = SCENES[scene as SceneName].expectedFlashes;
      r.flashes.forEach((t, i) =>
        expect(Math.abs(t - expected[i]!), `${fixture} ${scene} flash ${i}`).toBeLessThan(0.017),
      );
      r.offsetsMs.forEach((offset, i) =>
        expect(
          Math.abs(offset - source.offsetsMs[i]!),
          `${fixture} ${scene} event ${i}: export ${offset} ms vs source ${source.offsetsMs[i]} ms`,
        ).toBeLessThanOrEqual(1),
      );
    }
  }
});
