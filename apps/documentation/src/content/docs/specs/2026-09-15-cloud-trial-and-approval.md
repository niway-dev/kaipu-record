---
title: "Cloud trial and manual beta expansion"
description: "Accepted decisions on email verification, the 250 MB trial and owner-approved expansion to 1 GB."
---

# Cloud trial and manual beta expansion

Decision session: 2026-09-15. **Product decisions accepted; runtime implementation pending.**
This document supersedes the initial automatic 1 GB offer for new verified
accounts in the earlier Cloud proposal. It does not change deployed quotas.

## Decision 2 — no provisional manual verification

Do not implement a temporary `plan verify` command or a manual email-verification
button. Establish email ownership through the real email flow. Granting a plan
or approving more storage must not mark an email as verified.

The accepted email flow uses Resend and the Niway sender convention, with the
Rakoi infra-email pattern. Verification links last 24 hours and complete on web;
desktop refreshes verification state on return. Password recovery starts on web
from desktop, uses a one-use link valid for one hour, and invalidates existing
sessions on successful reset. Resends are user-requested with throttling.
These flows remain to be implemented.

## Decision 3 — trial and owner-approved expansion

- A verified account receives **250 MB total** (250,000,000 decimal bytes).
- Recordings and screenshots share the quota. Show their consumption separately;
  do not create independent video/image quotas.
- Requesting expansion is an explicit user action, not a side effect of signup.
- The owner personally approves each expansion to **1 GB total**
  (1,000,000,000 bytes), not 1 GB in addition to the trial.
- There is no automatic approval for the first N accounts.
- A pending request keeps the existing 250 MB trial; it does not block otherwise
  eligible uploads within that capacity.
- Email verification proves ownership; beta approval changes capacity. Do not
  make approval a prerequisite for all Cloud uploads.
- Local recording, editing and exporting remain usable without an account.

### Request and access state

Keep the request lifecycle separate from the effective Cloud access lifecycle:

| Field               | Values                                    | Meaning                                                     |
| ------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `requestStatus`     | `none`, `pending`, `approved`, `rejected` | What happened to the user's request for the beta expansion. |
| `cloudAccessStatus` | `trial`, `approved`, `revoked`, `banned`  | What the account may use right now.                         |

`banned` is an administrative safety block, not a rejected request. It prevents
Cloud use regardless of a previous approval. Do not add a persistent `reviewing`
state for the first version; record the review instead with `reviewedAt`,
`reviewedBy` and an optional `reviewReason`.

Access-state semantics (accepted 2026-09-15):

- **Revoking a plan grant** (for example Pro) is not an access-state change: the
  account falls back to whatever `cloudAccessStatus` grants — 1 GB if
  `approved`, 250 MB if `trial`.
- **`revoked`** means Cloud is removed entirely: no capacity, uploads blocked.
  It can be restored by an operator. To merely undo a beta expansion, transition
  `approved → trial` instead of using `revoked`.
- **`banned`** also means no Cloud at all, and additionally blocks reapplication
  and restoration until an operator lifts the ban.

A rejected request may be submitted again after a cooldown to prevent request
spam: store `canReapplyAt` on rejection (default **30 days** after the review)
and refuse earlier resubmissions server-side. Console may shorten or clear the
cooldown for a specific account.

### Effective capacity resolution

Exactly one application-layer function resolves an account's effective capacity;
no other layer computes quotas. Precedence, first match wins:

1. `cloudAccessStatus` is `banned` or `revoked` → **0** (Cloud blocked).
2. A non-expired per-user `quotaBytesOverride` → the override value.
3. A non-expired `unlimited` or `pro` plan → the plan capacity setting.
4. `cloudAccessStatus` is `approved` → `betaCapacityBytes`.
5. Otherwise (`trial`) → `trialCapacityBytes`.

Even with `unlimited`, per-file size limits and pending-upload limits still
apply; they protect the system, not the plan.

The first notification is intentionally small: send one transactional email when
an owner approves the expansion. Show rejection, revocation and ban in Console
and the app without adding separate email templates yet. Reuse the shared Niway
sender and email package when the approval email is implemented.

### Reduced-quota behavior for now

Do not implement the full data-export flow yet; record it as a future need. If a
quota is reduced below an account's current usage, restrict new uploads while
preserving existing files and their download/delete actions. The global Cloud
control flag can pause new Cloud operations at any time; this is an operational
switch, separate from per-account deletion policy.

Over-quota data follows the published Terms rather than an indefinite grace: the
account is notified, and content above the effective capacity may be deleted
**60 days after the notice** if the user does not resolve it (delete files or
regain capacity). The owner chose to apply the Terms as written — unused
over-quota data is not kept forever. Deletion requires the notice to have been
sent; it is never triggered silently by the quota change itself.

Remote video preview requires an explicit download. After the download is
verified locally, the item may be marked **ready to delete from Cloud** so the
user can recover quota. Download completion must never delete the Cloud copy
automatically. A future export should be resumable and should not depend on a
single fragile network transfer.

## Copy prepared in this change

The shared es/en messages now describe the 250 MB trial and manually approved
expansion. Account settings, signup and the Cloud promotion consume these keys.
The Cloud offer paragraph uses the same quantities and conditions.

Release this copy together with the real verification, trial quota and request/
approval flow. The backend currently still derives 1 GB for Free verified
accounts; this documentation/copy change alone is **not ready for deployment**.

Future request-state copy, to wire when those states exist:

| State               | Spanish                                                       | English                                                  |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| Eligible to request | Solicitar ampliación a 1 GB                                   | Request an increase to 1 GB                              |
| Pending             | Tu solicitud está pendiente. Puedes seguir usando tus 250 MB. | Your request is pending. You can keep using your 250 MB. |
| Approved            | Ya tienes 1 GB total en Kaipu Cloud.                          | You now have 1 GB total in Kaipu Cloud.                  |

## Remaining administration design

Owner-only manual approval is accepted. The owner chose a separate TanStack Start
app, **Kaipu Console**, following the existing monorepo template. See the
[Console specification](./2026-09-15-kaipu-console). The initial implementation
lists users and their current plan/storage state; request approval remains a
follow-up until request persistence and the trial capacity model exist.
Do not implement public self-approval or manual email verification.

Reapplication after rejection is defined above (30-day cooldown via
`canReapplyAt`). Existing-account migration remains open: preserve existing
accounts' capacity until a transition is defined; do not silently reduce them to
the trial quota.
The trial has no newly agreed expiration period in this session.

## Decision status

Decisions 1–4 and 6 are closed at the product level (implementation pending).
Decision 5 (referrals) is deferred. Unlimited, grant expiry, overrides,
capacity resolution and reduced-quota behavior are all recorded in this
document; treat it as the source of truth over earlier drafts.

## Decision 5 — referral idea deferred

Referral rewards are a future idea, explicitly deferred from the beta. Do not
build referral links, attribution records, review fields or reward automation in
the current implementation. If revisited, the intended simple direction is
manual review rather than automatic rewards.

The possible future review flow would record attribution from a referral link and
whether the referred account has verified its email and completed a first Cloud
upload. Kaipu Console would show those signals; it would not grant Pro
automatically.

The owner decides case by case whether to grant the referred user (and/or the
referrer) a standard three-month `pro` grant. Social sharing claims may be
self-reported and reviewed manually; they are not treated as machine-verified
events. Account registration through a referral link is observable attribution,
not proof that the user deserves a reward. A first-upload flag is evidence for
review, not an automatic trigger.

If this idea returns, keep the minimum record needed to review and audit the
decision: referral code, referrer, referred account, attribution timestamp,
email-verified timestamp if available, first-upload timestamp if available,
reviewer, decision, reason and grant reference. Anti-abuse checks and automatic
reward thresholds remain future design work.

## Decision 6 — local-first diagnostics

Kaipu keeps the local-first boundary while using Cloud to improve reliability:

- **Local logs:** always available on the device. They are the primary source for
  debugging and can be exported by the user.
- **Service telemetry:** server-side auth, upload, download and API error events
  remain enabled as operational records. They contain no file content, titles,
  paths, secrets or credentials.
- **Product analytics:** opt-in and disabled unless the user enables it.
- **Desktop diagnostics:** anonymous crash and technical error reports are
  enabled by default with a clear notice and an opt-out switch. They include only
  sanitized stack traces, error codes, app version, OS/architecture, operation
  state and an installation identifier.

The diagnostic sanitizer must remove emails, local paths, filenames, titles,
content, prompts, tokens, authorization headers and form values before enqueueing
or sending. If a user opts out, no remote desktop diagnostics are sent; local
logs and manual export remain available, and server-side service events continue.
Support remains available at `contacto@niway.dev`.

This follows the useful parts of Obsidian's local-only troubleshooting model and
OpenCode's explicit local logs/redaction workflow while taking advantage of
Kaipu's own Cloud for reliability signals. It is a product decision, not an
approval to send raw logs or a promise that every client failure will be visible.

Use **PostHog EU** for the optional analytics and desktop diagnostic streams,
with the Kaipu Worker proxying ingestion at `/ingest`. The privacy policy must
name PostHog, the EU processing region and the separate analytics/diagnostics
controls. Do not send directly from the renderer when the main process can own
the queue and redaction boundary.

## Decision 4 — Pro capacity

The paid/future Pro entitlement is **15 GB total** (15,000,000,000 decimal
bytes). The current 25 GB implementation is historical and must be updated when
this plan is implemented. Add an explicit **`unlimited` plan** for the owner's
operator account; do not make the admin role bypass storage checks.

Keep the capacity in one configurable entitlement setting/variable rather than
scattering `15 GB` literals through domain rules, database code, API responses
and clients. The setting must be validated as an integer byte value and shared
by every reader so an operator can change the quota without a code redesign or
an inconsistent UI.

### Temporary Pro grants

Promotional and operator-granted Pro uses the same `pro` plan as paid Pro. Each
grant has a required `currentPeriodEnd` — the only exception is the owner's
`unlimited` plan, which has no expiry; the account returns to its normal
entitlements when that date passes. Store the grant reason separately, such as
`referral`, `early_access` or `support`; do not create plan names like
`founder-pro`. Expiry is evaluated when entitlements are read, so a cron is not
required to downgrade the plan.

Migrate the existing `grantManualPlan`/`revokeManualPlan` use cases to this
model: `currentPeriodEnd` and `reason` become required for `pro` grants, and the
operations move behind Kaipu Console. The `bun run plan` CLI script is retired
once Console covers granting and revoking; the owner explicitly prefers Console
over command-line operator scripts.

The Kaipu Console may also set a per-user quota override for exceptional support
cases. An override records the byte value, operator, reason and optional expiry;
it changes effective capacity without inventing another plan name. It is an
operator-only escape hatch, not a client-editable preference, and must be included
in the audit trail.

Global trial, beta and Pro capacities are runtime settings stored in a dedicated
database configuration record, editable only from Kaipu Console. The record
stores validated integer byte values plus `updatedBy` and `updatedAt`. Entitlement
reads use this record rather than hardcoded plan capacities, so an operator can
change quotas without a deployment.

Fallback (accepted): the domain package defines default constants —
`trialCapacityBytes = 250 MB`, `betaCapacityBytes = 1 GB`,
`proCapacityBytes = 15 GB` — and the database record, when present and valid,
overrides them. A missing or invalid record never leaves the system without
quotas; it silently falls back to the domain defaults. The implementation still
chooses the read/cache strategy for the record.

## Implementation references

- [Initial Cloud product proposal](./2026-09-09-cloud-product)
- [Optional Cloud delivery status](../backlog/optional-cloud)
- [Plan/auth separation](../architecture/decisions/0002-plan-entitlements-separate-from-auth)
- [Niway sender convention](https://github.com/csdev19/general-knowledge/blob/main/infra/transactional-email.md)
- [Email package playbook](https://github.com/csdev19/general-knowledge/blob/main/packages/transactional-email-playbook.md)
