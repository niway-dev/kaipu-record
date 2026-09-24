# Development Rules

## Template Customization

This is a multi-pattern template. Before starting development, customize it:

- `bun run customize` — Interactive CLI: choose pattern, optional features, project name. Handles directory deletion, package.json cleanup, CI/CD generation, infra-env cleanup, lint config cleanup, and scope rename. Self-deletes after completion.
- `bun run rename <scope>` — Standalone scope rename (`@kaipu` -> `@your-scope` across 60+ files). Use if you only need to rename.

Always recommend `bun run customize` on a fresh clone. Do NOT do manual file-by-file customization.

## Development Workflow: MVP First, Then Refactor

When building new features, follow a two-phase approach:

### Phase 1: MVP (Speed)

Build the feature the simplest way possible. All logic can live inline in the frontend and backend:

- Add routes with inline business logic directly in `apps/server/src/routes/`
- Add serverFn with inline logic in `apps/web/src/functions/`
- Use `@kaipu/infra-db` repositories directly from route handlers
- Focus on making it work end-to-end (UI -> API -> DB)
- No need for use cases, domain interfaces, or mappers at this stage

### Phase 2: Refactor to Architecture Standards

Once the feature works, refactor to follow the layer architecture:

1. **Domain** (`packages/domain/`) -- Extract interfaces, schemas, types, constants
2. **Application** (`packages/application/`) -- Extract use cases that depend only on domain interfaces
3. **Infrastructure** (`packages/infra-db/`, `packages/infra-auth/`) -- Repository implementations, mappers
4. **Consumers** (`apps/*`) -- Thin handlers that wire application use cases with infra implementations

The dependency rule is strict: domain <- application <- infra, and only apps wire them together.

### When to Refactor

- When a second consumer needs the same logic (e.g., both web serverFn and API route)
- When business logic exceeds ~15 lines in a route handler
- When the feature is stable and tested

## Documentation

All design, planning, and feature documentation lives in the **docs site** at
`apps/documentation/` (Astro Starlight, `src/content/docs/`). That site is the single
source of truth for docs — not scattered `docs/` folders or app-local notes.

Rules:

- **Every new feature gets a doc.** Before/while building, add one under
  `apps/documentation/src/content/docs/`:
  - `backlog/` — proposed or in-flight work, and shipped-but-unvalidated features.
    Start it with a status banner and add a row to `backlog/index.mdx`.
  - `specs/` and `plans/` — design specs and implementation plans (including those the
    superpowers brainstorming / writing-plans skills produce). **Do not leave them in
    `docs/superpowers/` — migrate them here** (add Starlight frontmatter `title` +
    `description`, keep the body).
  - `desktop/`, `features/`, `architecture/`, … — stable reference docs once a feature
    has shipped and been validated.
- **Status legend** (use in backlog docs + `backlog/index.mdx`):
  🔵 Proposed · 🟡 In progress · 🟢 Ready to validate (prod review pending) · ✅ Done.
  When a backlog feature ships, flip it to 🟢; after prod validation, fold the lasting
  knowledge into a `desktop/`/`features/` reference doc and drop the backlog row.
- **Sidebar:** `apps/documentation/astro.config.mjs`. `specs/`, `plans/`, `features/`,
  `architecture/`, `backend/`, `frontend/` autogenerate from their directory; `backlog/`
  and `desktop/` pages are listed manually — add new pages there.
- **Language:** doc bodies are English (repo content rule). Legacy Spanish docs are tech
  debt to translate; don't add new Spanish docs.

## Architecture

This project uses DDD + Hexagonal Architecture with layer-first package structure:

```
packages/domain/        Pure. Mobile-safe. Constants, schemas, types, interfaces.
packages/application/   Use cases. Server-only. Depends on domain interfaces.
packages/infra-db/      Infrastructure. Server-only. Drizzle repos, mappers, schemas.
packages/infra-auth/    Infrastructure. Server-only. Better Auth configuration.
```

Infrastructure packages use the `infra-*` naming convention to make architectural intent explicit.

## Skill Configuration

Skills in `.claude/skills/` may have a **Configuration** table with paths (e.g., `DOCS_BASE`). If you detect a mismatch between a skill's configured path and the actual project path, update the skill's Configuration table directly so future sessions use the correct path without re-discovering it.

## Client-Server Architecture (Web + Elysia API)

The web app (TanStack Start) proxies all API requests through itself to the Elysia backend. This solves cookie-based auth on Cloudflare Workers where cross-origin cookies don't work.

**How it works:**

- Browser talks only to the web Worker domain (same-origin)
- Web Worker proxies `/api/auth/*` and `/api/v1/*` to the Elysia API Worker
- In production: Cloudflare Service Bindings (direct Worker-to-Worker, no public DNS)
- In local dev: regular `fetch()` fallback (Service Bindings not available)
- Set-Cookie headers are rewritten to strip `domain=` so cookies are assigned to the web domain

**Key files:**

- `apps/web/src/lib/api-fetch.ts` — Service Binding fetch wrapper with local dev fallback
- `apps/web/src/routes/api/auth/$.ts` — Auth proxy (forwards x-forwarded-host/proto)
- `apps/web/src/routes/api/v1/$.ts` — API proxy
- `apps/web/wrangler.jsonc` — Service Binding declared in `services` array
- `apps/web/src/lib/client-treaty.ts` — Eden Treaty uses `window.location.origin` (not server URL)

**Important:**

- Web app does NOT run Better Auth locally — it proxies to the backend's auth
- `@kaipu/infra-auth` is NOT a dependency of the web app
- CORS on the server is only for mobile (exp://, mobile://) — web is same-origin via proxy
- After modifying wrangler.jsonc, run `wrangler types` to regenerate `worker-configuration.d.ts`

## Package Import Rules

- `domain` never imports from `application` or `infra-*`
- `application` never imports from `infra-*` (uses domain interfaces)
- `infra-*` never imports from `application`
- Mobile app (`apps/mobile/`) only imports from `@kaipu/domain`

## Secrets: Infisical

All environment values come from Infisical. There are no hand-maintained `.env`
files — where one exists it is **generated** and gitignored, never edited.

First-time setup (once per machine):

```bash
bun run setup      # reports which global tools you are missing, and how to get them
infisical login
```

`scripts/setup-dev.sh` **checks, it never installs** — it reports what is missing
and the command to install it, so nothing lands on your machine that you did not
run yourself. See the
[tool-doctor pattern](https://github.com/csdev19/general-knowledge/blob/main/conventions/tool-doctor-pattern.md).

If Homebrew refuses with "Xcode is too outdated", this points it at the Command
Line Tools and fixes it for every formula:

```bash
sudo xcode-select --switch /Library/Developer/CommandLineTools
```

Do not install the CLI with `bun add` — bun blocks the `preinstall` that
extracts the binary, so you get the package without a working command.

Then every command works as before — the scripts pull secrets themselves:

- `bun run dev` — each app fetches its own env at start-up
- `bun run db:push` and the other `db:*` scripts wrap `infisical run`

Changing a value means changing it in Infisical and restarting. Never add it to
a local file.

Layout: environment slug `dev` (the UI shows it as "Development"). Secrets live
in four folders — `/cloudflare`, `/database`, `/server-hono`, `/kaipu-record` —
plus non-secret config at the root. Scripts use `--recursive` (or the four
explicit `--path` flags where `export` is needed, since `export` has no
`--recursive`).

Workers are the exception: `wrangler` needs values as bindings rather than
process env, so `env:pull` writes a generated `.env` that wrangler reads.

Scripts go through `scripts/with-env.sh` rather than calling `infisical run`
directly. It fetches from Infisical locally, and **passes straight through when
`CI` is set** — CI builds with placeholder values on purpose and must not need a
secrets CLI. Locally a missing CLI fails loudly instead of building with
undefined values, which would produce a subtly broken artifact rather than an
error.

## Native dependencies: no install scripts

There is **no `postinstall`** in this repo, and none should be added. `bun install`
is not allowed to compile code, download binaries, or run anything you have not
read — the same rule as `scripts/setup-dev.sh`, which checks and never installs.
The reusable form of this, including why it breaks unrelated CI jobs, is the
[native dependencies pattern](https://github.com/csdev19/general-knowledge/blob/main/desktop/native-dependencies.md).

The desktop app has one native dependency, `uiohook-napi` (the global mouse hook
behind auto-zoom on clicks). It ships prebuilds for Node, not for Electron, and
`electron-builder.yml` sets `npmRebuild: false`, so it has to be rebuilt
explicitly:

```bash
bun run rebuild:native   # rebuilds against the installed Electron's ABI
```

`bun run setup` reports when that rebuild is pending and prints this command —
it compares a stamp in `node_modules` against the installed Electron version, so
a fresh install or an Electron bump both show up. Every packaging path
(`build:mac`, `build:unpack`, `build:win`, `build:linux`, `release-desktop.yml`)
calls it explicitly, because a release must not depend on someone remembering.

If you skip it the app still runs: `click-hook.ts` degrades to "no clicks"
rather than crashing. That silence is why the check exists.

## Common Commands

- `bun run db:push` — Push Drizzle schema to DB (run from monorepo root, NOT from packages/infra-db/)
- `bun run db:studio` — Open Drizzle Studio to inspect DB
- `bun run rebuild:native` — Rebuild the desktop app's native deps for Electron (see above)

## Known Issues

- `@kaipu/web-ui` requires `dist/` to exist — the package exports point to built files (`./dist/index.d.ts`, `./dist/index.es.js`). If you get "Cannot find module" errors, run `bun run build` in `packages/web-ui/` to regenerate it. The `dist/` directory is committed to the repo and should be rebuilt after modifying web-ui components
