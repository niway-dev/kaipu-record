import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tanstackStart(),
    cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: 9234 }),
    viteReact(),
  ],
  // Never ship source maps: they would publish original sources (sourcesContent). Nothing
  // uploads them to an error tracker. Set to "hidden" if that changes.
  build: { sourcemap: false },
  server: { host: "127.0.0.1", port: 3002 },
});
