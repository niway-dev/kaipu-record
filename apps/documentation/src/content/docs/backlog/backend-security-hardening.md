---
title: Backend security hardening
description: The security work required before Kaipu exposes cloud recordings to real Web and Desktop users.
---

# Backend security hardening

> **Status: 🔵 Proposed.** Security review completed 2026-09-02. This is the execution hub;
> each workstream below has its own independently shippable backlog item.

Cloud recordings have been validated end-to-end in a local environment. They are **not yet ready
for production accounts**: dependencies, upload integrity, production configuration, client
authentication, abuse controls, Electron hardening, and data deletion all need explicit work.

## Scope and boundary

The product remains local-first. These tasks harden the optional cloud capability; they must not
make recording or local playback depend on an account or network connection.

## Workstreams and kill order

1. [Dependency security upgrades](./dependency-security-upgrades) — remove known critical
   vulnerabilities from the active Web/API dependency graph.
2. [R2 upload integrity](./r2-upload-integrity) — make an upload ticket non-overwritable and
   verify the object that becomes `ready`.
3. [Production cloud security](./production-cloud-security) — provision least-privilege secrets,
   deploy the database schema, and prove production is configured intentionally.
4. [Desktop auth and R2 CORS](./desktop-auth-and-r2-cors) — define the Desktop session model and
   the exact browser/renderer CORS policy for both first-party clients.
5. [API abuse controls](./api-abuse-controls) — rate limits, quotas, MIME restrictions, request
   limits, and pagination.
6. [Electron security hardening](./electron-security-hardening) — reduce renderer privilege before
   it can handle cloud account state.
7. [Cloud data lifecycle](./cloud-data-lifecycle) — recover pending uploads and delete private
   objects when their owning account is deleted.

## Release gate

Cloud recordings may be promoted from local validation to a production-facing Desktop feature only
when every workstream is at least **🟢 Ready to validate**, and the final production validation
proves: two-user isolation, upload integrity, quota/rate-limit behaviour, logout/session expiry,
and account deletion cleanup.

## Evidence reviewed

- Source, tests, lockfile, deployment workflows, and current documentation.
- `bun run test --filter='@kaipu/*'` and `bun run check-types` were green on 2026-09-02.
- `bun audit` reported critical and high dependency findings; the dependency workstream owns their
  remediation and re-audit.
- Cloudflare dashboard configuration, production secret values, and token scope were deliberately
  not inspected or recorded in this repository.
