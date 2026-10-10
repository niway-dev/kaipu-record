---
title: Plan — optional cloud and share links
description: Phased implementation with quota, security, editing, and design gates.
---

# Implementation plan

Date: 2026-09-09. Status: proposed plan, without application changes or deployment. Contracts: [product](/specs/2026-09-09-cloud-product/), [data](/specs/2026-09-09-cloud-data-model/), [design](/specs/2026-09-09-cloud-design-handoff/).

Detailed, task-by-task plans (written 2026-09-10, table refreshed 2026-10-09 against `origin/main`; execute from these, not from the phase summaries below):

| Phase                              | Plan                                                                                                                  | Status                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1 — server                         | [Cloud 01 — server quotas, revisions and immutable tickets](/plans/2026-09-09-cloud-01-server-quotas-and-revisions/)  | 🟡 In progress — Tasks 0–10 merged (#92/#96, #97); 11 and 13 in NIW2-214; 12 moved to NIW2-221 |
| 2 — local identity                 | [Cloud 02 — local identity and the combined library](/plans/2026-09-09-cloud-02-local-identity-and-combined-library/) | ✅ Merged (#90)                                                                                |
| 3 — manual upload and download     | [Cloud 03 — manual transfers](/plans/2026-10-09-cloud-03-manual-transfers/) (NIW2-214)                                | 🔵 Proposed — awaiting the founder's approval                                                  |
| 4 — links and independent deletion | not written yet                                                                                                       | —                                                                                              |
| 5 — automatic upload               | not written yet                                                                                                       | —                                                                                              |
| 6 — explicit link updates          | not written yet                                                                                                       | —                                                                                              |

## Phase 0 — finalize contracts and design

- Review the design brief and produce clearly separated MVP and future screens/states.
- Set the policy for 1 GB free, 25 GB future capacity, 1 GB/video, proposed 25 MB/screenshot, and decimal units. Choose the global beta limit, pending uploads per account, rate limits, and ticket/read TTLs through testing; do not leave these values undefined at deployment.
- Test actual write-time byte limits against real R2, not just post-upload checks. Verify overwrite protection, integrity, Range, and player formats.
- Confirm editing dependency semantics and conservative restrictions on removing local sources.

Output: reviewable API contracts, schema, and prototype. Do not open the beta while integrity and quota gates remain unresolved.

## Phase 1 — server with economic limits

Current entry points: `packages/domain/src/schemas/recording.ts`, the storage port, `packages/application/src/recordings/`, `packages/infra-storage/src/r2-storage.ts`, repositories in `packages/infra-db`, and recordings/me routers in `apps/server-hono`.

Implement quota and transactional reservations, idempotency, verifiable revisions and metadata, immutable/restricted tickets, and coordinated cancellation/expiration. Extend entitlements with capacity and cloud permissions; the backend enforces them even with a modified client. Include beta access and a global ticket switch.

Add scheduled cleanup, reconcilable accounting, deletion tombstones, and account deletion. Separate capacity for confirmed and temporary data. Telemetry without signed URLs or secrets: used/reserved bytes, failures, old pending uploads, quota rejections, and cleanup failures.

Acceptance tests: two requests competing for the last bytes cannot exceed quota; lying about size cannot bypass limits; reusing a ticket cannot replace a ready object; repeated confirmation cannot duplicate usage; repeated cancellation/deletion cannot produce negative usage; failed cleanup cannot release fictitious quota. Also measure cases where the client never confirms.

## Phase 2 — local identity and combined library

Migrate sidecars additively; preserve existing filenames/media/sessions. Introduce a library model that allows an absent local path, a paginated remote catalog, and account-specific cache. Separate location, transfer, comparison, and editing. Add export-to-source relationships.

Current entry points: `main/library/library-vault.ts`, `video-edit-session.ts`, `shared/types/library-storage.ts`, IPC, and library hooks/components. Replace generic deletion in disk-space recovery paths with a dedicated operation that preserves metadata and resources.

Acceptance: media with both copies appears once; cloud-only media remains visible without a local file; account B cannot see account A's catalog; a disconnected disk does not delete associations; a legacy vault retains its sessions; a new export remains a distinct related result; changing folders does not reassociate files by name.

## Phase 3 — manual upload, download, and MVP settings

Persistent queue in the main process to survive navigation and restart; the renderer only observes and requests operations. Authenticate/validate IPC and paths; do not give R2 credentials to the renderer. Bounded retries with backoff, safe cancellation, and idempotent recovery after restart. If resumable multipart uploads are not implemented, explain that retrying restarts the transfer rather than pretending to resume from the last byte.

Implement Local only and Manual upload, quota indicators, library/detail views, and the transfers panel. Download through a temporary file, validation, atomic rename, and editor opening. Do not offer automatic mode as functional before it is implemented.

Acceptance: the local file survives every upload failure; failed downloads are not presented as local; destination conflicts do not overwrite files; incompatible sessions are not applied to renders; insufficient disk space or expired sessions provide explicit recovery; cancellation does not leave permanent billable duplicates.

## Phase 4 — links and independent deletion

Add a sharing entity with an unpredictable, revocable token, a public endpoint separate from owner access, and a player. Keep the bucket private; never publish the user's prefix. Limit abuse in link creation/resolution. Define read TTL and effective revocation semantics.

Implement deletion dialogs based on actual evidence, Remove local download only when eligible, durable exclusion from automatic upload after cloud deletion, and storage management. The first release shares a fixed revision; updating an existing link belongs to phase 6.

Acceptance: another owner cannot list/download/delete; a valid link exposes only the authorized revision; revocation preserves files; deleting cloud preserves local and breaks the link; removing a download preserves cloud/link; deleting the last copy requires an unambiguous warning; clipboard failure does not show Copied. Validate public reads and Range against real R2 and clean up all test objects.

## Phase 5 — automatic upload

Listen for successful recording/screenshot/export finalization, never watch temporary files. Consent is per account/device, with manual mode as default. No retroactive uploads, automatic publishing, or resurrection of deleted cloud copies. Respect mode changes, sessions, budget, and server exclusions before issuing each ticket.

Add 50/75/90% notices, pending-task grouping, and a resumption policy after network/quota recovery. Tasks that do not fit remain local and do not block every smaller task that fits; keep order/state understandable and avoid continuous polling.

Acceptance: creating an account uploads nothing; enabling automatic mode does not upload the existing library; finalizing a file creates exactly one intent; cloud deletion on device A does not trigger automatic reupload from B; switching accounts does not execute another account's queue; quota rejections do not interrupt recording.

## Phase 6 — explicit link updates

Associate the selected export with the published revision. Reserve replacement capacity without removing the active revision, verify it, atomically switch the link target, and clean up the unreferenced previous version. Conflicts between devices require explicit intervention.

Acceptance: failure at any step preserves the previous link; no local edits are overwritten and no draft is published; insufficient temporary space is explained before sending; update retries do not accumulate orphaned revisions.

## Verification and beta gate

Focused domain/application tests for invariants; DB integration for concurrency; main-process tests for filesystem/queues; UI tests for states and actions; an Electron journey covering upload → share → remove download → download → edit. Do not substitute mocks for real R2 tests of limits and signatures.

Run type/lint checks and relevant suites according to repository scripts during implementation. Manually verify themes, keyboard, screen readers, long text, and intermittent connectivity. Do not approve beta access until quota, account isolation, physical deletion, integrity, editing dependencies, and cleanup operations are verified.

Connect existing backlog items: `backlog/r2-upload-integrity.md`, `cloud-data-lifecycle.md`, `production-cloud-security.md`, `desktop-auth-and-r2-cors.md`, `api-abuse-controls.md`, and `desktop-cloud-sync-gap.md`. Update their statuses only when implementation and evidence exist. Do not assume deployed configuration matches local code.

Decision metrics: storage per account and percentiles, globally committed capacity, upload success/time, orphaned pending uploads, links created, downloads for editing, and frequency of quota exhaustion. Review free capacity using data; do not silently introduce charges or retrospective deletions.
