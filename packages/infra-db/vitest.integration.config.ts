import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/integration/**/*.integration.test.ts"],
    // Integration files share one real database; run them one at a time so suites never interfere.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
