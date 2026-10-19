---
title: "Continue with Google and safe account linking"
description: "Web Google sign-in (NIW2-219): the button, the linking rules, the pre-hijack guard, Sign-in methods on /dashboard/profile and the desktop hint."
---

# Continue with Google

> **Status: 🟡 In progress (2026-10-19).** Code and tests are in a PR stacked on the
> [web dashboard](./web-dashboard) (#325 → #274) that also carries the NIW2-215 config (#323)
> until it merges. Not yet tried with a real Google account. Linear: NIW2-219. Epic: NIW2-213.

## What it does

- `/auth/login` and `/auth/signup` show **Continue with Google** above the email form. Sign-in
  lands on `resolvePostSignInPath` (the dashboard unless a safe `redirect` is present). Sign-up
  shows the legal notice under the button.
- The button only appears with `VITE_GOOGLE_AUTH_ENABLED=true`. Set it only where the API has
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see the [Google OAuth runbook](/deployment/google-oauth/)).
  Production reads it from the GitHub `production` Environment variable of the same name.
- A failed or cancelled Google round trip comes back to `/auth/login?error=<code>` (or
  `/dashboard/profile?error=<code>` for Connect), and the code is shown as copy, never raw.
- **Sign-in methods** on `/dashboard/profile`: Connect Google (`linkSocial`), Disconnect Google
  (disabled when it is the only method; the API refuses it too) and **Set a password** for
  Google-only accounts (`POST /api/v1/me/password`), so the desktop app can sign them in.
- Desktop: a wrong email or password adds "Signed up with Google? Set a password at kaipu.app".

## Linking rules

| Situation                                                            | Result                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| New email                                                            | New user, `emailVerified` from Google, one `google` account. Cloud trial applies at once.                  |
| Existing **verified** email+password user, same email                | Google is linked. Password and sessions keep working.                                                      |
| Existing **unverified** email+password user, same email (signed out) | Google is linked; the password and every earlier session are deleted first; a one-time banner explains it. |
| Google says the email is **not** verified, user exists               | Refused (`account_not_linked`). Google is not a trusted provider.                                          |
| Signed in, Connect Google with a different email                     | Linked. `email` and `emailVerified` unchanged.                                                             |
| Signed in and unverified, Connect Google with the same email         | Linked, email marked verified, password kept.                                                              |
| Google account already linked to another user                        | Refused (`account_already_linked_to_different_user`).                                                      |

The third row is the **pre-hijack guard**: someone who registered your address with a password
before you verified it loses that access when you sign in with Google.

## How it works

- `apps/server-hono/src/lib/account-linking.ts` holds the rules. `decideLinkSideEffects` is a pure
  function; the Better Auth `databaseHooks.account.create` hooks only load data and apply its
  answer. The destructive part runs in `create.before`, so a failure aborts the link instead of
  leaving a linked account with the old password intact (there are no DB transactions here).
- Better Auth 1.7 refuses an implicit link to an unverified local account by default. Kaipu
  sets `accountLinking.requireLocalEmailVerified: false` so the approved behaviour (link, drop
  the unverified password and old sessions) still applies; the `create.before` guard is what
  makes that safe. The guard aborts with a plain `Error`, which Better Auth answers with
  `?error=unable_to_link_account` (an `APIError` would surface as a bare 403).
- The hook tells a manual link from a sign-in by the OAuth state Better Auth keeps for the request
  (`getOAuthState().link`), not by path alone.
- Google's id-token sign-in paths are disabled (`disableIdTokenSignIn`); only the redirect flow exists.
- `authMiddleware` reads sessions without the 10-minute cookie cache, so a revoked session stops
  working on `/api/v1` at once.
- Google's access and refresh tokens are stored encrypted (`encryptOAuthTokens`).
- Disconnecting Google sends Better Auth's own account id (`unlinkAccount({ accountId })`). It
  needs a fresh session (signed in within a day); otherwise the page asks the user to sign in
  again.
- `account` has a unique index on `(provider_id, account_id)`; apply it with `bun run db:push`.

## Testing

`account-linking.flow.test.ts` drives a real Better Auth 1.7.11 instance on the in-memory adapter
with a fake Google token endpoint, so it pins Better Auth's internal ordering. A Better Auth
upgrade that changes it fails there.

Not covered without a browser: the real Google consent screen, cookies across the web proxy, and
the desktop session being signed out on its next call. Those are the manual steps in the PR.
