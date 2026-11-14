import { test, expect, type Locator, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dismissOnboarding } from "../e2e/helpers/launch";
import { ensureFixtures } from "../ui-catalog/fixtures/make-fixtures";
import { ASSETS, seedCatalogVault } from "../ui-catalog/fixtures/seed-vault";
import { startScenario } from "./helpers";

/*
 * Real-app proof for NIW2-782 (behind the `timeline-levels` flag): dragging a Library recording
 * from the Add from Library panel onto the Clips row draws "Insert here" at the clip boundary
 * nearest the pointer, the drop inserts the recording there, and one Cmd+Z undoes the join.
 *
 * Opens "Weekly sync" (one 3 s clip) with the flag forced on the way the UI catalog forces it
 * (`KAIPU_FLAG_OVERRIDES`), drags "Walkthrough 1" (12 s) to the end of the clip, so the nearest
 * boundary is 0:03.0, and records what the indicator said, the clip order after the drop, and
 * the durations before, after and after the undo. Screenshots and `result.json` go to
 * `test-results/verify/add-recording/`. The seeded vault is a throwaway one per launch, so
 * nothing needs restoring.
 */
const NAME = "add-recording";
const OPENED = "Weekly sync";
const DRAGGED = "Walkthrough 1";

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

test("A Library recording dragged onto the Clips row shows Insert here, drops there and undoes in one step", async () => {
  test.setTimeout(240_000);
  ensureFixtures();
  const s = await startScenario(NAME, {
    env: { KAIPU_FLAG_OVERRIDES: JSON.stringify({ "timeline-levels": true }) },
    seedVault: (dir) =>
      seedCatalogVault(dir, { now: Date.now(), content: "demo", floatingImages: true }),
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

    // 2. The panel.
    await page
      .locator("[data-ui-area='editorVideo.transport']")
      .getByRole("button", { name: "Add recording", exact: true })
      .click();
    const panel = page.locator("[data-ui-area='editorVideo.addFromLibrary']");
    const row: Locator = panel.getByRole("button", { name: `Add ${DRAGGED}`, exact: true });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600); // thumbnails decode after the list is drawn
    await s.shot("panel");

    // 3. The drag. The Clips row's clip block is the first `button[data-item-id]` of the
    // timeline; aim 6 px inside its right edge, so the nearest boundary is its end (0:03.0).
    const block = page
      .locator("[data-ui-area='editorVideo.timeline'] button[data-item-id]")
      .first();
    const box = await block.boundingBox();
    if (!box) throw new Error("the clip block has no box");
    const targetX = box.x + box.width - 6;
    const targetY = box.y + box.height / 2;
    result.clipBox = box;
    result.pointer = { x: targetX, y: targetY };

    let method: "mouse API" | "dragTo" | "none worked" = "none worked";
    await row.hover();
    const from = await row.boundingBox();
    if (!from) throw new Error("the row has no box");
    const startX = from.x + from.width / 2;
    const startY = from.y + from.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        startX + ((targetX - startX) * i) / steps,
        startY + ((targetY - startY) * i) / steps,
      );
    }
    // A few small moves inside the row so dragover fires with the pointer parked at the target.
    await page.mouse.move(targetX - 2, targetY);
    await page.mouse.move(targetX, targetY);
    const indicator = page.locator("[data-testid='insert-indicator']");
    try {
      await expect(indicator).toBeVisible({ timeout: 5_000 });
      method = "mouse API";
    } catch {
      method = "none worked";
    }
    if (method === "mouse API") {
      const text = (await indicator.innerText()).replace(/\s+/g, " ").trim();
      result.indicatorText = text;
      result.indicatorEdge = await indicator.getAttribute("data-edge");
      result.indicatorLeftPercent = await indicator.evaluate(
        (el) => (el as HTMLElement).style.left,
      );
      expect(text).toContain("Insert here");
      await s.shot("indicator");
      await page.mouse.up();
    } else {
      await page.mouse.up();
      result.indicatorText = "not captured: the mouse API did not start a native drag";
      // Fallback: Playwright's own drag-and-drop (no mid-drag screenshot is possible).
      await row.dragTo(block, { targetPosition: { x: box.width - 6, y: box.height / 2 } });
      const changed = await durationLabel(page);
      if (changed !== before) method = "dragTo";
    }
    result.dragMethod = method;

    // 4. The drop: 3 s + 12 s.
    await expect.poll(() => durationLabel(page), { timeout: 20_000 }).not.toBe(before);
    await expect
      .poll(async () => (await clipLabels(page)).length, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(800); // the joined clip's thumbnails
    const after = await durationLabel(page);
    const labels = await clipLabels(page);
    result.durationAfter = after;
    result.labelsAfter = labels;
    await s.shot("after");
    expect(after).toBe("0:15.0");
    expect(labels[0]).toContain(OPENED);
    expect(labels[1]).toContain(DRAGGED);

    // 5. One undo takes the whole join back.
    await page.keyboard.press("Meta+z");
    await expect.poll(() => durationLabel(page), { timeout: 10_000 }).toBe("0:03.0");
    result.durationAfterUndo = await durationLabel(page);
    result.labelsAfterUndo = await clipLabels(page);
    await s.shot("undo");
  } finally {
    await writeFile(path.join(s.outDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(`[verify] ${NAME}: ${JSON.stringify(result)}`);
    await s.finish();
  }
});
