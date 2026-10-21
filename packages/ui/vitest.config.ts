import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The StyleX babel plugin runs here too, with the SAME options every other
 * transform in this repo uses (`dev: false`). That is invariant 3 from
 * `backlog/stylex-migration.md`: a transform that disagrees emits different
 * class names than the rest of the pipeline, and the test would then assert
 * about classes no build produces.
 *
 * It is not optional either — `stylex.create` is a compile-time call, so
 * without the plugin the component's module throws on import.
 */
const stylexBabel = [
  "@stylexjs/babel-plugin",
  {
    dev: false,
    runtimeInjection: false,
    treeshakeCompensation: true,
    unstable_moduleResolution: { type: "commonJS" },
  },
];

export default defineConfig({
  plugins: [react({ babel: { plugins: [stylexBabel] } })],
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
