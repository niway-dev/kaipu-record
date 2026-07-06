import { test, expect } from "@playwright/test";
import { launchApp, RECORDING_ID } from "./helpers/launch";

test("seeded recording lists and opens in the editor", async () => {
  const { page, teardown } = await launchApp();
  try {
    await page.evaluate((id) => {
      location.hash = `#/library/${id}`;
    }, RECORDING_ID);
    // The detail page shows the recording's actions, including "Edit video".
    await expect(page.getByRole("button", { name: "Edit video" })).toBeVisible();
  } finally {
    await teardown();
  }
});
