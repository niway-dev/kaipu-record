import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import stylexPostcss from "@stylexjs/postcss-plugin";

/**
 * StyleX experiment (shared @kaipu/ui components): the babel plugin compiles
 * stylex.create calls in the renderer, and the postcss plugin scans the same
 * sources to write the atomic CSS where a stylesheet says `@stylex;`
 * (dev/stylex-probe.css). babel.config.cjs exists only for the postcss
 * plugin's scanner; the renderer's real transform gets its plugins inline.
 */
const stylexBabel = [
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
];

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
    plugins: [react({ babel: { plugins: [stylexBabel] } })],
    css: {
      postcss: {
        plugins: [
          stylexPostcss({
            include: ["../../packages/ui/src/**/*.{ts,tsx}", "src/renderer/src/dev/**/*.{ts,tsx}"],
          }),
        ],
      },
    },
  },
});
