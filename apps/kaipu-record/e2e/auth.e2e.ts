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

// MAIN_VITE_SERVER_URL is inlined at build time (src/main/index.ts) as
// http://localhost:3000 — these tests talk to a REAL local server-hono dev instance
// (`bun run dev` in apps/server-hono), not a mock.
const SERVER_HEALTH_URL = "http://localhost:3000/api/v1/health";

/**
 * Task 12 (desktop-authentication plan) manual verification, kept as a permanent
 * regression spec. Self-skips (rather than failing) when the local server isn't
 * reachable, so it stays out of CI without a CI-only env var — ci-desktop.yml has no
 * server-hono step, and there is no clean way to stand up Cloudflare Workers + D1 there.
 */
async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(SERVER_HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * A bespoke launch — not the shared e2e/helpers/launch.ts — because it needs to expose
 * and reuse the same userData directory across relaunches, to test restart-persistence.
 * Called with no argument it seeds a fresh throwaway profile (a preferences.json pointing
 * at a throwaway vault, so it never touches the real ~/Videos/Kaipu Record, and a pinned
 * English locale for deterministic copy); called with a directory it reuses it as-is.
 */
async function launchWithUserData(
  userDataDir?: string,
): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
  let dir = userDataDir;
  if (!dir) {
    dir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-auth-"));
    const vaultDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-auth-vault-"));
    await writeFile(
      path.join(dir, "preferences.json"),
      JSON.stringify({ vaultDirectory: vaultDir }),
    );
    await writeFile(path.join(dir, "settings.json"), JSON.stringify({ locale: "en" }));
  }

  const args = [MAIN_ENTRY, `--user-data-dir=${dir}`];
  if (process.env.CI) args.push("--no-sandbox");

  const app = await electron.launch({ args });
  const page = await app.firstWindow();
  return { app, page, userDataDir: dir };
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

async function openSettings(page: Page): Promise<void> {
  await dismissOnboarding(page);
  await page.evaluate(() => (location.hash = "#/settings"));
}

function uniqueEmail(): string {
  return `e2e-auth-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test.describe("Desktop authentication (Task 12 manual verification)", () => {
  test.beforeAll(async () => {
    if (!(await isServerUp())) {
      test.skip(
        true,
        `server-hono is not reachable at ${SERVER_HEALTH_URL} — run "bun run dev" in apps/server-hono first`,
      );
    }
  });

  test("sign up, sign out, sign in again, and the session survives a restart", async () => {
    const email = uniqueEmail();
    const password = "correct horse battery staple 1";
    const name = "E2E Auth";

    const { app, page, userDataDir } = await launchWithUserData();
    try {
      await openSettings(page);

      // Sign up
      await page.getByRole("button", { name: "Create account" }).click();
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Name").fill(name);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

      // Sign out
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      await expect(page.getByText(email)).toHaveCount(0);

      // Sign in with the same credentials
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    } finally {
      await app.close();
    }

    // Restart, reusing the SAME userData dir: the token persisted to auth.enc must
    // restore the session on the fresh process without re-entering credentials.
    const relaunch = await launchWithUserData(userDataDir);
    try {
      await openSettings(relaunch.page);
      await expect(relaunch.page.getByText(email)).toBeVisible();
      await expect(relaunch.page.getByRole("button", { name: "Sign out" })).toBeVisible();

      // Cleanup: sign out so the test doesn't leave a signed-in account behind.
      await relaunch.page.getByRole("button", { name: "Sign out" }).click();
      await expect(relaunch.page.getByRole("button", { name: "Sign in" })).toBeVisible();
    } finally {
      await relaunch.app.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  });

  test("a corrupted token file does not crash the app and starts signed out", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-auth-corrupt-"));
    const vaultDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-auth-corrupt-vault-"));
    await writeFile(
      path.join(dir, "preferences.json"),
      JSON.stringify({ vaultDirectory: vaultDir }),
    );
    await writeFile(path.join(dir, "settings.json"), JSON.stringify({ locale: "en" }));
    // Garbage bytes where auth-store.ts's readStoredToken expects a safeStorage-encrypted
    // blob — its decryptString try/catch must swallow this as "no token", not crash launch.
    await writeFile(path.join(dir, "auth.enc"), Buffer.from([0x00, 0xff, 0x13, 0x37, 0xde, 0xad]));

    const { app, page } = await launchWithUserData(dir);
    try {
      await openSettings(page);
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
