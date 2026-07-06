import { test, expect } from "@playwright/test";
import { launchApp, dismissOnboarding } from "./helpers/launch";

/**
 * The /shortcuts page rebinds global accelerators. This test covers the
 * deterministic, headless-testable slice only: capturing a new combo on the page
 * persists it through the real updateSettings IPC to settings.json, observable via
 * the getSettings round-trip.
 *
 * It deliberately does NOT fire the actual OS-level global accelerator. Electron's
 * globalShortcut is a system hotkey; Playwright's page.keyboard dispatches DOM
 * events inside the renderer that never reach the OS hotkey layer, so that path is
 * not headless-testable (see docs/testing/shortcuts.md).
 */
test("rebinding a shortcut on /shortcuts persists the new accelerator", async () => {
  const { page, teardown } = await launchApp();
  try {
    await dismissOnboarding(page);

    // The app uses a hash router; navigate straight to the Shortcuts page.
    await page.evaluate(() => {
      location.hash = "#/shortcuts";
    });

    // First row is "Start recording", still on its default ⌃⌘C. The rebind control
    // is the ShortcutInput button (aria-label "Change shortcut"); its text is the
    // macOS-symbol label of the current accelerator.
    const control = page.getByRole("button", { name: "Change shortcut" }).first();
    await expect(control).toHaveText("⌃⌘C");

    // Click to enter capture mode: ShortcutInput toggles `listening`, suspends the
    // global shortcuts (so the combo reaches the renderer instead of firing), and
    // attaches a capture-phase keydown listener on window. The label flips to a
    // prompt while listening.
    await control.click();
    await expect(control).toHaveText("Press keys…");

    // Press a valid, non-conflicting combo. captureShortcut requires Command or
    // Control plus a letter/digit; Control+D collides with none of the defaults
    // (Command+Control+{C,S,O,X}). It reads event.code ("KeyD" → "D") + modifier
    // flags, producing the Electron accelerator "Control+D".
    await page.keyboard.press("Control+D");

    // The DOM immediately reflects the captured binding (⌃D).
    await expect(control).toHaveText("⌃D");

    // Deterministic boundary: the accelerator round-trips through the real
    // updateSettings → settings.json → getSettings path. Poll because the write is
    // async (update() → IPC → main-process file write → settingsChanged broadcast).
    await expect
      .poll(
        async () => {
          const persisted = await page.evaluate(() => window.electronAPI.getSettings());
          return persisted.shortcuts.startRecording;
        },
        { timeout: 10_000 },
      )
      .toBe("Control+D");
  } finally {
    await teardown();
  }
});
