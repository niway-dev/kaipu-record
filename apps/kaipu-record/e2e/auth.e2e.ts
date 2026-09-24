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

    const { userDataDir, vaultDir } = await seedUserData();
    // One outer try/finally covering BOTH launches: an assertion failure anywhere in the
    // first launch's block must still reach the cleanup below, not just a failure after
    // the restart section starts.
    try {
      {
        const { app, page } = await launch(userDataDir);
        try {
          await openSettings(page);

          // Sign up: Settings only offers "Sign in"; the sign-in page links to sign-up.
          await page.getByRole("button", { name: "Sign in" }).click();
          await page.getByRole("link", { name: "Create account" }).click();
          await page.getByLabel("Email").fill(email);
          await page.getByLabel("Name").fill(name);
          await page.getByLabel("Password").fill(password);
          await page.getByRole("button", { name: "Create account" }).click();
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
          await page.getByRole("button", { name: "Sign in" }).click();
          await expect(page.getByText(email)).toBeVisible();
          await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
        } finally {
          await app.close();
        }
      }

      // Restart, reusing the SAME userData dir: the token persisted to auth.enc must
      // restore the session on the fresh process without re-entering credentials.
      {
        const { app, page } = await launch(userDataDir);
        try {
          await openSettings(page);
          await expect(page.getByText(email)).toBeVisible();
          await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

          // Cleanup: sign out so the test doesn't leave a signed-in account behind.
          await page.getByRole("button", { name: "Sign out" }).click();
          await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
        } finally {
          await app.close();
        }
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
