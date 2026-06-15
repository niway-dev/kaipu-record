# Development Rules

## Template Customization

This is a multi-pattern template. Before starting development, customize it:

- `bun run customize` — Interactive CLI: choose pattern, optional features, project name. Handles directory deletion, package.json cleanup, CI/CD generation, infra-env cleanup, lint config cleanup, and scope rename. Self-deletes after completion.
- `bun run rename <scope>` — Standalone scope rename (`@monorepo-template` -> `@your-scope` across 60+ files). Use if you only need to rename.

Always recommend `bun run customize` on a fresh clone. Do NOT do manual file-by-file customization.

## Development Workflow: MVP First, Then Refactor

When building new features, follow a two-phase approach:

### Phase 1: MVP (Speed)

Build the feature the simplest way possible. All logic can live inline in the frontend and backend:

- Add routes with inline business logic directly in `apps/server/src/routes/`
- Add serverFn with inline logic in `apps/web/src/functions/`
- Use `@monorepo-template/infra-db` repositories directly from route handlers
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
- `@monorepo-template/infra-auth` is NOT a dependency of the web app
- CORS on the server is only for mobile (exp://, mobile://) — web is same-origin via proxy
- After modifying wrangler.jsonc, run `wrangler types` to regenerate `worker-configuration.d.ts`

## Package Import Rules

- `domain` never imports from `application` or `infra-*`
- `application` never imports from `infra-*` (uses domain interfaces)
- `infra-*` never imports from `application`
- Mobile app (`apps/mobile/`) only imports from `@monorepo-template/domain`

## Common Commands

- `bun run db:push` — Push Drizzle schema to DB (run from monorepo root, NOT from packages/infra-db/)
- `bun run db:studio` — Open Drizzle Studio to inspect DB

## Known Issues

- `@monorepo-template/web-ui` requires `dist/` to exist — the package exports point to built files (`./dist/index.d.ts`, `./dist/index.es.js`). If you get "Cannot find module" errors, run `bun run build` in `packages/web-ui/` to regenerate it. The `dist/` directory is committed to the repo and should be rebuilt after modifying web-ui components
