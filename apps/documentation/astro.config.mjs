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
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/withastro/starlight",
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [{ slug: "index" }, { slug: "commands" }],
        },
        {
          label: "Briefings",
          autogenerate: { directory: "briefings" },
        },
        {
          label: "Marketing",
          autogenerate: { directory: "marketing" },
        },
        {
          label: "Stack",
          items: [{ slug: "stack/hono" }, { slug: "stack/better-auth-electron-bug" }],
        },
        {
          label: "Desktop App",
          autogenerate: { directory: "desktop" },
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
          label: "Audits",
          autogenerate: { directory: "audits" },
        },
        {
          label: "Backlog",
          autogenerate: { directory: "backlog" },
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
      ],
    }),
  ],
});
