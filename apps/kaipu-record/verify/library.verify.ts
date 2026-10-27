import { test, expect } from "@playwright/test";
import { dismissOnboarding, RECORDING_ASSET_ID } from "../e2e/helpers/launch";
import { startScenario } from "./helpers";

// Library: the seeded recording lists, and its detail page offers "Edit video".
test("library: seeded recording lists and opens its detail page", async () => {
  const s = await startScenario("library");
  try {
    await dismissOnboarding(s.page);
    await s.page.evaluate(() => (location.hash = "#/library"));
    await s.page.waitForTimeout(1000);
    await s.shot("library-list");
    await s.page.evaluate((id) => (location.hash = `#/library/${id}`), RECORDING_ASSET_ID);
    await expect(s.page.getByRole("button", { name: "Edit video" })).toBeVisible();
    await s.shot("recording-detail");
  } finally {
    await s.finish();
  }
});
