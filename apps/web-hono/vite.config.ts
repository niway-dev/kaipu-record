import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    tanstackStart(),
    cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: 9233 }),
    viteReact({
      babel: {
        plugins: [
          [
            "@stylexjs/babel-plugin",
            {
              // Always false: it must MATCH the postcss scanner (babel.config.cjs,
              // dev:false) — with dev:true the transform emits different class
              // names than the sheet carries and dev renders unstyled.
              dev: false,
              runtimeInjection: false,
              treeshakeCompensation: true,
              unstable_moduleResolution: { type: "commonJS" },
            },
          ],
        ],
      },
    }),
  ],
  server: {
    port: 3001,
  },
  // optimizeDeps: {
  //   force: true,
  // },
  // css: {
  //   devSourcemap: true,
  // },
  // build: {
  //   cssCodeSplit: false,
  // },
});
