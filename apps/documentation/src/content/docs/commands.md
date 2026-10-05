---
title: Commands
description: Every command used in the project — development, database, operator tasks such as granting pro, quality checks, and per-app scripts.
---

# Commands

Run root commands from the repository root. Commands that touch the database fetch their
environment from Infisical via `scripts/with-env.sh` (see [Environment
Variables](/backend/environment-variables/)). Infisical **overrides a variable already set** in
your shell, so to point a command at a different `DATABASE_URL` — production, for example —
prefix it inline and set `SKIP_INFISICAL=1`, rather than `export`ing it beforehand:
`DATABASE_URL='<url>' SKIP_INFISICAL=1 bun run plan grant <email>`.

## Development

| Command                                | What it does                                             |
| -------------------------------------- | -------------------------------------------------------- |
| `bun install`                          | Install dependencies (also installs the lefthook hooks). |
| `bun run dev`                          | Start every app in development mode.                     |
| `bun run dev:server-hono`              | Start only the API (Wrangler, port 3000).                |
| `bun run dev:web-hono`                 | Start only the web app.                                  |
| `cd apps/kaipu-record && bun run dev`  | Start the desktop app (electron-vite).                   |
| `cd apps/documentation && bun run dev` | Start this documentation site.                           |

## Database

| Command               | What it does                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bun run db:push`     | Apply the Drizzle schema to the database. This is how schema changes ship.                                         |
| `bun run db:studio`   | Open Drizzle Studio to inspect data.                                                                               |
| `bun run db:generate` | Generate versioned migration files. Not used today; the project stays on `db:push` until an ADR adopts migrations. |
| `bun run db:migrate`  | Apply versioned migrations. Not used today, same reason.                                                           |

Never run `db:*` from `packages/infra-db/` directly: the root scripts are what fetch the
environment from Infisical.

## Plans — make an account premium (pro)

`pro` removes the watermark. With no payment provider yet, an operator grants it by hand:

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
