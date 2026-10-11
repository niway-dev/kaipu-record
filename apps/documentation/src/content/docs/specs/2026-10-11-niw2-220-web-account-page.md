---
title: "NIW2-220: Web account page — approved spec"
description: Authenticated /account page (profile, sign-in methods, plan and storage, danger zone) with mocked data only; server deletion stays in NIW2-214.
---

# NIW2-220: Web account page (profile, sign-in methods, plan and storage, danger zone)

> Approved spec, committed **before** implementation (ADR-0010). The full original text, with every open question, is the Linear issue: https://linear.app/niway/issue/NIW2-220. This file is the contract. Where they disagree, **this file wins**.
> Path: `apps/documentation/src/content/docs/specs/2026-10-11-niw2-220-web-account-page.md` · Approved: 2026-10-10 (decisions), 2026-10-11 (mocked-data rule) · Epic: NIW2-213

## Problem

The web app has no account page; the header menu only shows the email and Sign out. A signed-in user can't see:

- whether their email is verified (and therefore why cloud is locked);
- which sign-in methods the account has;
- their plan and storage.

They also can't ask to delete the account.

## Goal

An authenticated `/account` page with four sections:

1. **Profile:** name, email, verification badge, resend verification.
2. **Sign-in methods:** list the methods and change the password.
3. **Plan and storage:** the same states and numbers as the desktop capacity card.
4. **Danger zone:** request account deletion, as a 7-day soft delete.

## Scope of this ticket

**In:**

- Route `apps/web-hono/src/routes/_authenticated/account/index.tsx`, and an "Account" item in `components/user-menu.tsx` above Sign out.
- **Profile:**
  - edit the name with `authClient.updateUser` (trimmed, 1–80 characters);
  - verification badge;
  - "Resend verification" with a 2-minute cooldown that survives a reload (`localStorage`, keyed by user id);
  - a "Refresh" button after a successful resend.
- **Sign-in methods:**
  - list from `authClient.listAccounts()`;
  - "Change password" (current + new + confirm, `revokeOtherSessions: true`) for accounts that have a password.
  - The Google connect/disconnect and the "set a password" form belong to **NIW2-219**. Leave a slot in the section and hide it until NIW2-219 ships.
- **Plan and storage:**
  - Read `orpc.me.entitlements` and `orpc.me.storage`.
  - Map them to the 8 `CapacityView` states: loading, usage, beta-unavailable, suspended, not-available (404), session-expired (401), error (5xx/timeout), stale.
  - Never show zeros for a failed request.
  - Show the exact server numbers in decimal units; label reserved bytes "in progress".
  - Over quota: a warning, `available = 0`, and the bar clamped at 100%.
  - At 90% or more, a passive "Almost full" notice.
  - Plan names and sizes come from the `@kaipu/domain` plan table (NIW2-232). Never hard-code 250 MB or 15 GB.
- **Shared capacity view:**
  - Move `capacity-view.ts`, `barSegments` and the desktop byte formatter (`formatBytesDecimal`) into `@kaipu/domain`; desktop imports them from there.
  - No change in behaviour.
- **Danger zone:**
  - A dialog that lists what will be deleted and says local files are kept.
  - The confirm button stays disabled until the user types the email exactly; accounts with a password also enter it.
  - It calls the **account-deletion port** described below. Success shows "Deletion scheduled for {date}" with Restore.
- es/en copy in the `account` namespace, plus the route-slice rule in `lib/i18n/route-messages.ts` and its test.
- `redirect` search param on the `_authenticated` login redirect (same-origin paths only), honoured by `sign-in-form.tsx`.

**Out of scope (owned elsewhere — do not implement):**

- The server-side account deletion, the soft-delete grace period, the purge hook, `scheduled.ts` and the **wrangler cron trigger**. They belong to **NIW2-214 / PR #268**. Don't touch `wrangler.jsonc`, `infra-auth` hooks, or that PR.
- Google provider config, linking and set-password (NIW2-215 / NIW2-219).
- Billing, email change, 2FA/passkeys, session list, data export, per-kind usage breakdown.

## Account-deletion port (how the UI talks to deletion without the server work)

- Define `AccountDeletionClient` in `apps/web-hono/src/lib/account-deletion.ts` with three methods: `requestDeletion({ password? })`, `getDeletionStatus()` and `cancelDeletion()`.
- Ship two implementations:
  - **`httpAccountDeletionClient`** calls the routes PR #268 exposes. If those routes aren't on `main` when you build, keep this implementation behind the flag below and don't guess undocumented endpoints.
  - **`mockAccountDeletionClient`** is in-memory and used by tests and by local dev.
- Add the flag `VITE_ACCOUNT_DELETION_ENABLED` (default `false`). While it is false, the Danger zone renders a disabled button reading "Coming soon". This keeps the PR mergeable before #268 lands.

## Testing rule: mocked data only (Cristian, 2026-10-11)

**No test or QA step in this ticket touches a real database, R2 bucket, Infisical, Neon branch or deployed API. That includes dev.**

- Unit tests:
  - `capacity-view`: all 8 states, over-quota, clamping, the 90% notice;
  - byte formatter;
  - the route-slice rule;
  - the cooldown helper.
- Component tests (testing-library, already in `apps/web-hono`) use a **mocked oRPC client** and a **mocked `authClient`** with fixtures. Put the fixtures in `apps/web-hono/src/test/fixtures/account.ts`, with one per CapacityView state plus an over-quota one, and cover:
  - the storage section in every state (error never shows zeros; stale keeps the numbers);
  - Change password with the right and wrong current password;
  - the delete dialog: confirm is disabled until the email matches; it calls `mockAccountDeletionClient.requestDeletion`; the success banner appears.
- If an integration-style test is wanted, use the repo's fakes (`packages/application/src/cloud/fakes.ts`) or an in-memory store. **Never** `DATABASE_URL`, `scripts/with-env.sh` or `pull-env.sh`.
- Local manual QA (in the PR's "How to try it"): `bun run dev` for web with `VITE_ACCOUNT_DELETION_ENABLED=true` and a mock flag `VITE_ACCOUNT_USE_MOCKS=true` that swaps in the mocked clients. No backend is needed.

## Acceptance criteria

- [ ] `/account` redirects to login when signed out and comes back after sign-in (`redirect` param). The user menu links to it.
- [ ] Profile: a name edit persists (mocked) and invalidates the session query. The resend cooldown is 2 minutes and survives a reload. An error is visible on failure.
- [ ] Sign-in methods match `listAccounts`. Change password handles a wrong current password with a field error.
- [ ] Storage shows exact numbers per state. None of the failure states shows `0 B`. Over quota and the 90% notice render as specified.
- [ ] The Danger zone is disabled behind the flag. With the flag and mocks, the full request → scheduled banner → Restore flow works.
- [ ] Desktop still passes its capacity-card tests after moving `capacity-view` and the formatter to `@kaipu/domain`.
- [ ] es/en parity test passes. `bun run check-types`, lint and tests pass for web-hono, domain and kaipu-record.
- [ ] `git grep -nE "DATABASE_URL|with-env|pull-env" -- apps/web-hono/src` shows nothing new.

## Approved decisions

1. **Deletion:** soft delete with a 7-day grace period. Confirm with email + password, or a fresh session (< 10 min) for Google-only accounts. **The server side is NIW2-214 / #268**; this ticket only builds the UI and the port.
2. **Google-only account:** confirms with a fresh session. That flow becomes active when NIW2-219 ships.
3. **Set password:** owned by NIW2-219. This ticket only does Change password.
4. **Change password:** `revokeOtherSessions: true`, with no checkbox.
5. **Deletion with uploads or shares:** allowed. Show the counts in the dialog when the API provides them; the mock includes them.
6. **Capacity:** server numbers only. Plan values come from the NIW2-232 domain plan table.
7. **Q7–Q12:**
   - totals only, no per-kind breakdown;
   - desktop byte formatter in `@kaipu/domain`;
   - Google row hidden when Google isn't configured;
   - `redirect` param, same-origin only;
   - name editable, email not;
   - stuck purges only logged (server side, not here).
8. **Mocked data only** for every test and QA step (Cristian, 2026-10-11).
9. **Land: human.** The issue carries `needs-human-merge`. Open the PR and leave it for Cristian; never auto-merge.
10. **No deploy configuration:** no `wrangler.jsonc`, no secrets, no `db:push`.

## Size

Medium. One PR is fine. If it gets large, split in two: (a) move the shared capacity view into domain, (b) the `/account` page, stacked.

## Change log

| Date       | Change                                                                                            | Approved by                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 2026-10-10 | Decisions Q1–Q12 (Linear comment)                                                                 | Cristian                                                                         |
| 2026-10-11 | Server deletion stays in NIW2-214/#268; UI behind a port and a flag; mocked data only; land human | Cristian ("¿puedes hacer una base de datos mocked? para que no peligre el test") |
