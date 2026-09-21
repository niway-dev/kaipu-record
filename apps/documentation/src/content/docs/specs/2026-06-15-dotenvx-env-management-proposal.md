---
title: "Rejected: dotenvx for encrypted env management"
description: A 2026-06-15 proposal to manage .env files with dotenvx encryption. Rejected in favour of Infisical; kept here as a historical record.
---

# Rejected: dotenvx for encrypted env management

**Status: 🔴 Rejected.** Proposed 2026-06-15. Superseded by the move to
[Infisical](https://infisical.com) (`scripts/with-env.sh`, `scripts/pull-env.sh`, landed around
2026-09-18). Current behaviour is documented in
[Environment Variables](/backend/environment-variables/) and the root `CLAUDE.md` ("Secrets:
Infisical"). This page is kept only as a record of what was considered and why it was not
adopted — it does not describe how the project works today.

## Why it was rejected

Infisical replaced this proposal wholesale rather than combining with it: it gives centralized,
access-controlled secret storage with per-folder scoping (`/cloudflare`, `/database`,
`/server-hono`, `/kaipu-record`) and a CLI that injects values directly into a command's
environment, without ever requiring an encrypted file to be committed to the repository or a
private key to be distributed to each developer. That removed the need for dotenvx's core
value proposition — encrypting secrets so they could safely live in git — because with
Infisical no secret lives in git at all, encrypted or not.

## The original proposal (as written 2026-06-15)

### How env vars were loaded at the time

| App/Package                       | Method                                      | Source File                                | When                                   |
| --------------------------------- | ------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| **Server**                        | `import { env } from "cloudflare:workers"`  | `.dev.vars` (dev), wrangler secrets (prod) | Runtime                                |
| **Web**                           | Vite `import.meta.env` + Alchemy bindings   | `.env`                                     | Build-time (client) / Runtime (server) |
| **Mobile**                        | Expo `EXPO_PUBLIC_` prefix + Zod validation | `.env`                                     | Build-time                             |
| **Infra-DB** (drizzle migrations) | `dotenv` loading `../../.env` (root)        | Root `.env`                                | Migration-time                         |

### Pain points it was meant to solve

1. Multiple `.env` file locations — root `.env`, `apps/server/.dev.vars`, `apps/web/.env`,
   `apps/mobile/.env`.
2. Manual sync — changing `DATABASE_URL` required updating 3+ files.
3. No encryption — secrets were stored in plaintext.
4. Wrangler used `.dev.vars`, a different format/location from everything else.
5. Drizzle loaded from root via a fragile relative path (`config({ path: "../../.env" })`).

### What dotenvx offered

[dotenvx](https://dotenvx.com) is billed as the next-generation replacement for `dotenv`, by
the same author (free, open source, BSD-3): AES-256 + secp256k1 encryption of values inline in
`.env` files, so encrypted files could safely be committed; asymmetric keys (a public key in the
committed `.env`, a private key in a local, never-committed `.env.keys`); a language-agnostic
CLI wrapper (`dotenvx run -- bun run dev`); and multi-file support via `-f`.

### Options considered

- **Option A (recommended at the time): dotenvx for everything except server dev.** Manage
  `apps/web/.env`, `apps/mobile/.env`, and root `.env` with dotenvx; keep `.dev.vars` for the
  server as-is. Least disruption, but server secrets stayed unencrypted locally.
- **Option B: generate `.dev.vars` from a dotenvx-managed `.env`.** A `dev:sync` script would
  decrypt and filter into `.dev.vars` before `wrangler dev`.
- **Option C: `wrangler dev --env-file .env`.** Rely on Wrangler v4's native `--env-file` /
  `env_file` support instead of generating `.dev.vars` at all.
- **Option D: consolidate to a single root `.env` + dotenvx**, with every app loading from
  there.

### Planned rollout (never executed)

1. Install `@dotenvx/dotenvx` as a root devDependency.
2. Encrypt existing `.env` files with `dotenvx encrypt`.
3. Ignore `.env.keys` and `.dev.vars` in git.
4. Update `drizzle.config.ts` to not depend on a fragile root-relative `.env` path.
5. Update `package.json` scripts to use `dotenvx run`.
6. Store `DOTENV_PRIVATE_KEY` in 1Password for team sharing.
7. Optionally add `dotenvx ext precommit` to prevent committing unencrypted secrets.

New-developer onboarding would have been: clone the repo (encrypted `.env` files come with it),
receive `.env.keys` from a team lead via 1Password, place it at the repo root, then `bun run
dev` would decrypt automatically. CI/CD would have run
`bunx dotenvx run -f apps/server/.env -- wrangler deploy` with `DOTENV_PRIVATE_KEY` set as a
GitHub secret.

None of this shipped. The project adopted Infisical instead — see
[Environment Variables](/backend/environment-variables/) for the current state.
