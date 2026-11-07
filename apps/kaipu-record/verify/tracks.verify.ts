import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { dismissOnboarding, launchApp, RECORDING_ASSET_ID } from "../e2e/helpers/launch";

/*
 * The Tracks popover (NIW2-665): the editor at the app's default launch size, at 1440×900
 * and at the 1180 px floor, closed, with the popover open, and with Zooms hidden. Self
 * contained and tolerant of a tree from before the change: when the Tracks button is still
 * the disabled placeholder it only shoots the closed editor, so the same file produces the
 * "before" shots.
 */
const NAME = "tracks";
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

test("tracks popover: editor at the default size, 1440 and 1180", async () => {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const { app, page, userDataDir, teardown } = await launchApp();
  try {
    await dismissOnboarding(page);
    const gotIt = page.getByRole("button", { name: "Got it" });
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();

    await page.evaluate((h) => (location.hash = h), `#/library/${RECORDING_ASSET_ID}`);
    await page.getByRole("button", { name: "Edit video" }).click();
    await page.waitForFunction(() => location.hash.startsWith("#/editor/video/"));
    await page.waitForSelector("video");
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

    // A manual zoom, so the Zooms lane has something a hidden lane must keep.
    await page.getByRole("button", { name: "Zoom", exact: true }).click();
    await page.waitForSelector("[data-zoom-id]");

    const tracks = page.getByRole("button", { name: /^Tracks/ });
    const interactive = await tracks.isEnabled();
    console.log(`[verify] ${NAME}: tracks button enabled=${interactive}`);
    console.log(`[verify] ${NAME}: tracks button text=${JSON.stringify(await tracks.innerText())}`);

    const laneLabels = (): Promise<string[]> =>
      page.$$eval("footer span", (els) =>
        els.filter((el) => el.querySelector("svg") && el.textContent).map((el) => el.textContent!),
      );
    const box = async (): Promise<string> => {
      const video = await page.locator("video").first().boundingBox();
      const footer = await page.locator("footer").boundingBox();
      return `video=${video ? `${Math.round(video.width)}x${Math.round(video.height)}` : "n/a"} footer-height=${
        footer ? Math.round(footer.height) : "n/a"
      }`;
    };
    const shot = async (name: string, size?: [number, number]): Promise<void> => {
      if (size) await sizeWindow(app, page, size);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
      console.log(
        `[verify] ${NAME}: ${name} width=${await page.evaluate(() => window.innerWidth)} lanes=${JSON.stringify(
          await laneLabels(),
        )} ${await box()}`,
      );
    };
    const toggleZooms = async (): Promise<void> => {
      await page.getByRole("menuitemcheckbox", { name: "Zooms" }).click();
      await page.waitForTimeout(300);
    };

    const sizes: [string, [number, number] | undefined][] = [
      ["default-size", undefined],
      ["1440x900", [1440, 900]],
      ["1180x800", [1180, 800]],
    ];
    let n = 0;
    for (const [label, size] of sizes) {
      const step = (what: string): string => `${String(++n).padStart(2, "0")}-${label}-${what}`;
      await shot(step("closed"), size);
      if (!interactive) continue;
      await tracks.click();
      await page.getByRole("menu", { name: "Show tracks" }).waitFor();
      await shot(step("popover-open"));
      await toggleZooms();
      await shot(step("popover-zooms-unchecked"));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      console.log(
        `[verify] ${NAME}: focus returned to trigger=${await tracks.evaluate((el) => el === document.activeElement)}`,
      );
      await shot(step("zooms-hidden"));
      // Put Zooms back for the next size.
      await tracks.click();
      await toggleZooms();
      await page.keyboard.press("Escape");
    }

    if (interactive) {
      // The choice is saved per user, in the settings store.
      await tracks.click();
      await toggleZooms();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1200);
      const saved = JSON.parse(await readFile(path.join(userDataDir, "settings.json"), "utf8"));
      console.log(`[verify] ${NAME}: settings.json editor=${JSON.stringify(saved.editor)}`);

      // A selection is never invisible: the Zoom tool selects the zoom, so the lane returns.
      await page.getByRole("button", { name: "Zoom", exact: true }).click();
      await page.waitForTimeout(500);
      const after = await laneLabels();
      console.log(`[verify] ${NAME}: after selecting the zoom lanes=${JSON.stringify(after)}`);
      await shot(`${String(++n).padStart(2, "0")}-zoom-selected-lane-back`);
      const saved2 = JSON.parse(await readFile(path.join(userDataDir, "settings.json"), "utf8"));
      console.log(`[verify] ${NAME}: settings.json editor now=${JSON.stringify(saved2.editor)}`);
    }
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
