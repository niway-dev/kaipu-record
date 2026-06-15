# Monorepo Template Customization Retrospective

> Generated after customizing the template for the **Raiko** project.
> Pattern chosen: **Fullstack serverFn Only** + Mobile + Docs.
> Use this to improve the official `monorepo-template` and reduce future customization time.

---

## Time Breakdown

| Step                          | Effort        | Why it was slow                                                                                                           |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Codebase exploration          | High          | Had to read 15+ files to understand the full dependency graph                                                             |
| Delete directories            | Trivial       | Just `rm -rf`                                                                                                             |
| Root package.json             | Low           | Straightforward edits                                                                                                     |
| infra-env cleanup             | Low           | Delete files + update index.ts                                                                                            |
| CI/CD workflows               | Medium        | Had to understand env vars per pattern, rewrite YAML                                                                      |
| **Rename @monorepo-template** | **Very High** | **62 files. This dominated the entire process.**                                                                          |
| Dead reference cleanup        | High          | Grep found references in .cursorrules, README, .claude/_, .cursor/_, fumadocs docs, .oxlintrc.json, .oxfmtrc.json, .env.x |
| Post-cleanup verification     | Low           | bun install + grep                                                                                                        |

**Total: ~80% of time was spent on renaming and dead reference cleanup.**

---

## Pain Points & Recommendations

### 1. Rename is the #1 bottleneck (62 files touched)

**Problem:** `@monorepo-template` appears in:

- 7 `package.json` files (packages)
- 5 `package.json` files (apps)
- 1 root `package.json`
- ~20 source files (imports)
- 2 CI/CD workflows
- 1 turbo.json (indirectly via filter)
- 1 CLAUDE.md
- 1 .cursorrules
- 1 .env.x
- ~20 fumadocs documentation files
- 3 .claude/ context files
- 2 .cursor/ rule files
- 2 lint/format configs (.oxlintrc.json, .oxfmtrc.json)

**Recommendation:** Add a `bun run rename <new-scope>` script to the template root that:

1. Finds all files containing `@monorepo-template` or `monorepo-template`
2. Replaces them (excluding node_modules, bun.lock, .git)
3. Runs `bun install` to regenerate lockfile
4. Prints a summary of changed files

Something like:

```typescript
// scripts/rename.ts
import { $ } from "bun";
const newName = process.argv[2];
if (!newName) { console.error("Usage: bun run rename <new-scope>"); process.exit(1); }
// ... find-and-replace logic
```

### 2. The customize-template skill has all the knowledge but the agent still has to explore

**Problem:** The SKILL.md is 360 lines and contains everything needed, but the agent still had to:

- Read the root package.json to know exact content
- Read each CI/CD workflow to know exact YAML structure
- Read infra-env/src/index.ts to know exact exports
- Read .cursorrules, README.md, etc.

**Recommendation:** The skill should include exact file paths AND their expected content structure, or better yet, the template should ship with a `customize.config.ts` that declares:

```typescript
export const patterns = {
  "client-server": {
    keep: ["apps/web", "apps/server"],
    remove: ["apps/fullstack-fn-only", "apps/fullstack-tanstack-elysia"],
    catalogRemove: ["@elysiajs/eden"],
    scriptsRemove: ["dev:fullstack-fn", "dev:fullstack-elysia"],
    envSchemasRemove: ["fullstackServerEnvSchema"],
    dbEnvSource: "apps/server/.env",
  },
  "fullstack-fn-only": {
    keep: ["apps/fullstack-fn-only"],
    remove: ["apps/web", "apps/server", "apps/fullstack-tanstack-elysia"],
    catalogRemove: ["elysia", "@elysiajs/eden", "@elysiajs/cors"],
    scriptsRemove: ["dev:web", "dev:server", "dev:fullstack-elysia"],
    envSchemasRemove: ["serverEnvSchema", "webServerEnvSchema", "webClientEnvSchema"],
    dbEnvSource: "apps/fullstack-fn-only/.env",
  },
  // ...
};
```

### 3. Documentation files contain hardcoded app paths

**Problem:** 20+ fumadocs `.mdx` files reference `apps/web/`, `apps/server/`, etc. These become stale after customization but are too many to manually update.

**Recommendation:**

- Option A: Use a docs generation approach where paths are variables
- Option B: Tag docs with which pattern they apply to (e.g., frontmatter `pattern: client-server`) so they can be bulk-removed
- Option C: Accept that docs are educational and don't need to match the exact project structure (current approach, but confusing)

### 4. AI context files (.claude/, .cursor/) have stale references

**Problem:** These files exist to help AI assistants understand the project, but after customization they reference deleted apps:

- `.claude/architecture.md` — references `apps/server/`, `apps/web/`
- `.claude/ai-context.md` — references `apps/web/src/`
- `.claude/todo-crud-reference.md` — references `apps/server/`, `apps/web/`
- `.claude/env-management-proposal.md` — references old env structure
- `.cursor/rules/backend.mdc` — entirely about Elysia `apps/server/`
- `.cursor/rules/frontend.mdc` — about `apps/web/` with Eden Treaty
- `.cursorrules` — mixed references to all patterns

**Recommendation:**

- Make these files pattern-aware. Ship variants:
  - `.claude/architecture-client-server.md`
  - `.claude/architecture-fullstack-fn.md`
  - `.claude/architecture-fullstack-elysia.md`
- The customization script picks the right one and renames it to `.claude/architecture.md`
- Same for `.cursor/rules/` — the backend.mdc is entirely Elysia-specific

### 5. .cursorrules is monolithic and pattern-specific

**Problem:** The `.cursorrules` file is 580 lines and mixes:

- Universal rules (TypeScript, Zod v4, component patterns)
- Pattern-specific content (auth proxy pattern is client-server only, Elysia routes, Eden Treaty)
- Workspace structure (hardcoded)
- Package imports (hardcoded)

**Recommendation:** Split into:

- `.cursorrules` — universal rules only (TypeScript, Zod, components, architecture principles)
- `.cursor/rules/pattern-specific.mdc` — generated during customization

### 6. No automated post-cleanup verification

**Problem:** After customization, you have to manually:

1. Run `bun install`
2. Grep for dead references
3. Try `bun run build`
4. Try `bun run check-types`

**Recommendation:** Add a `bun run verify-cleanup` script that:

1. Greps for references to all known app names
2. Checks that all `@scope/` imports resolve to existing packages
3. Validates that package.json dependencies exist in workspace
4. Runs build + type-check

---

## Complete File Manifest (What Changed)

### Files Deleted

```
apps/web/                              (entire directory)
apps/server/                           (entire directory)
apps/fullstack-tanstack-elysia/        (entire directory)
packages/infra-env/src/server.ts
packages/infra-env/src/web-server.ts
packages/infra-env/src/web-client.ts
.claude/skills/convex/                 (13 convex skill directories)
```

### Files Modified (Structural Changes)

| File                                      | What Changed                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `package.json` (root)                     | name, removed scripts, removed catalog entries, updated db:\* env source, renamed scope |
| `packages/infra-env/src/index.ts`         | Removed 3 schema exports                                                                |
| `.github/workflows/pr-validation.yml`     | Changed to fullstack-fn-only, removed backend step                                      |
| `.github/workflows/deploy-production.yml` | Changed to fullstack-fn-only, removed backend deploy                                    |
| `apps/fullstack-fn-only/wrangler.jsonc`   | Changed worker name                                                                     |
| `.oxlintrc.json`                          | Updated ignore path                                                                     |
| `.oxfmtrc.json`                           | Updated ignore path                                                                     |
| `CLAUDE.md`                               | Rewritten for fullstack-fn-only pattern                                                 |
| `README.md`                               | Rewritten for fullstack-fn-only pattern                                                 |
| `.cursorrules`                            | Updated tech stack, workspace structure, patterns                                       |

### Files Modified (Rename Only — @monorepo-template → @raiko)

```
packages/domain/package.json
packages/application/package.json
packages/infra-db/package.json
packages/infra-auth/package.json
packages/infra-env/package.json
packages/web-ui/package.json
packages/config/package.json
packages/infra-db/tsconfig.json
packages/infra-auth/tsconfig.json
packages/infra-env/tsconfig.json
apps/fullstack-fn-only/package.json
apps/mobile/package.json
apps/mobile/eslint.config.js
apps/fullstack-fn-only/src/server-functions/*.ts (6 files)
apps/fullstack-fn-only/src/routes/*.tsx (3 files)
apps/fullstack-fn-only/src/components/*.tsx (3 files)
apps/fullstack-fn-only/src/env/server.ts
apps/fullstack-fn-only/src/lib/auth/auth-server.ts
apps/fullstack-fn-only/src/index.css
packages/infra-db/src/repositories/todo.repository.ts
packages/infra-db/src/mappers/todo.mapper.ts
packages/infra-auth/src/config/base-config.ts
packages/application/src/todos/*.ts (5 files)
packages/domain/README.md
packages/web-ui/README.md
packages/infra-db/SPEC.md
apps/fumadocs/content/docs/*.mdx (~15 files)
.claude/architecture.md
.claude/todo-crud-reference.md
.env.x
```

### Files NOT Updated (Known Stale References)

These files still reference the old architecture but were left as-is:

| File                                                    | Issue                                                              | Priority |
| ------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| `.claude/skills/customize-template/SKILL.md`            | Template reference doc — intentionally unchanged                   | Low      |
| `.claude/commands/customize-template.md`                | Template reference doc — intentionally unchanged                   | Low      |
| `.claude/architecture.md`                               | Still references apps/server, apps/web sections                    | Medium   |
| `.claude/ai-context.md`                                 | References apps/web/src/ paths                                     | Medium   |
| `.claude/todo-crud-reference.md`                        | References apps/server, apps/web                                   | Medium   |
| `.claude/env-management-proposal.md`                    | References old env structure                                       | Low      |
| `.cursor/rules/backend.mdc`                             | Entirely about Elysia apps/server (should be deleted or rewritten) | High     |
| `.cursor/rules/frontend.mdc`                            | References apps/web with Eden Treaty                               | High     |
| `apps/fumadocs/content/docs/authentication/*.mdx`       | References apps/web auth proxy pattern                             | Medium   |
| `apps/fumadocs/content/docs/application-layer.mdx`      | References apps/server, apps/web                                   | Medium   |
| `apps/fumadocs/content/docs/schemas-implementation.mdx` | References apps/server, apps/web                                   | Low      |

---

## Suggested Template Improvements (Prioritized)

### P0 — Ship with the next release

1. **Add `bun run rename <scope>`** — Automated rename script. Eliminates 80% of customization time.
2. **Add `bun run customize`** — Interactive CLI that asks pattern + options, then runs all deletions, script removals, catalog cleanup, env schema cleanup, CI/CD rewrites, and rename in one command.

### P1 — High impact

3. **Split .cursorrules** into universal + pattern-specific sections.
4. **Delete or gate .cursor/rules/\*.mdc** per pattern — `backend.mdc` is useless without Elysia.
5. **Ship pattern-specific .claude/ context files** and pick the right ones during customization.
6. **Add pattern frontmatter to fumadocs** so docs can be filtered/removed per pattern.

### P2 — Nice to have

7. **Add `bun run verify-cleanup`** — post-customization verification script.
8. **Centralize all path references** — use a single `paths.ts` config that documentation and configs can reference.
9. **Reduce the number of AI context files** — `.claude/architecture.md`, `.claude/ai-context.md`, `.claude/todo-crud-reference.md`, `.cursorrules` all overlap significantly. Consolidate into CLAUDE.md + one reference file.

---

## Ideal Future Customization Flow

```bash
# 1. Clone template
git clone monorepo-template my-project
cd my-project

# 2. Run interactive customizer (< 10 seconds)
bun run customize
# Prompts:
#   Project name? my-project
#   Pattern? fullstack-fn-only
#   Mobile? yes
#   Docs? yes
#   Convex? no

# 3. Done. No AI agent needed for mechanical work.
bun run dev
```

**Target: Customization should take < 30 seconds, not 10+ minutes.**
