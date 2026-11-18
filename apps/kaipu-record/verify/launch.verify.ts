import { test, expect } from "@playwright/test";
import { dismissOnboarding } from "../e2e/helpers/launch";
import { startScenario } from "./helpers";

// First run: the app opens to onboarding, then to the Record page once skipped.
test("launch: app opens to onboarding, then the main window", async () => {
  const s = await startScenario("launch");
  try {
    const dialog = s.page.getByRole("dialog", { name: "Onboarding" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await s.shot("onboarding");
    // Leaves the takeover and the one-time privacy notice that follows it (NIW2-849).
    await dismissOnboarding(s.page);
    await s.shot("main-window");
  } finally {
    await s.finish();
  }
});
