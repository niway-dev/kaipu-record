import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "..", "..");
const MAIN_ENTRY = path.join(APP_ROOT, "out", "main", "index.js");
const FIXTURE = path.join(APP_ROOT, "e2e", "fixtures", "sample.mp4");

/** The seeded recording's id (its filename stem) and known duration (seconds). */
export const RECORDING_ID = "e2e-sample";
export const RECORDING_DURATION = 3;

/**
 * Seed a temp vault with the fixture recording so it lists and opens in the editor:
 * `<id>.mp4` in the root, and a `.kaipu/<id>.json` sidecar carrying a positive
 * durationSeconds (what makes a recording editable — see LibraryDetailPage) plus a title.
 */
async function seedVault(vaultDir: string): Promise<void> {
  await copyFile(FIXTURE, path.join(vaultDir, `${RECORDING_ID}.mp4`));
  await mkdir(path.join(vaultDir, ".kaipu"), { recursive: true });
  await writeFile(
    path.join(vaultDir, ".kaipu", `${RECORDING_ID}.json`),
    JSON.stringify({
      title: "E2E Sample",
      durationSeconds: RECORDING_DURATION,
      createdAt: 1_700_000_000_000,
    }),
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
 * recording's detail page (the app uses createHashRouter), then click the real "Editar
 * video" button so the flow is genuinely end-to-end.
 */
export async function openEditor(page: Page): Promise<void> {
  await dismissOnboarding(page);
  await page.evaluate((id) => {
    location.hash = `#/library/${id}`;
  }, RECORDING_ID);
  await page.getByRole("button", { name: "Editar video" }).click();
  await page.waitForSelector("video");
}
