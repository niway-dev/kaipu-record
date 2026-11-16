import { test, expect, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dismissOnboarding } from "../e2e/helpers/launch";
import { ensureFixtures } from "../ui-catalog/fixtures/make-fixtures";
import { ASSETS, seedCatalogVault } from "../ui-catalog/fixtures/seed-vault";
import { startScenario } from "./helpers";

/*
 * Real-app proof for NIW2-790 (behind the `timeline-levels` flag): the transport's Add recording
 * button opens the Add from Library modal, its Add button (destination "after the clip under the
 * playhead", the default for a recording) inserts the selected recording after that clip, and one Cmd+Z undoes the join.
 *
 * Opens "Weekly sync" (one 3 s clip) with the flag forced on the way the UI catalog forces it
 * (`KAIPU_FLAG_OVERRIDES`), selects "Walkthrough 1" (12 s) and presses Add in the modal,
 * and records the clip order after the add and the durations before, after and after the undo.
 * Screenshots and `result.json` go to `test-results/verify/add-recording/`. The seeded vault is
 * a throwaway one per launch, so nothing needs restoring. The scenario uses `Meta+z`, so it runs
 * on macOS only (the verify suite runs on the Mac mini).
 */
const NAME = "add-recording";
const OPENED = "Weekly sync";
const ADDED = "Walkthrough 1";

/** The "m:ss.t" total in the transport bar's "0:00.0 / 0:03.0". */
async function durationLabel(page: Page): Promise<string> {
  const text = await page
    .locator("[data-ui-area='editorVideo.transport']")
    .getByText(/\d+:\d{2}\.\d \/ \d+:\d{2}\.\d/)
    .first()
    .innerText();
  const match = /\/\s*(\d+:\d{2}\.\d)/.exec(text);
  if (!match) throw new Error(`no duration in the transport text: ${text}`);
  return match[1];
}

async function clipLabels(page: Page): Promise<string[]> {
  const labels = await page.locator("[data-testid='clip-label']").allInnerTexts();
  return labels.map((label) => label.replace(/\s+/g, " ").trim());
}

/** The clip blocks of the timeline: one `button[data-item-id]` per clip. */
function clipBlocks(page: Page): Locator {
  return page.locator("[data-ui-area='editorVideo.timeline'] button[data-item-id]");
}

test("Add in the Add from Library modal inserts the recording and undoes in one step", async () => {
  test.setTimeout(240_000);
  ensureFixtures();
  const s = await startScenario(NAME, {
    env: { KAIPU_FLAG_OVERRIDES: JSON.stringify({ "timeline-levels": true }) },
    seedVault: (dir) =>
      seedCatalogVault(dir, {
        now: Date.now(),
        content: "demo",
        floatingImages: true,
        frameCaptures: true,
      }),
  });
  const page = s.page;
  const result: Record<string, unknown> = { flag: "timeline-levels" };
  try {
    await dismissOnboarding(page);
    const gotIt = page.getByRole("button", { name: "Got it" });
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
    await page.evaluate((id) => {
      location.hash = `#/editor/video/${id}`;
    }, ASSETS.weeklySync);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    // 1. One clip, 3 s.
    const before = await durationLabel(page);
    result.durationBefore = before;
    result.labelsBefore = await clipLabels(page);
    expect(before).toBe("0:03.0");
    await s.shot("before");

    // 2. The modal opens on the Recordings tab with the preview of the first row.
    await page
      .locator("[data-ui-area='editorVideo.transport']")
      .getByRole("button", { name: "Add recording", exact: true })
      .click();
    const modal = page.locator("[data-ui-area='editorVideo.addFromLibrary']");
    const row: Locator = modal.getByRole("button", { name: ADDED, exact: true });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(row).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(600); // thumbnails decode after the list is drawn
    await s.shot("modal");

    // 3. Add with the default destination (after the clip under the playhead). The playhead is at
    // 0:00, so "after the clip under it" is 0:03.0.
    await modal.getByRole("button", { name: "Add", exact: true }).click();

    // 4. 3 s + 12 s, the opened recording first.
    await expect.poll(() => durationLabel(page), { timeout: 20_000 }).not.toBe(before);
    await expect
      .poll(async () => (await clipLabels(page)).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(800); // the joined clip's thumbnails
    const after = await durationLabel(page);
    const labels = await clipLabels(page);
    result.durationAfter = after;
    result.labelsAfter = labels;
    result.blocksAfter = await clipBlocks(page).count();
    await s.shot("after");
    expect(after).toBe("0:15.0");
    expect(labels[0]).toContain(OPENED);
    expect(labels[1]).toContain(ADDED);
    expect(result.blocksAfter).toBe(2);

    // 5. One undo takes the whole join back: one clip is left, and no clip label is drawn. The
    // modal stays open after an add and holds focus, so close it first.
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await page.keyboard.press("Meta+z");
    await expect.poll(() => durationLabel(page), { timeout: 10_000 }).toBe("0:03.0");
    result.durationAfterUndo = await durationLabel(page);
    result.labelsAfterUndo = await clipLabels(page);
    result.blocksAfterUndo = await clipBlocks(page).count();
    await s.shot("undo");
    expect(result.labelsAfterUndo).toHaveLength(0);
    expect(result.blocksAfterUndo).toBe(1);
  } finally {
    await writeFile(path.join(s.outDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(`[verify] ${NAME}: ${JSON.stringify(result)}`);
    await s.finish();
  }
});
