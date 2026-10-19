import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "..");
const MAIN_ENTRY = path.join(APP_ROOT, "out", "main", "index.js");

/** A throwaway profile: preferences.json pointing at a throwaway vault (so the app never
 * touches the real ~/Videos/Kaipu Record) and a pinned English locale for deterministic
 * copy. Returns both directories so the caller can remove them once done — a relaunch
 * against the SAME userDataDir only needs that dir; vaultDir is only created fresh. */
async function seedUserData(): Promise<{ userDataDir: string; vaultDir: string }> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-auth-"));
  const vaultDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-auth-vault-"));
  await writeFile(
    path.join(userDataDir, "preferences.json"),
    JSON.stringify({ vaultDirectory: vaultDir }),
  );
  await writeFile(path.join(userDataDir, "settings.json"), JSON.stringify({ locale: "en" }));
  return { userDataDir, vaultDir };
}

/**
 * A bespoke launch — not the shared e2e/helpers/launch.ts — because it needs to launch
 * against an already-seeded userData directory, to test restart-persistence (the shared
 * helper always seeds a fresh one internally and never exposes the path).
 */
async function launch(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const args = [MAIN_ENTRY, `--user-data-dir=${userDataDir}`];
  if (process.env.CI) args.push("--no-sandbox");

  const app = await electron.launch({ args });
  const page = await app.firstWindow();
  return { app, page };
}

/** Mirrors e2e/helpers/launch.ts's dismissOnboarding — duplicated locally to keep this
 * file self-contained around its own bespoke launch. */
async function dismissOnboarding(page: Page): Promise<void> {
  const skip = page.getByRole("button", { name: "Skip setup" });
  try {
    await skip.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return;
  }
  await skip.click();
  await page.getByRole("dialog", { name: "Onboarding" }).waitFor({ state: "detached" });
}

// The account moved from Settings to its own Cloud page.
async function openSettings(page: Page): Promise<void> {
  await dismissOnboarding(page);
  await page.evaluate(() => (location.hash = "#/cloud"));
}

test.describe("Desktop authentication", () => {
  // The browser round trip itself (system browser -> kaipu.app -> deep link) cannot be driven
  // from Playwright; the main-process and renderer units cover the states, and the manual steps
  // are in the PR that introduced it (NIW2-471). What E2E can pin is what the user sees.
  test("the sign-in page hands off to the browser and has no password field", async () => {
    const { userDataDir, vaultDir } = await seedUserData();
    try {
      const { app, page } = await launch(userDataDir);
      try {
        await openSettings(page);
        await page.getByRole("button", { name: "Sign in" }).click();

        await expect(page.getByRole("button", { name: "Sign in with your browser" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
        await expect(page.getByLabel("Password")).toHaveCount(0);
        await expect(page.getByLabel("Email")).toHaveCount(0);
      } finally {
        await app.close();
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
      await rm(vaultDir, { recursive: true, force: true });
    }
  });

  test("a corrupted token file does not crash the app and starts signed out", async () => {
    const { userDataDir, vaultDir } = await seedUserData();
    // Garbage bytes where auth-store.ts's readStoredToken expects a safeStorage-encrypted
    // blob — its decryptString try/catch must swallow this as "no token", not crash launch.
    await writeFile(
      path.join(userDataDir, "auth.enc"),
      Buffer.from([0x00, 0xff, 0x13, 0x37, 0xde, 0xad]),
    );

    try {
      const { app, page } = await launch(userDataDir);
      try {
        await openSettings(page);
        await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
        // Same signed-out marker the account-panel unit test uses: the exact sentence has
        // changed before, and this suite only runs when a local server answers.
        await expect(page.getByText(/without an account/i).first()).toBeVisible();
      } finally {
        await app.close();
      }
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
      await rm(vaultDir, { recursive: true, force: true });
    }
  });
});
