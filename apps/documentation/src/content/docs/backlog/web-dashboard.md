---
title: "Web dashboard — the signed-in home"
description: "The /dashboard hub on the web (NIW2-470): where every web sign-in lands, its four pages, and what is deliberately not there yet."
---

# Web dashboard

> **Status: 🟢 Ready to validate (2026-10-19), not yet reviewed on a deploy.**
> Linear: NIW2-470. Epic: NIW2-213. Stacked on the account page (NIW2-220 / PR #274), which it splits.

## Where sign-in lands

Email sign-in, email sign-up and (once NIW2-219 lands) Google sign-in all end on `/dashboard`, unless
the visitor came with a safe same-origin `redirect` search parameter, which wins. An unsafe one
(`https://evil.example`, `//host`, a backslash, control characters) is ignored.
`resolvePostSignInPath` in `apps/web-hono/src/lib/post-sign-in.ts` is the single place that decides,
and NIW2-219's Google button must call it for `callbackURL` and `newUserCallbackURL`.

- Signed out, `/dashboard` goes to `/auth/login?redirect=/dashboard`.
- Signed in, `/auth/login` and `/auth/signup` go to `/dashboard`.
- Signed in, `/` goes to `/dashboard`. With no session cookie, or a cookie whose session is invalid,
  the landing renders as before (no API call without a cookie, no redirect loop, no forced login), so
  crawlers and first-time visitors see the marketing page.

## The four pages

`/dashboard` is a hub with its own sub-navigation. The header has one "Dashboard" item.

| Page                    | What it shows                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`            | Greeting and email, a first-visit welcome, the verification notice (resend with the 2-minute cooldown), a compact plan and storage summary, and a "Get started" download block. |
| `/dashboard/profile`    | Profile and Sign-in methods (the first half of the old `/account`).                                                                                                             |
| `/dashboard/settings`   | Plan and storage, language, and the Danger zone (the second half of the old `/account`).                                                                                        |
| `/dashboard/recordings` | The legacy recordings table, unchanged.                                                                                                                                         |

`/account` redirects to `/dashboard/profile` and `/recordings` to `/dashboard/recordings`, so old
links and bookmarks keep working. The profile/settings split is an assumption to confirm in review.

## Decisions worth knowing

- **No recent-recordings block on the home.** The library is NIW2-221 and does not exist yet, so
  "Get started" shows for every user until it does.
- **First visit.** "Your account is ready" plus the plan, shown once per browser and user. "Seen" is a
  `localStorage` key (`kaipu.dashboard-welcome-seen.<userId>`), wrapped in try/catch; with storage
  blocked the welcome never shows. No server field in v1.
- **Downloads.** The visitor's OS (`navigator.userAgentData`, then the user agent) picks the primary
  button; the other installers are plain links. Phones, Linux and unknown browsers get only the list.
- **One capacity view.** The home summary is `StorageView` with `compact`, so loading, error, stale,
  suspended, beta-unavailable, not-available and session-expired read the same as on the settings
  page, and a failed request never shows zeros.
- **Shared verification notice.** `VerificationNotice` is used by the profile page and the home, so
  the resend cooldown is one piece of state per browser.

## Not in this change

Google sign-in (NIW2-215, NIW2-219), the online library (NIW2-221), analytics, sharing stats,
notifications and desktop changes. When NIW2-221 lands, `/dashboard/recordings` moves to
`/api/v1/assets` on its own.

## How to try it

Local web against the dev API, or `VITE_ACCOUNT_USE_MOCKS=true` for the account pages without a
backend. Sign in with email and check that you end on `/dashboard`; open
`/auth/login?redirect=https://evil.example` and confirm it still ends there; open `/account` and
`/recordings` and confirm both redirect; stop the API and reload to see the storage error with Retry.
