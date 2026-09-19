---
title: "ADR 0003: Explicit environment execution contracts"
description: Proposed consumer-scoped environment sourcing and build/runtime boundaries after the Infisical migration audit.
---

# ADR 0003: Explicit environment execution contracts

> **Status: Proposed — not accepted or implemented.**
> Date: 2026-09-18. Trigger: audit of `feat/infisical-local-dev` at `fd32f0d`.
> Acceptance requires maintainer review; implementation belongs in follow-up changes.

## Context

The local migration uses a project-recursive wrapper for builds, app startup,
database writes, and operator commands. Worker files use a different export path.
Implicit precedence and process boundaries create the failures documented in the
[audit](/deployment/infisical-local-dev-audit). Production still uses GitHub
Secrets/variables. The choice of Infisical itself is not being reopened here.

Reusable guidance remains in the
[Infisical playbook](https://github.com/csdev19/general-knowledge/blob/main/infra/infisical-secrets.md)
and [tool-doctor pattern](https://github.com/csdev19/general-knowledge/blob/main/conventions/tool-doctor-pattern.md).
This ADR records Kaipu-specific boundaries, rather than duplicating those guides.

## Proposed decision

1. Every execution declares its **consumer**, **target environment**, and **value
   source**. CI is context, not the sole value-source selector for database writes.
   Define the command syntax in implementation; none is introduced by this ADR.
2. Consumer contracts enumerate allowed and required keys. Secret folders remain
   organizational; fetching a folder does not imply permission to pass every key
   to a process. Reject unexpected sensitive keys and ambiguous duplicates.
3. Desktop build configuration is public and cache-visible. API credentials never
   reach the desktop dev process. Signing credentials exist only for the signing
   stage, with explicit lifetime across build/packaging process boundaries.
4. Web/API local Worker bindings have an explicit narrowly scoped source. Generated
   files are owner-only and atomically replaced after full validation. Competing
   legacy sources are detected, not silently preferred or automatically deleted.
5. Ambient-source execution validates the same required-key contract as remote
   sourcing. Operator commands identify and validate the intended target without
   printing credentials. Shell-versus-provider precedence is documented and tested.
6. Local development and production release secret stores remain explicitly
   separate until a later CI migration is implemented and validated. A future
   OIDC design must scope identities per release need and prove environment
   restrictions; it is not accepted by this ADR.

## Alternatives rejected by this proposal

- **Keep recursive project injection:** simplest wiring, but exposure grows with
  every added folder and cannot enforce consumer contracts.
- **Use `CI=true` as the manual override:** avoids fetching, but conflates the
  source for potentially destructive commands with unrelated CI behavior.
- **Include the complete host environment in Worker bindings:** bridges the
  runtime boundary by granting unnecessarily broad access.
- **Keep mutable `.env` as both cache and source of truth:** supports offline use
  but obscures freshness, precedence, and rotation; no silent fallback is proposed.
- **Fetch inside cacheable desktop tasks without hashing config:** remote changes
  remain invisible to the cache. Temporarily disabling cache is acceptable until
  the public configuration contract is implemented.

## Consequences

More explicit configuration and contract tests are required, but app startup and
operator behavior become reproducible. Least-privilege contributors can run a
single app without reading unrelated secrets. File generation becomes a small
shared implementation instead of duplicated shell concatenation. Adding a new
secret requires updating the relevant consumer contract intentionally.

Remote-provider outages still affect operations that require remote values.
Offline support needs an explicit later design; it is not achieved by silently
reusing stale exported credentials.

## Non-goals

- Replacing Infisical or introducing Varlock in this audit.
- Migrating GitHub releases to OIDC in the same change.
- Rotating provider credentials as part of transport refactoring.
- Refactoring business/application architecture or database migration policy.
- Claiming native Windows support without testing the execution toolchain.

## Reopen conditions

Revisit if a new consumer cannot be expressed through a key contract, a provider
supports short-lived credentials that change the runtime model, offline developer
operation becomes a requirement, or release isolation requires separate projects
rather than environments/identities. Accept only after the
[verification gates](/deployment/infisical-local-dev-verification) are agreed.
