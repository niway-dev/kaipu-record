---
title: Web sign-in redesign ("Kaipu Web Auth")
description: The web sign-in and sign-up pages rebuilt from the "Kaipu Web Auth" design — one shared shell for every /auth route, Google first, verification by link, no account enumeration.
---

# Web sign-in redesign ("Kaipu Web Auth")

> **Status: 🟡 In progress** — implemented on `feature/web-auth-redesign`, PR open, not merged.
> Linear: [NIW2-474](https://linear.app/niway/issue/NIW2-474). Design: Claude Design project
> 71546ef1, file `Kaipu Web Auth.dc.html`.

## What it is

Every `/auth/*` page renders into one shell, `AuthShell`
(`apps/web-hono/src/components/auth/`): the brand panel on the left ("Show it." / "Get back to
work."), the 520px form column on the right, one column below 900px. The colours are the landing's
`--kl-*` tokens, so the pages follow the same dark/light cookie as the home; styles are StyleX
(ADR 0008), reading the tokens through `auth.stylex.ts`.

| Route                   | Design state                                                                    |
| ----------------------- | ------------------------------------------------------------------------------- |
| `/auth/login`           | Sign in · Email · Wrong credentials · Google closed                             |
| `/auth/signup`          | Sign up · Sign up with email · Check your email (in place, after sign-up)       |
| `/auth/forgot-password` | Reset (the reset is still a link by email)                                      |
| `/auth/reset-password`  | Choose a new password (from the emailed link)                                   |
| `/auth/email-verified`  | Where the verification link lands; offers a new link when it failed             |
| `/auth/desktop`         | "Kaipu Record for Mac is waiting" + the same tabs; "Continue as …" if signed in |
| `/auth/desktop/done`    | "You're signed in", Open Kaipu Record, then the copy-the-code fallback          |

## Decisions

- **Verification stays a link** (owner, 2026-10-19). Signing up with email signs the user in
  unverified; the link only unlocks Kaipu Cloud. So "Check your email" never blocks: the web shows
  "Go to your library", and a desktop sign-up goes straight to the done page (`check_email=1`
  adds the note there). The desktop app's "Resend verification email" keeps sending the same link.
- **No account enumeration** (owner). Wrong password and unknown email get one message, "Wrong
  email or password", plus "New to Kaipu? Create an account with this email", which opens the
  sign-up tab with the email carried in memory (never in the URL).
- **Tabs are links.** Each tab has its own URL and keeps `redirect` or the desktop query.
- **Kai comes from `@kaipu/brand`.** The design's raster foxes are replaced by the shipped marks:
  `app` on the brand panel, `permissions` on "Check your email", `done` on the done page.

## Open

- Copy to validate with the owner: the brand panel's three claims ("Share links that open
  anywhere", "Your library on every Mac and PC", "Files stay yours — MP4 and PNG").
- The "250 MB free" Cloud promotion block is gone from the forms (the design has the "account is
  optional" note instead).
- Screenshots: not captured; check both themes, mobile width and Spanish by hand.
