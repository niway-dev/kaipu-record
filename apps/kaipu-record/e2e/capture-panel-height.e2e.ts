import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { CAPTURE_PANEL_MAX_HEIGHT } from "../src/shared/capture-panel";
import { launchApp } from "./helpers/launch";

/** The menu-bar panel's page. Main prewarms it hidden once the main window has painted. */
async function capturePanelPage(app: ElectronApplication): Promise<Page> {
  let panel: Page | undefined;
  await expect
    .poll(() => (panel = app.windows().find((page) => page.url().includes("mode=capture"))))
    .toBeTruthy();
  await panel!.getByTestId("capture-panel").waitFor();
  // Shown without focus, as a tray click shows it.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes("mode=capture"),
    );
    window?.showInactive();
  });
  return panel!;
}

/** The panel's laid-out height, as its ResizeObserver reports it to main. */
async function panelHeight(panel: Page): Promise<number> {
  return panel
    .getByTestId("capture-panel")
    .evaluate((element) => Math.ceil(element.getBoundingClientRect().height) + 1);
}

/**
 * The popover fits under the window's height ceiling: past it the panel scrolls and the
 * header leaves the top of the view. This is the real layout in the real panel window,
 * which unit tests (jsdom) cannot measure.
 */
test("the idle capture panel fits under the panel's height ceiling", async () => {
  const { app, teardown } = await launchApp();
  try {
    const panel = await capturePanelPage(app);
    await expect(panel.getByRole("button", { name: /^Screenshot/ })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Recording/ })).toBeVisible();
    expect(await panelHeight(panel)).toBeLessThanOrEqual(CAPTURE_PANEL_MAX_HEIGHT);
  } finally {
    await teardown();
  }
});
