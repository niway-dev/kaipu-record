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
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
