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
          label: "Briefings",
          autogenerate: { directory: "briefings" },
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
            { slug: "backlog/code-quality-audit" },
            { slug: "backlog/fable-audit" },
            { slug: "backlog/fable-audit-results" },
            { slug: "backlog/aspect-ratio-distortion" },
            { slug: "backlog/editor-zoom" },
            { slug: "backlog/recording-compositor-perf" },
            { slug: "backlog/roadmap" },
            { slug: "backlog/version-gate" },
            { slug: "backlog/auto-update" },
            { slug: "backlog/shared-tokens-package" },
            { slug: "backlog/r2-storage-architecture" },
            { slug: "backlog/cloud-recordings-upload" },
            { slug: "backlog/backend-security-hardening" },
            { slug: "backlog/dependency-security-upgrades" },
            { slug: "backlog/r2-upload-integrity" },
            { slug: "backlog/production-cloud-security" },
            { slug: "backlog/desktop-auth-and-r2-cors" },
            { slug: "backlog/api-abuse-controls" },
            { slug: "backlog/electron-security-hardening" },
            { slug: "backlog/cloud-data-lifecycle" },
            { slug: "backlog/playwright-e2e" },
            { slug: "backlog/i18n" },
            { slug: "backlog/settings-roadmap" },
            { slug: "backlog/shortcuts" },
            { slug: "backlog/screenshots" },
            { slug: "backlog/editor-toolbar-responsive" },
            { slug: "backlog/screenshot-save-strategy" },
            { slug: "backlog/screenshot-scene-doc" },
            { slug: "backlog/screenshot-redaction" },
            { slug: "backlog/screenshot-crop" },
            { slug: "backlog/screenshot-freehand" },
            { slug: "backlog/screenshot-auto-select" },
            { slug: "backlog/widget-capture-tabs" },
            { slug: "backlog/screen-picker-thumbnail-perf" },
            { slug: "backlog/export-formats" },
            { slug: "backlog/video-editor" },
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
          label: "Testing",
          autogenerate: { directory: "testing" },
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
