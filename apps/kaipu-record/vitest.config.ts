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
      // `include` makes v8 report every matching source file, not just the ones a
      // test happened to import — so untested modules (e.g. recorder-engine) show
      // up as 0% instead of vanishing. (Vitest 4 dropped the old `all` flag.)
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
          // Pure, DOM-free logic runs in the node project: main-process code, `shared/`,
          // and the Node-only E2E helpers (e.g. the ffprobe output parser). The `.e2e.ts`
          // Playwright specs are NOT matched here — they run under Playwright, not vitest.
          include: [
            "src/main/**/*.{test,spec}.ts",
            "src/shared/**/*.{test,spec}.ts",
            "e2e/helpers/**/*.{test,spec}.ts",
          ],
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
