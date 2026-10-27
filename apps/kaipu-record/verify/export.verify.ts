import { test, expect } from "@playwright/test";
import { openEditor } from "../e2e/helpers/launch";
import { startScenario } from "./helpers";

// Export flow: editor -> export sheet -> "Ready to share" card. Needs WebCodecs H.264
// (macOS / dev machine); headless Linux has no encoder, same as e2e/export.e2e.ts.
test("export: editor to the Ready to share card", async () => {
  test.skip(process.platform === "linux", "WebCodecs H.264 encoding unavailable on Linux");
  const s = await startScenario("export");
  try {
    await openEditor(s.page);
    await expect
      .poll(() => s.page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await s.shot("editor");
    await s.page.getByRole("button", { name: "Export" }).click();
    await s.shot("export-sheet");
    await s.page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^Export( |$)/ })
      .click();
    const ready = s.page.getByRole("region", { name: /^Ready to share/ });
    await expect(ready).toBeVisible({ timeout: 90_000 });
    await expect(ready.getByRole("button", { name: "View file" })).toBeVisible();
    // The card slides in: wait for its animations to finish, not for a guessed delay.
    await ready.evaluate((card) =>
      Promise.all(card.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
    await s.shot("ready-to-share");
  } finally {
    await s.finish();
  }
});
