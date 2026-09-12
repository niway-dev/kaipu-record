import { test, expect } from "@playwright/test";
import { access, copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { dismissOnboarding, launchApp } from "./helpers/launch";

const ORPHAN_ID = "e2e-orphan";
const VIDEO_FIXTURE = path.join(__dirname, "fixtures", "sample.mp4");

test("an imported recording with no sidecar self-heals on Sync", async () => {
  const { page, vaultDir, teardown } = await launchApp();
  try {
    // Onboarding's full-window modal intercepts pointer events, so it must go first.
    await dismissOnboarding(page);

    // Drop a valid MP4 into the vault with NO `.kaipu` sidecar — exactly what a
    // hand-imported clip (or an interrupted finalize) looks like: right filename,
    // no derived duration/poster. It lists as 0:00 with the editor disabled.
    await copyFile(VIDEO_FIXTURE, path.join(vaultDir, `${ORPHAN_ID}.mp4`));

    // Land on the library list and Sync so the orphan is discovered + healed.
    await page.evaluate(() => {
      location.hash = "#/library";
    });
    await page.getByRole("button", { name: "Sync" }).click();

    // Duration is demuxed from the container (no decoder needed) — this heals
    // everywhere, including headless CI, and is what re-enables "Edit video".
    const sidecarPath = path.join(vaultDir, ".kaipu", `${ORPHAN_ID}.json`);
    await expect
      .poll(
        async () => {
          try {
            return (
              (JSON.parse(await readFile(sidecarPath, "utf-8")).durationSeconds as number) ?? 0
            );
          } catch {
            return 0;
          }
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    // The poster is decoded via WebCodecs, which headless Linux CI lacks (same as
    // the export test) — assert it only where a real decoder exists.
    if (!(process.platform === "linux" && process.env.CI)) {
      const posterPath = path.join(vaultDir, ".kaipu", `${ORPHAN_ID}.jpg`);
      await expect
        .poll(
          async () => {
            try {
              await access(posterPath);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 30_000 },
        )
        .toBe(true);
    }

    // And the healed recording is now editable in the UI. The detail route is keyed by
    // `assetId`, which the vault minted into the sidecar during the same heal — so read it
    // from disk rather than guessing it.
    const healedAssetId = (JSON.parse(await readFile(sidecarPath, "utf-8")) as { assetId?: string })
      .assetId;
    expect(healedAssetId).toBeTruthy();
    await page.evaluate((assetId) => {
      location.hash = `#/library/${assetId}`;
    }, healedAssetId!);
    await expect(page.getByRole("button", { name: "Edit video" })).toBeEnabled();
  } finally {
    await teardown();
  }
});
