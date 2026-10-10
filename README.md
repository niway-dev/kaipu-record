# Kaipu — This. Captured.

Screen recordings and screenshots, kept in a folder you own.

Kaipu is a local-first desktop app for recording bugs, explaining changes, annotating
screenshots, and finding those explanations again. Record, trim, annotate, and export
without an account for local use. Cloud capabilities are optional.

## Why Kaipu

**Kaipu = KAY + khiPU → «Esto, registrado».** Our name is a creative brand construction
inspired by “this” and the khipu/quipu, the Andean system of recording information with
cords and knots. It is not a literal Quechua translation. **“This. Captured.”** is our
English brand signature.

**Kai** is the name of our companion, with a small knot that keeps moments as the
preferred visual direction. Final logo, mascot, and notch-state artwork integration
is still pending.

The [canonical brand identity](apps/documentation/src/content/docs/marketing/brand-identity.md)
preserves the adopted meaning, origin story, and sources. Start there for brand work.

## Product and status

- Screen, voice, and camera recording, global shortcuts, and floating recording controls.
- Screenshot capture and annotation, crop, freehand, and redaction tools.
- Lightweight video editing with trim, annotations, auto-zoom, and MP4 export.
- A filesystem-first library that keeps original recordings and exported results.
- macOS is the current product target; a recording-only Windows beta is planned.
- This branch removes mandatory watermarks and adds an opt-in “Made with Kaipu” badge,
  off by default. Packaged-build validation is pending; see the
  [validation checklist](apps/documentation/src/content/docs/backlog/free-tier-no-watermark.md).

Visit [kaipu.app](https://kaipu.app) for available downloads. The source is public under
AGPL-3.0-only. Roadmap items are not claims about the currently downloaded release.

## Start reading

- [Product philosophy](apps/documentation/src/content/docs/desktop/product-philosophy.mdx)
- [Marketing and growth](apps/documentation/src/content/docs/marketing/index.md)
- [Brand and website execution plan](apps/documentation/src/content/docs/plans/2026-09-27-brand-and-website-rollout.md)
- [Product growth roadmap](apps/documentation/src/content/docs/backlog/product-growth.mdx)
- [Commands](apps/documentation/src/content/docs/commands.md)

All maintained project documentation lives in the Astro Starlight site at
`apps/documentation/`. Run `bun run dev` from that directory to read it locally.

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

4. For the desktop app, follow any native-rebuild instruction from `bun run setup`,
   then run `bun run dev` in `apps/kaipu-record`. Native rebuilding is explicit:

```bash
bun run rebuild:native
```

For backend development, push the database schema:

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
kaipu-record-monorepo/
├── apps/
│   ├── kaipu-record/     # Electron desktop recorder and editors
│   ├── web-hono/         # Website and web app (TanStack Start)
│   ├── server-hono/      # Hono API on Cloudflare Workers
│   ├── console/          # Operations console
│   └── documentation/    # Astro Starlight documentation
│
├── packages/
│   ├── domain/           # Pure business logic: schemas, types, repository interfaces
│   ├── application/      # Use cases (depends only on domain interfaces)
│   ├── infra-db/         # Infrastructure: Drizzle schemas, repositories, mappers
│   ├── infra-auth/       # Infrastructure: Better Auth configuration
│   ├── web-ui/           # Shared React UI components (shadcn/ui)
│   ├── i18n/             # Shared English/Spanish messages
│   ├── tokens/           # Shared light/dark design tokens
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

- `bun run plan show|grant|revoke <email>` -- Inspect, grant or revoke account entitlements; what each plan includes is documented on the docs site's Plans page (`features/plans`)

### Code Quality

- `bun run check-types` -- Check TypeScript types across all packages
- `bun run verify` -- Run workflow checks, lint, format checks, package builds, types, and tests
- `bun run lint` -- Lint all files with oxlint
- `bun run format` -- Format all files with oxfmt
- `bun run format:tracked` -- Format only git-tracked files
- `bun run check` -- Run both lint and format

## Architecture

The shared backend packages follow DDD + Hexagonal Architecture with a layer-first structure. Inner layers never depend on outer layers. Desktop-specific architecture is documented separately in the docs site.

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
                 │   desktop   │
                 └─────────────┘
```

See the [desktop recording pipeline](apps/documentation/src/content/docs/desktop/recording-pipeline.mdx)
and [architecture docs](apps/documentation/src/content/docs/architecture/) for the current implementation.

## Tech Stack

| Layer         | Technology                             |
| ------------- | -------------------------------------- |
| Runtime       | Bun                                    |
| Language      | TypeScript                             |
| Monorepo      | Turborepo + Bun Workspaces             |
| Frontend      | TanStack Start, React, TanStack Router |
| Backend       | Hono, oRPC                             |
| Desktop       | Electron, React, WebCodecs, Mediabunny |
| Database      | Neon PostgreSQL, Drizzle ORM           |
| Auth          | Better Auth                            |
| UI Components | shadcn/ui, Tailwind CSS                |
| Linting       | oxlint                                 |
| Formatting    | oxfmt                                  |
| Deployment    | Cloudflare Workers                     |
| Documentation | Astro Starlight                        |

## Deployment

The web app, API server and console deploy to Cloudflare Workers. Deploys are
driven by release-please: merging its release PR tags a component (`api-v*`,
`web-v*`, `desktop-v*`) and the matching workflow ships it.

For manual deployment commands and prerequisites, use the
[deployment documentation](apps/documentation/src/content/docs/deployment/).

**Worker secrets are not set with `wrangler secret put`.** Production still
reads them from GitHub Secrets inside the release workflows; migrating that to
Infisical with OIDC is pending. Setting a secret by hand creates a value no
workflow knows about and that nothing will keep in sync.

## Maintainer and contributing

Kaipu Record is written and maintained by **Cristian Sotomayor
([@csdev19](https://github.com/csdev19))** and published by **Niway S.A.C.**

**Issues are open to everyone; pull requests are limited to collaborators.** Report bugs and
request features through [issues](https://github.com/niway-dev/kaipu-record/issues) — see
[CONTRIBUTING.md](CONTRIBUTING.md) for why, and [SECURITY.md](SECURITY.md) for reporting a
vulnerability privately.

## License

This project is licensed under **AGPL-3.0-only**. See [LICENSE](LICENSE).
The [open-source plan](apps/documentation/src/content/docs/marketing/open-source.md)
records why the repository is open and how contributions are handled.
