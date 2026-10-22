---
title: "Google OAuth setup"
description: "Runbook for creating Kaipu's Google OAuth clients and wiring GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and BETTER_AUTH_URL per environment."
---

# Google OAuth setup

**Status: 🟡 Code merged, console and secrets pending the owner** (NIW2-215). The API
registers Google only when both Google variables are set, so the code is inert until
this runbook is done. No secret value belongs in Git, chat, Linear or a PR.

## How the pieces fit

- Better Auth builds the OAuth `redirect_uri` from `BETTER_AUTH_URL` plus the default path
  `/api/auth/callback/google`.
- `BETTER_AUTH_URL` is the **web** origin, not the API. The browser only talks to the web
  Worker, which proxies `/api/auth/*` to the API, and the OAuth `state` cookie is set on
  the web origin. If the redirect pointed at the API origin, the callback would arrive
  without that cookie and fail with a state mismatch.
- Scopes are Better Auth's Google default: `openid email profile` (all non-sensitive).
- The account chooser is always shown (`prompt: select_account`).

| Environment | `BETTER_AUTH_URL`       | Redirect URI to register                         |
| ----------- | ----------------------- | ------------------------------------------------ |
| Dev         | `http://localhost:3001` | `http://localhost:3001/api/auth/callback/google` |
| Prod        | `https://kaipu.app`     | `https://kaipu.app/api/auth/callback/google`     |

Google does not accept wildcard redirect URIs, so Google sign-in does not work on preview
versions (`*.workers.dev`). Register only the apex in prod and redirect `www.kaipu.app` to
`https://kaipu.app` in Cloudflare: the `state` cookie is host-only, so a flow started on
`www` and called back on the apex fails.

That redirect lives only in the Cloudflare dashboard (a 301 at the edge, path and query
preserved; checked 2026-10-21) and more than OAuth depends on it: production `CORS_ORIGIN` is
the apex only, so a request from `https://www.kaipu.app` would fail Better Auth's origin check
on `/api/auth/*` and the CSRF check on `/api/v1/*` (NIW2-324) with a 403. If the rule is ever
removed, add `https://www.kaipu.app` to `CORS_ORIGIN` or restore it.

## Google Cloud Console

Current console naming is "Google Auth Platform". Use the Google account that should own
Kaipu's Google assets.

1. **Project:** console.cloud.google.com, project picker, _New project_, name `Kaipu`.
2. **Google Auth Platform, Get started / Branding:** app name `Kaipu`, user support email
   (your address), audience **External**, developer contact `contacto@niway.dev`.
3. **Branding (edit):** home page `https://kaipu.app`, privacy
   `https://kaipu.app/legal/privacy-policy`, terms
   `https://kaipu.app/legal/terms-and-conditions`, authorized domain `kaipu.app`. Leave
   the logo empty (a logo triggers brand verification).
4. **Audience:** keep _Publishing status = Testing_ and add yourself (and any tester)
   under _Test users_. Testing mode allows at most 100 test users. Moving to _In
   production_ is required before a public launch.
5. **Data access:** tick only `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`.
6. **Clients, Create client**, twice: type _Web application_, names `kaipu-web-dev` and
   `kaipu-web-prod`. Separate clients so a leaked dev secret (it lives in laptop `.env`
   files) cannot touch prod.
   - Dev: JavaScript origin `http://localhost:3001`, redirect URI
     `http://localhost:3001/api/auth/callback/google`.
   - Prod: JavaScript origin `https://kaipu.app`, redirect URI
     `https://kaipu.app/api/auth/callback/google`.
   - Copy the client ID and secret straight into the stores below; the secret may be
     shown only once.

## Secret stores

**Infisical `dev`** (see [Secrets layout](/deployment/secrets-layout/)), tag `server-hono`:

- `/auth/GOOGLE_CLIENT_SECRET` (dev client)
- `/public/GOOGLE_CLIENT_ID` (dev client)
- `/public/BETTER_AUTH_URL` = `http://localhost:3001` (if a value exists and says
  `http://localhost:3000`, change it)

Check without printing values:
`bun env:pull && grep -c GOOGLE_ apps/server-hono/.env` should print `2`.

**Prod:** GitHub, repo Settings, Environments, `production` (what `release-api.yml` reads):

- Secret `GOOGLE_CLIENT_SECRET` (prod client)
- Variables `GOOGLE_CLIENT_ID` (prod client) and `BETTER_AUTH_URL` = `https://kaipu.app`

Mirror the same three in Infisical `prod` if that environment exists. `release-api.yml`
drops empty values, so merging the workflow before these exist is safe.

## Before the first prod release with `BETTER_AUTH_URL`

Setting it changes Better Auth's base URL for every caller, including the desktop app,
which calls `kaipu-api` directly. Smoke-test email+password sign-in on web and on the
desktop dev build before releasing. Confirm the current prod value with
`wrangler secret list` on `kaipu-api` (names only).

## Verify locally

With the dev secrets present, `bun run dev`, then:

```bash
curl -s -X POST http://localhost:3001/api/auth/sign-in/social \
  -H 'content-type: application/json' \
  -d '{"provider":"google","callbackURL":"/dashboard"}'
```

The returned Google URL must contain
`redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fauth%2Fcallback%2Fgoogle`.
