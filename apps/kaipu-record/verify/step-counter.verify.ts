import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dismissOnboarding, SCREENSHOT_ASSET_ID } from "../e2e/helpers/launch";
import { startScenario, type Scenario } from "./helpers";

// Step counter (NIW2-701): three clicks with the Step tool number 1, 2, 3; deleting the middle
// badge renumbers the rest; the badges reach the copied PNG. Run with image-canvas off and on,
// since badges are canvas items in canvas mode and plain annotations without it.

const FLAG = (on: boolean): Record<string, string> => ({
  KAIPU_FLAG_OVERRIDES: JSON.stringify({ "image-canvas": on }),
});

/** The numbers the badges show, in document order. */
async function badgeNumbers(s: Scenario): Promise<string[]> {
  return s.page.locator("[data-annotation] text").allTextContents();
}

/** Let the toolbar's background transition finish, so a shot never catches two tools mid-fade. */
async function settledShot(s: Scenario, name: string): Promise<void> {
  await s.page.waitForTimeout(500);
  await s.shot(name);
}

async function copyPng(s: Scenario, name: string): Promise<{ width: number; height: number }> {
  await s.app.evaluate(({ clipboard }) => clipboard.clear());
  await s.page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(s.page.getByRole("button", { name: "Copied", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const raw = await s.app.evaluate(({ clipboard }) => {
    const image = clipboard.readImage();
    return { ...image.getSize(), png: image.toPNG().toString("base64") };
  });
  await writeFile(path.join(s.outDir, name), Buffer.from(raw.png, "base64"));
  return { width: raw.width, height: raw.height };
}

async function run(on: boolean, offset: number): Promise<void> {
  const side = on ? "flag-on" : "flag-off";
  const s = await startScenario("step-counter", {
    env: FLAG(on),
    keepOutput: offset > 0,
    shotOffset: offset,
    videoName: `video-${side}`,
  });
  try {
    await dismissOnboarding(s.page);
    await s.page.evaluate((id) => (location.hash = `#/editor/image/${id}`), SCREENSHOT_ASSET_ID);
    await expect(s.page.getByRole("button", { name: /^Save/ })).toBeEnabled({ timeout: 15_000 });
    const shot = await s.page
      .locator('[data-ui-area="editorImage.canvas"] img')
      .first()
      .boundingBox();
    if (!shot) throw new Error("the shot has no box");

    await s.page.getByRole("button", { name: "Step", exact: true }).click();
    const points = [0.25, 0.5, 0.75].map((f) => ({
      x: shot.x + shot.width * f,
      y: shot.y + shot.height * 0.4,
    }));
    for (const p of points) await s.page.mouse.click(p.x, p.y);
    await expect.poll(() => badgeNumbers(s)).toEqual(["1", "2", "3"]);
    await settledShot(s, `${side}-three-steps`);

    // Select the middle badge and delete it: the third one becomes 2.
    await s.page.getByRole("button", { name: "Select", exact: true }).click();
    await s.page.mouse.click(points[1].x, points[1].y);
    await s.page.keyboard.press("Delete");
    await expect.poll(() => badgeNumbers(s)).toEqual(["1", "2"]);
    await settledShot(s, `${side}-after-delete`);

    const size = await copyPng(s, `${side}-export.png`);
    const result = { side, numbersAfterDelete: await badgeNumbers(s), export: size };
    await writeFile(path.join(s.outDir, `${side}.json`), JSON.stringify(result, null, 2));
    console.log(`[verify] step-counter: ${JSON.stringify(result)}`);
  } finally {
    await s.finish();
  }
}

test("step-counter: 1, 2, 3 in order, renumber on delete, badges in the export", async () => {
  test.setTimeout(180_000);
  await run(false, 0);
  await run(true, 3);
});
