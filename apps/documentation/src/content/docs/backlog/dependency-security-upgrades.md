---
title: Dependency security upgrades
description: Update and validate direct runtime dependencies with known security advisories before production cloud rollout.
---

# Dependency security upgrades

> **Status: 🔵 Proposed.** Blocking production rollout of cloud recordings.

## Why

`bun audit` (run 2026-09-02, re-verified against the published npm versions on the same date)
reports the versions **currently pinned** in this repo as the vulnerable ones — not already
resolved:

| Package                        | Currently pinned | Vulnerable range                                                                | First safe published version                        |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `@orpc/client`                 | `1.13.5`         | `<=1.13.5` (**critical** — prototype pollution via `StandardRPCJsonSerializer`) | `1.15.0`\*                                          |
| `@orpc/openapi`                | `1.13.5`         | `<=1.13.8`                                                                      | `1.15.0`\*                                          |
| `better-auth`                  | `1.4.18`         | `<1.6.2`                                                                        | `1.7.2`\*                                           |
| `hono`                         | `4.12.3`         | `<4.12.18`                                                                      | `4.13.5`\*                                          |
| `drizzle-orm`                  | `0.45.1`         | `<0.45.2`                                                                       | `0.45.2`\*                                          |
| `seroval` (via TanStack Start) | transitive       | `<=1.5.2`                                                                       | `1.6.4`\*                                           |
| `@tanstack/start-server-core`  | transitive       | `<1.167.30`                                                                     | not previously listed here — add to this workstream |

\* Latest published as of 2026-09-02; re-check at implementation time, since these packages
release frequently. Keep every `@orpc/*` package (`client`, `contract`, `server`, `openapi`,
`openapi-client`, `tanstack-query`) on the same release.

**Scope note:** `bun audit` reports **254 findings across the whole workspace (5 critical, 98
high, 124 moderate, 27 low)**, not just the seven packages above. This workstream deliberately
scopes to direct dependencies reachable from the Web/API request path (server-hono, web-hono,
and what `web-hono` ships to the browser). Everything else — `astro`/`vite`/`svgo`/`mermaid`/
`js-yaml` (documentation site build), `electron-builder`/`electron-updater`/`xmldom`/`tar` (Desktop
packaging), `turbo`, and other devDependency-only findings — is **out of scope here**, either
because it never runs in the request path or because it is a build-time-only tool. That said, the
documentation site is itself a public page (`kaipu.app` docs) — the `astro`/`mermaid`/`js-yaml` XSS
advisories are dev-tooling by dependency graph but a real product surface by exposure. File a
follow-up ticket for the doc-site dependency chain rather than silently deferring it.

## Plan

1. Update the root catalog and package ranges as a coordinated change; keep all `@orpc/*`
   packages on a compatible release.
2. Update TanStack Start/Router until it resolves a non-vulnerable `seroval` **and**
   `@tanstack/start-server-core` version.
3. Update Better Auth, Hono, Drizzle, and their compatible peers.
4. Regenerate `bun.lock`; do not use a blind major-version update.
5. Run the full test/type/build matrix, then repeat `bun audit` and record the remaining findings
   with runtime reachability and owner.
6. Add `bun audit` as a **permanent CI check** (fail on new critical/high in the direct
   dependency graph) so this doesn't silently drift out of date again — a one-time fix with no
   regression gate just becomes stale advice.

## Acceptance criteria

- No known critical advisory remains in a direct production dependency without an explicit,
  documented exception and expiry date.
- Sign-up, sign-in, sign-out, session lookup, authenticated API proxy, and recording routes pass
  regression tests.
- The documentation site, Web Worker, API Worker, and packaged Desktop app build successfully.
- `bun audit` output is captured in the PR description; findings limited to development-only or
  unreachable paths have a rationale.
- CI fails a future PR that reintroduces a critical/high advisory in a direct Web/API dependency.

## Non-goals

- Replacing Bun, Hono, Better Auth, oRPC, or TanStack Start.
- Treating every audit entry as equally exploitable without reviewing its reachability.
