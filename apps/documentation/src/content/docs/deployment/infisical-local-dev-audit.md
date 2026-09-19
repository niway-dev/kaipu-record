---
title: Infisical local development migration — technical audit
description: Security, compatibility, CI/CD, and operational findings for feat/infisical-local-dev at fd32f0d.
---

# Infisical local development migration — technical audit

> **Review date: 2026-09-18. Recommendation: request changes before merge.**
> This is an assessment, not a record of implemented remediation. No production
> incident or secret exfiltration was established by this review.

## Scope and provenance

| Item               | Reviewed state                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Branch             | `feat/infisical-local-dev`                                                                                                          |
| Head               | `fd32f0d0c2056a3e106c5cc3ea5d26d4d981f415` (local and remote-tracking refs agree)                                                   |
| Base               | `origin/main`, `ecdc9571ef5e43377ce30371fe78defaaf6eee63`                                                                           |
| Change set         | Seven commits; 11 files; 210 additions and 22 deletions                                                                             |
| Authoring checkout | `feat/console-app`, `b96d2cd`; the additional Console commit is excluded from findings                                              |
| Evidence           | Branch diff, unchanged callers and configuration, installed dependency source, synthetic probes, upstream CLI source at `v0.43.132` |

The review covers all changed files and the execution paths they affect: root
database/operator commands, API and web development, Electron development and
packaging, Turbo, setup, GitHub validation/release workflows, and onboarding docs.
It is not a general dependency CVE scan or an audit of unrelated application logic.

No actual secret values, `.env` contents, Infisical sessions, or provider dashboards
were read. No database command, deploy, signing operation, or real secret export
was run. Existing remote-tracking refs were used without fetching new branch state.

Related documents:

- [Evidence and verification matrix](/deployment/infisical-local-dev-verification)
- [Prioritized remediation plan](/plans/2026-09-18-infisical-audit-remediation)
- [Proposed environment execution contract](/architecture/decisions/0003-environment-execution-contract)

## Executive assessment

Moving values out of developer-maintained files is useful, but changing the
transport does not establish least privilege or preserve command semantics.
The migration currently has four high-priority problems:

1. Desktop and web processes request the entire development secret tree.
2. The documented shell override for production operator commands no longer wins.
3. Normal web development injects the host process but does not supply Worker bindings.
4. Local desktop packaging can compile the development endpoint into signed builds,
   while signing still depends on a manually sourced file.

The remaining risks concern plaintext file handling, stale configuration, CLI
provenance, cache correctness, implicit environment selection, and missing tests.
The branch implements **local development migration only**: production releases
still consume GitHub Secrets and variables. Calling Infisical the sole source of
all environment values is inaccurate at this SHA.

### What the branch gets right

- `.infisical.json` contains a project identifier, not a credential.
- The setup script reports missing tools rather than installing remote executables.
- Missing local CLI and failed exports stop the associated startup command.
- CI builds remain independent of an Infisical login.
- Generated `.env` files are ignored by Git, including app-specific ignore rules.
- API schema validation still rejects missing required bindings.
- Existing Turbo database tasks explicitly allow `DATABASE_URL`; integration tests
  allow `TEST_DATABASE_URL`. The new wrapper does not inherently lose these values.

## Severity and evidence vocabulary

**P1:** fix before merging this migration because of a material security boundary
or a core workflow regression. **P2:** resolve before calling the migration complete;
some are merge gates where affected workflows are supported. **P3:** reliability
or diagnostic improvement.

**Confirmed** means repository/upstream implementation or a synthetic probe
establishes the mechanism. **Conditional impact** means actual credentials,
permissions, existing files, or usage determine whether harm occurs. A confirmed
mechanism is not evidence that the harm already occurred.

| ID     | Priority | Finding                                                            | Evidence status                                         |
| ------ | -------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| INF-01 | P1       | Project-wide secrets flow to unrelated processes                   | Confirmed scope; credential impact conditional          |
| INF-02 | P1       | Shell database override is replaced by Infisical dev value         | Confirmed for CLI 0.43.132                              |
| INF-03 | P1       | Web dev injection misses the Worker binding boundary               | Confirmed loader mechanism; full app smoke test pending |
| INF-04 | P2       | Plaintext exports are non-atomic and permissions depend on umask   | Reproduced                                              |
| INF-05 | P2       | Legacy files can override freshly fetched configuration            | Loader precedence reproduced                            |
| INF-06 | P2       | Global CLI policy conflicts with retained npm CLI package          | Confirmed; clean-install behavior untested              |
| INF-07 | P1       | Desktop build and packaging have conflicting environment lifetimes | Confirmed command graph; signed artifact not built      |
| INF-08 | P2       | Turbo cannot hash remotely fetched desktop build configuration     | Confirmed dry-run and configuration                     |
| INF-09 | P2       | Any nonempty CI selects ambient environment, even for writes       | Reproduced; no privilege escalation by itself           |
| INF-10 | P2       | Migration completeness and rotation guidance are inaccurate        | Confirmed workflow/documentation mismatch               |
| INF-11 | P2       | CI does not exercise the new secrets boundary                      | Confirmed workflow inspection                           |
| INF-12 | P3       | Setup can accept an unparseable required version                   | Confirmed conditional logic                             |

## Findings

### INF-01 — Overbroad secret distribution

**Evidence:** `scripts/with-env.sh:21-22` executes `infisical run --env=dev
--recursive`; desktop `package.json:19-20` and web `package.json:11` call it.
API and web `env:pull` both export root, `/database`, `/cloudflare`, and
`/server-hono` (`package.json:9` and `:10`, respectively).

Consequently, the Electron development process and web build/dev dependencies can
receive database, authentication, mail, and infrastructure credentials they do
not need. Web exports also persist backend secrets in a second app directory.
If the identity cannot read those unrelated folders, the broad request can instead
prevent a least-privileged contributor from starting their own app.

**Threat:** malicious or compromised tooling running as the developer can read
inherited variables; a leaked dev credential's damage depends on its provider
scope. If `/cloudflare` contains production-capable deploy or R2 keys, the blast
radius crosses environments. That provider configuration has not been inspected.

This does **not** prove secrets are bundled into the browser: Vite's prefix filter
still applies. However, any sensitive key incorrectly named `VITE_*` or the
Electron public build prefixes becomes eligible for embedding. Secret storage
location is not a public/private type system.

**Recommendation:** define consumer-specific key contracts and least-privilege
identities. Desktop should receive public build configuration, not backend
credentials. Restrict API exports to runtime needs and keep deploy credentials
outside application bindings. Validate the effective key set with synthetic
sentinels. See the proposed ADR; implementation is pending.

### INF-02 — Production operator examples now target development

**Evidence:** root `package.json:47-53`; `scripts/with-env.sh:22`;
`apps/documentation/src/content/docs/commands.md:8-10,44-50`;
`apps/server-hono/scripts/plan.ts:8-9,32-39`.

The docs promise that `DATABASE_URL='<production url>' bun run plan grant ...`
wins over the local source. CLI `v0.43.132`'s `formatSecretsForShell` first copies
`os.Environ()`, then assigns fetched secrets over it. If `dev` contains
`DATABASE_URL`, the inline production URL is replaced. The same incompatibility
affects database commands and any inherited test database override with the same
key. `--secret-overriding` controls personal versus shared Infisical secrets;
it does not restore shell precedence.

**Impact:** writes can reach the wrong database, and a successful command can be
misinterpreted as a production change. `plan` prints the selected hostname, which
helps diagnosis but does not preserve the documented contract. This finding is
not a claim that the migration defaults to production; it explicitly selects dev.

**Recommendation:** define an explicit source/environment selection contract,
update operator docs with it, and verify target selection before writes using
synthetic environments. Do not present `CI=true` as the operator interface.

### INF-03 — Normal web dev does not populate local Worker bindings

**Evidence:** web `package.json:11,14`; `vite.config.ts:6,13`;
`src/env/server.ts:3` parses `process.env`; Cloudflare's Vite plugin runs SSR in
a Worker; Wrangler `getVarsForDev` loads `.dev.vars`/`.env` and does not include
arbitrary parent environment variables by default.

The normal `dev` command wraps `vite dev` with Infisical but never runs `env:pull`.
Only `wrangler:dev` generates the file. Injecting the Vite host is sufficient for
client-prefixed build variables, but it is not equivalent to supplying the
Worker environment. The `nodejs_compat` flag does not import the host's complete
environment into the Worker.

**Impact:** a clean checkout can have missing server-side values, while an old
`.env` makes an existing laptop appear healthy. This can also produce different
client and server configuration in one development session. The loader behavior
was reproduced; a full web startup/auth smoke test remains required.

**Recommendation:** make the actual web `dev` entry point populate narrowly scoped
bindings and validate them inside the Worker. Do not solve this by importing all
host variables into the Worker.

### INF-04 — Failed exports destroy the previous file and leave partial secrets

**Evidence:** API/web `env:pull` scripts use `> .env` followed by three `>> .env`
operations, without a temporary file, validation, permission restriction, or lock.

Synthetic probes established:

- Failure of the first export truncates the previous `.env` to zero bytes.
- Failure of the second leaves a partial file from the first export.
- A newly created file with umask `022` is mode `0644`, not owner-only.

The `&&` chain correctly stops that startup. The remaining risk is the damaged
file, watchers or other consumers reading it, and later commands reusing it.
Parallel pulls in the same app can interleave truncation/appends. Sequential
exports can also observe different versions during a multi-key rotation.

**Recommendation:** owner-only temporary output on the same filesystem, explicit
format, validate required keys and duplicates, atomic replacement on total
success, cleanup on failure, and defined concurrency behavior. Filesystem access
still depends on directory permissions and OS policy; `0644` is not proof another
user actually accessed the file. Ignore rules prevent ordinary Git inclusion,
not backups, malware, or accidental diagnostic uploads.

### INF-05 — Old configuration can silently win

**Evidence:** Wrangler's `.dev.vars` branch returns before loading `.env`;
the scripts do not check for competing files. Vite also retains its usual
mode/local env-file loading behavior.

A synthetic `.dev.vars` value won over a freshly generated `.env` value. Thus
successful exports do not prove the API or web is consuming Infisical's values.
Other mode-specific files and Bun's automatic dotenv loading add compatibility
surfaces that need targeted tests; their complete precedence matrix was not run.

**Recommendation:** explicitly identify conflicting legacy files by path, migrate
them deliberately, and select the intended generated source. Do not delete
unfamiliar developer files automatically. Test with conflicting sentinel values,
not only with an empty checkout.

### INF-06 — Two conflicting CLI installation contracts

**Evidence:** `CLAUDE.md` says the CLI is global and warns against installing it
with Bun. Nevertheless `apps/server-hono/package.json:32` and `bun.lock` retain
`@infisical/cli@0.43.132`. The npm package's `preinstall` downloads a separate
GitHub release binary; its inspected installer does not verify a release checksum.

Package-script PATH resolution can select a workspace CLI instead of the global
one. If its install hook did not materialize the binary, behavior depends on
package manager and installation state. If it did run, the npm archive integrity
does not pin the separately downloaded binary bytes. This undermines the stated
single global-tool policy and the setup script's provenance rationale.

The current laptop's `bun pm untrusted` reported zero untrusted scripts. That is
not evidence of a broken install here, nor proof a fresh Bun 1.3.4 install behaves
identically. No installation was modified during the review.

**Recommendation:** use one supported CLI installation contract, remove the
contradictory dependency if retaining the global policy, and test actual binary
resolution from root and app scripts on a fresh install.

### INF-07 — Desktop build scope ends before signing and always fetches dev

**Evidence:** desktop `package.json:20-25`;
`scripts/build-mac-local.sh:7-10,16-19`;
`.github/workflows/release-desktop.yml:66-89`.

Three concrete inconsistencies remain:

1. `build:mac` still requires and shell-sources `.env.signing`, contradicting the
   no-hand-maintained-files claim. With that file absent, it fails before building.
2. `npm run build` injects Infisical only into its child build process. Those
   variables cannot propagate back to the subsequent `electron-builder` process.
   Moving signing values into Infisical alone would not supply the packager.
3. The local build wrapper always fetches `dev`. A supplied release
   `MAIN_VITE_SERVER_URL` is overwritten if dev defines it. The resulting signed
   local installer can contain the development endpoint. `build:linux` bypasses
   the wrapper entirely and can instead use missing or stale values.

The GitHub macOS release path supplies the production URL and uses the CI bypass;
this is **not** a claim that that workflow now ships dev endpoints.

**Recommendation:** make build-time public configuration explicit for every
packaging entry point and inject signing credentials only into packaging/signing.
Inspect the endpoint in a synthetic build artifact before any signed release.

### INF-08 — Remote build inputs are invisible to Turbo

**Evidence:** `turbo.json:9-13` hashes repo/default and `.env*` inputs and caches
`dist/**`; desktop secrets/config are fetched inside the task. A dry-run of
`kaipu-record#build` showed no configured or inferred environment variables and
no `scripts/with-env.sh` input.

A remote change to `MAIN_VITE_SERVER_URL` or another build variable need not
change the task hash. A cache hit can skip both fetching and rebuilding. The
shared wrapper is also outside this package's default source inputs. Desktop's
actual `out/` output is not covered by the existing `dist/**` declaration; this
output mismatch predates the migration.

**Recommendation:** resolve and hash approved public configuration before the
build task, declare shared script inputs and correct outputs, or disable caching
until those invariants are implemented. Do not put secret values into cache
metadata to solve a public-config invalidation problem.

### INF-09 — CI is an implicit ambient-source selector for every command

**Evidence:** `scripts/with-env.sh:16-19`; the same wrapper handles builds,
database mutations, operator tasks, and integration tests.

`CI=false` and `CI=0` both bypass Infisical because they are nonempty. Synthetic
probes confirmed that a child runs with its ambient environment in all three
cases (`true`, `false`, `0`). A developer shell or external runner can therefore
select a different database source without changing the command.

This is a correctness boundary, **not authentication**: someone controlling a
local process can already choose environment variables. Preserving CI builds
without real credentials is good; using the same implicit switch to choose the
source for database writes is ambiguous.

**Recommendation:** separate execution mode/source from the CI marker; validate
the selected consumer contract in every mode and make database targets explicit.

### INF-10 — Source-of-truth and rotation documentation overstate completion

**Evidence:** `CLAUDE.md:121-170`; README dotenvx onboarding;
`commands.md`; backend environment docs; local signing script;
`.github/workflows/release-{api,web,desktop}.yml`.

Release workflows continue to read GitHub Secrets/variables and push Worker
secrets; no Infisical/OIDC integration was introduced. Alchemy commands still
load `.env` (`apps/web-hono/alchemy.run.ts:6`) without fetching. Restarting an app
does not update an already compiled desktop endpoint or deployed Worker secret.

**Impact:** deleting GitHub Secrets under the belief they were migrated breaks
releases. Rotating only one store can leave production unchanged or credentials
out of sync. Existing docs also invite users to restore dotenvx files and the
old precedence contract.

**Recommendation:** publish a per-consumer ownership/rotation matrix and mark CI
migration as separate pending work. Keep GitHub production values until the
replacement release path has been verified. The reusable
[Infisical playbook](https://github.com/csdev19/general-knowledge/blob/main/infra/infisical-secrets.md)
describes a broader target than the implementation in this branch.

### INF-11 — Green CI does not validate the migration's behavior

**Evidence:** `.github/workflows/ci.yml:48-83`, `ci-desktop.yml:89-98`, and
the `paths` lists in API/web/desktop test workflows.

CI does not run app `dev`, `env:pull`, or setup against controlled secrets.
Desktop E2E sets a placeholder endpoint and follows the CI bypass. There are
no new tests for partial exports, precedence, key scope, or Worker bindings.
App-specific workflow path filters omit shared `scripts/**` and root
`package.json`; a later wrapper-only change need not run those suites.

**Recommendation:** add deterministic fake-CLI/temporary-directory contract tests
and a Worker-binding smoke test. Test source selection without real credentials
in PRs. Add the shared inputs to relevant workflow filters. Keep an authenticated,
least-privilege dev smoke test distinct from the credential-free PR checks.

### INF-12 — Tool version checks can fail open

**Evidence:** `scripts/setup-dev.sh:30-33,59-68` compares the version only when
`found` is nonempty. A command with unparseable output can be shown as `present`
despite a declared minimum. The later access probe proves one secrets-read
operation, not every `run` and `export` capability or required key.

The minimum CLI is `0.40.0`, while observed semantics were checked at `0.43.132`;
the supported lower boundary has not been exercised. Installation guidance uses
Homebrew and scripts require Bash, so native Windows support is not established.

**Recommendation:** reject unknown versions for required versioned tools, test
the minimum supported version, and state supported local platforms. Follow the
[tool-doctor pattern](https://github.com/csdev19/general-knowledge/blob/main/conventions/tool-doctor-pattern.md)
without treating a successful connectivity probe as complete configuration validation.

## Scaling and operational failure modes

These affect developer/team growth and release reliability, not application
request throughput: the app does not fetch Infisical secrets on every user request.

| Growth/failure scenario           | Current behavior                                                                          | Consequence                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| More apps and folders             | Recursive consumers inherit new keys automatically; exports retain hardcoded paths        | Increasing exposure and inconsistent new-key availability                                        |
| Reused names across folders       | All values flatten into a single environment namespace                                    | Collisions; ordered exports and recursive reads may choose different values                      |
| More developers                   | Full-tree access requested for app startup                                                | Narrow RBAC becomes difficult to adopt                                                           |
| Repeated startup/build            | API performs four sequential export invocations; web and desktop each run a fetch wrapper | Startup depends on network/session health; actual HTTP calls may exceed CLI invocation counts    |
| Infisical outage or expired login | Local fetch-dependent commands cannot start                                               | Local development/build availability now depends on the service; no documented offline procedure |
| Concurrent pulls in one app       | Same destination file, no lock/atomic swap                                                | Partial or mixed generations                                                                     |
| Rotation across paths             | Independent requests and long-lived processes                                             | No coherent version snapshot or automatic reload guarantee                                       |
| Shared Turbo cache                | Remote public configuration not in hash                                                   | Old build can survive a configuration change                                                     |
| Incident/offboarding              | Local exports and inherited process values remain                                         | Revoking Infisical access alone does not invalidate already fetched provider credentials         |

No performance measurements or rate-limit observations were collected. Duplicate
names, imported secrets, and personal overrides must be inventoried before
claiming deterministic resolution. CLI defaults include imports and personal
overrides; the branch does not define a policy for either.

## Adjacent issues and external checks

These are relevant context, not newly introduced confirmed vulnerabilities:

- Root `db:command` targets a task absent from `turbo.json` and the infra-db
  package. This broken entry point predates the migration.
- Web still requires/receives `DATABASE_URL` despite its schema comment saying
  server functions no longer need it. Remove only with coordinated schema/deploy
  changes; the migration should not expand that inherited exposure.
- API runtime and desktop release workflows use the same GitHub R2 key names in
  the same production Environment. Verify bucket-scoped permissions and whether
  they really share a key before concluding private assets and public releases
  are isolated. This layout predates the branch.
- Upstream CLI `run.go` has debug logging of injected variables. `--silent` means
  suppressing tip/info messages, not a general redaction guarantee. Do not capture
  verbose real-secret sessions in issue/CI artifacts.
- Infisical project roles, developer prod access, imports across environments,
  machine identities, session storage, MFA, provider token scopes, audit retention,
  GitHub Environment protections, and rotation state were not inspected.

The last group needs administrative evidence, preferably key names, policies,
scope summaries, and event metadata rather than secret values. No merge approval
should be inferred from repository checks alone for those controls.
