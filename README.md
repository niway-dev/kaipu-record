# Monorepo Template

A production-ready monorepo template with DDD + Hexagonal Architecture, authentication, deployment configs, and a Todo CRUD example. Built with TypeScript, Bun, and Turborepo.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.3.4 or higher
- PostgreSQL database (e.g., [Neon](https://neon.tech))

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd monorepo-template
```

2. Install dependencies:

```bash
bun install
```

3. Set up environment variables:

   **With dotenvx (recommended):**

   Get the `.env.keys` file from your team lead and place it at the repo root. The encrypted `.env` files are already committed -- dotenvx decrypts them automatically at runtime.

   **Manual setup (from scratch):**

   Copy the `.env.example` files and fill in your values:

   ```bash
   # Server (Wrangler uses .dev.vars)
   cp apps/server/.env.example apps/server/.dev.vars

   # Web
   cp apps/web/.env.example apps/web/.env

   # Mobile (if needed)
   cp apps/mobile/.env.example apps/mobile/.env
   ```

   Required variables:

   | Variable             | Apps        | Description                                 |
   | -------------------- | ----------- | ------------------------------------------- |
   | `DATABASE_URL`       | server, web | Neon PostgreSQL connection string           |
   | `BETTER_AUTH_SECRET` | server, web | `openssl rand -base64 32`                   |
   | `BETTER_AUTH_URL`    | server      | Server URL (e.g., `http://localhost:3000`)  |
   | `CORS_ORIGIN`        | server      | Web app URL (e.g., `http://localhost:3001`) |
   | `VITE_SERVER_URL`    | web         | Server URL for Eden Treaty client           |

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

## Project Structure

```
monorepo-template/
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

### Development

- `bun run dev` -- Start all applications in development mode
- `bun run dev:web` -- Start only the web application
- `bun run dev:server` -- Start only the server

### Building

- `bun run build` -- Build all applications for production

### Database

- `bun run db:push` -- Push schema changes to database
- `bun run db:studio` -- Open Drizzle Studio (database GUI)
- `bun run db:generate` -- Generate migration files
- `bun run db:migrate` -- Run database migrations

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

Both the web app and API server deploy to Cloudflare Workers.

```bash
# Deploy the web app
cd apps/web && bun run deploy

# Deploy the server
cd apps/server && bun run deploy
```

For Cloudflare Workers secrets:

```bash
wrangler secret put DATABASE_URL
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put BETTER_AUTH_URL
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
