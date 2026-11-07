import { mkdir, rm, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { launchApp, RECORDING_ASSET_ID } from "../e2e/helpers/launch";

/*
 * Preview playback speed (NIW2-666): the transport bar at the editor's 1180 px floor and at
 * 1440 px, in English and Spanish, and at a non-1x speed. Self-contained and tolerant of a
 * tree from before the change (no speed button there), so the same file shoots "before" and
 * "after". It also logs the numbers behind the `.timeDisplay` comment in
 * transport-bar.module.css: the right column's width, the right cluster's width and the time
 * label's width, whose sum is the column width under which the label overlaps the buttons.
 */
const NAME = "speed";
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

for (const locale of ["en", "es"] as const) {
  test(`playback speed: transport bar at 1180 and 1440 in ${locale}`, async () => {
    await mkdir(OUT_DIR, { recursive: true });
    for (const f of await readdir(OUT_DIR)) {
      if (f.startsWith(`${locale}-`)) await rm(path.join(OUT_DIR, f));
    }
    const { app, page, teardown } = await launchApp({ settings: { locale } });
    try {
      // The e2e helper only knows the English labels; this scenario also runs in Spanish.
      const skip = page.getByRole("button", { name: /Skip setup|Omitir configuración/ });
      if (
        await skip.waitFor({ state: "visible", timeout: 10_000 }).then(
          () => true,
          () => false,
        )
      ) {
        await skip.click();
        await page
          .getByRole("dialog", { name: /Onboarding|Introducción/ })
          .waitFor({ state: "detached" });
      }
      const gotIt = page.getByRole("button", { name: /Got it|Entendido/ });
      if (await gotIt.isVisible().catch(() => false)) await gotIt.click();

      await page.evaluate((h) => (location.hash = h), `#/library/${RECORDING_ASSET_ID}`);
      await page.getByRole("button", { name: /Edit video|Editar video/ }).click();
      await page.waitForFunction(() => location.hash.startsWith("#/editor/video/"));
      await page.waitForSelector("video");
      const bar = page.locator("[data-ui-area='editorVideo.transport']");
      await expect(bar).toBeVisible();

      const speedButton = page.getByRole("button", {
        name: /^(Playback speed|Velocidad de reproducción)/,
      });
      const hasSpeed = (await speedButton.count()) > 0;

      const measure = async (): Promise<string> =>
        bar.evaluate((el) => {
          const [, centre, right] = Array.from(el.children) as HTMLElement[];
          const time = centre.lastElementChild as HTMLElement;
          const buttons = Array.from(right.children) as HTMLElement[];
          const first = buttons[0].getBoundingClientRect();
          const rightBox = right.getBoundingClientRect();
          const t = time.getBoundingClientRect();
          return JSON.stringify({
            barWidth: Math.round(el.getBoundingClientRect().width),
            rightColumn: Math.round(rightBox.width),
            rightCluster: Math.round(rightBox.right - first.left),
            timeLabel: Math.round(t.width),
            // Negative = clear space between the label and the first right-hand button.
            overlap: Math.round(t.right - first.left),
            oneLine: Math.round(el.getBoundingClientRect().height),
          });
        });

      const shot = async (name: string, size?: [number, number]): Promise<void> => {
        if (size) await sizeWindow(app, page, size);
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT_DIR, `${locale}-${name}-window.png`) });
        await bar.screenshot({ path: path.join(OUT_DIR, `${locale}-${name}-bar.png`) });
        console.log(
          `[verify] ${NAME}: ${locale} ${name} ${await measure()} speedButton=${hasSpeed}`,
        );
      };

      await shot("default");
      await shot("1440", [1440, 900]);
      await shot("1180", [1180, 800]);
      if (hasSpeed) {
        await speedButton.click(); // 1.5x
        await speedButton.click(); // 2x
        await shot("1180-2x");
        await sizeWindow(app, page, [1440, 900]);
        await shot("1440-2x");
        const rate = await page.evaluate(
          () => (document.querySelector("video") as HTMLVideoElement).playbackRate,
        );
        console.log(`[verify] ${NAME}: ${locale} video.playbackRate=${rate}`);
        expect(rate).toBe(2);
        await speedButton.click(); // 0.5x
        await shot("1440-0.5x");
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
}
