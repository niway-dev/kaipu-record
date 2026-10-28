import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { CAPTURE_PANEL_MAX_HEIGHT } from "../src/shared/capture-panel";
import { launchApp } from "./helpers/launch";

/** More inputs than most machines have, so the device list hits its scroll cap. */
const FAKE_MICROPHONES = 8;

/** The menu-bar panel's page. Main prewarms it hidden once the main window has painted. */
async function capturePanelPage(app: ElectronApplication): Promise<Page> {
  let panel: Page | undefined;
  await expect
    .poll(() => (panel = app.windows().find((page) => page.url().includes("mode=capture"))))
    .toBeTruthy();
  await panel!.getByTestId("capture-panel").waitFor();
  // Shown without focus, as a tray click shows it: a blur would close the open drawer.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes("mode=capture"),
    );
    window?.showInactive();
  });
  return panel!;
}

/**
 * Replace the runner's audio inputs with a long, named list, and never open a real device
 * (the drawer's level meter asks for the selected one).
 */
async function fakeMicrophones(panel: Page, count: number): Promise<void> {
  await panel.evaluate((count) => {
    const devices = Array.from({ length: count }, (_, index) => ({
      deviceId: `e2e-mic-${index + 1}`,
      groupId: `e2e-group-${index + 1}`,
      kind: "audioinput",
      label: `E2E Microphone With A Long Product Name ${index + 1}`,
      toJSON: () => ({}),
    }));
    const media = navigator.mediaDevices;
    Object.defineProperty(media, "enumerateDevices", {
      value: async () => devices,
    });
    Object.defineProperty(media, "getUserMedia", {
      value: async () => {
        throw new DOMException("No real device in this test", "NotFoundError");
      },
    });
    media.dispatchEvent(new Event("devicechange"));
  }, count);
  await expect(panel.getByRole("radio", { name: /E2E Microphone/ })).toHaveCount(count);
}

/** The panel's laid-out height, as its ResizeObserver reports it to main. */
async function panelHeight(panel: Page): Promise<number> {
  return panel
    .getByTestId("capture-panel")
    .evaluate((element) => Math.ceil(element.getBoundingClientRect().height) + 1);
}

/**
 * Every drawer of the capture panel, open at its tallest, fits under the window's height
 * ceiling: past it the panel scrolls and the Record button leaves the top of the view. This
 * is the real layout in the real panel window, which unit tests (jsdom) cannot measure.
 */
test("every capture-panel drawer fits under the panel's height ceiling", async () => {
  const { app, teardown } = await launchApp();
  try {
    const panel = await capturePanelPage(app);

    // Before the drawer opens, so the list is already long when it does.
    await panel.getByRole("button", { name: "Microphone settings" }).click();
    await fakeMicrophones(panel, FAKE_MICROPHONES);
    await expect(panel.getByRole("region", { name: "Microphone settings" })).toBeVisible();
    expect(await panelHeight(panel)).toBeLessThanOrEqual(CAPTURE_PANEL_MAX_HEIGHT);

    await panel.getByRole("button", { name: "System audio settings" }).click();
    await expect(panel.getByRole("region", { name: "System audio settings" })).toBeVisible();
    expect(await panelHeight(panel)).toBeLessThanOrEqual(CAPTURE_PANEL_MAX_HEIGHT);

    await panel.getByRole("button", { name: "Camera settings" }).click();
    const camera = panel.getByRole("region", { name: "Camera settings" });
    await expect(camera).toBeVisible();
    // Framing on adds the zoom slider and the position pad: the camera drawer's tallest
    // state. A runner that denies camera access shows the (shorter) blocked card instead.
    const framing = camera.getByRole("switch", { name: "Framing" });
    if ((await framing.count()) > 0) {
      await framing.click();
      await expect(camera.getByLabel("Image position")).toBeVisible();
    }
    expect(await panelHeight(panel)).toBeLessThanOrEqual(CAPTURE_PANEL_MAX_HEIGHT);
  } finally {
    await teardown();
  }
});
