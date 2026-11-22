import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { dismissOnboarding, launchApp } from "../e2e/helpers/launch";
import { startScenario, type Scenario } from "./helpers";

// Admin mode (NIW2-900): an admin account with the preference on launches in Admin mode, shows
// "👑 Admin" in the title bar and an "Admin mode" row in Settings → App; turning it off asks for
// a restart. Build from apps/kaipu-record, then run on the Mac mini (never the owner's laptop):
//   ./node_modules/.bin/electron-vite build
//   bun run proof:run -- verify/admin-mode.verify.ts
// The "before" shot comes from the commit WITHOUT the change: copy this file and the helpers
// change over that checkout, build it the same way, then `--grep before`.
//
// No API runs here. The admin session is real, though: a first launch encrypts it with this
// machine's safeStorage key, the second launch reads that auth.enc at start-up, the way an
// offline admin's app does. Its session check fails (no server), so the stored permission stays.

const SESSION = {
  token: "verify-token",
  userId: "verify-admin",
  email: "admin@example.com",
  name: "Verify Admin",
  admin: true,
};

/** Encrypt the session with the app's own safeStorage, in a throwaway launch. */
async function encryptedSession(): Promise<Buffer> {
  const { app, teardown } = await launchApp();
  try {
    const base64 = await app.evaluate(
      ({ safeStorage }, json) => safeStorage.encryptString(json).toString("base64"),
      JSON.stringify(SESSION),
    );
    return Buffer.from(base64, "base64");
  } finally {
    await teardown();
  }
}

async function openSettingsApp(s: Scenario): Promise<void> {
  await dismissOnboarding(s.page);
  await s.page.evaluate(() => (location.hash = "#/settings/app"));
  await expect(s.page.getByText("Kaipu Record").first()).toBeVisible({ timeout: 15_000 });
}

/** Let the switch and rail transitions finish, so a shot never catches them halfway. */
const settle = (s: Scenario) => s.page.waitForTimeout(500);

test("before: no badge and no Admin mode row", async () => {
  const s = await startScenario("admin-mode-before");
  try {
    await openSettingsApp(s);
    await settle(s);
    await s.shot("settings-app");
  } finally {
    await s.finish();
  }
});

test("user: a signed-out app with the preference on stays in User mode", async () => {
  const s = await startScenario("admin-mode-user", { settings: { adminMode: true } });
  try {
    await openSettingsApp(s);
    await expect(s.page.getByText("👑 Admin")).toHaveCount(0);
    await expect(s.page.getByRole("switch", { name: "Admin mode" })).toHaveCount(0);
    await settle(s);
    await s.shot("settings-app");
  } finally {
    await s.finish();
  }
});

test("after: an admin launches in Admin mode, and turning it off asks for a restart", async () => {
  const blob = await encryptedSession();
  const s = await startScenario("admin-mode-after", {
    settings: { adminMode: true },
    seedUserData: (userDataDir) => writeFile(path.join(userDataDir, "auth.enc"), blob),
  });
  try {
    await openSettingsApp(s);
    await expect(s.page.getByText("👑 Admin")).toBeVisible();
    const toggle = s.page.getByRole("switch", { name: "Admin mode" });
    await expect(toggle).toBeChecked();
    await expect(s.page.getByText("Restart to apply")).toHaveCount(0);
    await settle(s);
    await s.shot("settings-app-admin");

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(s.page.getByText("Restart to apply")).toBeVisible();
    await expect(s.page.getByRole("button", { name: "Restart now" })).toBeVisible();
    // The badge stays: this process still runs in Admin mode until it restarts.
    await expect(s.page.getByText("👑 Admin")).toBeVisible();
    await settle(s);
    await s.shot("restart-pending");
  } finally {
    await s.finish();
  }
});
