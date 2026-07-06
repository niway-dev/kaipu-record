import { test, expect } from "@playwright/test";
import { launchApp, dismissOnboarding } from "./helpers/launch";

/*
 * The deterministic slice of the Settings flow: a native-free toggle flipped in the UI
 * persists through the settings IPC round-trip (settings:update → settings.json → broadcast).
 *
 * We exercise `showBarInRecording` (the "Show control bar in recording" toggle). It is the
 * cleanest native-free choice on this page: unlike `showInDock` (which fires the macOS
 * Dock/activation-policy side effect) it has NO OS side effect at all — the update is purely
 * persisted, so the outcome is identical on every platform.
 *
 * We assert at the IPC boundary rather than reading settings.json on disk: launchApp() does
 * not expose its throwaway userData dir, and getSettings() round-trips through the main
 * process (settings:get returns the in-memory settings the update persisted + broadcast), so
 * it already proves persistence without touching the launch helper.
 */
test("toggling a setting persists through the settings IPC round-trip", async () => {
  const { page, teardown } = await launchApp();
  try {
    await dismissOnboarding(page);
    await page.evaluate(() => (location.hash = "#/settings"));

    // Read the CURRENT persisted value via the same IPC method the page uses on mount.
    const before = await page.evaluate(() => window.electronAPI.getSettings());
    const initial = before.showBarInRecording;

    // The Toggle is a Radix Switch (role="switch", aria-checked) with no accessible name, so
    // the two page switches are positional: showBarInRecording renders first (Recording
    // section), showInDock second (App section). The dev-only watermark toggle is stripped
    // from the production build under test, so exactly two switches exist.
    const toggle = page.getByRole("switch").first();

    // Guard the positional selector: the first switch must reflect the persisted value we
    // just read, proving we are about to flip the control we think we are.
    await expect(toggle).toHaveAttribute("aria-checked", String(initial));

    // Flip it in the UI. onCheckedChange → update({ showBarInRecording }) → updateSettings IPC.
    await toggle.click();

    // Required assertion: poll the same getSettings() round-trip until the persisted value
    // has flipped. Polling (not a bare read) absorbs the async invoke + main-process write.
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.electronAPI.getSettings())).showBarInRecording,
      )
      .toBe(!initial);

    // The DOM control also reflects the new state (nice-to-have; the IPC round-trip above is
    // the load-bearing assertion).
    await expect(toggle).toHaveAttribute("aria-checked", String(!initial));
  } finally {
    await teardown();
  }
});
