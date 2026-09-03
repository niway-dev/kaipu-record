---
title: Production cloud security configuration
description: Deploy cloud-recording credentials, database schema, and observability with least privilege and repeatable validation.
---

# Production cloud security configuration

> **Status: 🔵 Proposed.** Blocking production rollout of cloud recordings.

## Problem

Local R2/Postgres validation is complete, but the production API deployment currently does not
inject the four R2 credentials. A production release also needs an explicit database-schema step,
least-privilege credentials, and an operational rollback path.

## Required work

1. Create a dedicated R2 S3 API token restricted to `kaipu-private-bucket` and only the object
   operations the API requires. Do not reuse the public-installer bucket credentials.
2. Store `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` as
   production environment secrets/variables with least access to the release workflow.
3. Add those secrets to the API deployment workflow without printing values.
4. Apply and verify the `recording` schema in the production database before the API release that
   uses it. Prefer a repeatable migration strategy over an undocumented manual action.
5. Define credential rotation, emergency revocation, and rollback instructions.
6. Add structured operational events for ticket issuance, confirmation failure, deletion failure,
   rate limiting, and cleanup failures. Never include presigned URLs, session tokens, or raw file
   names in those events. **Decide the destination explicitly** rather than defaulting to
   `console.log`/Wrangler tail: Desktop already sends exceptions to PostHog via `posthog-node`
   (see [analytics + flags](/desktop/analytics-and-flags)) — either extend that same project with
   a server-side key so backend and Desktop events land in one place, or pick a Workers-native
   option (Logpush, Analytics Engine) if PostHog's ingestion model doesn't fit operational events
   well. Don't let this workstream and a future one each stand up a different tool by accident.

## Acceptance criteria

- Production API starts with valid R2 credentials and cannot access the public installer bucket.
- A deployment against an unprepared database fails before serving traffic, with an actionable
  release check.
- Secret values are absent from source, build logs, telemetry, and error responses.
- A rotation rehearsal proves old R2 credentials can be revoked without data loss.
- Production smoke test completes create → upload → confirm → download → delete using a disposable
  test account and removes all test data.

## Non-goals

- Making the private bucket public or attaching a custom domain.
- Storing S3 credentials in the Desktop application.
