import { test, expect, type Locator, type Page } from "@playwright/test";
import { dismissOnboarding } from "../e2e/helpers/launch";
import { ensureFixtures } from "../ui-catalog/fixtures/make-fixtures";
import { ASSETS, seedCatalogVault } from "../ui-catalog/fixtures/seed-vault";
import { startScenario } from "./helpers";

/*
 * Dragging the camera bubble while the video plays (camera parts, drag-first). Proves, in
 * the real app with real pointer input:
 *   1. picking the bubble up pauses playback;
 *   2. after the drop outside every camera part, the "Where to keep the camera" card is
 *      still open one time update later (the pause queues one), and the transport still
 *      says Play;
 *   3. the part the card offers starts at the paused time.
 * The recording is the catalog's "Camera parts" (12 s, a webcam track, a part from 2 s to 6 s
 * and a hidden range from 8 s to 10 s); the script parks the playhead at 0 and plays, so the
 * bubble is picked up in the original stretch and the drop lands where no part is. No camera
 * device is involved: the webcam is the recording's own track.
 */
const NAME = "camera-drag-pauses";
const CLOCK = /^\d+:\d\d\.\d \/ \d+:\d\d\.\d$/;

const log = (message: string): void => console.log(`[verify] ${NAME}: ${message}`);

/** The transport's "0:03.2" (the current time of "0:03.2 / 0:12.0"). */
async function clockNow(page: Page): Promise<string> {
  const full = await page.getByText(CLOCK).first().innerText();
  return full.split(" / ")[0]!;
}

async function mainVideoTime(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.querySelector<HTMLVideoElement>("video:not([data-testid='webcam-video'])")
        ?.currentTime ?? -1,
  );
}

test("camera: dragging the bubble during playback pauses it and the drop card stays open", async () => {
  test.skip(process.platform === "linux", "needs the real app on a desktop");
  ensureFixtures();
  const scenario = await startScenario(NAME, {
    seedVault: (dir) =>
      seedCatalogVault(dir, { now: Date.now(), content: "demo", cameraRecordings: true }),
  });
  const { app, page, shot, finish } = scenario;
  try {
    const win = await app.browserWindow(page);
    await win.evaluate((w) => {
      w.setSize(1440, 900);
      w.center();
    });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1400);
    await dismissOnboarding(page);
    await page.evaluate((id) => {
      location.hash = `#/editor/video/${id}`;
    }, ASSETS.cameraParts);
    await expect
      .poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    const bubble = page.getByTestId("webcam-layer");
    const slot = page.getByTestId("webcam-slot");
    await expect(bubble).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Webcam section 1", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const sectionsBefore = await page.getByRole("button", { name: /^Webcam section \d+$/ }).count();

    const play = page.getByRole("button", { name: "Play", exact: true });
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    const card: Locator = page.getByRole("group", { name: "Where to keep the camera" });

    // Park the playhead in the original stretch (before the 2 s part), then play.
    await page.evaluate(() => {
      const main = document.querySelector<HTMLVideoElement>(
        "video:not([data-testid='webcam-video'])",
      );
      if (main) main.currentTime = 0;
    });
    await expect(play).toBeVisible();
    log(`before playing: ${await clockNow(page)}, ${sectionsBefore} sections on the lane`);
    await play.click();
    await expect(pause).toBeVisible();
    // Wait until playback has really advanced, so the paused time is clearly later than 0. The pickup has to
    // happen well before the 2 s part, or the room left is too short to offer a part.
    await expect.poll(() => mainVideoTime(page), { intervals: [30] }).toBeGreaterThan(0.25);

    // Pick the bubble up with the real mouse and drag it well away, in several steps.
    const from = (await bubble.boundingBox())!;
    const area = (await slot.boundingBox())!;
    const startX = from.x + from.width / 2;
    const startY = from.y + from.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 4, startY - 4, { steps: 2 });
    const toX = area.x + area.width * 0.75;
    const toY = area.y + area.height * 0.3;
    await page.mouse.move(toX, toY, { steps: 15 });

    // 1. The transport now says Play, with the mouse still down.
    await expect(play).toBeVisible();
    await expect(pause).toHaveCount(0);
    await page.waitForTimeout(250);
    const pausedClock = await clockNow(page);
    log(
      `PASS 1: mouse down, transport shows Play; paused at ${pausedClock} (video ${(await mainVideoTime(page)).toFixed(3)} s)`,
    );
    await shot("dragging-paused");

    // Drop.
    await page.mouse.up();
    await expect(card).toBeVisible();
    const cardText = (await card.innerText()).replace(/\s+/g, " ");
    log(`PASS 2a: card visible right after the drop: "${cardText}"`);
    await shot("card-after-drop");

    // 2. One time update later (nothing pressed): the card is still open, still paused.
    await page.waitForTimeout(600);
    await expect(card).toBeVisible();
    await expect(play).toBeVisible();
    const clockAfter = await clockNow(page);
    log(
      `PASS 2b: 600 ms later the card is still visible and the transport still says Play; paused clock before ${pausedClock}, after ${clockAfter} (video ${(await mainVideoTime(page)).toFixed(3)} s)`,
    );
    await shot("card-still-open");

    // 3. "Only for this part": a part appears on the lane, starting at the paused time.
    // The card writes whole seconds ("from 0:01"); the transport shows tenths ("0:01.0").
    const offered = /from (\d+:\d\d)/.exec(cardText)?.[1] ?? "(not found)";
    log(`the card offers a part "from ${offered}"; paused clock ${pausedClock}`);
    expect(pausedClock.startsWith(offered)).toBe(true);
    expect(await mainVideoTime(page)).toBeGreaterThan(0.25);
    await card.getByRole("button", { name: /Only for this part/ }).click();
    await expect
      .poll(() => page.getByRole("button", { name: /^Webcam section \d+$/ }).count())
      .toBe(sectionsBefore + 1);
    const sections = page.getByRole("button", { name: /^Webcam section \d+$/ });
    for (let i = 0; i < (await sections.count()); i += 1) {
      const text = (await sections.nth(i).innerText()).replace(/\s+/g, " ");
      const label = await sections.nth(i).getAttribute("aria-label");
      log(`lane: "${label}" -> "${text}"`);
    }
    const panel = page.locator("[data-ui-area='editorVideo.webcamPanel']");
    await expect(panel).toBeVisible();
    const panelText = (await panel.innerText()).replace(/\s+/g, " ");
    // The panel reads "0:00.3 – 0:02.0 · 1.7 s": the new part's start is its first time.
    const startsAt = /(\d+:\d\d\.\d) – /.exec(panelText)?.[1];
    expect(startsAt, `the panel names the part's range: "${panelText}"`).toBeDefined();
    expect(startsAt).toBe(pausedClock);
    log(
      `PASS 3: a part was added (${sectionsBefore} -> ${sectionsBefore + 1}) and starts at ${startsAt}, the paused time ${pausedClock}; panel: "${panelText}"`,
    );
    await shot("part-added");
  } finally {
    await finish();
  }
});
