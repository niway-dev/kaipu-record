import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/integration/**/*.integration.test.ts"],
    // Concurrency tests are the point — never serialise them across files by accident.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
