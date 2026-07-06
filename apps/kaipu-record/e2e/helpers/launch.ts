import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "..", "..");
const MAIN_ENTRY = path.join(APP_ROOT, "out", "main", "index.js");
const VIDEO_FIXTURE = path.join(APP_ROOT, "e2e", "fixtures", "sample.mp4");
const IMAGE_FIXTURE = path.join(APP_ROOT, "e2e", "fixtures", "sample.png");

/** The seeded recording's id (its filename stem) and known duration (seconds). */
export const RECORDING_ID = "e2e-sample";
export const RECORDING_DURATION = 3;

/** The seeded screenshot's id (its filename stem). A `.png` classifies as `kind: "screenshot"`. */
export const SCREENSHOT_ID = "e2e-shot";

/**
 * Seed a temp vault with both fixtures so they list and open:
 *   - `<recording>.mp4` + a `.kaipu/<id>.json` sidecar with a positive durationSeconds
 *     (what makes a recording editable — see LibraryDetailPage).
 *   - `<screenshot>.png` + a `.kaipu/<id>.json` sidecar. `.png` files classify as
 *     `kind: "screenshot"` in the vault (LibraryVault.describe), so the detail page shows the
 *     "Edit"/"Copy" screenshot actions.
 * Seeding both at launch (rather than after) avoids any list-refresh race: the library reads
 * the vault fresh on mount.
 */
async function seedVault(vaultDir: string): Promise<void> {
  await mkdir(path.join(vaultDir, ".kaipu"), { recursive: true });

  await copyFile(VIDEO_FIXTURE, path.join(vaultDir, `${RECORDING_ID}.mp4`));
  await writeFile(
    path.join(vaultDir, ".kaipu", `${RECORDING_ID}.json`),
    JSON.stringify({
      title: "E2E Sample",
      durationSeconds: RECORDING_DURATION,
      createdAt: 1_700_000_000_000,
    }),
  );

  await copyFile(IMAGE_FIXTURE, path.join(vaultDir, `${SCREENSHOT_ID}.png`));
  await writeFile(
    path.join(vaultDir, ".kaipu", `${SCREENSHOT_ID}.json`),
    JSON.stringify({ title: "E2E Shot", createdAt: 1_700_000_000_000 }),
  );
}

/**
 * Launch the built app fully isolated: a throwaway userData whose `preferences.json`
 * points at a throwaway vault seeded with the fixture. `--user-data-dir` makes Electron
 * put `app.getPath("userData")` in our temp dir, so vault-location.ts reads OUR
 * preferences and never the developer's real profile or ~/Videos/Kaipu Record.
 */
export async function launchApp(): Promise<{
  app: ElectronApplication;
  page: Page;
  vaultDir: string;
  teardown: () => Promise<void>;
}> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-user-"));
  const vaultDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-vault-"));
  await seedVault(vaultDir);
  await writeFile(
    path.join(userDataDir, "preferences.json"),
    JSON.stringify({ vaultDirectory: vaultDir }),
  );
  // Pin the UI locale so assertions are deterministic. A fresh profile otherwise
  // seeds its locale from `app.getLocale()` (settings-store.ts) — English on CI
  // runners, Spanish on a local machine — which would flip every user-facing
  // string. Seeding settings.json with `locale: "en"` (the language these tests
  // assert in) makes the suite independent of the runner's OS locale.
  await writeFile(path.join(userDataDir, "settings.json"), JSON.stringify({ locale: "en" }));

  // Electron's Chromium sandbox needs a SUID helper that headless CI runners lack, so the
  // app fails to launch there without --no-sandbox. Disable it only under CI, never locally.
  const args = [MAIN_ENTRY, `--user-data-dir=${userDataDir}`];
  if (process.env.CI) args.push("--no-sandbox");

  const app = await electron.launch({ args });
  const page = await app.firstWindow();

  return {
    app,
    page,
    vaultDir,
    teardown: async () => {
      await app.close();
      await rm(userDataDir, { recursive: true, force: true });
      await rm(vaultDir, { recursive: true, force: true });
    },
  };
}

/**
 * A fresh profile opens with the onboarding takeover — a full-window `aria-modal` dialog
 * that intercepts pointer events over the whole app, so it must be dismissed before any
 * interaction. The window can resolve before React mounts it, so wait for its "Skip setup"
 * button (rather than an immediate isVisible check that races the mount), click it, and wait
 * for the dialog to detach. If it never appears (already dismissed), proceed.
 */
export async function dismissOnboarding(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: "Skip setup" });
  try {
    await skip.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return;
  }
  await skip.click();
  await page.getByRole("dialog", { name: "Onboarding" }).waitFor({ state: "detached" });
}

/**
 * Enter the video editor for the seeded recording: dismiss onboarding, hash-navigate to the
 * recording's detail page (the app uses createHashRouter), then click the real "Edit video"
 * button so the flow is genuinely end-to-end.
 */
export async function openEditor(page: Page): Promise<void> {
  await dismissOnboarding(page);
  await page.evaluate((id) => {
    location.hash = `#/library/${id}`;
  }, RECORDING_ID);
  await page.getByRole("button", { name: "Edit video" }).click();
  await page.waitForSelector("video");
}

/**
 * Enter the screenshot editor for the seeded screenshot. The editor reads its image from
 * react-router `state` (an ImageSource); a bare hash navigation to `/screenshot-editor`
 * arrives stateless and redirects away, so the only reliable entry is the real "Edit" button
 * on the screenshot's detail page (which passes the state). Waits until the editor's Save
 * control is present (the toolbar has rendered).
 */
export async function openScreenshotEditor(page: Page): Promise<void> {
  await dismissOnboarding(page);
  await page.evaluate((id) => {
    location.hash = `#/library/${id}`;
  }, SCREENSHOT_ID);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: /^Save/ }).waitFor({ state: "visible" });
}
