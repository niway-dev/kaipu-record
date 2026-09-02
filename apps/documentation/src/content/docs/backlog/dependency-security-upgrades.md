---
title: Dependency security upgrades
description: Update and validate direct runtime dependencies with known security advisories before production cloud rollout.
---

# Dependency security upgrades

> **Status: 🔵 Proposed.** Blocking production rollout of cloud recordings.

## Why

The 2026-09-02 dependency audit reported known advisories in direct runtime dependencies used by
the Web/API path. The highest-priority resolved versions include `@orpc/*` 1.13.5,
`better-auth` 1.4.18, `seroval` 1.5.0 via TanStack Start, `hono` 4.12.3, and
`drizzle-orm` 0.45.1. Audit output is an input to triage, not proof that every transitive
advisory is exploitable in Kaipu.

## Plan

1. Update the root catalog and package ranges as a coordinated change; keep all `@orpc/*`
   packages on a compatible release.
2. Update TanStack Start/Router until it resolves a non-vulnerable `seroval` version.
3. Update Better Auth, Hono, Drizzle, and their compatible peers.
4. Regenerate `bun.lock`; do not use a blind major-version update.
5. Run the full test/type/build matrix, then repeat `bun audit` and record the remaining findings
   with runtime reachability and owner.

## Acceptance criteria

- No known critical advisory remains in a direct production dependency without an explicit,
  documented exception and expiry date.
- Sign-up, sign-in, sign-out, session lookup, authenticated API proxy, and recording routes pass
  regression tests.
- The documentation site, Web Worker, API Worker, and packaged Desktop app build successfully.
- `bun audit` output is captured in the PR description; findings limited to development-only or
  unreachable paths have a rationale.

## Non-goals

- Replacing Bun, Hono, Better Auth, oRPC, or TanStack Start.
- Treating every audit entry as equally exploitable without reviewing its reachability.
