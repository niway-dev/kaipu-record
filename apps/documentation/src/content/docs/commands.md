---
title: Commands
description: Every command used in the project — development, database, operator tasks such as granting pro, quality checks, and per-app scripts.
---

# Commands

Run root commands from the repository root. Commands that touch the database fetch their
environment from Infisical through `scripts/with-env.sh`, filtered to the `db-scripts` tag so
they receive `DATABASE_URL` and nothing else.

**Infisical overrides variables already set in your shell.** dotenvx, which this replaced, did
the opposite. Prefixing a command with a different `DATABASE_URL` no longer wins — see
[Production](#production) below for how to target another database.

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
environment.

## Plans — make an account premium (pro)

`pro` removes the watermark. With no payment provider yet, an operator grants it by hand:

```bash
bun run plan show <email>     # current plan
bun run plan grant <email>    # active, non-expiring manual pro (safe to repeat)
bun run plan revoke <email>   # remove the manual grant, back to free
```

- The command first prints `Database: <host>` — check it before trusting the result. This is the
  safety net for everything below.
- **Development:** no extra setup; it fetches the `dev` database URL from Infisical.
- **Production:** `SKIP_INFISICAL=1` is required. Without it Infisical overwrites the URL you
  passed and the command silently grants pro in **development** instead:
  ```bash
  SKIP_INFISICAL=1 DATABASE_URL='<production url>' bun run plan grant <email>
  ```
  Put both in front of the command, never `export` them, so later commands do not inherit a
  production connection.
- Run `show` first: "No account uses the email" usually means the wrong database.
- It refuses to change a subscription a billing provider (`stripe`, `autumn`) owns.
- The user restarts the desktop app (or signs out and in) to pick up the change.

Rules and the offline behaviour: [Pro mode — entitlements conditions](/features/pro-mode).

## Quality

| Command                  | What it does                                          |
| ------------------------ | ----------------------------------------------------- |
| `bun run check-types`    | Type-check every package.                             |
| `bun run lint`           | Lint with oxlint.                                     |
| `bun run format`         | Format with oxfmt.                                    |
| `bun run format:tracked` | Format only git-tracked files.                        |
| `bun run check`          | Lint, then format.                                    |
| `bun run test`           | Run every package's unit tests.                       |
| `bun run build`          | Build everything (`build:no-cache` forces a rebuild). |

## Per app

**API (`apps/server-hono`)** — `bun run deploy` (Wrangler deploy), `bun run cf:gen-types`
(regenerate binding types after editing `wrangler.jsonc`).

**Web (`apps/web-hono`)** — `bun run deploy` / `bun run destroy` (Alchemy),
`bun run wrangler:types`.

**Desktop (`apps/kaipu-record`)** — `bun run test`, `bun run test:e2e` (Playwright),
`bun run typecheck`, `bun run build:mac` / `build:win` / `build:linux` (installers).

**Docs (`apps/documentation`)** — `bun run build`, `bun run preview`.
