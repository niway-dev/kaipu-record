---
title: Desktop sign-in through the browser — design
description: The desktop app opens kaipu.app in the system browser to sign in or sign up, and the browser hands a single-use PKCE-bound code back through a kaipu:// link. Built on Better Auth's official Electron plugin after an upgrade to 1.7.x, keeping the desktop's bearer token store.
---

# Desktop sign-in through the browser — design

**Status: 🟡 In progress · 2026-10-19.** Decisions approved by Cristian in chat on 2026-10-19;
implementation dispatched in three stacked PRs. Nothing below is on `main` yet. ADR:
[0025](/architecture/decisions/0025-desktop-signs-in-through-the-browser/). Linear: NIW2-471
(parent NIW2-213). Amends the [desktop authentication spec](/specs/2026-09-02-desktop-authentication-design/).

## Summary (one minute)

The desktop stops asking for a password. "Sign in" opens `kaipu.app/auth/desktop` in the default
browser; the person signs in there with email or Google (or continues with the session the
browser already has), confirms that this computer may sign in, and the browser opens
`kaipu://auth/callback` with a code. The app exchanges the code, with the PKCE verifier and state
only it holds, for a new session of its own, and stores it exactly where it stores the bearer
token today. If the link does not open the app, the page shows the code to paste. Better Auth is
upgraded from 1.4.18 to 1.7.x first, so the flow is the official `@better-auth/electron` plugin
rather than security code of our own.

| #   | Decision                                                                           | Why                                                                               | ADR        |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------- |
| 1   | No password field in the desktop; sign-in and sign-up on kaipu.app                 | Google forbids embedded OAuth (RFC 8252 §8.12); payments will live on the web too | 0025 (new) |
| 2   | Return via `kaipu://auth/callback` with a 300 s single-use code, PKCE S256 + state | The OAuth-for-native-apps pattern; a stolen code is useless without the verifier  | 0025 (new) |
| 3   | Upgrade Better Auth to 1.7.x and use `@better-auth/electron`                       | Maintained implementation of decision 2 instead of our own                        | 0025 (new) |
| 4   | Keep `auth.enc` + bearer as the only session store                                 | Existing API callers and existing sessions keep working unchanged                 | 0025 (new) |
| 5   | Paste-code fallback, also the development path                                     | Blocked schemes; macOS routes custom schemes only to packaged apps                | 0025 (new) |
| 6   | Scheme `kaipu`, trusted origin `kaipu:/`                                           | Readable; PKCE covers interception                                                | 0025 (new) |
| 7   | Signed-in browser → "Continue as …" / "Switch account"                             | No second sign-in when the browser already has a session                          | —          |
| 8   | One session per device, native Better Auth session rows                            | User agent and IP are already stored; `listSessions` / `revokeSession` exist      | —          |
| 9   | `kaipu://billing/refresh` reserved, not built                                      | The billing work only needs the app to refresh                                    | 0025 (new) |

## Open questions

- The plugin's manual `authenticate({ token })` expects the base64url value of the
  `better-auth.electron` cookie, while its docs describe a 32-character code. The web page must
  show the value the app accepts; PR 2 verifies which one.
- Whether the server can drop the old `kaipu-record://app` trusted origin once no desktop build
  in use still sends it (it depends on how many users update).

## Out of scope

Billing and `kaipu://billing/refresh` handling; a "your devices" page; device-code sign-in;
universal links; Linux; Google sign-in itself (NIW2-219); Google QA against the owner's account.

## Failures this must protect against

- A code used twice, after 300 s, with a wrong verifier, a wrong state or a wrong `client_id` is
  rejected.
- Another app that registers `kaipu://` and receives the link cannot exchange the code.
- A sign-in page opened without `client_id`, `state` and `code_challenge` explains itself instead
  of signing the browser in and stopping.
- The app launched cold by the link (not running) still completes the sign-in; macOS `open-url`
  and Windows `second-instance` / argv both work; there is one single-instance lock.
- A desktop signed in before this change stays signed in after updating.
- Signing out on the desktop ends only the desktop's session, not the browser's.
- The renderer never receives the session token.
- If safe storage is unavailable, the app does not write the token in plain text.

## Flow

```
desktop main                     browser (kaipu.app)                        API (Better Auth)
────────────                     ───────────────────                        ─────────────────
requestAuth():
  verifier, state (S256)
  open /auth/desktop?client_id&state&code_challenge ──►
                                 signed in?  ── yes ─► "Continue as X" ─► POST /electron/transfer-user
                                             └─ no ──► sign-in (email / Google) with the query
                                                       forwarded ─────────────► hooks store challenge,
                                                                                issue code (300 s)
                                 /auth/desktop/done: ensureElectronRedirect()
◄── kaipu://auth/callback#token=… (or the person pastes the code)
POST /electron/token {code, code_verifier, state} ──────────────────────────► new session,
                                                                                set-auth-token (signed)
commit signed token → auth.enc (safeStorage) → every API call: Authorization: Bearer
```

## Work split (Linear NIW2-471)

1. **Upgrade** `better-auth` 1.4.18 → 1.7.x across the monorepo with no behaviour change
   (`feature/niw2-471-better-auth-1-7`). No new columns on `user`, `session`, `account` or
   `verification` going straight to 1.7.11.
2. **Server + web** (`feature/niw2-471-electron-server-web`): `electron()` on the API, `kaipu:/`
   in `trustedOrigins`, `/auth/desktop` and `/auth/desktop/done` on the web, an in-process test
   of the whole exchange.
3. **Desktop** (`feature/niw2-471-desktop-browser-sign-in`): protocol registration (electron-builder
   `protocols`), the plugin's main and preload setup merged with the existing single-instance
   lock, the token committed through the existing auth store, the new sign-in screens, removal of
   the password IPC, a main-process variable for the web origin.

## Environment

The desktop gains a main-process variable for the web origin, beside `MAIN_VITE_SERVER_URL`:
`http://localhost:3001` in development, `https://kaipu.app` in production. PR 3 names it and lists
where it must be set (Infisical and the GitHub `production` environment). No new Google
credentials: the desktop never talks to Google, the web does.

## Sources

- RFC 8252, OAuth 2.0 for Native Apps: §7.1 private-use schemes, §7.3 loopback, §8.1 PKCE,
  §8.9 state, §8.12 embedded user agents — https://www.rfc-editor.org/rfc/rfc8252
- Better Auth Electron integration — https://better-auth.com/docs/integrations/electron
- `@better-auth/electron` 1.7.11 and `better-auth` 1.4.18 / 1.7.11, read from the published
  packages on 2026-10-19 (code length, expiry, single use, S256, storage interface, `setupMain`
  behaviour, trusted-origin matching).
- Electron, launching an app from a URL — https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app
- Prior art: invisible-assistant ADR 0051 (same flow, designed, not built).
