---
title: "Web dashboard — the signed-in hub"
description: "The /dashboard hub on the web (NIW2-470): home, profile, settings and recordings, where every sign-in lands, and how / decides whether to redirect."
---

# Web dashboard

> **Status: 🟢 Ready to validate (2026-10-19), not yet reviewed on a deploy.**
> Linear: NIW2-470. Epic: NIW2-213. Stacked on the account page ([web-account-page](./web-account-page), PR #274).

## Pages

`/dashboard` is the signed-in hub, under the `_authenticated` layout. Its layout draws the frame
(see [Visual design](#visual-design)) around four pages:

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

## Visual design

> **Status: 🟡 In progress (2026-10-19).** Linear: NIW2-475. Design: `Kaipu Dashboard.dc.html` in
> the Claude Design project (prompt and decisions: NIW2-473, PR #338).

The dashboard draws with the landing's palette, like the sign-in pages (NIW2-474): the frame
renders inside `[data-kl]` with `data-kl-theme` from the landing's theme cookie, so dark or light
follows the visitor everywhere on kaipu.app. Styles are StyleX (ADR 0008) over typed references to
the `--kl-*` tokens in `components/dashboard/dashboard.stylex.ts`; nothing in the dashboard uses
Tailwind or `@kaipu/web-ui` any more.

- **Frame** (`components/dashboard/dashboard-shell.tsx`): a 240px sidebar on desktop (logo, Home,
  Recordings, Profile, Settings; Devices and Billing as muted "Soon" items; the user, theme, EN/ES
  and Sign out at the foot). Below 768px: a top bar and a four-item bottom tab bar with 44px
  targets; theme and Sign out move to the foot of Settings. The site header and legal footer are
  not shown on `/dashboard`.
- **Pieces** (`components/dashboard/ui.tsx`): button, tag, card, notice, page heading, field, glow
  box, coming-soon row, skeleton and a dialog that renders in place (bottom sheet on a phone).
- **Glow only for moments**: the first-visit welcome and the download card. Data cards, forms and
  the table stay flat.

Visual only, no data yet: "Recent in your library" on Home, Devices and Billing in the navigation.
They are drawn muted and are not clickable.

Differences from the design, on purpose:

- Kai's expressions in the design (`fox-wave`, `fox-capture`, `fox-error`, …) are not in
  `@kaipu/brand`, so the dashboard uses the brand's own marks by purpose (`done` on the first
  visit, `app` on the download card) and icons on the notices. The fox does not float: the brand
  page rules out constant animation on the website.
- The library target grid, the Devices page and the Billing page are not built: they need
  NIW2-221 and server work that does not exist.
- The "app signed in" row on Home is not built: the web cannot see the installed app.
- A scheduled account deletion is shown inside the Danger zone card rather than as a separate
  banner at the top of Settings.

## Known gaps

- No recent-recordings block until the library exists (NIW2-221); the design's Coming soon row
  stands in for it.
- In the light theme the first paint before the stylesheet is dark: the root document's critical
  style only knows the landing's and the auth pages' shells. Adding the dashboard there is a
  one-line follow-up once the sign-in redesign has merged.
- The Google button (NIW2-219) is not part of this change.
- The first-visit flag is per browser, not per account (no server field in v1).
