---
title: Commands
description: Every command used in the project — development, database, operator tasks such as granting pro, quality checks, and per-app scripts.
---

# Commands

Run root commands from the repository root. Generate the local `.env` files once with
`bun env:pull` (see [Environment Variables](/backend/environment-variables/)); commands that
touch the database then read `packages/infra-db/.env`. A variable set inline **wins over the
file**, so to point a command at a different `DATABASE_URL` — production, for example — prefix
it: `DATABASE_URL='<url>' bun run plan grant <email>`.

## Development

| Command                                | What it does                                             |
| -------------------------------------- | -------------------------------------------------------- |
| `bun install`                          | Install dependencies (also installs the lefthook hooks). |
| `bun env:pull`                         | Generate every local `.env` file from Infisical (dev).   |
| `bun run dev`                          | Start every app in development mode.                     |
| `bun run dev:server-hono`              | Start only the API (Wrangler, port 3000).                |
| `bun run dev:web-hono`                 | Start only the web app.                                  |
| `cd apps/kaipu-record && bun run dev`  | Start the desktop app (electron-vite).                   |
| `cd apps/documentation && bun run dev` | Start this documentation site.                           |

## Database

| Command               | What it does                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run db:generate` | Generate a versioned migration from schema changes into `packages/infra-db/src/migrations/`. Commit the result.                                                      |
| `bun run db:migrate`  | Apply committed migrations to the database `DATABASE_URL` points at. This is how schema changes ship.                                                                |
| `bun run db:check`    | Fail if the schema has changes without a committed migration. Needs no database; CI runs it on release candidates (ADR 0027).                                        |
| `bun run db:studio`   | Open Drizzle Studio to inspect data.                                                                                                                                 |
| `bun run db:push`     | Sync the schema straight to a throwaway **development** database. Never production ([ADR 0029](/architecture/decisions/0029-committed-migrations-instead-of-push/)). |

Schema changes ship as committed migrations: edit `packages/infra-db/src/schema/`, run
`bun run db:generate`, read the SQL, and commit it with the schema change. `@csdev19` is the
required reviewer for those paths. Migrations are not applied by the release workflows yet:
the owner runs `bun run db:migrate` against production after merging. The first time, mark
the baseline as applied first; the procedure is in
[ADR 0029](/architecture/decisions/0029-committed-migrations-instead-of-push/#owner-procedure-mark-the-baseline-as-applied-on-production).

Never run `db:*` from `packages/infra-db/` directly: the root scripts are what fetch the
environment from Infisical.

## Plans — make an account premium (pro)

`pro` raises the account's cloud capacity (what each plan includes: [Plans](/features/plans)).
With no payment provider yet, an operator grants it by hand:

```bash
bun run plan show <email>     # current plan
bun run plan grant <email>    # active, non-expiring manual pro (safe to repeat)
bun run plan revoke <email>   # remove the manual grant, back to free
```

- The command first prints `Database: <host>` — check it before trusting the result.
- **Development:** no extra setup; it fetches `DATABASE_URL` from Infisical.
- **Production:** put the URL in front of the command and set `SKIP_INFISICAL=1`, never
  `export` it, so later commands do not silently hit production. `SKIP_INFISICAL` is required —
  Infisical overrides a variable already set in the shell, so without it the inline value would
  be silently replaced by the dev one:
  ```bash
  DATABASE_URL='<production url>' SKIP_INFISICAL=1 bun run plan grant <email>
  ```
- Run `show` first: "No account uses the email" usually means the wrong database.
- It refuses to change a subscription a billing provider (`stripe`, `autumn`) owns.
- The user restarts the desktop app (or signs out and in) to pick up the change.

Rules and the offline behaviour: [Pro mode — entitlements conditions](/features/pro-mode).

## Quality

| Command                  | What it does                                          |
| ------------------------ | ----------------------------------------------------- |
| `bun run check-types`    | Type-check every workspace, apps included.            |
| `bun run lint`           | Lint with oxlint.                                     |
| `bun run format`         | Format with oxfmt.                                    |
| `bun run format:tracked` | Format only git-tracked files.                        |
| `bun run check`          | Lint, then format.                                    |
| `bun run test`           | Run every package's unit tests.                       |
| `bun run build`          | Build everything (`build:no-cache` forces a rebuild). |

:::caution[Every workspace must expose `check-types`]
Turbo only runs a task where a package declares it, and it says nothing about the
packages that don't. A workspace with no `check-types` script is silently skipped, and
the root command still reports success — which is how `apps/web-hono` went without any
type checking at all, and how the desktop's `typecheck` (a different name) was left out
of the root task.

So: **a new workspace declares `check-types`, spelled exactly that way**, and CI needs no
new step. If it depends on a package that exports built files rather than source — today
only `@kaipu/web-ui` — give it a package-level `turbo.json` with
`"dependsOn": ["transit", "^build"]`, as `apps/web-hono` does; otherwise `tsc` runs before
that `dist/` exists and fails on a missing module.
:::

## Per app

**API (`apps/server-hono`)** — `bun run deploy` (Wrangler deploy), `bun run cf:gen-types`
(regenerate binding types after editing `wrangler.jsonc`).

**Web (`apps/web-hono`)** — `bun run deploy` / `bun run destroy` (Alchemy),
`bun run wrangler:types`.

**Desktop (`apps/kaipu-record`)** — `bun run test`, `bun run test:e2e` (Playwright),
`bun run check-types`, `bun run build:mac` / `build:win` / `build:linux` (installers).

**Docs (`apps/documentation`)** — `bun run build`, `bun run preview`.
