---
title: Optional cloud — upload, catalog and share links (epic)
description: Status tracker for the optional cloud epic — one library entry per video with Local / Cloud / Local and cloud locations, server-enforced quotas, manual and automatic upload, and share links.
---

# Optional cloud — upload, catalog and share links

> **Status: 🟡 In progress.** Plan 02 (desktop identity + combined library) is merged. Plan 01
> (server) is in progress on `feat/cloud-01-server-quotas`: the founder's decisions are recorded
> (Task 0, with five values still open as proposals) and both real-R2 spikes passed (Task 1/1b);
> Tasks 2–13 are not implemented yet. Cloud Free depends on email verification, which the server
> does not send yet.
> Effort: High (six phases).

## Where the detail lives

- **Product:** [Optional cloud — product, quotas and file safety](/specs/2026-09-09-cloud-product/)
- **Data model:** [Cloud — identity, revisions and the relationship with .kaipu](/specs/2026-09-09-cloud-data-model/)
- **Design brief:** [Claude Design — cloud, sharing and video locations](/specs/2026-09-09-cloud-design-handoff/)
- **Umbrella plan (phases + acceptance):** [Plan — optional cloud and share links](/plans/2026-09-09-cloud-delivery/)
- **Detailed plans:**
  - [Cloud 01 — server quotas, revisions and immutable tickets](/plans/2026-09-09-cloud-01-server-quotas-and-revisions/)
  - [Cloud 02 — local identity and the combined library](/plans/2026-09-09-cloud-02-local-identity-and-combined-library/)

## What plans 01 and 02 deliver together

- Server: `cloud_asset` / `cloud_revision` model, atomic quota reservation, idempotent upload
  intents, presigned tickets bound to length + type + sha256 + no-overwrite, verified confirm,
  scheduled sweep, account purge, beta allowlist and global upload switch. The legacy
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
