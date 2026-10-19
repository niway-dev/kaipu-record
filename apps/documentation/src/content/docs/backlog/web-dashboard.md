---
title: "Web dashboard — the signed-in hub"
description: "The /dashboard hub on the web (NIW2-470): home, profile, settings and recordings, where every sign-in lands, and how / decides whether to redirect."
---

# Web dashboard

> **Status: 🟢 Ready to validate (2026-10-19), not yet reviewed on a deploy.**
> Linear: NIW2-470. Epic: NIW2-213. Stacked on the account page ([web-account-page](./web-account-page), PR #274).

## Pages

`/dashboard` is the signed-in hub, under the `_authenticated` layout, with a sub-navigation for four pages:

| Path                    | Content                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/dashboard`            | Welcome (name, or the email's local part), unverified-email notice, plan and storage summary, Get started. |
| `/dashboard/profile`    | Profile and Sign-in methods (from the account page).                                                       |
| `/dashboard/settings`   | Plan and storage (full), language, Danger zone. The profile/settings split is an assumption to confirm.    |
| `/dashboard/recordings` | The legacy recordings table, moved unchanged. The online library is NIW2-221.                              |

`/account` and `/recordings` redirect to `/dashboard/profile` and `/dashboard/recordings`, so old links work.

## Where sign-in lands

One helper decides: `resolvePostSignInPath(search)` in `apps/web-hono/src/lib/post-sign-in.ts` is
`safeRedirectPath(search.redirect) ?? DEFAULT_SIGNED_IN_PATH` (`/dashboard`). The sign-in and sign-up
forms and the `/auth/login` and `/auth/signup` guards use it. NIW2-219 (Google) must import the same
helper for `callbackURL` and `newUserCallbackURL`.

## `/` redirect

`/` redirects to `/dashboard` only on a document request that carries a Better Auth session cookie
(`better-auth.session_token`, with or without `__Secure-`) **and** whose session is valid. The check is
a server function called from the route's `beforeLoad` on the server only:

- No cookie (crawlers, new visitors): no session lookup, the landing renders as before.
- Cookie but invalid session, or the lookup fails: the landing renders. No loop, no forced login.
- In-app navigation to `/` (the header logo, sign-out) is never redirected.

## First visit, download, OS detection

- "Your account is ready" shows once per user per browser: `localStorage` key
  `kaipu.dashboard-welcome-seen.<userId>`, every access in try/catch. If storage is blocked, the
  welcome is simply not shown (it never repeats on every visit).
- Get started links the desktop installers from `lib/download.ts` and features the visitor's OS
  (`navigator.userAgentData`, then the user agent). Unknown OS shows all links equally.

## Known gaps

- No recent-recordings block until the library exists (NIW2-221).
- The Google button (NIW2-219) is not part of this change.
- The first-visit flag is per browser, not per account (no server field in v1).
