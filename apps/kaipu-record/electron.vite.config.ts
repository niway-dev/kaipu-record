import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // Externalize node_modules deps (electron-vite default) EXCEPT @kaipu/i18n:
    // the main process is Node, so it must not import the workspace package's raw
    // TypeScript at runtime. Bundling it in compiles the TS into out/main.
    //
    // Note the PRELOAD bundle externalizes too and has no such escape hatch, which
    // is why `@shared/types` keeps its constants as literals rather than importing
    // them from a workspace package. See the comment on SHORTCUT_DEFINITIONS.
    plugins: [externalizeDepsPlugin({ exclude: ["@kaipu/i18n"] })],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
  },
});
