# Environment Variables Management Proposal

## Current State

### How Env Vars Are Loaded Today

| App/Package                       | Method                                      | Source File                                | When                                   |
| --------------------------------- | ------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| **Server**                        | `import { env } from "cloudflare:workers"`  | `.dev.vars` (dev), wrangler secrets (prod) | Runtime                                |
| **Web**                           | Vite `import.meta.env` + Alchemy bindings   | `.env`                                     | Build-time (client) / Runtime (server) |
| **Mobile**                        | Expo `EXPO_PUBLIC_` prefix + Zod validation | `.env`                                     | Build-time                             |
| **Infra-DB** (drizzle migrations) | `dotenv` loading `../../.env` (root)        | Root `.env`                                | Migration-time                         |

### Variables by Context

| Variable              | Server | Web | Mobile | Infra-DB | Sensitive? |
| --------------------- | ------ | --- | ------ | -------- | ---------- |
| `DATABASE_URL`        | Yes    | Yes | -      | Yes      | **Yes**    |
| `DATABASE_URL_DIRECT` | Yes    | Yes | -      | -        | **Yes**    |
| `BETTER_AUTH_SECRET`  | Yes    | Yes | -      | -        | **Yes**    |
| `BETTER_AUTH_URL`     | Yes    | -   | -      | -        | No         |
| `CORS_ORIGIN`         | Yes    | -   | -      | -        | No         |
| `VITE_SERVER_URL`     | -      | Yes | -      | -        | No         |
| `EXPO_PUBLIC_API_URL` | -      | -   | Yes    | -        | No         |
| `ENVIRONMENT`         | -      | Yes | -      | -        | No         |

### Current Pain Points

1. **Multiple .env file locations** -- root `.env`, `apps/server/.dev.vars`, `apps/web/.env`, `apps/mobile/.env`
2. **Manual sync** -- changing DATABASE_URL requires updating 3+ files
3. **No encryption** -- secrets stored in plaintext
4. **Wrangler uses `.dev.vars`** not `.env` -- different format/location from everything else
5. **Drizzle loads from root** -- `config({ path: "../../.env" })` is fragile
6. **GitHub Actions works fine** -- secrets/vars managed in GitHub, no issue there

---

## What is dotenvx?

dotenvx is the **next-generation replacement for dotenv**, by the same author. Free and open source (BSD-3).

### Key Features

- **Encryption** -- AES-256 + secp256k1 (same curve as Bitcoin). Values encrypted inline in `.env` files
- **Safe to commit** -- encrypted `.env` files can live in git
- **Per-environment keys** -- `.env.production` gets its own key pair, separate from `.env`
- **Asymmetric crypto** -- public key in `.env` (anyone can add secrets), private key in `.env.keys` (only holders can decrypt)
- **Language-agnostic CLI** -- wraps any command: `dotenvx run -- bun run dev`
- **Monorepo support** -- `-f` flag to specify which `.env` file, `-fk` for keys location

### Development AND Production

- **Dev**: `dotenvx run -- bun run dev` decrypts `.env` using local `.env.keys`
- **CI/CD**: Set `DOTENV_PRIVATE_KEY` as a GitHub secret, dotenvx decrypts at build/deploy time
- **Production**: Either decrypt at deploy time or continue using platform secrets (wrangler secrets, GitHub secrets)

---

## Options

### Option A: dotenvx for Everything EXCEPT Server Dev

Use dotenvx to manage `apps/web/.env`, `apps/mobile/.env`, and root `.env` (for drizzle). Keep `.dev.vars` for server development as-is.

### Option B: Generate `.dev.vars` from a dotenvx-managed `.env`

Keep a `apps/server/.env` managed by dotenvx. Add a script that decrypts and writes to `.dev.vars`.

### Option C: Use `wrangler dev --env-file .env` (Wrangler v4+)

Wrangler now supports `--env-file` flag or `env_file` in `wrangler.jsonc` to load from `.env` instead of `.dev.vars`.

### Option D: Consolidate to Root `.env` + dotenvx

Single encrypted `.env` at root with ALL variables. Each app script uses dotenvx to load it.

---

## Recommendation

**Start with Option A** (dotenvx for everything except `.dev.vars`) because:

1. Zero risk to existing wrangler workflow
2. Encrypts web, mobile, and root env files immediately
3. `.dev.vars` already works fine for local server dev
4. Can migrate server to Option B or C later

**Key changes needed:**

1. Install `@dotenvx/dotenvx` as root devDependency
2. Encrypt existing `.env` files with `dotenvx encrypt`
3. Update `.gitignore` to include `.env.keys` and `.dev.vars`
4. Update drizzle.config.ts to not depend on root `.env` with relative path
5. Update package.json scripts to use `dotenvx run`
6. Store `DOTENV_PRIVATE_KEY` in 1Password for team sharing
7. Optionally add `dotenvx ext precommit` to husky to prevent committing unencrypted secrets
