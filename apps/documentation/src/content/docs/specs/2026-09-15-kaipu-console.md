---
title: "Kaipu Console — independent operator app"
description: "TanStack Start server functions, shared authentication through Service Binding, and a read-only account directory."
---

# Kaipu Console

Status: implementation in progress, not deployed. The owner chose a separate
TanStack Start app over a route inside the public website or a local-only tool.

## Existing patterns reused

`apps/console` follows `monorepo-template/apps/fullstack-fn-only` for server
functions and `web-hono` for Cloudflare Service Binding authentication.

```text
Browser → Console Worker (TanStack Start)
                  ├─ auth proxy → API_SERVICE → existing kaipu-api / Better Auth
                  └─ authorized server function → infra-db → shared database
```

There is no new admin REST API in server-hono and no duplicate auth database.
The app has its own Worker and can receive its own hostname. A private-looking
hostname is not authorization: every data request validates the live session
and matches its immutable user ID against `CONSOLE_ADMIN_USER_IDS`.

## Initial scope

- Sign in/out with an existing Kaipu account; no signup in Console.
- Paginated user directory with name/email search (25 per page).
- Email verification, stored plan/status/provider/expiry, current effective
  capacity, used/reserved bytes, pending uploads and account creation date.
- Global upload availability, read from cloud control.
- English interface with responsive tables and explicit empty/error states.
- Read only. Beta requests/approval, grants, revocation and plan changes are
  follow-ups, not simulated buttons. Existing quota rules remain authoritative.

No passwords, session tokens, provider references or stored file content are
returned in the user directory. The auth proxy strips bearer-token response
headers through the shared proxy utility. Data responses use `private, no-store`.

## Configuration and local run

1. Copy `apps/console/.env.example` to `.env` and set `DATABASE_URL` to the same
   database as the connected API. Use a read-only database credential if available.
2. Set `CONSOLE_ADMIN_USER_IDS` to the owner's existing Better Auth user ID.
   Empty configuration denies all access. This is not email verification.
3. Set `CONSOLE_API_URL` and an explicit `CONSOLE_ENVIRONMENT` label.
4. Add `http://localhost:3002` to the API's `CORS_ORIGIN` list, which also supplies
   Better Auth trusted origins. For deployment, use the actual Console origin.
5. Run `bun run dev:server-hono` and `bun run dev:console` in separate terminals.
   Open `http://localhost:3002` so browser secure-cookie localhost behavior applies.

The dev server binds to loopback. In Cloudflare, `API_SERVICE` targets `kaipu-api`;
HTTP fallback follows the shared template for environments without the binding.
Never expose DB credentials with a `VITE_` prefix. No real credentials are included.

## Deployment boundary

The Worker config disables workers.dev and preview URLs and reserves the
dedicated `console.kaipu.app` custom domain. No deployment is performed by this
change. Configure Worker secrets and add the Console origin to the API's trusted
origins before deploying; do not use the public website's hostname.
A Service Binding makes Console-to-API transport private; it does not make a
browser-facing Console hostname private. User authorization still applies.

## Verification

Run `bun run --filter console test`, `bun run --filter console check-types` and
`bun run --filter console build`. Test anonymous, non-operator and operator
sessions against the configured environment before enabling the hostname.
Inspect both narrow and wide tables and confirm search, pagination and logout.
No production data access or approval is needed for the automated checks.
