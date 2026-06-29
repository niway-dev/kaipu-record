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
            { slug: "desktop/renderer-architecture" },
            { slug: "desktop/main-process-architecture" },
            { slug: "desktop/ipc-contract" },
            { slug: "desktop/library-vault" },
            { slug: "desktop/permissions-and-onboarding" },
            { slug: "desktop/electron-vs-tauri" },
          ],
        },
        {
          label: "Features",
          autogenerate: { directory: "features" },
        },
        {
          label: "Specs",
          autogenerate: { directory: "specs" },
        },
        {
          label: "Plans",
          autogenerate: { directory: "plans" },
        },
        {
          label: "Backlog",
          items: [
            { slug: "backlog" },
            { slug: "backlog/aspect-ratio-distortion" },
            { slug: "backlog/roadmap" },
            { slug: "backlog/version-gate" },
            { slug: "backlog/auto-update" },
            { slug: "backlog/shared-tokens-package" },
            { slug: "backlog/r2-storage-architecture" },
            { slug: "backlog/playwright-e2e" },
            { slug: "backlog/settings-roadmap" },
            { slug: "backlog/shortcuts" },
            { slug: "backlog/screenshots" },
          ],
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Deployment",
          autogenerate: { directory: "deployment" },
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
