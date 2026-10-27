import { defineConfig } from "@playwright/test";

/*
 * Proof scenarios for PR bodies (`## Proof`). Not part of CI and not the e2e suite: they
 * reuse its launch helper to drive the real built app and leave screenshots plus a video in
 * `test-results/verify/<scenario>/`. Run through `node` by path, for the reason given in
 * ../playwright.config.ts.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.verify.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  // Playwright empties its outputDir on every run; keep it apart from the artifact folders.
  outputDir: "../test-results/verify-runner",
});
