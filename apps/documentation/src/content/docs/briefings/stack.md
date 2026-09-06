---
title: Stack
description: Every layer of Kaipu Record's stack, its role here, and why it was picked.
---

# Stack

One table per layer. Each row names a **direct, load-bearing** dependency — a
technology the architecture actually depends on, not everything in `node_modules`.
Transitive deps, `@types/*` packages, and routine dev tooling are grouped, not
listed one row at a time.

## Monorepo & tooling

| Technology         | Role here                                                     | Why                                                                                                  |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Bun (`^1.3.4`)     | Package manager + JS runtime for scripts (`db:push`, tests)   | Fast install/run, native workspace support, one runtime instead of node + a separate package manager |
| Turborepo          | Task orchestration + caching across `apps/*` and `packages/*` | Per-project `ci-*.yml` pipelines (see Deployment) run only what changed, cached between runs         |
| TypeScript (`5.9`) | Language, everywhere                                          | End-to-end type safety from Zod schema → oRPC contract → React client → desktop IPC                  |
| oxlint / oxfmt     | Lint + format                                                 | Rust-based, materially faster than ESLint/Prettier at this repo's size; wired into `lefthook`        |
| Zod (`4.x`)        | Schema definition + validation, shared by every layer         | Domain schemas double as runtime validation and static types (`z.infer`) — one definition, not two   |

## Backend (`apps/server-hono`)

| Technology                               | Role here                         | Why                                                                                                                                                      |
| ---------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hono                                     | HTTP framework                    | Runs natively on Cloudflare Workers; minimal overhead for an API that's mostly oRPC routing                                                              |
| oRPC (`contract`/`server`/`openapi`)     | Contract-first API layer          | One `*.contract.ts` definition (routes + Zod schemas) is imported directly by the web client — no codegen step, no drift between server and client types |
| Better Auth                              | Authentication                    | TypeScript-native, framework-agnostic; issues the httpOnly session cookie the same-origin proxy (below) depends on                                       |
| Drizzle ORM + `@neondatabase/serverless` | Database access, on Neon Postgres | Lightweight, SQL-shaped, edge/serverless-compatible driver — fits a Workers runtime that can't hold a long-lived TCP pool                                |
| `@kaipu/infra-storage` (`aws4fetch`)     | Presigned R2 uploads/downloads    | `aws4fetch` is a ~1.5 kB SigV4 signer with no Node-only dependencies, so it runs inside a Cloudflare Worker where the full AWS SDK doesn't               |

## Web (`apps/web-hono`)

| Technology                    | Role here                                             | Why                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Start + React Router | SSR web app (landing + authenticated app shell)       | Deploys as a Cloudflare Worker; its server functions are what proxy `/api/*` to the API Worker (see below)                                          |
| TanStack Query                | Server-state caching for the oRPC client              | Pairs directly with `@orpc/tanstack-query` — typed queries/mutations with no separate fetching layer                                                |
| Tailwind CSS v4 + shadcn/ui   | Styling + component primitives                        | Utility-first styling on top of `@kaipu/tokens` CSS variables; shadcn gives ownable, un-abstracted component source instead of an opaque UI library |
| `@base-ui/react`              | Low-level unstyled primitives (used alongside shadcn) | Accessible interaction behavior without imposing visual style                                                                                       |

**Same-origin proxy architecture**: the web Worker forwards `/api/auth/*` and
`/api/v1/*` to the API Worker — via a Cloudflare **Service Binding** in production
(direct Worker-to-Worker, no public DNS) and a plain `fetch()` fallback locally —
rewriting `Set-Cookie` to drop `domain=`. This exists specifically because
cross-origin cookies don't work on Cloudflare Workers, and Better Auth's session
cookie has to reach the browser same-origin.

## Desktop (`apps/kaipu-record`)

| Technology                              | Role here                                                                                      | Why                                                                                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron + electron-vite                | Native macOS app shell                                                                         | Renderer runs in Chromium, which gives native WebCodecs support (below) — a hard requirement, not incidental                                                                                                                           |
| mediabunny                              | Capture + mux to MP4 via WebCodecs                                                             | Replaces `MediaRecorder` + FFmpeg for the live pipeline — see [ADR 0001](../architecture/decisions/0001-mediabunny-over-ffmpeg): real seekable MP4 from the first byte, hardware encode, ~70 kB vs 50–80 MB of bundled FFmpeg binaries |
| electron-builder + electron-updater     | Packaging, code signing/notarization, auto-update                                              | Signs + notarizes with a Developer ID for direct-download distribution outside the Mac App Store; updater reads a feed hosted on the same R2 bucket as the installers                                                                  |
| Playwright (`@playwright/test`)         | End-to-end tests against the packaged Electron app                                             | Drives the real app, not a browser mock — catches the main/renderer/IPC integration bugs unit tests can't                                                                                                                              |
| PostHog (`posthog-js` + `posthog-node`) | Feature flags + analytics/error capture                                                        | One flag store for both processes (renderer via `useFlag`, main via `posthog-node`), offline-safe (missing key → flag defaults, no crash)                                                                                              |
| Vitest                                  | Unit tests (pure logic: recording-quality math, watermark resolution, storage-key rules, etc.) | Fast, same config shape as the rest of the monorepo                                                                                                                                                                                    |

## Shared design & i18n

| Technology                                         | Role here                                    | Why                                                                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kaipu/tokens` (hand-written TS, no external lib) | Design tokens → CSS variables (dark + light) | One source (`base.ts`, `themes/{dark,light}.ts`) generates the CSS consumed by both the desktop renderer and the web app; contrast-tested in CI (`contrast.test.ts`) |
| `@kaipu/i18n` (`use-intl`)                         | Shared en/es translation layer               | One message catalog (`messages/{en,es}.json`) used by both the web landing page and the desktop renderer, instead of duplicating copy per app                        |

## Documentation & release

| Technology                                   | Role here                                                                        | Why                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Astro Starlight                              | This documentation site (`apps/documentation`)                                   | Content-as-Markdown/MDX with a working sidebar/search out of the box; no app code to maintain for docs       |
| release-please                               | Per-app versioned releases (`desktop-vX`, `web-vX`, `api-vX`) via GitHub Actions | Each app in the monorepo ships and versions independently — a desktop bump doesn't force an API version bump |
| GitHub Actions (`ci-*.yml`, `release-*.yml`) | Per-project CI + release pipelines                                               | Scoped so a desktop-only change doesn't run the web/API test suite and vice versa                            |

## Not yet decided

Cloud object storage is Cloudflare R2 (S3-compatible, presigned URLs, no egress
fees for a Worker-adjacent bucket) — chosen and implemented, but the **access
architecture** (private bucket + Worker gateway vs. a bucket split) is a recorded,
accepted decision not yet built; see the
[R2 storage architecture](../backlog/r2-storage-architecture) backlog doc.
