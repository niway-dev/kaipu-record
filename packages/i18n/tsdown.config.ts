import { defineConfig } from "tsdown";

// Build the package to `dist/` (used by `publishConfig`); `devExports: true`
// keeps the local monorepo `exports` pointed at source for HMR + clean types.
// use-intl is bundled (noExternal) so the published dist is self-contained;
// react stays external (peerDependency).
export default defineConfig({
  entry: ["src/index.ts", "src/web.ts", "src/main.ts"],
  format: "esm",
  dts: true,
  clean: true,
  noExternal: ["use-intl"],

  exports: {
    devExports: true,
    // The message catalogs aren't TS entries, so tsdown drops them from the
    // generated exports — re-add the raw-JSON subpaths (dev + publish).
    customExports(exports) {
      exports["./messages/es"] = "./messages/es.json";
      exports["./messages/en"] = "./messages/en.json";
      return exports;
    },
  },
});
