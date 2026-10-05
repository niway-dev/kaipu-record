---
title: Secrets and dependency audit — handoff
description: Findings from the 2026-09-20 audit of environment delivery and dependency manifests, with the exact pending changes so the work can resume on another machine.
---

**Status: 🟡 In progress.** Audit complete, documentation landed, code changes **not** landed.

This page exists so this work can resume on a different machine with nothing re-derived. It
records what was investigated, what was proven, what was only suspected, and the exact diffs
that were produced but deliberately not merged.

Everything below was found on 2026-09-20 against `main` at `c909bf1`.

## Start here if you are picking this up

1. Read [§1](#1-the-secrets-migration-is-not-finished) first. It changes what is worth doing.
2. The dependency work in [§3](#3-dependency-manifest-findings) is independent and safe to do
   at any time.
3. [§2](#2-alchemyrunts-bypasses-infisical) is **closed**: `alchemy.run.ts` was deleted from
   the repository after this audit, so the bypass no longer exists. Kept as a record.

## 1. The secrets migration is not finished

The repository moved off [dotenvx](https://dotenvx.com) and onto Infisical — that part is
real and works today (`scripts/with-env.sh`, `scripts/pull-env.sh`; the tag-filtering refactor
landed 2026-09-18). The only surviving `dotenvx` reference in the whole tree is inside an
unrelated stale worktree.

But Infisical was never the end state. A further migration to **varlock on top of Infisical**
is designed as a **six-phase plan**, and **no phase has merged**:

| PR   | What it is                                          | State                                      |
| ---- | --------------------------------------------------- | ------------------------------------------ |
| #112 | `docs(secrets)` — the design, a six-phase spec      | Open, untouched since 09-18                |
| #113 | `feat(secrets)` — phase 1, foundation + root schema | Open, **mergeable**, untouched since 09-18 |

**The highest-value next action is not any of the fixes below — it is deciding the fate of
#113.** Everything in §2 is downstream of it.

### Verified behaviour worth knowing

`scripts/with-env.sh` has a property that the old dotenvx setup did not, and it is easy to get
wrong: **Infisical overrides variables already set in the shell.** Under dotenvx, a shell value
won. So an inline override is silently ignored unless you opt out:

```bash
# WRONG — Infisical replaces the inline value with the dev one, silently
DATABASE_URL='<production url>' bun run plan grant <email>

# RIGHT
DATABASE_URL='<production url>' SKIP_INFISICAL=1 bun run plan grant <email>
```

The script also passes through when `CI` is set, requires an explicit `--tags`/`--path` filter
(there is deliberately no "fetch everything" mode), and fails loudly when the CLI is missing
rather than running with undefined values.

## 2. `alchemy.run.ts` bypasses Infisical

> **Closed (checked 2026-10-05).** `apps/web-hono/alchemy.run.ts` no longer exists on `main`;
> the web deploys through `wrangler` with the env pulled from Infisical. What follows is the
> finding as it stood on 2026-09-21.

`apps/web-hono/alchemy.run.ts` imports `dotenv` directly and calls `config({ path: ".env" })`.
Its consumers — `deploy`, `destroy`, `alchemy:dev` — do not run `env:pull` first (only `dev`
does). So `bun run deploy` ships whatever stale `.env` is on disk, and does nothing detectable
if none exists.

**This is already a known finding.** The #112 spec lists it verbatim, and assigns it to
**phase 3**: _"`web-hono`. App schema; `@varlock/cloudflare-integration`; `varlock-wrangler`
for deploys. `alchemy.run.ts` drops its own `dotenv.config()`."_

A fix was written on 2026-09-20 taking a different route — wrapping the scripts in
`with-env.sh` — and was **discarded** precisely because phase 3 would have to undo it. It is
recorded here only so the option is not re-derived from scratch:

```diff
-import { config } from "dotenv";
-config({ path: ".env" });
```

```diff
-"alchemy:dev": "alchemy dev",
-"deploy": "alchemy deploy",
-"destroy": "alchemy destroy",
+"alchemy:dev": "bash ../../scripts/with-env.sh --tags web-hono -- alchemy dev",
+"deploy": "bash ../../scripts/with-env.sh --tags web-hono -- alchemy deploy",
+"destroy": "bash ../../scripts/with-env.sh --tags web-hono -- alchemy destroy",
```

:::caution[Unverified]
Whether a `web-hono` tag actually exists in Infisical was never confirmed — it needs CLI
access. If that tag is missing, the commands above fail rather than work.
:::

### Dead `dotenv` declarations

Once `alchemy.run.ts` stops importing it, `dotenv` is dead in four places, confirmed by a
repo-wide grep: `apps/web-hono`, `packages/infra-auth`, the root `dependencies`, and the root
`catalog`. Remove them **with** whichever change drops the import, not before — removing them
first breaks the build.

## 3. Dependency manifest findings

Independent of secrets. Safe to do at any time.

### 3a. Runtime dependency declared as a devDependency — a real latent bug

`@kaipu/domain` was declared in `devDependencies` by packages importing **runtime values** from
it (error classes, constants, mapper functions), not just types. It works today only because
bun workspaces hoist and nothing prunes; `bun install --production`, publishing, or a stricter
installer breaks it.

| Package                  | Verdict                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `packages/application`   | **Move to `dependencies`** — runtime value imports confirmed   |
| `packages/infra-db`      | **Move to `dependencies`** — runtime value imports confirmed   |
| `packages/infra-storage` | **Leave as-is** — type-only imports, correctly a devDependency |

A commit implementing exactly this was written and verified but not merged. Redoing it is a
two-line change plus `bun install`.

### 3b. Dependencies nothing uses

**Confirmed unused** — grep over `src/`, all config files, and CSS `@import`/`@plugin`
directives (`apps/web-hono/index.css` imports only `@kaipu/web-ui/styles.css` and
`@kaipu/tokens/css/kaipu`):

- `apps/web-hono`: `class-variance-authority`, `next-themes`, `tw-animate-css`,
  `@base-ui/react`, `@uiw/react-md-editor`, `web-vitals`
- `apps/web-hono`: `@kaipu/domain`, `@kaipu/application`, `@kaipu/infra-db` — architecturally
  expected dead weight, since the web app proxies everything to the API and never touches the
  DB or runs Better Auth itself. Residue from before that design.
- root: `jose` — zero hits repo-wide

:::caution[Suspected only — do not remove without proving it]
These were flagged but **never empirically verified**; the verification run was interrupted.
Each needs a full `check-types` + `build` + `test` pass with it removed before it is touched.

- `drizzle-orm` in `apps/server-hono` — **most suspicious of the list.** It may be an
  intentional pin so `@kaipu/infra-db`'s types resolve. A clean `src/` grep is not evidence here.
- `zod` in `packages/application`, `packages/infra-auth`, `packages/infra-db`
- `react-dom` in `packages/infra-email`
- `vite-tsconfig-paths` misplaced in `packages/web-ui`
- a `react`/`react-dom` drift between `19.2.3` and `19.2.4` — align only if the drift is
  provably unintentional
  :::

A false positive here breaks CI, which is worse than an unremoved dead dependency. When in
doubt, leave it declared.

### 3c. Explicitly not a bug

`react` / `react-dom` in the `devDependencies` of `apps/kaipu-record` was flagged by an
automated audit as a smell. **It is correct.** electron-vite bundles the renderer, and
`dependencies` is what electron-builder packages into the shipped app. Leave it alone.

## 4. Other open threads from the same session

- **`ci-web.yml` "Web tests" exits 0 when `apps/web-hono` has no `test` script** — a green
  check that verifies nothing. Needs a decision: add tests, or drop the job.
- **`check-types` is not in the lefthook pre-push hook.** Worth adding now that the root task
  is honest (see PR #128), but it slows every push — a judgment call, not an oversight.
- **Flaky E2E: `rename persists the new title to the vault sidecar`.** Investigated via trace;
  no plausible mechanism found and a re-run passed. The underlying fragility is real though:
  in `use-local-library.ts`, `setVideos` runs _after_ `await renameLocalRecording(...)`, so the
  rename is **not** optimistic despite a test comment claiming it is. Fix by either reordering
  the assertions so the sidecar poll comes first, or making the rename genuinely optimistic.
- **`packages/web-ui`'s `dist/` is gitignored**, but the root `CLAUDE.md` claims it is
  committed. The claim is stale. Run `bun run build` in that package when a consumer reports
  "Cannot find module".

## 5. Security follow-up

A live Neon database credential was echoed into an assistant session transcript on 2026-09-19
while debugging a generated `.env`. **Rotate that credential.** Treat it as exposed regardless
of where the transcript lives.
