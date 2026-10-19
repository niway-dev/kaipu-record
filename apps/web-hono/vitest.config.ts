import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const require = createRequire(import.meta.url);
const packageDir = (name: string): string => path.dirname(require.resolve(`${name}/package.json`));

// The workspace has two React patch versions (this app pins 19.2.3, the desktop 19.2.4), and
// packages with a React peer dependency can bind to either. Two copies in one test run break
// hooks ("Cannot read properties of null (reading 'useState')"), so every import of React, even
// from inside a dependency, resolves to this app's copy.
const reactAliases = ["react", "react-dom"].flatMap((name) => [
  { find: new RegExp(`^${name}$`), replacement: packageDir(name) },
  { find: new RegExp(`^${name}/(.*)$`), replacement: `${packageDir(name)}/$1` },
]);

// `use-sync-external-store` is CommonJS and would bypass the React aliases above; see the shim.
const shim = path.resolve(import.meta.dirname, "src/test/shims/use-sync-external-store.ts");
const shimAliases = [
  { find: /^use-sync-external-store\/shim(\/with-selector)?$/, replacement: shim },
];

export default defineConfig({
  // Resolves `@/` from each package's own tsconfig (this app's and @kaipu/web-ui's), so tests
  // import modules the way the app does. The cast is only because the plugin is typed against
  // vite 7.3.0 and Vitest runs 7.3.1: the same plugin, two declaration copies.
  plugins: [tsconfigPaths() as never],
  resolve: {
    alias: [...reactAliases, ...shimAliases],
    dedupe: ["react", "react-dom"],
  },
  test: {
    // Run the packages bound to the other React copy through Vite so the aliases apply to them.
    server: { deps: { inline: [/use-intl/, /@base-ui/, /@kaipu\/web-ui/] } },
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  esbuild: { jsx: "automatic" },
});
