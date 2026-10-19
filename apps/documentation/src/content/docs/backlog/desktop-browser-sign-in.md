---
title: "Desktop sign-in through the browser"
description: "How the desktop app signs in on kaipu.app and comes back through a kaipu:// link (NIW2-471): the pages, the API endpoints, the security properties and the paste-code fallback."
---

# Desktop sign-in through the browser

> **Status: 🟡 In progress (2026-10-19).** Linear: NIW2-471.
> PR 1 upgrades better-auth to 1.7. **PR 2 (this doc's code) adds the server plugin and the web
> pages**, stacked on PR 1. PR 3 makes the desktop use them; until it lands, the desktop still signs
> in with its own email + password form.
> Decision and design: [ADR 0025](/architecture/decisions/0025-desktop-signs-in-through-the-browser/)
> and the [spec](/specs/2026-10-19-desktop-browser-sign-in-design/) (both in the docs PR #331 until it merges).

The desktop never shows a password field. "Sign in" opens kaipu.app in the system browser; the
person signs in there (email, Google when that is enabled, or "Continue" if they are already signed
in on the web), and the browser hands control back to the app through a `kaipu://` link carrying a
short-lived, single-use code. The app exchanges that code for its own session.

We use the official [`@better-auth/electron`](https://www.better-auth.com/docs/integrations/electron)
plugin (1.7.11, versioned in lockstep with `better-auth` through the root catalog) rather than a
hand-built exchange.

## The flow

```
Desktop app                    Browser (kaipu.app)                         API (/api/auth)
-----------                    -------------------                         ---------------
make verifier, state,
challenge = S256(verifier)
open /auth/desktop?client_id=kaipu-desktop&state=…&code_challenge=…
                               ├─ signed in?  "Sign in to Kaipu on this computer as X?"
                               │    Continue ───────── POST /electron/transfer-user?<query> ──▶ mint code
                               │    Switch account ─── sign out, show the form (same URL)
                               └─ signed out? sign-in form (or sign-up, query kept)
                                    POST /sign-in/email?<query>  ─────────────────────────────▶ new session
                                                                                               + mint code
                               ◀── Set-Cookie: better-auth.kaipu-desktop=<base64url {identifier,state}>
                                   (readable by JS, 120 s)
                               /auth/desktop/done
                                 read cookie, ensureElectronRedirect()
◀── kaipu://auth/callback#token=<cookie value>
decode → {identifier, state}
POST /electron/token {token: identifier, state, code_verifier}   (Origin: kaipu:/) ─────────▶ check + consume
◀────────────────────────────────────────────── 200 {token, user} + set-auth-token: <signed token>
keep the signed token (safeStorage)
```

"Mint code" means: a 32-character random code stored in the `verification` table as
`electron:<code>` with `{ userId, codeChallenge, state }`, expiring after 300 s.

## Pages (apps/web-hono)

| Path                   | What it does                                                                                                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/desktop`        | Validates `client_id` (must be `kaipu-desktop`), `state` and an S256-shaped `code_challenge`. Missing or malformed → "Open sign-in from the Kaipu app". Signed in → confirm the account (**Continue** / **Switch account**). Signed out → the sign-in form plus a sign-up link, both carrying the query. |
| `/auth/signup?<query>` | The regular sign-up page. With the desktop query it sends it with the request, lands on the done page, and its "sign in" link returns to `/auth/desktop`. A signed-in visitor is sent to `/auth/desktop`, not the dashboard.                                                                             |
| `/auth/desktop/done`   | Reads the code cookie, calls `ensureElectronRedirect()` and shows "Returning to Kaipu…". After 4 s it offers **Open Kaipu again** and **Copy code**. With no cookie after 10 s it says the code expired or was used.                                                                                     |

All three are `NOINDEX`. The copy lives in the `desktopAuth` message namespace (en + es), which only
`/auth/desktop/*` loads (`route-messages.ts`).

`resolvePostSignInPath` does not apply to these flows: when the forms get a `desktop` query they go
to the done page instead of the `redirect` param or the dashboard.

The electron proxy client (`lib/auth/desktop-auth-client.ts`) is imported only by the desktop pages,
so it ships in its own chunk; the public pages and the regular auth client never load it.

**Google:** the Google button is not on this branch yet (it arrives through PR 1 from NIW2-219). It
must be added to `/auth/desktop` with `fetchOptions: { query }` and
`callbackURL: /auth/desktop/done?<query>`; the plugin keeps the query across the OAuth round trip in
a signed `transfer_token` cookie and mints the code on `/callback/google`.

## API (apps/server-hono)

`apps/server-hono/src/lib/desktop-auth.ts` registers `electron({ clientID: "kaipu-desktop" })`.

| Endpoint                                           | Used by          | Notes                                                                                                                               |
| -------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| hooks on `/sign-in/*`, `/sign-up/*`, `/callback/*` | web forms, OAuth | With the desktop query, a new session also mints a code and sets the readable cookie; the JSON gains `electron_authorization_code`. |
| `POST /electron/transfer-user`                     | `/auth/desktop`  | Signed-in visitor → code. Wrong `client_id` → 400.                                                                                  |
| `POST /electron/token`                             | desktop (PR 3)   | Code + `code_verifier` + `state` → a NEW session; the bearer plugin returns the signed token in `set-auth-token`.                   |
| `GET /electron/init-oauth-proxy`                   | not used         | Fetches the API's own base URL from inside the Worker; the browser-driven flow does not need it.                                    |

The client id and the scheme are shared constants in `@kaipu/domain/constants` (`desktop-auth.ts`),
so the server, the web and the desktop cannot drift apart.

## Security properties

- **PKCE S256.** The code is bound to the challenge; `/electron/token` recomputes S256 of the
  verifier, which never leaves the app. A scheme-hijacking app that receives the link cannot use it.
- **Single use, 300 s.** The code is consumed before any check runs, so a wrong verifier or state
  also destroys it, and the real app has to start again.
- **State** must match what the app sent.
- **`client_id`** is a public identifier, not a secret; a request with another id mints nothing.
- **Trusted origin `kaipu:/`.** The Electron client sends `Origin: kaipu:/`. Better Auth 1.7
  matches a host-bearing pattern against the host exactly, so the bare-scheme pattern is required; a
  pattern such as `kaipu://app` would not match. `kaipu-record://app` stays for the current in-app
  form and can be removed once every supported desktop build signs in through the browser (after
  PR 3 ships and old builds are past the [version gate](./version-gate)).
- **Bearer token.** `requireSignature: true` is unchanged: the desktop keeps the signed value from
  `set-auth-token`, never the raw session token from the JSON body.

All of the above is pinned by `apps/server-hono/src/lib/desktop-auth.flow.test.ts`, which runs the
whole exchange on an in-process Better Auth instance (memory adapter, no network).

## The paste-code fallback

When the `kaipu://` link cannot open the app — the browser prompt was dismissed, or it is an
unpackaged dev build (macOS routes custom schemes only to packaged apps) — the done page shows the
code and a **Copy code** button; the person pastes it in the app.

**What is copied is the cookie value, not the 32-character code.** The desktop's
`authenticate({ token })` base64url-decodes its input into `{ identifier, state }` and looks up the
verifier by that state; the bare code would fail to decode. The done page reads the cookie before
`ensureElectronRedirect()` deletes it, so the value is still there for the fallback.

Device-code flow (RFC 8628) is not in v1.

## Reserved, not implemented

- `kaipu://billing/refresh` — reserved for the billing ticket: the web would open it after a
  purchase so the app refreshes its entitlements. Nothing handles it yet.

## Not verified yet

- A real browser on a deployed domain: the cookie passing through the web proxy (domain stripped)
  and being readable by the done page.
- The deep link opening the packaged app (needs PR 3).
- Google sign-in through this flow (button not on the branch yet; no QA against the owner's account).
