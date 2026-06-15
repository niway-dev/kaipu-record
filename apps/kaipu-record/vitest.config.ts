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
