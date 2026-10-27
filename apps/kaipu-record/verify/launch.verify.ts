import { test, expect } from "@playwright/test";
import { startScenario } from "./helpers";

// First run: the app opens to onboarding, then to the Record page once skipped.
test("launch: app opens to onboarding, then the main window", async () => {
  const s = await startScenario("launch");
  try {
    const skip = s.page.getByRole("button", { name: "Skip setup" });
    await expect(skip).toBeVisible({ timeout: 15_000 });
    await s.shot("onboarding");
    await skip.click();
    await s.page.getByRole("dialog", { name: "Onboarding" }).waitFor({ state: "detached" });
    await s.shot("main-window");
  } finally {
    await s.finish();
  }
});
