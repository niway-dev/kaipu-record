import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const sharedAlias = { "@shared": resolve("src/shared") };

/**
 * One Vitest project per Electron process we test:
 *   - main:     pure logic (node environment)
 *   - renderer: helpers + components (jsdom environment)
 * The preload process is intentionally untested (it is a thin IPC bridge).
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text"],
      // Report every source file, not just the ones a test happened to import,
      // so untested modules (e.g. recorder-engine) show up as 0% instead of vanishing.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/*.d.ts",
        "src/**/index.ts", // barrels — re-exports only
        "src/preload/**", // thin IPC bridge, intentionally untested
        "src/renderer/src/main.tsx", // app entry
        "src/renderer/src/test/**", // test harness
        "src/shared/types/**", // type-only declarations
      ],
    },
    projects: [
      {
        resolve: { alias: sharedAlias },
        test: {
          name: "main",
          environment: "node",
          include: ["src/main/**/*.{test,spec}.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            "@renderer": resolve("src/renderer/src"),
            ...sharedAlias,
          },
        },
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["src/renderer/**/*.{test,spec}.{ts,tsx}"],
          setupFiles: ["src/renderer/src/test/setup.ts"],
        },
      },
    ],
  },
});
