import { test, expect } from "@playwright/test";
import { dismissOnboarding } from "../e2e/helpers/launch";
import { startScenario, type Scenario } from "./helpers";

// Developer page flag toggles (NIW2-846): Settings → Developer lists every feature flag with
// its effective value and source, and a toggle pins it live. The Developer route exists only in
// a development renderer, so build it that way from apps/kaipu-record:
//   NODE_ENV=development ./node_modules/.bin/electron-vite build --mode development
// Then run on the Mac mini (never the owner's laptop):
//   bun run proof:run -- verify/developer-flags.verify.ts --grep after
// The "before" shot comes from the commit WITHOUT the change: copy this file over that checkout,
// build it the same way, then `--grep before`. Throwaway vault; no user data is read.

async function openDeveloperPage(s: Scenario): Promise<void> {
  await dismissOnboarding(s.page);
  await s.page.evaluate(() => (location.hash = "#/settings/developer"));
  await expect(s.page.getByText("Updater simulator")).toBeVisible({ timeout: 15_000 });
}

test("before: the Developer page has only the two simulators", async () => {
  const s = await startScenario("developer-flags-before");
  try {
    await openDeveloperPage(s);
    await s.shot("developer-page");
  } finally {
    await s.finish();
  }
});

test("after: every flag has a toggle, and a toggle pins it live", async () => {
  const s = await startScenario("developer-flags-after");
  try {
    await openDeveloperPage(s);
    const toggle = s.page.getByRole("switch", { name: "image-canvas" });
    await expect(toggle).not.toBeChecked();
    await expect(s.page.getByText("local env", { exact: true })).toBeVisible();
    await s.shot("developer-page");

    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(s.page.getByText("On · pinned here")).toBeVisible();
    // The badge in the shell follows without a reload: the override reached this window live.
    await expect(s.page.getByText("local env · flags overridden")).toBeVisible();
    await s.shot("flag-pinned");

    await s.page.getByRole("button", { name: "Reset" }).click();
    await expect(toggle).not.toBeChecked();
    await expect(s.page.getByText("local env", { exact: true })).toBeVisible();
    await s.shot("flag-reset");
  } finally {
    await s.finish();
  }
});
