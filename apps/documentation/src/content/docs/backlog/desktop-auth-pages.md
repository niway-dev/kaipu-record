---
title: Desktop — sign-in and sign-up pages
description: Status tracker for moving the desktop sign-in / sign-up form out of Settings into full-window pages, with Settings keeping only the entry buttons and the signed-in state.
---

# Desktop — sign-in and sign-up pages

> **Status: 🟡 In progress (2026-09-09).** Implemented on `feat/desktop-auth-pages`, PR open.
> Flip to 🟢 on merge; drop the row once a real sign-in / sign-up / sign-out cycle has been run
> against the production server from a packaged build.

## What changed

- **Settings → Account** no longer holds the form. Signed out it is a single row — "Your Kaipu
  account" / "You can record, edit, and export without an account." — with one "Sign in" button
  that opens the sign-in page and tells it to come back to `/settings`. Creating an account is
  reached from the sign-in page's switch link, not from Settings. Signed in (email + Sign out) and
  the offline `unknown` state (last email + Retry) are unchanged.
- **Copy is deliberately sober** (2026-09-09): the upload/share flow is not wired from the library
  in this checkout and there is no settings sync, so the row promises nothing. When sharing by link
  ships, the planned row is "Share your recordings with a link" / "Save your recordings to the cloud
  and send them without attachments.", and the strong create-account prompt should live at the
  "Share with link" action, where the intent is concrete, returning to that recording afterwards.
- **Form buttons name the action**: "Sign in" / "Create account", and "Signing in…" /
  "Creating account…" while the attempt is in flight (the shared `auth` keys, also used by the web
  app, moved to sentence case). The sign-up subtitle says an account is optional instead of
  repeating the title. Switching between sign-in and sign-up keeps the email and clears the
  password.
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
- Journey follow-ups from the 2026-09-09 copy review, not done yet: a "Minimum 8 characters" hint
  and show/hide toggle on the password field (and whether the name should be required at sign-up);
  an "already registered" error that links to sign-in; translating the raw server errors the web
  forms display; and the web library empty state, which implies desktop recordings sync
  automatically.
