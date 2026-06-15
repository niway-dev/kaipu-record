// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";

// https://astro.build/config
export default defineConfig({
  integrations: [
    mermaid(),
    starlight({
      title: "Kaipu",
      lastUpdated: true,
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/withastro/starlight" }],
      sidebar: [
        {
          label: "Getting Started",
          items: [{ slug: "index" }],
        },
        {
          label: "Stack",
          items: [{ slug: "stack/hono" }, { slug: "stack/better-auth-electron-bug" }],
        },
        {
          label: "Desktop App",
          items: [
            { slug: "desktop/product-philosophy" },
            { slug: "desktop/filesystem-first-monetization" },
            { slug: "desktop/recording-pipeline" },
            { slug: "desktop/electron-vs-tauri" },
          ],
        },
        {
          label: "Features",
          autogenerate: { directory: "features" },
        },
        {
          label: "Backlog",
          items: [
            { slug: "backlog" },
            { slug: "backlog/library-page-cleanup" },
            { slug: "backlog/vitest-migration" },
            { slug: "backlog/playwright-e2e" },
          ],
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Authentication",
          items: [
            { slug: "authentication" },
            { slug: "authentication/overview" },
            { slug: "authentication/implementation" },
            { slug: "authentication/quick-reference" },
          ],
        },
        {
          label: "Backend",
          autogenerate: { directory: "backend" },
        },
        {
          label: "Frontend",
          autogenerate: { directory: "frontend" },
        },
        {
          label: "Changelog",
          items: [{ slug: "changelog" }],
        },
      ],
    }),
  ],
});
