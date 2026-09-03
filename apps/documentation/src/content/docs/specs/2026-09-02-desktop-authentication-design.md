---
title: Desktop authentication — design spec
description: Email/password sign-in and sign-up for the Kaipu desktop app, using Better Auth's bearer plugin from the main process — no cookie jar, no R2 CORS, no blocking gate on the local-first product.
---

# Desktop authentication — design spec

**Goal:** let a user sign in (or sign up) to their Kaipu account from the desktop app, so a later
feature (cloud recordings upload) has a session to act on. Desktop stays fully usable, offline,
with zero account required — signing in is opt-in, never a gate.

**Status:** design approved (brainstorming), implemented, and manually verified against a real
local `server-hono` (`wrangler dev`) on 2026-09-02 (Task 12 of the implementation plan) — every
scenario in the Testing plan's manual section passed, including sign-up/sign-out/sign-in/restart
restore, a corrupted token file, and the offline `unknown`-state check with reconnect recovery. Two
real bugs surfaced only by that live verification, and one UX rough edge exposed by real network
latency, all fixed before sign-off:

1. The origin/CSRF assumption below was wrong — sign-up/sign-in failed outright until fixed (see
   the **Correction** in "Server-side change").
2. `AccountPanel`'s form `mode` state never reset after a successful sign-in/sign-up, so a later
   sign-out re-rendered the stale, still-filled-in form instead of the closed "Sign in"/"Create
   account" buttons.
3. Against a real network round-trip, `AccountPanel` briefly rendered the signed-out buttons for an
   already-signed-in user before the initial `getAuthStatus()` call resolved — invisible with the
   mocked, near-instant promises the unit tests use. Fixed by gating that render on the hook's
   `pending` flag now also covering the initial load, not just later submit attempts.

All three fixes and their evidence are on the `feat/desktop-auth-12-manual-verification` branch
(stacked PR).

**Second correction (final whole-branch review, 2026-09-02):** a further review of the complete
stack, dispatched per the standard process, found the Error-handling table below also encoded a
wrong assumption — the same 401-only claim the origin/CSRF correction above already disproved in
spirit. `getSession`'s actual contract is corrected in the table row itself; see that row's note.
The review also found the IPC boundary silently discarded every structured `AuthError` (Electron
serializes a _thrown_ `ipcMain.handle` error down to its `.message` only), the shared `bearer()`
config exposed the session token to the web app's page JS via a proxied response header, and two
more gaps (no fetch timeouts; `lastKnownEmail` empty in the exact restart-while-offline case it
exists for). All fixed on `feat/desktop-auth-13-final-review-fixes` (stacked PR); see that
branch's PR body for the full list and verification evidence.

**Change (2026-09-09): the form moved out of Settings.** Sign-in and sign-up are now full-window
pages (`#/sign-in`, `#/sign-up`, `pages/auth/auth-page.tsx`) rendered outside the sidebar shell;
Settings → Account keeps the signed-in / `unknown` rows and, signed out, two buttons that open
those pages and return to Settings afterwards. The form itself is `features/auth/auth-form.tsx`;
`AccountPanel` no longer owns a `mode`. Everything below section 5 that says "form in Settings"
describes the original implementation; the states, the IPC contract and `useAuthStatus` are
unchanged. Tracker: [/backlog/desktop-auth-pages](/backlog/desktop-auth-pages).

**Tech stack:** Electron main process (Node `fetch`), `safeStorage` (new to this codebase), Better
Auth `bearer` plugin (new server-side addition), React (renderer, Settings page). No new backend
service, no database migration — reuses the existing `user`/`session` tables and the
`emailAndPassword` flow already live in `packages/infra-auth`.

---

## Scope

**In scope (v1):**

- Email/password **sign-in** and **sign-up** from Desktop.
- Session persisted encrypted-at-rest across app restarts, with a startup validity check.
- **Sign-out**, both local (clear stored token) and server-side (invalidate the session record).
- A **bearer** transport for Desktop→API requests (no cookie jar to build).
- One new server-side plugin (`bearer()`), added to the config shared by web and Desktop.

**Out of scope (separate backlog items, decided during brainstorming):**

- **Google Sign-In** — needs a system-browser handoff (Google disallows embedded webviews for
  OAuth), a registered custom protocol (`app.setAsDefaultProtocolClient`), single-instance/deep-link
  handling, a Google Cloud Console app, and a web-side "Sign in with Google" button — none of which
  exist today. Ships as its own item; the token storage/transport this spec builds (`bearer` +
  `safeStorage`) does not change when Google is added, only the "how do we obtain the first token"
  step gains a second path.
- **R2 bucket CORS** — moot for Desktop. **Note on provenance:** the backlog's own
  [Before integrating with Desktop](/backlog/cloud-recordings-upload#before-integrating-with-desktop)
  recommendation says to decide "upload from main vs. renderer" together with Desktop auth, since
  that single choice determines both the CORS policy and the auth/session surface. This
  brainstorming session decided **both** at once — the question posed and answered was "which
  process does login, API calls, **and the R2 PUT**" (main, for all three) — so the CORS-is-moot
  conclusion follows from a decision actually made here, not an assumption borrowed from the
  narrower auth-only scope of this spec. The R2 PUT/GET _implementation_ is still deferred to
  [R2 upload integrity](/backlog/r2-upload-integrity); only the **process** it will run in is
  locked in by this spec. If that workstream later overturns the main-process choice (e.g. for
  renderer-side upload-progress events), R2 CORS becomes blocking again and this note is stale —
  update both docs together.
- Password reset, email verification, "forgot password" — Desktop links out to the web app for
  these; no new UI here.
- The R2 upload itself (the [R2 upload integrity](/backlog/r2-upload-integrity) workstream) — this
  spec only gets Desktop a valid session and confirms the process it'll run in; not the upload
  code.

---

## Architecture

```
renderer (Settings → "Cuenta" section)        main process                       server-hono
──────────────────────────────────────   ─────────────────────────────    ─────────────────────
useAuthStatus() ──IPC: authGetStatus──►   authStore.getStatus()
  <AccountPanel/>                          ├─ no token → "signed-out"
signIn(email, pw) ──IPC: authSignIn───►   ├─ token present → authClient
signUp(...) ──IPC: authSignUp─────────►   │    .getSession(token)  ───────►  auth.api.getSession
signOut() ──IPC: authSignOut──────────►   │    (Authorization: Bearer)        (bearer plugin reads it)
onAuthStatusChanged ◄──IPC event──────    │
                                           authClient.signIn/signUp ────────►  POST /api/auth/sign-in/email
                                             reads `set-auth-token` response     POST /api/auth/sign-up/email
                                             header, NOT Set-Cookie              (bearer plugin sets it)
                                           authStore.setToken()
                                             safeStorage.encryptString()
                                             → write auth.enc (userData dir)
                                           broadcastAuthStatus() → every window
```

The renderer never holds the token. It sends credentials once per sign-in/sign-up call (same trust
level as settings already crossing IPC today) and otherwise only asks "what's my status" / "sign
me out". Every window shares the same preload bridge (per the existing multi-window setup), so
`authStatusChanged` broadcasts to all of them the same way `settingsChanged` already does — in
practice only the main window renders an account UI, but the broadcast costs nothing extra to keep
consistent with the settings pattern.

## Server-side change

One line in `packages/infra-auth/src/config/base-config.ts`:

```ts
import { bearer } from "better-auth/plugins";

export const baseConfig: BetterAuthOptions = {
  // ...unchanged...
  plugins: [bearer()],
};
```

Verified against the installed `better-auth@1.4.18` source (not assumed): the `bearer` plugin's
`before`/`after` hooks build a **fresh** `Headers` object rather than mutating an existing
`Request`'s immutable headers — it does not hit the Cloudflare Workers bug the (now-stale, to be
retired) [Better Auth Electron workaround](/stack/better-auth-electron-bug) doc describes for
`@better-auth/electron`. And `authMiddleware` (`apps/server-hono/src/middleware/auth.ts`) resolves
sessions via `auth.api.getSession({ headers })` — the same internal pipeline the plugin hooks into
— so a bearer token authenticates both `/api/auth/*` and the oRPC `/api/v1/recordings/*` routes
with no per-route changes.

**Correction (Task 12 manual verification against real `wrangler dev`, superseding the adversarial
review's "Verified" claim below):** the claim that Desktop needs no `trustedOrigins` entry was
**wrong** — the sign-up/sign-in calls failed with a real `403 MISSING_OR_NULL_ORIGIN` the first
time they ran against a live server. The review correctly read `validateOrigin`'s own
short-circuit (`if (!(forceValidate || useCookies)) return;`, in `origin-check.mjs`), but missed
that the sign-in/email and sign-up/email routes are _also_ gated by a second, independent
middleware in the same file — `formCsrfMiddleware` / `validateFormCsrf`, whose own doc comment
says it exists for exactly this: "CSRF protection using Fetch Metadata headers... for first-login
scenarios." It inspects `Sec-Fetch-Site`/`-Mode`/`-Dest`, and whenever ANY of those three headers
is present it calls `validateOrigin(ctx, forceValidate: true)` — bypassing the `useCookies`
short-circuit entirely. Electron's main-process `fetch()` (Chromium's network stack, not a
browser-page fetch) attaches these `Sec-Fetch-*` headers even outside a page context; confirmed
directly with `curl` against the local server — identical headers, no cookie, no Origin: 403
`MISSING_OR_NULL_ORIGIN`; same request with a matching `Origin` header: 200. (`get-session`, a
GET, and `sign-out`, a POST with no `Sec-Fetch-*` sensitivity in practice, were both confirmed
unaffected — only the two credential-submission routes need this.)

**Fix implemented in Task 12:** `apps/server-hono/src/lib/auth.ts`'s `trustedOrigins` gains one
literal entry, `"kaipu-record://app"` — not a real navigable scheme, just Desktop's request
identity for this check, mirroring the existing mobile pattern (`exp://`, `mobile://` in the same
file's `cors()` call, which never hit this because React Native's `fetch` doesn't send
`Sec-Fetch-*` headers). `apps/kaipu-record/src/main/services/auth-client.ts`'s
`callCredentialEndpoint` sends that same literal as an explicit `Origin` header on its two POST
calls. Confirmed Electron's main-process `fetch()` does let a caller set `Origin` explicitly (a
real browser page forbids scripts from doing so; this context does not).

<details>
<summary>Original (incorrect) claim, kept for the record</summary>

**Verified** (adversarial review, `better-auth/dist/api/middlewares/origin-check.mjs`,
`validateOrigin`): the check short-circuits with `if (!(forceValidate || useCookies)) return;` — it
only engages when the request carries cookies or the endpoint forces validation. Desktop's
main-process requests carry no `Origin` header and, until sign-in, no cookie either, so the check
never fires and `trustedOrigins`/`CORS_ORIGIN` needs no Desktop entry.

</details>

---

## Components

### 1. Shared types — `src/shared/types/auth.ts`

Pure (no `electron`/`node` imports), mirrors the existing `ipc.ts` convention.

```ts
export type AuthStatus =
  | { kind: "signed-out" }
  | { kind: "signed-in"; email: string; name: string }
  /** A token is stored but its last verification attempt couldn't reach the server (offline,
   *  timeout) — distinct from `signed-out` so a network blip never silently drops the session. */
  | { kind: "unknown"; lastKnownEmail?: string };

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface SignUpInput extends AuthCredentials {
  name: string;
}

/** What a failed sign-in/sign-up/session-check reports to the renderer. */
export type AuthError =
  | { kind: "invalid-credentials" }
  | { kind: "email-taken" }
  | { kind: "network" }
  | { kind: "unknown"; message: string };
```

### 2. Server client — `src/main/services/auth-client.ts`

No Electron imports (unit-testable with a mocked `global.fetch`, same approach as
`fetchVersionGateConfig`). Owns exactly the HTTP shape, not storage or IPC.

```ts
export interface AuthClientConfig {
  serverUrl: string; // MAIN_VITE_SERVER_URL
}

export interface SignInResult {
  token: string; // from the `set-auth-token` response header
  email: string;
  name: string;
}

/** POST /api/auth/sign-in/email. Reads `set-auth-token`, never touches Set-Cookie. */
export function signInWithPassword(
  config: AuthClientConfig,
  credentials: AuthCredentials,
): Promise<SignInResult>; // throws AuthError-shaped errors

/** POST /api/auth/sign-up/email. Same response shape as sign-in (Better Auth logs the new user in). */
export function signUpWithPassword(
  config: AuthClientConfig,
  input: SignUpInput,
): Promise<SignInResult>;

/**
 * GET /api/auth/get-session with `Authorization: Bearer <token>`.
 *
 * Resolves `null` ONLY on a 401 (the server explicitly said the session is gone — safe to treat
 * as signed-out). Any other failure (network error, timeout, non-401 error status) REJECTS
 * instead — the caller must not conflate "server said no" with "couldn't ask the server," or an
 * offline status check would delete a still-valid token. See Error handling.
 */
export function getSession(
  config: AuthClientConfig,
  token: string,
): Promise<{ email: string; name: string } | null>;

/** POST /api/auth/sign-out with `Authorization: Bearer <token>`. Best-effort — a network failure
 *  here must not block clearing the local token (see Error handling). */
export function signOutRemote(config: AuthClientConfig, token: string): Promise<void>;
```

### 3. Local store — `src/main/infrastructure/auth-store.ts`

Electron-specific (mirrors `settings-store.ts`'s shape: in-memory cache + disk + IPC
registration), but the disk artifact is an **encrypted blob**, not JSON.

- Path: `join(app.getPath("userData"), "auth.enc")`.
- Write: `safeStorage.encryptString(token)` → raw bytes to disk (same atomic temp-file +
  `renameSync` pattern as `settings-store.ts`, so a crash mid-write can't corrupt it).
- Read: `safeStorage.decryptString(bytes)`, wrapped in try/catch — it **throws**, not returns
  falsy, on ciphertext it can't decrypt (corrupted file, copied to another machine, app re-signed
  with a different code-signing identity). Same crash-safety discipline as `settings-store.ts`'s
  own `load()` (`apps/kaipu-record/src/main/infrastructure/settings-store.ts:47-53`), which this
  file must not regress on: any decrypt failure → treat as no token, never an uncaught exception —
  this runs synchronously during `app.whenReady()`, so an unguarded throw would risk failing app
  startup. If `safeStorage.isEncryptionAvailable()` is `false` (rare — no OS keychain backend),
  **fail closed** the same way: treat as signed-out, do not fall back to plaintext. Log once; do
  not persist a token that couldn't be encrypted.
- In-memory cache: `token: string | null`, mirrors settings' cache-on-load pattern.
- `registerAuth(config: AuthClientConfig)` — the single entry point (called from `main/index.ts`
  next to `registerSettings()`):
  - On call: load the token from disk if present.
  - `ipcMain.handle(IPC_CHANNELS.authGetStatus)` — if no token, `{ kind: "signed-out" }`; else
    `authClient.getSession(token)`: a **null** result (confirmed dead — a `401`, or, in practice
    far more often, a `200` response with a `null` body; see the Error-handling table's
    correction) clears the stored token and returns `signed-out`; a **hit** caches
    `{ email, name }` in memory for the process
    lifetime (avoids a round-trip on every status check) and returns `signed-in`; a **rejection**
    (network/other failure) does **not** touch the stored token — return the last-known cached
    status if one exists in memory, else a distinct `{ kind: "unknown" }` `AuthStatus` variant the
    renderer shows as "couldn't verify, still using your last session" rather than signed-out.
  - `ipcMain.handle(IPC_CHANNELS.authSignIn, credentials)` /
    `ipcMain.handle(IPC_CHANNELS.authSignUp, input)` — call `authClient`, store the returned
    token encrypted, cache `{ email, name }`, broadcast the new status.
  - `ipcMain.handle(IPC_CHANNELS.authSignOut)` — clear the in-memory + on-disk token
    immediately, fire-and-forget `authClient.signOutRemote(token)` (see Error handling), broadcast
    `signed-out`.
  - `broadcastAuthStatus()` — sends `IPC_CHANNELS.authStatusChanged` to every open `BrowserWindow`,
    same helper shape as `settings-store.ts`'s `broadcastSettings()`.

### 4. IPC + preload

- `IPC_CHANNELS` additions (`src/shared/types/ipc.ts`): `authGetStatus`, `authSignIn`,
  `authSignUp`, `authSignOut`, `authStatusChanged` (event).
- **Sender validation on `authSignIn`/`authSignUp`/`authSignOut`.** Every `BrowserWindow` shares
  the identical preload bridge, so without a check, a compromised or buggy renderer in _any_
  window — not just the main one — could sign in with attacker-supplied credentials, swap the
  active account, or force a sign-out. Guard these three handlers the same way
  `main/index.ts:279` and `:324-327` already guard other privileged channels: reject unless
  `event.sender === mainWindow?.webContents` (only the main window renders an account UI, so this
  costs nothing functionally). `authGetStatus` and `authStatusChanged` stay unrestricted — they're
  read-only.
- This is a **partial** mitigation, not full remediation — this codebase's `BrowserWindow`s run
  `sandbox: false` today (`main/index.ts:97`), which is the actual scope of
  [Electron security hardening](/backlog/electron-security-hardening) (status: blocking Desktop
  cloud-recordings integration). That workstream is broader than this spec and not a hard
  prerequisite for it — the sender check above is a concrete, cheap mitigation this spec commits
  to regardless of when the fuller sandboxing work lands — but ship them close together, not with
  a long gap where sender-validated-but-unsandboxed is the resting state.
- `KaipuElectronAPI` additions (`src/shared/types/electron-api.ts`) +
  `src/preload/index.ts` implementation:

```ts
getAuthStatus(): Promise<AuthStatus>;
signIn(credentials: AuthCredentials): Promise<AuthStatus>; // rejects with AuthError on failure
signUp(input: SignUpInput): Promise<AuthStatus>;
signOut(): Promise<void>;
onAuthStatusChanged(callback: (status: AuthStatus) => void): () => void; // unsubscribe fn
```

### 5. Renderer — `src/renderer/src/features/auth/`

Follows the existing feature-module convention (`features/onboarding`, `features/permissions`,
`features/watermark`) — imported directly into `settings-page.tsx`, no `pages/settings/`
wrapper file needed.

- `use-auth-status.ts` — `useAuthStatus()`: calls `getAuthStatus()` on mount, subscribes to
  `onAuthStatusChanged`, exposes `{ status, signIn, signUp, signOut, pending, error }` (`pending`
  covers the in-flight request; `error` is the last `AuthError`, cleared on the next attempt).
- `account-panel.tsx` — renders one of four states (**as of 2026-09-09 the "form open" state is
  gone: the buttons open the full-window auth pages instead — see the change note at the top**):
  - `signed-out` + no form open → "Iniciar sesión" / "Crear cuenta" buttons.
  - a form open → email/password (+ name for sign-up) fields, using the existing `Card`/`Row`/
    `Button` primitives (same as every other Settings section) — no new form library; this is two
    fields and a submit, matching the codebase's existing preference for hand-rolled controlled
    inputs over a form library for small forms.
  - `signed-in` → shows the email, a "Cerrar sesión" button.
  - `unknown` → shows `lastKnownEmail` (if present) with a small "no se pudo verificar la sesión"
    note and a manual retry action, instead of demanding re-login for what may be a network blip.
  - Errors render inline under the form via `t(...)` copy keyed by `AuthError.kind` (i18n, matches
    every other Settings string).
- Composed into `settings-page.tsx` as a new `<Section title={t("account")}><AccountPanel /></Section>`,
  positioned first (account state is the most likely thing a returning user checks) or last — pick
  during implementation; not architecturally significant.

---

## Data flow

**Sign-in:**

1. User submits the form → `AccountPanel` calls `signIn({ email, password })`.
2. Preload → `ipcMain.handle(authSignIn)` → `authClient.signInWithPassword(...)`.
3. `POST /api/auth/sign-in/email`. On 200: read the `set-auth-token` response header (not
   `Set-Cookie`) for the session token, and the response body for `{ email, name }`.
4. `authStore` encrypts + persists the token, caches `{ email, name }` in memory, broadcasts
   `signed-in` to every window.
5. `AccountPanel` re-renders from the broadcast (or the resolved IPC promise — whichever arrives
   first; both carry the same `AuthStatus`).

**Startup restore:**

1. `registerAuth()` runs during `app.whenReady()`, loads the token from disk (if present) into
   memory. It does **not** eagerly call `getSession` — the first `authGetStatus` call (fired by
   `useAuthStatus()` on the Settings page mounting) triggers that check, so app startup isn't
   delayed by a network round-trip for a page the user might never open this session.
2. If the token turns out invalid/expired/revoked (a confirmed 401), `authGetStatus` clears it and
   returns `signed-out`. If the check simply couldn't reach the server, the token is **kept** and
   `authGetStatus` returns `unknown` instead — see Error handling.

**Sign-out:**

1. `AccountPanel` calls `signOut()`.
2. `authStore` clears the in-memory + on-disk token **immediately** and broadcasts `signed-out` —
   the UI reflects signed-out state without waiting on the network.
3. `authClient.signOutRemote(token)` fires after, best-effort (see Error handling).

---

## Error handling

| Situation                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong password / unknown email on sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                 | `AuthError: invalid-credentials`; local token untouched (there wasn't one)                                                                                                                                                                                                                                                                       |
| Email already registered on sign-up                                                                                                                                                                                                                                                                                                                                                                                                                                       | `AuthError: email-taken`                                                                                                                                                                                                                                                                                                                         |
| Network failure during sign-in/sign-up                                                                                                                                                                                                                                                                                                                                                                                                                                    | `AuthError: network`; nothing persisted                                                                                                                                                                                                                                                                                                          |
| `getSession` confirms the session is gone (expired or revoked elsewhere) — **correction, final whole-branch review**: better-auth's `/get-session` answers this with `200` + a JSON `null` body in the two realistic cases (no session cookie resolved; session found but expired), not `401` — verified directly against the installed `better-auth` route source. `401` only fires in one narrow concurrent-update-failure edge case. Both must be treated identically. | Clear the local token, return `signed-out` — no error surfaced, this is the expected "please sign in again" path, not a failure                                                                                                                                                                                                                  |
| `getSession` **rejects** (offline, timeout, non-401 error)                                                                                                                                                                                                                                                                                                                                                                                                                | The stored token is **left untouched** — this must never be treated as "invalid" or the app would silently sign a user out for a network blip while offline, contradicting the whole point of a local-first product. `authGetStatus` returns `unknown` (last-known email if cached, else none); the next successful check resolves it either way |
| `safeStorage.isEncryptionAvailable()` is `false`                                                                                                                                                                                                                                                                                                                                                                                                                          | Sign-in/sign-up fails with a clear `AuthError` rather than silently storing plaintext or silently not persisting                                                                                                                                                                                                                                 |
| Stored token fails to decrypt (corrupted file, copied to another machine, app re-signed with a different identity — `safeStorage.decryptString` throws rather than returning falsy)                                                                                                                                                                                                                                                                                       | Caught explicitly, same as `settings-store.ts`'s crash-safety pattern for its own JSON parse — treated as no token (signed-out), never an uncaught exception. This check runs synchronously during `app.whenReady()`, so an unguarded throw here would risk failing app startup, not just this feature                                           |
| `signOutRemote` fails (offline, server down)                                                                                                                                                                                                                                                                                                                                                                                                                              | Local state is already `signed-out` (step 2 above ran first) — the orphaned server-side session simply expires on its own schedule. Never blocks or reverts the local sign-out; never retried on a timer for v1                                                                                                                                  |
| App killed between "token written" and "broadcast sent"                                                                                                                                                                                                                                                                                                                                                                                                                   | No inconsistency risk — the write is atomic (temp file + rename) and every window re-reads real status via `authGetStatus` on its own mount, so a missed broadcast self-heals on next read, not just on the window that missed it                                                                                                                |

**Central property:** the local sign-out button always works instantly and offline, and **a
network failure never signs an already-signed-in user out** — only an explicit 401 does. The only
place a network failure can strand the user is sign-in/sign-up itself (expected — you can't
authenticate without the network). This is the fix that came out of the design review: the first
draft of this spec conflated "server said the session is invalid" with "couldn't reach the
server" in `getSession`'s contract, which would have silently deleted a valid session on a
network blip — directly contradicting the "stays usable offline" goal at the top of this doc.

---

## Testing plan

Pure / logic (fully unit-testable, no Electron):

- `auth-client.ts` — mock `fetch`: 200 sign-in (token extracted from `set-auth-token`, not
  `Set-Cookie`), 200 sign-up, invalid-credentials (expected 4xx shape from Better Auth),
  email-taken, network throw, `getSession` 200 vs **401 → resolves `null`** vs **network/other
  failure → rejects** (these two must be observably different outcomes, not both `null` —
  the whole point of the fix from the design review), `signOutRemote` success and failure (must
  not throw in a way that blocks the caller — see Error handling).

`auth-store.ts` (Electron-adjacent — fake `safeStorage` / `authClient`, real `mkdtemp` filesystem):

- Round-trip encrypt/decrypt through the fakes.
- `isEncryptionAvailable() === false` → sign-in/sign-up rejects, nothing written.
- An encrypted token already on disk while `isEncryptionAvailable() === false` → fail closed as
  `signed-out`; do not attempt decryption or contact the server.
- A fake `safeStorage.decryptString` that **throws** (simulating a corrupted/foreign-machine blob)
  → treated as no token, `registerAuth()` does not throw, app startup is not blocked.
- `authGetStatus` with a stored-but-**confirmed-401** token clears it and returns `signed-out`.
- `authGetStatus` with a stored token whose `getSession` call **rejects** (network) leaves the
  token on disk untouched and returns `unknown`, not `signed-out`.
- `authSignOut` clears local state synchronously even when the fake `signOutRemote` rejects.
- Broadcast fires to every non-destroyed fake `BrowserWindow` on every state transition.
- `authSignIn`/`authSignUp`/`authSignOut` invoked from a fake `event.sender` that isn't the main
  window's `webContents` is rejected; `authGetStatus` from any sender succeeds.

Component (renderer):

- `AccountPanel` — renders each of the three states; submitting the sign-in form calls `signIn`
  with the entered values and shows the returned `AuthError` inline; submitting while `pending`
  is a no-op (button disabled); `unknown` exposes an explicit retry that rechecks the status.

Manual, against local `wrangler dev` server-hono (same pattern as the recordings end-to-end test
already run — `wrangler dev` runs on `workerd`, the real Workers runtime, so this does exercise
the same header/Request-immutability class of bug the bearer-plugin choice was made to avoid, even
though it isn't the deployed production Worker):

- Sign up a new Desktop account → sign out → sign in again → restart the app (or re-invoke
  `registerAuth`) → confirm the session restores without re-entering credentials → sign out. **Run
  2026-09-02** as `apps/kaipu-record/e2e/auth.e2e.ts` (a permanent, self-skipping-when-no-server
  Playwright spec, not a one-off) against the real local server — passed, after the origin/CSRF and
  `mode`-reset fixes above.
- Confirm a stale/tampered/corrupted token on disk is treated as signed-out, not a crash. **Run
  2026-09-02**, same spec file — passed.
- Confirm going offline mid-session (kill network, reopen Settings) shows `unknown`, not
  `signed-out`, and the stored token survives, and that reconnecting + retrying recovers to
  signed-in. **Run 2026-09-02** — sign up while the server is up, kill the local `wrangler dev`
  process, relaunch the app (same `userData` dir): the Account section showed the `accountUnknown`
  note with no sign-in prompt. Restarted the server, clicked Retry: recovered to signed-in with no
  re-entered credentials. Passed. (One operational note for whoever repeats this: drive the
  kill/restart from a separate process than the one running the Electron/Playwright driver — the
  first attempt had the driver script kill the server itself via `child_process`, and the sandbox's
  process-group handling took the driver down along with it. Not an app bug, just a driver-hygiene
  gotcha; splitting the two processes fixed it.)

**Known gap vs. the backlog's acceptance bar:** [Desktop auth and R2
CORS](/backlog/desktop-auth-and-r2-cors) asks for these flows to be **integration-tested against a
production-equivalent Worker**, not exercised manually against local dev. This spec deliberately
ships with only the manual coverage above; closing the gap is [Production cloud
security](/backlog/production-cloud-security)'s job — extend its existing "production smoke test"
acceptance criterion (create → upload → confirm → download → delete against a disposable account)
to also cover sign-up → sign-in → restart-restore → sign-out, rather than duplicating a second
smoke-test mechanism here. Don't mark the parent [backend security
hardening](/backlog/backend-security-hardening) hub's release gate satisfied for this workstream
until that extension exists.

---

## File structure

- Create `src/shared/types/auth.ts`.
- Create `src/main/services/auth-client.ts` + `auth-client.test.ts`.
- Create `src/main/infrastructure/auth-store.ts` + `auth-store.test.ts`.
- Create `src/renderer/src/features/auth/use-auth-status.ts`, `account-panel.tsx` (+ `.module.css`),
  tests alongside each.
- Modify `src/shared/types/ipc.ts` (5 new channel entries).
- Modify `src/shared/types/electron-api.ts` (5 new method signatures).
- Modify `src/preload/index.ts` (implement the 5 methods).
- Modify `src/main/index.ts` (call `registerAuth({ serverUrl: import.meta.env.MAIN_VITE_SERVER_URL })`
  next to `registerSettings()`).
- Modify `src/renderer/src/pages/settings/settings-page.tsx` (new `<Section>`).
- Modify `.env.example` and `src/main/env.d.ts` — add and type `MAIN_VITE_SERVER_URL` (mirrors
  how `VITE_SERVER_URL` is documented in `web-hono`'s `.env.example`: must include the scheme,
  e.g. `http://localhost:3000`).
- Modify `packages/infra-auth/src/config/base-config.ts` — add the `bearer()` plugin.
- i18n: new `account`, `signIn`, `signUp`, `signOut`, and per-`AuthError.kind` copy keys in the
  `settings` namespace (`@kaipu/i18n`).

---

## Running locally

1. Configure the existing `apps/server-hono` environment and start the local Worker from the
   repository root with `bun run dev:server-hono`.
2. Copy `apps/kaipu-record/.env.example` to `apps/kaipu-record/.env` and set
   `MAIN_VITE_SERVER_URL=http://localhost:3000` (or the actual Worker URL, including its scheme).
3. In `apps/kaipu-record`, run `bun run build` and then `bun run dev`.
4. Exercise the Desktop flow under **Settings → Account**. Restart Desktop after changing
   `MAIN_VITE_SERVER_URL`; electron-vite reads it at process startup.

The implementation plan contains the focused test commands and full manual verification sequence.

---

## Follow-ups (not v1)

- **Google Sign-In** — its own spec: custom protocol registration, single-instance handling,
  system-browser handoff, Google Cloud Console app, web-side button.
- **R2 bucket CORS** — configure when a web-side direct-to-R2 feature actually needs it.
- **"Remember me" / multi-account** — out of scope; one signed-in account at a time, matches the
  web app's model today.
- **Session refresh UX polish** — e.g. proactively warning the user a few days before the ~7-day
  session expires, instead of only reacting to a 401. **Correction from the design review:** the
  real trigger for a stale session isn't the app being closed for 7+ days — `getSession`'s sliding
  refresh only fires when something actually calls it, and this spec's only caller is
  `useAuthStatus()` mounting on the Settings page. A user who signs in once and then never revisits
  Settings again (e.g. just keeps recording locally for weeks) never refreshes at all, and hits an
  unexpected 401 the first time a future feature (cloud upload) tries to use the stale token. Not
  fixed in v1, but the fix isn't "warn before expiry" — it's giving any future auth-gated action
  (not just the Settings page) a reason to call `getSession` opportunistically. Revisit when the
  upload feature lands, since that's the first real caller.
- Gating any cloud-recordings UI (upload button, "synced" badge) on `useAuthStatus()` — belongs to
  the upload-UI work itself, not this spec.
