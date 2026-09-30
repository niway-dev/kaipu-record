import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // Externalize node_modules deps (electron-vite default) EXCEPT the workspace
    // packages we import as SOURCE: the main process is Node, so it must not
    // import raw TypeScript at runtime. Bundling them compiles the TS into
    // out/main.
    //
    // Every `"."`-style source export a main-process file reaches has to be
    // listed here. @shared/types imports the shortcut defaults from
    // @kaipu/domain/constants, and leaving it external made Electron fail to
    // boot with ERR_MODULE_NOT_FOUND on domain's own extensionless imports —
    // which Vite resolves and Node's ESM loader does not.
    plugins: [externalizeDepsPlugin({ exclude: ["@kaipu/i18n", "@kaipu/domain"] })],
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
