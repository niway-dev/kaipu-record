---
title: Optional cloud — upload, catalog and share links (epic)
description: Status tracker for the optional cloud epic — one library entry per video with Local / Cloud / Local and cloud locations, server-enforced quotas, manual and automatic upload, and share links.
---

# Optional cloud — upload, catalog and share links

> **Status: 🟡 In progress.** _(Refreshed 2026-10-09 against `origin/main`, NIW2-214.)_ Plan 02
> (desktop identity + combined library) is merged (#90). Plan 01 (server): Tasks 0–9 merged (#92,
> via #96) and Task 10 merged (#97) — `/api/v1/assets*` and `/api/v1/me/storage` are served.
> Task 11 (cron sweep, account purge, `cloud:uploads` command) and Task 13 (operations docs, WAF
> runbook, CI, migration baseline) are delivered by NIW2-214; Task 12 (removing the legacy
> recording vertical) moved to NIW2-221. Verification emails are sent (transactional email, #107);
> production delivery is not yet proven. Entitlements v2 (250 MB trial + approval) is not on
> `main`: today every verified email gets 1 GB. The desktop does not upload or download yet —
> that is phase 3, planned in [Cloud 03 — manual transfers](/plans/2026-10-09-cloud-03-manual-transfers/)
> (awaiting approval).
> Effort: High (six phases).

## Where the detail lives

- **Handoff (state, carried rulings, how to resume on another machine):** [Optional cloud — handoff](/backlog/optional-cloud-handoff/)

- **Product:** [Optional cloud — product, quotas and file safety](/specs/2026-09-09-cloud-product/)
- **Data model:** [Cloud — identity, revisions and the relationship with .kaipu](/specs/2026-09-09-cloud-data-model/)
- **Design brief:** [Claude Design — cloud, sharing and video locations](/specs/2026-09-09-cloud-design-handoff/)
- **Umbrella plan (phases + acceptance):** [Plan — optional cloud and share links](/plans/2026-09-09-cloud-delivery/)
- **Detailed plans:**
  - [Cloud 01 — server quotas, revisions and immutable tickets](/plans/2026-09-09-cloud-01-server-quotas-and-revisions/)
  - [Cloud 02 — local identity and the combined library](/plans/2026-09-09-cloud-02-local-identity-and-combined-library/)
  - [Cloud 03 — manual transfers](/plans/2026-10-09-cloud-03-manual-transfers/) (proposed)

## What plans 01 and 02 deliver together

- Server: `cloud_asset` / `cloud_revision` model, atomic quota reservation, idempotent upload
  intents, presigned tickets bound to length + type + sha256 + no-overwrite, verified confirm,
  scheduled sweep, account purge, and a global upload switch (no beta allowlist: a verified
  email is the access rule, plan 01 decision #8). The legacy
  `recording` vertical is replaced.
- Desktop: stable `assetId` in sidecars (additive), export provenance, lazy content hash, the
  editing-state probe, the "remove local download" operation with its safety policy, a
  per-account cloud catalog cache, and one library entry per asset with the labels Local,
  Cloud, Local and cloud, Local location unavailable.

Not yet: transfers (upload/download queue, upload mode setting, cloud thumbnails) — plan 03;
share links and the delete dialogs — plan 04; automatic upload — plan 05; link update — plan 06.

## Upgrade notes

- A desktop session stored before this change has no `userId` and is treated as absent —
  the account it belonged to is forced to sign in again once the app updates.

## Related backlog items this epic absorbs

[R2 upload integrity](./r2-upload-integrity) · [Cloud data lifecycle](./cloud-data-lifecycle) ·
[API abuse controls](./api-abuse-controls) · [Desktop ↔ cloud sync gap](./desktop-cloud-sync-gap) ·
[Desktop auth and R2 CORS](./desktop-auth-and-r2-cors) · [Production cloud security](./production-cloud-security).
Their statuses change only when the corresponding plan task ships with evidence.
