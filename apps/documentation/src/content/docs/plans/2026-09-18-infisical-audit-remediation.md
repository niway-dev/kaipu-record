---
title: Infisical audit — prioritized remediation plan
description: Proposed work packages and acceptance gates for the local-development secrets migration, separate from future CI migration.
---

# Infisical audit — prioritized remediation plan

> **Status: Proposed. No fixes in this plan have been implemented by the audit.**
> Applies to `feat/infisical-local-dev` at `fd32f0d`, reviewed 2026-09-18.

The [audit](/deployment/infisical-local-dev-audit) is the finding register; the
[verification matrix](/deployment/infisical-local-dev-verification) defines evidence
needed to close each item. The
[execution-contract ADR](/architecture/decisions/0003-environment-execution-contract)
is a proposal awaiting maintainer acceptance.

## Work packages, in order

### 1. Restore trustworthy command targeting

**Addresses:** INF-02, INF-09, INF-10. **Suggested owner:** tooling + operator workflow maintainer.

- Define explicit source and target selection for operator/database commands.
- Specify collision precedence and behavior for absent required values.
- Replace the documented production inline-override example only when the new
  command actually exists; retain a visible warning about the reviewed behavior.
- Test development, explicit release/production configuration, and ambient CI
  with synthetic endpoints before permitting a database mutation.

**Gate:** a selected target never silently changes because of provider injection,
`CI=false`, or a leftover env file. Credential-free PR tests cover these branches.

### 2. Scope the secrets boundary and fix Worker startup

**Addresses:** INF-01, INF-03, INF-04, INF-05. **Suggested owner:** platform/web/API maintainers.

- Inventory key names, owning systems, consumers, and required/optional status.
  No values in the inventory or review artifacts.
- Implement consumer-specific selection and duplicate-key detection; verify that
  unrelated secrets never reach Electron or the web process.
- Route both normal web dev and API dev through a binding-aware path.
- Consolidate exports into a validated, atomic, owner-only write implementation
  with explicit format and a defined concurrent-run policy.
- Detect legacy `.dev.vars` and mode/local env files; give a migration message
  instead of destroying developer-owned configuration.

**Gate:** clean startup and stale-file startup select the same intended sentinel
values inside the Worker. An export failure preserves the previous complete file
and prevents launch. No partially updated file becomes visible to consumers.

### 3. Make desktop builds reproducible across packaging commands

**Addresses:** INF-07, INF-08. **Suggested owner:** desktop/release maintainer.

- Separate public build config from signing credentials and backend secrets.
- Apply the same config contract to unpacked, Windows, macOS, and Linux entry
  points that the project chooses to support.
- Ensure signing credentials reach the packager, not merely its preceding build.
- Remove the `.env.signing` requirement only after its replacement works.
- Resolve/hash approved public inputs before Turbo scheduling, declare shared
  script inputs and `out/` outputs, or temporarily disable the affected cache.

**Gate:** a synthetic endpoint change produces a different compiled artifact;
unchanged inputs produce the expected cache behavior. A packaging process receives
only its signing values. Production-target local builds do not silently become dev.

### 4. Align installation, checks, and onboarding

**Addresses:** INF-06, INF-11, INF-12 and the onboarding part of INF-10.
**Suggested owner:** tooling/docs maintainers.

- Choose one CLI installation/provenance contract and remove its contradiction.
- Test a fresh install with the project's pinned Bun version, CLI minimum, and
  supported platform(s); verify root/app binary resolution.
- Add fake-CLI contract tests and a binding smoke test to appropriate CI jobs.
- Include shared script/config changes in app-workflow path filters.
- Fail clearly on unknown required-tool versions and missing required keys.
- Update README, Commands, Pro mode, backend env docs, and script comments;
  mark old proposals historical rather than letting them serve as onboarding.

**Gate:** a new contributor follows one consistent source of instructions, and PR
checks fail for the reproduced migration defects without needing live secrets.

### 5. Validate external controls and record the actual production boundary

**Addresses:** conditional impacts and operational gaps in INF-01/INF-10.
**Suggested owner:** repository/Infisical/provider administrator.

- Verify developer access is dev-only and check imports/personal overrides.
- Record provider scopes, especially deploy tokens, database roles, R2 buckets,
  and the relationship between private assets and public release credentials.
- Validate token revocation, secret history/audit visibility, and offboarding.
- Confirm GitHub Environment access/protection policies and who can change values.
- Document rotation steps for each store and consumer below.

**Gate:** policy and scope evidence supports the isolation claims. Real-secret
values are unnecessary for this review. Any future CI/OIDC migration is separately
designed and must have a verified release path before GitHub secrets are removed.

## Current ownership and propagation matrix

This is the repository's current wiring, not proof of dashboard contents.

| Consumer                  | Current source                                              | Value change becomes effective when                  | Required follow-up                           |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| API local dev             | Infisical dev → generated `.env` → Wrangler                 | Export and Worker restart, unless a legacy file wins | Atomic file and source precedence            |
| Web normal dev            | Infisical dev → Vite host; Worker bindings still file-based | Host restart; Worker source independently resolved   | Supply correct bindings                      |
| Web `wrangler:dev`        | Infisical dev → generated `.env`                            | Export and restart                                   | Reduce exported key set                      |
| Desktop local dev/build   | Infisical dev → electron-vite                               | Restart/rebuild, provided Turbo does not skip it     | Public-only config and cache inputs          |
| Local macOS signing       | `.env.signing` sourced by shell                             | New packaging invocation                             | Define replacement and credential lifetime   |
| Root DB/operator commands | Infisical dev, or ambient environment when CI is nonempty   | Next command                                         | Explicit source and target                   |
| PR builds                 | GitHub runner environment and placeholders                  | Next build                                           | Preserve credential-free operation           |
| Production API/web        | GitHub Secrets/variables → workflow → Worker                | Successful deploy/secret update                      | Not migrated to Infisical in this branch     |
| Production desktop        | GitHub production variables and signing secrets             | Build, sign, publish, then user update               | Compiled config cannot be fixed by restart   |
| Alchemy local commands    | Ambient variables / `.env`                                  | Invocation                                           | Decide supported path and freshness contract |

## Rollback and recovery constraints

- For a failed local migration, stop affected processes and identify the selected
  source before restoring anything. Do not copy unknown secrets into tracked files.
- Reverting transport code alone may not recover a laptop whose old `.env` was
  truncated. Restore from the authoritative store through a verified export path.
- Keep production GitHub values while release workflows depend on them. Local
  transport rollback and production credential rotation are different operations.
- If actual exposure is discovered, revoke/rotate the affected **provider**
  credentials and investigate audit events. Revoking Infisical access does not
  invalidate already exported credentials or running processes.
- Do not add silent stale-secret fallback just to make offline startup green.

## Completion criteria

The local migration is complete only when P1 findings are closed, supported
entry points have passing contract/smoke evidence, exported files have explicit
lifecycle guarantees, and docs reflect the actual release-store split. A green
generic build is insufficient. Production secret migration is a separate milestone.
