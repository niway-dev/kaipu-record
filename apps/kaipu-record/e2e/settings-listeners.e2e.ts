import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchApp, dismissOnboarding } from "./helpers/launch";

/*
 * The renderer's settings store (ADR 0063), seen from the real app.
 *
 * Every renderer window used to open one `settings:changed` listener per hook, and the main
 * window reached twelve on the Record page: past Node's limit of ten, so Node printed
 * `MaxListenersExceededWarning`. The unit tests count listeners against a fake bridge; this
 * file is the check against the built app: no warning anywhere, a change made in one window
 * reaches another that is already open, and a workspace override is what a window opens with.
 */

const WARNING = "MaxListenersExceededWarning";

/** The Record page is mounted when its mic control is. */
const RECORD_READY = '[data-ui-area="record.mic"]';

interface Watch {
  /** Every console message, page error and stderr chunk seen so far, from every process. */
  seen: string[];
  /** The ones that carry the warning. */
  warnings(): string[];
}

/**
 * Listens to the main process (its stderr and console) and to every window, present and future.
 * Attach it before the page loads: a message printed earlier is gone.
 */
function watchWarnings(app: ElectronApplication): Watch {
  const seen: string[] = [];
  app.process().stderr?.on("data", (chunk: Buffer | string) => seen.push(String(chunk)));
  app.process().stdout?.on("data", (chunk: Buffer | string) => seen.push(String(chunk)));
  app.on("console", (message) => seen.push(message.text()));
  const follow = (page: Page): void => {
    page.on("console", (message) => seen.push(message.text()));
    page.on("pageerror", (error) => seen.push(error.message));
  };
  for (const page of app.windows()) follow(page);
  app.on("window", follow);
  return { seen, warnings: () => seen.filter((line) => line.includes(WARNING)) };
}

/** The menu-bar panel: a second window of the same app, prewarmed hidden. */
async function capturePanelPage(app: ElectronApplication): Promise<Page> {
  let panel: Page | undefined;
  await expect
    .poll(() => (panel = app.windows().find((page) => page.url().includes("mode=capture"))))
    .toBeTruthy();
  await panel!.getByTestId("capture-panel").waitFor();
  return panel!;
}

test("no MaxListenersExceededWarning on Record, or after ten laps through the app", async () => {
  const { app, page, teardown } = await launchApp();
  try {
    const watch = watchWarnings(app);
    // Load the window again with the listeners attached, so its whole startup is observed.
    await page.reload();
    await dismissOnboarding(page);
    await page.waitForSelector(RECORD_READY);
    // Give the other windows (the prewarmed panel and overlays) time to start as well.
    await capturePanelPage(app);

    expect(watch.warnings()).toEqual([]);

    for (let lap = 0; lap < 10; lap += 1) {
      for (const hash of ["#/settings/general", "#/library", "#/"]) {
        await page.evaluate((next) => {
          location.hash = next;
        }, hash);
        await page.waitForFunction((next) => location.hash === next, hash);
      }
      await page.waitForSelector(RECORD_READY);
    }

    expect(watch.warnings()).toEqual([]);
  } finally {
    await teardown();
  }
});

test("a setting changed in the main window reaches the capture panel that is already open", async () => {
  const { app, page, teardown } = await launchApp({ settings: { locale: "en" } });
  try {
    await dismissOnboarding(page);
    const panel = await capturePanelPage(app);
    await expect(panel.getByText("Record with")).toBeVisible();

    // The change goes through the main window's own bridge, as the Settings page sends it.
    await page.evaluate(() => window.electronAPI.updateSettings({ locale: "es" }));

    // The panel is not reloaded and not reopened: the broadcast is all it gets.
    await expect(panel.getByText("Grabar con")).toBeVisible();
    await expect(panel.getByText("Record with")).toHaveCount(0);

    await page.evaluate(() => window.electronAPI.updateSettings({ locale: "en" }));
    await expect(panel.getByText("Record with")).toBeVisible();
  } finally {
    await teardown();
  }
});

/** The workspace the profile below registers: a plain id, so the machine file can name it. */
const WORKSPACE_ID = "e2e-workspace";

test("a workspace override is in force when the window opens", async () => {
  const { page, teardown } = await launchApp({
    // A registry that already holds one active workspace, and this Mac's override for it:
    // the save mode is machine-bound (consent stays on the Mac), so it lives in
    // `userData/workspace-settings.json`, keyed by the workspace id.
    seedUserData: async (userDataDir, vaultDir) => {
      await mkdir(userDataDir, { recursive: true });
      await writeFile(
        path.join(userDataDir, "preferences.json"),
        JSON.stringify({
          vaultDirectory: vaultDir,
          workspaces: {
            version: 1,
            activeId: WORKSPACE_ID,
            legacyCloudOwnerId: WORKSPACE_ID,
            hintDismissedAt: 1,
            kaipuColorApplied: true,
            entries: [
              {
                id: WORKSPACE_ID,
                name: "E2E workspace",
                color: "rose",
                path: vaultDir,
                addedAt: 1,
              },
            ],
          },
        }),
      );
      await writeFile(
        path.join(userDataDir, "workspace-settings.json"),
        JSON.stringify({ workspaces: { [WORKSPACE_ID]: { uploadMode: "automatic" } } }),
      );
    },
  });
  try {
    await dismissOnboarding(page);
    await page.waitForSelector(RECORD_READY);
    // The window's own read, at startup and now: the override over the All level (which is
    // "local-only"), not the file's value.
    const settings = await page.evaluate(() => window.electronAPI.getSettings());
    expect(settings.uploadMode).toBe("automatic");
  } finally {
    await teardown();
  }
});
