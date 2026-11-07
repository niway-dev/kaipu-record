import { mkdir, rm, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { dismissOnboarding, launchApp, RECORDING_ASSET_ID } from "../e2e/helpers/launch";

/*
 * The video editor's transport bar (NIW2-664): the editor at the app's default launch
 * size, at 1440×900 and at the 1180 px floor, so the play button's centring and the
 * split/delete/mute cluster can be compared before and after. Self-contained, and it only
 * shoots, so the same file runs on a tree from before the change.
 */
const NAME = "transport";
const OUT_DIR = path.resolve(__dirname, "..", "test-results", "verify", NAME);

async function sizeWindow(
  app: ElectronApplication,
  page: Page,
  [width, height]: [number, number],
): Promise<void> {
  const handle = await app.browserWindow(page);
  await handle.evaluate((w, [wd, ht]) => w.setSize(wd, ht), [width, height]);
  await page.waitForFunction((wd) => window.innerWidth === wd, width);
}

test("transport bar: editor at the default size, 1440 and 1180", async () => {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const { app, page, teardown } = await launchApp();
  try {
    await dismissOnboarding(page);
    const gotIt = page.getByRole("button", { name: "Got it" });
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();

    await page.evaluate((h) => (location.hash = h), `#/library/${RECORDING_ASSET_ID}`);
    await page.getByRole("button", { name: "Edit video" }).click();
    await page.waitForFunction(() => location.hash.startsWith("#/editor/video/"));
    await page.waitForSelector("video");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

    const shot = async (name: string, size?: [number, number]): Promise<void> => {
      if (size) await sizeWindow(app, page, size);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
      const box = await page.getByRole("button", { name: "Play" }).boundingBox();
      const viewport = await page.evaluate(() => window.innerWidth);
      // The play button's centre against the window's centre: 0 means optically centred.
      console.log(
        `[verify] ${NAME}: ${name} width=${viewport} play-centre-offset=${
          box ? (box.x + box.width / 2 - viewport / 2).toFixed(1) : "n/a"
        }`,
      );
    };

    // The app's own launch size, before anything resizes the window.
    await shot("01-default-size");
    await shot("02-1440x900", [1440, 900]);
    await shot("03-1180x800", [1180, 800]);
  } finally {
    try {
      await teardown();
    } catch (error) {
      console.error(`[verify] ${NAME}: closing the app failed`, error);
    }
    for (const f of (await readdir(OUT_DIR)).sort()) {
      console.log(`[verify] ${NAME}: ${f} (${(await stat(path.join(OUT_DIR, f))).size} bytes)`);
    }
  }
});
