---
title: Desktop — sign-in and sign-up pages
description: Status tracker for moving the desktop sign-in / sign-up form out of Settings into full-window pages, with Settings keeping only the entry buttons and the signed-in state.
---

# Desktop — sign-in and sign-up pages

> **Status: 🟡 In progress (2026-09-09).** Implemented on `feat/desktop-auth-pages`, PR open.
> Flip to 🟢 on merge; drop the row once a real sign-in / sign-up / sign-out cycle has been run
> against the production server from a packaged build.

## What changed

- **Settings → Account** no longer holds the form. Signed out it shows two buttons, "Sign in" and
  "Create account", that open the new pages and tell them to come back to `/settings`. Signed in
  (email + Sign out) and the offline `unknown` state (last email + Retry) are unchanged.
- **`#/sign-in` and `#/sign-up`** are full-window pages without the sidebar: Kaipu mark, title,
  the form, a link to switch between the two, and a Back button. On `signed-in` (from the form, a
  broadcast, or landing there while already signed in) the page returns to the route that opened
  it, Settings by default.
- **`AppRoot`** is a new root layout route that owns everything that must survive on every route:
  the IPC listeners for hotkeys and the Capture Panel, the recording-finished navigation, the
  version gate and the update banner. `AppShell` keeps only the sidebar, the content outlet and the
  status bar. The auth pages are siblings of the shell under `AppRoot`, so a hotkey or a finishing
  recording still works while the user is on them.
- **i18n:** the desktop pages reuse the `auth` namespace the web app already had; the form copy
  and error messages moved there from `settings`.

## Where the detail lives

- **Design:** [/specs/2026-09-02-desktop-authentication-design](/specs/2026-09-02-desktop-authentication-design)
  — the auth architecture (bearer token in main, IPC contract, states); see the dated change note
  at the top for this relocation.
- **Code:** `pages/auth/auth-page.tsx`, `features/auth/auth-form.tsx`, `features/auth/account-panel.tsx`,
  `shell/app-root.tsx`, `app/router.tsx`.

## Not in scope

- The sidebar footer avatar still does nothing. Candidate: open `/sign-in` when signed out and
  `/settings` when signed in.
- Google sign-in and password reset remain out, as in the original spec.
