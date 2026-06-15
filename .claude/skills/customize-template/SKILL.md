---
name: customize-template
description: Provides complete context for customizing this monorepo template. Knows which apps, packages, scripts, CI/CD steps, and dependencies to remove based on the user's chosen architecture pattern. Use when the user wants to strip down the template to only what they need.
---

# Customize Monorepo Template

## Quick Start: Automated Scripts

The template ships with two scripts that handle customization automatically:

### `bun run customize` — Full interactive customization

Handles everything in one command:

- Prompts for architecture pattern, mobile, docs, Convex, project name
- Deletes unused directories, cleans package.json, generates CI/CD, renames scope
- Runs verification (install, build, type-check)
- Self-deletes after completion

### `bun run rename <scope>` — Standalone rename

Replaces `@monorepo-template` across all 60+ files. Use if you only need to rename.

```bash
bun run rename raiko  # @monorepo-template -> @raiko everywhere
```

**Always recommend running `bun run customize` first.** Only fall back to manual steps if the script fails or needs adjustment.

---

## Template Inventory (Reference)

### Apps

| App                       | Path                            | Purpose                                               |
| ------------------------- | ------------------------------- | ----------------------------------------------------- |
| `web`                     | `apps/web/`                     | Frontend SPA (client in client-server pattern)        |
| `server`                  | `apps/server/`                  | Backend API (server in client-server pattern)         |
| `fullstack-fn-only`       | `apps/fullstack-fn-only/`       | Fullstack with TanStack serverFn only (no API server) |
| `fullstack-fn-and-convex` | `apps/fullstack-fn-and-convex/` | Fullstack with TanStack serverFn + Convex real-time   |
| `mobile`                  | `apps/mobile/`                  | Cross-platform mobile app (Expo 54)                   |
| `documentation`           | `apps/documentation/`           | Documentation site (Astro Starlight)                  |

### Packages

| Package                          | Path                    | Purpose                                    |
| -------------------------------- | ----------------------- | ------------------------------------------ |
| `@monorepo-template/domain`      | `packages/domain/`      | Pure domain layer: schemas, types, consts  |
| `@monorepo-template/application` | `packages/application/` | Use cases layer (server-only)              |
| `@monorepo-template/infra-db`    | `packages/infra-db/`    | Drizzle ORM, Neon PostgreSQL, repositories |
| `@monorepo-template/infra-auth`  | `packages/infra-auth/`  | Better Auth configuration                  |
| `@monorepo-template/infra-env`   | `packages/infra-env/`   | Zod env validation schemas                 |
| `@monorepo-template/web-ui`      | `packages/web-ui/`      | Shared React UI components (shadcn/ui)     |
| `@monorepo-template/config`      | `packages/config/`      | Shared tsconfig.base.json                  |

### Architecture Patterns (Mutually Exclusive)

| Pattern            | Keep                            | Remove                                                       |
| ------------------ | ------------------------------- | ------------------------------------------------------------ |
| Client-Server      | `apps/web/`, `apps/server/`     | `apps/fullstack-fn-only/`, `apps/fullstack-fn-and-convex/`   |
| Fullstack serverFn | `apps/fullstack-fn-only/`       | `apps/web/`, `apps/server/`, `apps/fullstack-fn-and-convex/` |
| Fullstack + Convex | `apps/fullstack-fn-and-convex/` | `apps/web/`, `apps/server/`, `apps/fullstack-fn-only/`       |

### Pattern-Specific Cleanups (handled by `bun run customize`)

| Item                       | Client-Server                          | Fullstack serverFn                                                      | Fullstack + Convex                                      |
| -------------------------- | -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Scripts to remove          | dev:fullstack-fn, dev:fullstack-convex | dev:web, dev:server, dev:fullstack-convex                               | dev:web, dev:server, dev:fullstack-fn                   |
| Catalog entries to remove  | convex, @convex-dev/react-query        | elysia, @elysiajs/eden, @elysiajs/cors, convex, @convex-dev/react-query | elysia, @elysiajs/eden, @elysiajs/cors                  |
| Env schemas to remove      | fullstackServerEnvSchema               | serverEnvSchema, webServerEnvSchema, webClientEnvSchema                 | serverEnvSchema, webServerEnvSchema, webClientEnvSchema |
| db:\* env source           | apps/server/.env                       | apps/fullstack-fn-only/.env                                             | apps/fullstack-fn-and-convex/.env                       |
| CI/CD backend step         | keep                                   | remove                                                                  | remove                                                  |
| .cursor/rules/backend.mdc  | keep                                   | delete                                                                  | delete                                                  |
| .cursor/rules/frontend.mdc | keep                                   | delete                                                                  | delete                                                  |

### Optional Features

**Mobile (`apps/mobile/`):** If removed, also remove `dev:native` script and `@better-auth/expo` from catalog.

**Documentation (`apps/documentation/`):** If removed, also delete `.cursor/rules/documentation.mdc`.

**Convex skills:** 13 pre-loaded `.claude/skills/convex-*` directories for future integration. Remove if not using Convex.

---

## Post-Script Manual Steps

The automated script handles structural changes but cannot rewrite prose content. After running `bun run customize`, check:

| File                             | What to update                                 |
| -------------------------------- | ---------------------------------------------- |
| `CLAUDE.md`                      | Architecture examples referencing deleted apps |
| `.cursorrules`                   | Workspace structure, pattern-specific sections |
| `.claude/architecture.md`        | References to deleted apps/server, apps/web    |
| `.claude/ai-context.md`          | References to deleted app paths                |
| `.claude/todo-crud-reference.md` | References to deleted apps                     |

Grep for stale references:

```bash
grep -r "apps/web\|apps/server\|apps/fullstack" --include="*.md" --include="*.mdc" .claude/ .cursor/ .cursorrules CLAUDE.md
```

---

## Rename Scope Details

The `bun run rename` script replaces both `@monorepo-template` (scope) and `monorepo-template` (bare name) across all files, excluding `node_modules`, `.git`, `bun.lock`, `.turbo`, `dist`, `.output`, `.wrangler`, `.next`.

Files typically affected (~60+):

- All `package.json` files (root + packages + apps)
- Source files with `import ... from "@monorepo-template/..."`
- CI/CD workflows (`--filter='@monorepo-template/*'`)
- `CLAUDE.md`, `.cursorrules`, `.env.x`
- Documentation `.mdx` files
- `.claude/` context files
- Lint/format configs
