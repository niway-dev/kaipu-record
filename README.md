# Monorepo Template

A production-ready monorepo template with DDD + Hexagonal Architecture, authentication, deployment configs, and a Todo CRUD example. Built with TypeScript, Bun, and Turborepo.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.3.4 or higher
- The [Infisical CLI](https://infisical.com/docs/cli/overview) — every dev and
  database script fetches its environment from it
- Access to the `kaipu-recorder` Infisical project

`bun run setup` checks both and prints how to install anything missing. It never
installs on your behalf.

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd kaipu-record-monorepo
```

2. Install dependencies and check your tooling:

```bash
bun install
bun run setup
```

3. Sign in to Infisical:

```bash
infisical login
```

**There are no `.env` files to create.** Every value comes from Infisical and is
fetched at start-up. Where a `.env` exists it is generated and gitignored —
editing it does nothing, because the next start overwrites it.

Change a value in Infisical, restart, done.

4. Push the database schema:

```bash
bun run db:push
```

5. Start the development servers:

```bash
bun run dev
```

The application will be available at:

- **Web App**: http://localhost:3001
- **API Server**: http://localhost:3000

### Environment variables

Every variable, which Infisical folder holds it, and which apps read it:
**[Secrets layout — folders and tags](apps/documentation/src/content/docs/deployment/secrets-layout.md)**.

The short version: **folders group by what a leak would cost** (`/public`,
`/database`, `/cloudflare`, `/auth`, `/email`, `/signing`), and **tags name the
consumer** (`server-hono`, `web-hono`, `kaipu-record`, `console`, `db-scripts`,
`ci-deploy`). Scripts filter by tag, so each app receives only its own values —
the desktop build never sees a database credential.

Adding a variable means creating it in Infisical with a folder and at least one
tag. **An untagged secret is silently absent** from every filtered fetch rather
than an error, so tag it as you create it.

## Project Structure

```
kaipu/
├── apps/
│   ├── web/              # Frontend (TanStack Start on Cloudflare Workers)
│   ├── server/           # Backend API (Elysia on Cloudflare Workers)
│   ├── mobile/           # Mobile app (Expo / React Native)
│   └── documentation/    # Documentation site (Astro Starlight)
│
├── packages/
│   ├── domain/           # Pure business logic: schemas, types, repository interfaces
│   ├── application/      # Use cases (depends only on domain interfaces)
│   ├── infra-db/         # Infrastructure: Drizzle schemas, repositories, mappers
│   ├── infra-auth/       # Infrastructure: Better Auth configuration
│   ├── web-ui/           # Shared React UI components (shadcn/ui)
│   └── config/           # Shared TypeScript configuration
```

## Available Scripts

The full reference — every command, per-app scripts, and how to make an account premium
(`bun run plan grant <email>`) in development or production — lives in the docs site:
[Commands](apps/documentation/src/content/docs/commands.md).

### Development

- `bun run dev` -- Start all applications in development mode
- `bun run dev:web-hono` -- Start only the web application
- `bun run dev:server-hono` -- Start only the API

### Building

- `bun run build` -- Build all applications for production

### Database

- `bun run db:push` -- Apply the schema to the database (how schema changes ship)
- `bun run db:studio` -- Open Drizzle Studio (database GUI)

### Plans (premium)

- `bun run plan show|grant|revoke <email>` -- Inspect, grant or revoke pro (no watermark) for an account

### Code Quality

- `bun run check-types` -- Check TypeScript types across all packages
- `bun run lint` -- Lint all files with oxlint
- `bun run format` -- Format all files with oxfmt
- `bun run format:tracked` -- Format only git-tracked files
- `bun run check` -- Run both lint and format

## Architecture

This template follows DDD + Hexagonal Architecture with a layer-first package structure. The dependency rule is strict: inner layers never depend on outer layers.

```
                ┌─────────────────┐
                │     domain      │  Pure. No dependencies.
                │  schemas, types │  Schemas, types, repository interfaces.
                │  repo interfaces│
                └────────┬────────┘
                         │
             ┌───────────┼───────────┐
             v                       v
      ┌──────────────┐       ┌──────────────┐
      │  application │       │   infra-db   │
      │  (use cases) │       │   infra-auth │
      │              │       │              │
      │  imports     │       │  implements  │
      │  from domain │       │  domain      │
      └──────┬───────┘       └──────┬───────┘
             │                      │
             └──────────┬───────────┘
                        v
                 ┌─────────────┐
                 │    apps     │  Wire everything together.
                 │ server, web │  Dependency injection happens here.
                 │   mobile    │
                 └─────────────┘
```

The Todo CRUD example demonstrates this architecture end-to-end:

1. **Domain** -- Zod schemas (`TodoBase`, `CreateTodo`, `UpdateTodo`) and repository interface (`ITodoRepository`)
2. **Application** -- Use cases (`createTodo`, `listTodos`, `updateTodo`, `deleteTodo`)
3. **Infrastructure** -- Drizzle table definition, `TodoRepository` implementation, `mapTodoToDomain` mapper
4. **Server** -- Elysia REST routes at `/todos` wiring the repository to use cases
5. **Web** -- TanStack Start pages under `/_authenticated/todos/`

## Tech Stack

| Layer         | Technology                             |
| ------------- | -------------------------------------- |
| Runtime       | Bun                                    |
| Language      | TypeScript                             |
| Monorepo      | Turborepo + Bun Workspaces             |
| Frontend      | TanStack Start, React, TanStack Router |
| Backend       | Elysia                                 |
| Mobile        | Expo (React Native)                    |
| Database      | Neon PostgreSQL, Drizzle ORM           |
| Auth          | Better Auth                            |
| UI Components | shadcn/ui, Tailwind CSS                |
| Linting       | oxlint                                 |
| Formatting    | oxfmt                                  |
| Deployment    | Cloudflare Workers                     |
| Documentation | Fumadocs (Next.js)                     |

## Deployment

The web app, API server and console deploy to Cloudflare Workers. Deploys are
driven by release-please: merging its release PR tags a component (`api-v*`,
`web-v*`, `desktop-v*`) and the matching workflow ships it.

To deploy by hand:

```bash
cd apps/server-hono && bun run deploy
cd apps/web-hono && bun run wrangler:dev   # local Worker run
```

**Worker secrets are not set with `wrangler secret put`.** Production still
reads them from GitHub Secrets inside the release workflows; migrating that to
Infisical with OIDC is pending. Setting a secret by hand creates a value no
workflow knows about and that nothing will keep in sync.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
