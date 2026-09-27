import { defineConfig } from "@playwright/test";

// E2E launches the real Electron build (see e2e/helpers/launch.ts). One worker: the app
// grabs a fixed userData/vault per launch and Electron single-instance behavior makes
// parallel app launches unreliable. Artifacts captured on failure replace the manual CDP
// logging previously done by hand.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  /* One retry on CI, none locally.
   *
   * Evidence, not convenience. Twice now the suite has died with
   * `Target page, context or browser has been closed` mid-click, on a locator that had
   * already resolved and been reported visible, enabled and stable — and on a DIFFERENT
   * test each time: `export.e2e.ts` on 2026-09-25 (which passed on the next run) and
   * `settings.e2e.ts` on 2026-09-26. Ten other tests passed around each one. A defect
   * that moves between unrelated tests while the app launches cleanly is environmental.
   *
   * The root cause is still unknown — see `launchApp`, which now records how the Electron
   * process actually went away so the next occurrence carries that evidence. Until then a
   * single bad launch must not block a release: a real failure still fails every attempt,
   * and only the failing test re-runs, so the macOS minutes this costs are small.
   *
   * Remove this the moment the cause is found. A retry that becomes permanent is how a
   * real defect gets to live in the suite forever. */
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
