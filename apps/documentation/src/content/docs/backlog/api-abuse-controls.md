---
title: API abuse controls for cloud recordings
description: Add explicit rate limits, quotas, request limits, MIME policy, and pagination before opening cloud storage to real accounts.
---

# API abuse controls for cloud recordings

> **Status: 🔵 Proposed.** Blocking production rollout of cloud recordings.

## Problem

The current 2 GiB maximum applies per declared upload, but there is no configured application-level
rate limit, per-user storage quota, limit on pending tickets, API request-size limit, MIME allowlist,
or pagination for a large cloud vault.

## Required controls

- Explicit rate limits for authentication and unauthenticated entry points, plus user-scoped limits
  for ticket issuance, confirm, download URL issuance, and deletion.
- Per-user quota accounting based on verified ready objects; a separate small cap for pending rows.
- Bounded JSON bodies and validated pagination for list routes.
- Allowlist of product-supported MIME types and clear handling of unsupported source files.
- Safe, generic client-facing errors; detailed diagnostic identifiers only in server-side logs.

## Design constraints

Use stable keys appropriate to each boundary: account/user ID for authenticated usage and a carefully
chosen anti-abuse key for login. Do not make IP address the only identity for legitimate users behind
shared networks. Limits must fail closed for upload-ticket issuance when the limiter is unavailable,
or the alternative must be explicitly justified.

**Implementation option to evaluate first:** the API already runs on Cloudflare Workers, which
has edge-native [Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
(WAF-level, no application code, no extra latency from a Durable Object/KV round-trip). Check
whether it can express the per-route, user-scoped limits above before building a custom
application-layer limiter — it still needs stable per-account keys (not bare IP) and a documented
fail-closed/fail-open decision either way, but may cut most of the implementation cost.

## Acceptance criteria

- Excess ticket creation, quota exhaustion, malformed JSON, unsupported MIME types, and oversized
  metadata requests are rejected predictably without creating rows or signed URLs.
- List responses remain bounded and preserve owner-scoped ordering/cursors.
- Rate-limit and quota responses are observable without exposing user content or credentials.
- Tests cover two users, retries, and concurrent ticket requests.

## Non-goals

- Charging, billing, or subscription entitlements; this task only creates the safe enforcement seam.

## Related

- [Production cloud security](./production-cloud-security)
