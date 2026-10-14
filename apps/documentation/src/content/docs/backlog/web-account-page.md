---
title: "Web account page — profile, sign-in methods, plan and storage"
description: "The authenticated /account page on the web (NIW2-220): what is built, what is held back behind a flag, and how to try it without a backend."
---

# Web account page

> **Status: 🟢 Ready to validate (2026-10-11), not yet reviewed on a deploy.**
> Spec (the contract): [NIW2-220 approved spec](../specs/2026-10-11-niw2-220-web-account-page).
> Linear: NIW2-220. Epic: NIW2-213. Server-side deletion: NIW2-214 / PR #268.

## What is on the page

`/account`, under the `_authenticated` layout, linked from the user menu. A signed-out visitor goes to
`/auth/login?redirect=/account` and comes back after signing in (the `redirect` value must be a
same-origin path).

1. **Profile:** name (editable, 1–80 characters), email, verification badge. If the email is not
   verified, the page says cloud is locked, offers "Resend verification email" with a 2-minute
   cooldown that survives a reload (`localStorage`, per user), and a "Refresh" once a mail was sent.
2. **Sign-in methods:** the methods from `listAccounts`, and Change password (current, new, confirm;
   other sessions are revoked). There is an empty slot for the Google controls that NIW2-219 adds.
3. **Plan and storage:** the desktop capacity card's states, from `GET /me/entitlements` and
   `GET /me/storage`. A failed request never renders as `0 B`; a failed refetch keeps the last numbers
   marked "Not up to date". Over quota shows a warning and a clamped bar; from 90% committed, a passive
   "Almost full" notice.
4. **Danger zone:** delete the account (7-day grace), behind a flag.

The capacity view (`toCapacityView`, `barSegments`, over-quota and 90% rules) and the decimal byte
formatter now live in `@kaipu/domain` (`./capacity`, `formatBytesDecimal`), and desktop imports them
from there. The web page only swaps the decimal separator for the locale (`1,3 GB` in Spanish).

## Account deletion is behind a port and a flag

The server (soft delete, restore, purge sweep, cron) is NIW2-214 / PR #268. The page talks to an
`AccountDeletionClient` (`apps/web-hono/src/lib/account-deletion.ts`):

| Flag                            | Default | Effect                                                                      |
| ------------------------------- | ------- | --------------------------------------------------------------------------- |
| `VITE_ACCOUNT_DELETION_ENABLED` | `false` | `false`: the Danger zone shows a disabled "Coming soon" button.             |
| `VITE_ACCOUNT_USE_MOCKS`        | `false` | `true`: the in-memory `mockAccountDeletionClient` replaces the HTTP client. |

The HTTP client calls the routes #268 documents (`GET`/`POST /api/v1/me/account-deletion`,
`POST …/restore`). Those routes are not on `main` yet, so keep the flag off until #268 lands and the
response shapes are checked against it.

## How to try it without a backend

Mocks only; nothing here touches a database, R2 bucket, secret store or deployed API.

1. Run the web app with `VITE_ACCOUNT_DELETION_ENABLED=true VITE_ACCOUNT_USE_MOCKS=true`.
2. The deletion flow works end to end against the mock (password: `correct-password`): open
   Danger zone, type the email, delete, see "Deletion scheduled for …", press Restore.
3. The session, storage and sign-in methods still come from the real API the dev server points at, so
   a signed-in session is needed to see `/account`. Component tests cover every state with mocked clients.

## Open follow-ups

- Wire the HTTP deletion client to PR #268 once merged; check the POST/GET response shapes and that
  Restore works from the post-request session (the request revokes every session).
- NIW2-232 (plan table in `@kaipu/domain`) is not on `main`: the page shows the server's capacity and
  plan name and hard-codes no sizes.
- Google connect/disconnect and "set a password" (NIW2-219) plug into `SignInMethodsSection`'s slot.
