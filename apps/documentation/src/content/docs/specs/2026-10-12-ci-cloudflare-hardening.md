---
title: CI and Cloudflare exposure hardening
description: Design for NIW2-326 — what PR #275 already hardened in the GitHub Actions workflows and Worker config, and the remaining plan — the API's custom domain, Access on preview URLs, SHA-pin maintenance, and the repository settings only the owner can change.
---

# CI and Cloudflare exposure hardening

**Status: design — phase 1 shipped in [PR #275](https://github.com/niway-dev/kaipu-record/pull/275)
(verified: actionlint clean, `bun run verify` green); phases 2–5 pending.**
Linear: NIW2-326 (child of NIW2-322). Written 2026-10-12 against `main` at `49b1780` plus
the PR branch. Source findings: the 2026-10-12 security audit (private, not in the repo).

The repository is public. This document names classes of weakness and the configuration
that closes them; it deliberately contains no working exploit steps.

## In one minute

### Summary

The audit found no secret leak and no critical code defect, but a set of configuration
gaps around the deploy pipeline: workflow inputs reaching a shell unescaped, mutable action
tags in jobs that hold signing and Cloudflare credentials, over-broad `GITHUB_TOKEN`
scopes, a database credential handed to a Worker that never reads it, and two Workers
reachable on public `workers.dev` hostnames that bypass the `kaipu.app` zone. PR #275
closed everything that was a one-file change. What remains needs either a new public
address for the API (the desktop app has it inlined, so it is a migration with a
compatibility window), a dashboard change only the owner can make, or a recurring process
(keeping SHA pins current).

### Decisions

| Decision                                                                                                                                                                     | Why                                                                                                                                                                                                                         | ADR                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| The API's public address becomes `api.kaipu.app` (Worker custom domain); `workers.dev` and Version URLs on `kaipu-api` are turned off once nothing installed still uses them | A zone hostname gets WAF, rate limiting and Access; `workers.dev` is Cloudflare's hobby tier and sits outside every zone rule. The desktop app inlines the URL at build time, so the switch needs a window, not a flag flip | creates **ADR 0011** — _Workers are reachable only on zone hostnames_ — written in the migration PR (phase 2), not here                             |
| Web previews stay Version URLs behind Cloudflare Access; no separate preview secrets yet                                                                                     | After PR #275 the web Worker holds no secret worth isolating; the only privileged thing a preview touches is the `API_SERVICE` binding, and that is the no-write rule ADR 0007 already states                               | reuses [ADR 0007](/architecture/decisions/0007-prod-previews-via-version-urls/); its reopen condition is not met (see [ADR check](#adr-0007-check)) |
| Access on previews is attached at the **Worker** level ("Previews only"), and measurements authenticate with an Access service token instead of turning Access off           | A Worker-level policy survives route and domain changes; the technical-debt log records Access turned off for a measurement twice and never confirmed back on                                                               | none                                                                                                                                                |
| Action SHA pins are maintained by Dependabot (`github-actions` ecosystem, weekly, grouped, 7-day cooldown)                                                                   | Dependabot rewrites both the SHA and the `# vX.Y.Z` comment, and it does **not** raise alerts for SHA-pinned actions, so version-update PRs are the only signal that a pin is stale                                         | none                                                                                                                                                |
| The `preview` GitHub Environment gets its own, narrower Cloudflare token                                                                                                     | A version upload needs Workers Scripts edit only; the production token also needs zone DNS edit for custom domains. Any collaborator with write access can dispatch `Preview Web` on any ref                                | none                                                                                                                                                |
| `DATABASE_URL` leaves the web Worker in three ordered steps: schema, release, `wrangler secret delete`                                                                       | `apps/web-hono/src/env/server.ts` parses the schema at module load; deleting the secret first would break the deployed Worker                                                                                               | none                                                                                                                                                |

### Open questions

1. **Is `kaipu-console` deployed?** The spec says "not deployed", `wrangler.jsonc` claims
   `console.kaipu.app`, and no release workflow exists. If it is live, `CONSOLE_API_URL`
   is set by hand on the Worker and must be moved by hand in phase 2.
2. **Compatibility window length for installed desktop builds.** This spec proposes
   "two desktop releases or 30 days, whichever is later, and zero `workers.dev` requests
   in Workers Logs for 7 consecutive days". The owner may prefer a hard cut with the
   version gate instead.
3. **Does the production Cloudflare token already carry `Zone → DNS → Edit`?** The
   `kaipu-web` custom domains deployed, which suggests yes; confirm before the API deploy
   rather than discovering it as an empty trigger error.
4. **Should the lint job run `actionlint`?** PR #275 was checked with it locally. Adding it
   to `Lint, format and workflow rules` is small, but it is a new binary in CI and out of
   this ticket's stated scope.
5. **Whether `wrangler secret delete` shares the "latest version must be deployed"
   constraint** documented for `wrangler secret bulk`. Assume yes and run it right after a
   release, before any preview upload.

### Out of scope

- Dependency upgrades (better-auth, Electron, oRPC/seroval) — separate tickets under NIW2-322.
- Security headers, CSRF/`SameSite` changes, source maps, rate limiting on sign-in — the
  web and API audits' own tickets. The API custom domain is a prerequisite for zone-level
  rate limiting, which is why it is noted below, but the rule itself is not designed here.
- A read-only database role for the console.
- A persistent development or staging Worker (ADR 0007's "separate Worker" day).
- Mobile clients; none ship today.

## What PR #275 changes (implemented, verified)

| Area                     | Before                                                                                                                | After                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview-web.yml` inputs | `inputs.ref` and `inputs.message` were expanded inside `run:` scripts and a wrangler argument                         | A first step validates both (charset, length, no leading `-`, no `..`) and later steps read them through `env:` / step outputs only          |
| Token scope              | Six workflows had no `permissions:`; `release-desktop.yml` granted `contents: write` to every job                     | Top-level `permissions: contents: read` everywhere; `contents: write` only on the job that publishes the GitHub Release                      |
| Action references        | Mutable tags (`@v4`, `@v2`, `@v3.14.1`) in jobs holding signing, Cloudflare and R2 credentials                        | All seven third-party actions pinned to a full commit SHA with a `# vX.Y.Z` comment                                                          |
| Web Worker secrets       | `release-web.yml` and `preview-web.yml` passed the production `DATABASE_URL` to a build and Worker that never read it | Removed from both workflows; the `preview` Environment no longer needs it. The deployed Worker still holds the old value until phase 5 below |
| Public hostnames         | `kaipu-web` never set `workers_dev`, so a redeploy could re-enable a second public origin for the live site           | `workers_dev: false` explicit in `apps/web-hono/wrangler.jsonc`; `preview_urls: true` stays for the Preview Web workflow                     |
| Documentation            | —                                                                                                                     | `deployment/ci-cd-pipelines` gains "Workflow hardening" and "Public Worker URLs"                                                             |

Verification on the branch: `actionlint` reports nothing, `bun run verify` passes, and the
`Validate inputs` step was exercised with a rejected and an accepted input pair.

Not changed, deliberately: `kaipu-api` keeps `workers_dev` (unset, so on) and
`preview_urls: true`, because its `workers.dev` hostname is the only address the desktop
build (`MAIN_VITE_SERVER_URL`) and the console (`CONSOLE_API_URL`) know. Turning it off
today would break every installed desktop app. That is phase 2.

## Phase 2 — the API moves to a custom domain

### Who reaches the API, and how

| Client                    | Path today                                                                               | After migration                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Web (`kaipu-web`)         | `API_SERVICE` service binding; `VITE_SERVER_URL` only builds the target path             | unchanged                                         |
| Console (`kaipu-console`) | `API_SERVICE` service binding; `CONSOLE_API_URL` only builds the target path             | unchanged routing; variable moved for consistency |
| Desktop (`kaipu-record`)  | Public HTTPS to `MAIN_VITE_SERVER_URL`, **inlined into the signed binary at build time** | `https://api.kaipu.app`, from the next release    |
| Transactional email links | `PUBLIC_WEB_URL` → the web app, never the API                                            | unchanged                                         |
| Browser, directly         | Nothing legitimate; the web proxy is the browser's path                                  | unchanged                                         |

Two facts make this cheaper than the hub's
[custom-domain-migration](https://github.com/csdev19/general-knowledge/blob/main/infra/custom-domain-migration.md)
checklist suggests: Better Auth derives its base URL from the request (no `baseURL` is
configured), and the desktop app presents `kaipu-record://app` as its origin, which is a
literal in `trustedOrigins`, not a hostname. Neither changes with the hostname. The
console's origin (`https://console.kaipu.app`) must already be in `CORS_ORIGIN`; that
requirement predates this spec.

### Why a custom domain and not Access on `workers.dev`

Cloudflare's own guidance is to run production on a route or custom domain; the
`workers.dev` subdomain is treated as a Free-plan hobby site. Concretely for Kaipu:

- Zone-level rules (WAF, rate limiting, redirect rules) apply to `api.kaipu.app` and not
  to a `workers.dev` host. The audit's P0 "unlimited sign-in attempts" finding wants a
  zone rate-limit rule on `/api/auth/sign-in/*`; it has nowhere to attach today.
- A `workers.dev` host is derived from the account subdomain. Renaming the account
  subdomain or the Worker silently changes the address every installed desktop build has
  inlined. A zone hostname is ours.
- Putting Access on the production `workers.dev` host is not an option for the API: the
  desktop app is an unauthenticated public client of it, so an Access policy would have to
  be a bypass, which protects nothing.

**Alternative rejected: route the desktop app through the web Worker's proxy** so the API
has no public address at all. The proxy is tuned for browsers (cookie rewriting, header
stripping); the desktop uses bearer auth and talks to the API directly by design (desktop
authentication spec, 2026-09-02). It would add a hop to every upload and make the web
Worker a hard dependency of the desktop app.

### Migration plan

The ordering exists because of one Wrangler rule: **adding a `routes` entry makes
Wrangler infer `workers_dev = false` on the next deploy** unless `workers_dev` is set
explicitly. Step A therefore pins `workers_dev: true` on purpose; step D removes it.

**A. Add the hostname, keep the old one.**

1. Confirm the `kaipu.app` zone has no existing record for `api` (a custom domain cannot be
   created over an existing CNAME). Delete a parking record if one exists; touch nothing else.
2. `apps/server-hono/wrangler.jsonc`: add
   `"routes": [{ "pattern": "api.kaipu.app", "custom_domain": true }]`, set
   `"workers_dev": true` explicitly with a comment pointing at step D, leave
   `preview_urls` as is for now, run `wrangler types`.
3. Confirm the production Cloudflare token holds `Zone → Zone → Read` and
   `Zone → DNS → Edit` (open question 3). If not, mint one before tagging.
4. Release the API (`api-v*` tag). Verify `https://api.kaipu.app/api/v1/health` and the
   same path on the `workers.dev` host both answer; verify a desktop sign-in still works
   against the old host.
5. Write ADR 0011 in this PR.

**B. Move the clients.**

1. GitHub `production` and `testing` Environments: `MAIN_VITE_SERVER_URL` →
   `https://api.kaipu.app`. Infisical `prod` `/public`: same value, tag `kaipu-record`.
   Infisical `/public` `CONSOLE_API_URL` → same host, tag `console`; apply it to the
   console Worker through whatever currently sets its vars (open question 1).
2. Cut a desktop release. From this release on, every new install and every auto-updated
   install talks to `api.kaipu.app`. Record the version number in the implementation
   status below: it is the version-gate floor for step C.
3. Update `deployment/ci-cd-pipelines` "Domains" and "Public Worker URLs" sections, the
   console spec's rollout checklist, and `apps/kaipu-record/scripts/build-mac-local.sh`'s
   example value.

**C. Compatibility window.** Installed desktop builds older than the B.2 release keep
calling the `workers.dev` host. Two mechanisms already shipped bound the window:

- **Auto-update** (electron-updater against the public R2 feed) moves running installs to
  the new build silently; the user only sees a "restart to apply" banner.
- **Version gate** (`version-gate.json` on `updates.kaipu.app`, fetched by the renderer,
  fail-open with last-good cache). Raising `minVersion` to the B.2 release puts a
  non-dismissible update overlay on any build that is still below it. The gate file lives
  on R2, not on the API, so it keeps working after step D.

Exit criteria (proposed; open question 2): the B.2 release has been the latest for at
least 30 days **and** a second desktop release has shipped since **and** Workers Logs for
`kaipu-api` show no invocation whose request host ends in `workers.dev` for 7 consecutive
days. Observability is already enabled on the Worker; the request URL is in each
invocation's metadata, so this is a dashboard query, not a code change. Raise
`minVersion` at the start of the last week, so stragglers see the overlay while the old
host still answers.

**D. Close the old hostname.**

1. `apps/server-hono/wrangler.jsonc`: `"workers_dev": false`, `"preview_urls": false`.
   No workflow uploads API versions (`release-api.yml` deploys directly), so API Version
   URLs have no consumer.
2. Release the API. Verify the `workers.dev` host no longer answers and
   `api.kaipu.app` does; verify a desktop sign-in and an upload on the current release.
3. Amend ADR 0011's status to "implemented"; update "Public Worker URLs" in the deployment
   doc.

### Backout

- After A: remove the route and redeploy; nothing else changed.
- After B: the old host still answers, so a bad desktop build is rolled back the ordinary
  way (patch release); `MAIN_VITE_SERVER_URL` can point back at the old host for one
  release without touching Cloudflare.
- After D: set `workers_dev: true`, redeploy the API; the old host returns within minutes.
  Installed builds on the old host were failing closed in the meantime (sign-in and upload
  errors, local recording unaffected — the desktop app is local-first).

## Phase 3 — preview URLs: Access rather than separate secrets

### Options considered

1. **Keep Version URLs (ADR 0007) and put Cloudflare Access in front — recommended.**
   Strongest argument against: the preview still runs with production bindings, so Access
   is the only barrier, and the technical-debt log shows it was switched off twice for
   measurements with no record of being switched back on. Mitigation below.
2. **Migrate `Preview Web` to Worker Previews (`wrangler preview`, Wrangler ≥ 4.135).**
   Previews carry their own `previews` block of vars and secrets, custom-domain preview
   hostnames, and automatic isolation for Durable Objects. Strongest argument against: the
   one thing worth isolating is the `API_SERVICE` binding, and Cloudflare documents that
   **service bindings from a Preview call the bound Worker's production deployment**.
   Isolation would need a non-production API Worker, which is exactly the separate Worker
   ADR 0007 defers. The web Worker's remaining secret after PR #275 is `VITE_SERVER_URL`,
   a public value. Previews would also change the workflow, the Wrangler pin and the
   measurement protocol for no isolation gain today. Revisit when ADR 0007 reopens.
3. **Turn `preview_urls` off on the web Worker and measure production after each
   release.** Rejected by ADR 0007 for the same reason as before: the point is to look
   before the tag.

### What changes under option 1

- **Access is attached to the Worker, scope "Previews only"** (Workers & Pages →
  `kaipu-web` → Access → Protect this Worker → Previews only; policy: the owner's email).
  A Worker-level policy follows the Worker regardless of hostnames and cannot be lost by
  editing routes. The console gets the same treatment with scope "All traffic".
- **Measurements stop toggling Access off.** Create an Access service token and add a
  Service Auth policy for it on the preview application. Local Lighthouse runs pass the
  token through `--extra-headers` (`CF-Access-Client-Id` / `CF-Access-Client-Secret`), so
  the request is authenticated and the page under test is the real page. The baseline
  document's commands gain that flag; PageSpeed Insights, which cannot send headers, is
  the one case that still needs a measurement window, and that window gets a start and an
  end entry in the baseline table. This closes the technical-debt item.
- **The web Worker's leftover `DATABASE_URL` is deleted** (phase 5), so a preview holds
  nothing a production incident would miss.
- Workers Logs are not produced for Version URLs; that limitation stands.

### ADR 0007 check

The decision above does not contradict ADR 0007; it is the ADR's own consequence
("Cloudflare Access stays enabled on the Worker's preview URLs") made operational. The
ADR's reopen condition — _"the moment a pre-production need writes"_ — is **not met**: the
preview still exists to inspect the marketing home and take render-only measurements.
Option 2 would be the natural answer when it is met, and the comparison here should be
copied into that ADR's successor rather than redone.

## Phase 4 — keeping SHA pins current

A SHA is an immutable reference; it is also a reference nobody bumps by accident, so
pinned actions age until something forces a change. GitHub's hardening guide names
Dependabot as the mechanism and warns that Dependabot **does not create vulnerability
alerts for actions pinned to a SHA** — version-update pull requests are the only signal.

Add `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 7
    groups:
      actions:
        patterns: ["*"]
    commit-message:
      prefix: "ci"
```

- Dependabot rewrites both the SHA and the trailing `# vX.Y.Z` comment, so the convention
  in `deployment/ci-cd-pipelines` ("Workflow hardening") holds without manual edits.
- `cooldown` keeps a just-published release out of the pipeline for a week: a compromised
  release is usually noticed and yanked within days, and nothing here needs same-day
  upgrades.
- One grouped PR per week keeps the macOS E2E cost to one run. `.github/` is not
  documentation, so `pr-checks.yml` runs the full suite on these PRs — correct, since a
  bumped `setup-bun` or `checkout` is exactly what the suite should exercise.
- Review rule for a bump: open the upstream compare between the two SHAs; confirm the new
  SHA is a commit in the action's own repository (not a fork). CODEOWNERS already routes
  the review to the maintainer.
- Not Renovate: it offers the same (`helpers:pinGitHubActionDigests`) with more
  configuration surface and a second bot identity; nothing here needs it.
- `bun add -g wrangler@4.148.0` in the three Worker workflows is version-pinned but not
  hash-pinned. The lockfile does not cover a global install. Accept: it is a Cloudflare
  first-party package on npm with 2FA-enforced publishing, and the catalog pin in
  `package.json` is the place to converge on when the workspace upgrades.

## Phase 5 — repository settings and the web Worker secret (owner actions)

Everything here lives outside the repository. Each item says how to verify it from the
outside, because nothing in CI fails when it is wrong.

| #   | Action                                                                                                                                                                                          | Verify                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Settings → Actions → General → Workflow permissions: **Read repository contents and packages permissions**; leave "Allow GitHub Actions to create and approve pull requests" off                | `gh api repos/niway-dev/kaipu-record/actions/permissions/workflow` → `default_workflow_permissions: read`              |
| 2   | Same page: if the account offers **Require actions to be pinned to a full-length commit SHA**, turn it on                                                                                       | A workflow referencing `@v4` fails to start                                                                            |
| 3   | Cloudflare: Access on `kaipu-web`, scope Previews only; Access on `kaipu-console`, scope All traffic; a service token with a Service Auth policy on the preview application                     | An unauthenticated request to a Version URL returns the Access login page; one with the token headers returns the page |
| 4   | Cloudflare: a second API token with **Workers Scripts → Edit** only, stored as `CLOUDFLARE_API_TOKEN` in the `preview` Environment; the production token keeps zone DNS edit for custom domains | `Preview Web` still uploads; the preview token cannot list zones                                                       |
| 5   | `packages/infra-env/src/web-server.ts`: drop `DATABASE_URL` from `webServerEnvSchema` (its own comment asks for this); release the web                                                          | `bun run verify`; the deployed Worker serves `kaipu.app`                                                               |
| 6   | Immediately after that release and before any preview upload: `wrangler secret delete DATABASE_URL --name kaipu-web`                                                                            | `wrangler secret list --name kaipu-web` shows only `VITE_SERVER_URL`                                                   |
| 7   | Confirm the `preview` Environment holds no `DATABASE_URL` any more (PR #275 stopped reading it; the value may still be stored)                                                                  | Environment secrets page lists the Cloudflare token and account id only                                                |

Item 5 must precede item 6: `apps/web-hono/src/env/server.ts` parses the schema at module
load, so deleting the secret from a Worker whose code still requires it takes the site down
on the next cold start.

## Test plan

| Phase | Check                                                                                                                                                        | How                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Input validation rejects a `ref` with `..` or a leading `-`, and a `message` outside the allowed charset; accepts `main` / `manual preview`                  | Dispatch `Preview Web` twice; one run fails at `Validate inputs`, the other reaches the upload                                           |
| 1     | No job can write to the repository unless named                                                                                                              | `gh run view <id> --json jobs` shows no `contents: write` outside `release-mac`; actionlint clean                                        |
| 2A    | API answers on both hosts; desktop sign-in on the old host still works                                                                                       | `curl` health on both; manual sign-in on the current desktop release                                                                     |
| 2B    | New desktop build inlines the new host; auth, entitlements and upload work against it                                                                        | `strings` on the built main bundle for `api.kaipu.app`; the desktop E2E auth spec against the release build; manual upload               |
| 2C    | Old-host traffic trends to zero; the gate overlay appears on a build below `minVersion`                                                                      | Workers Logs query on request host; install the previous DMG, raise `minVersion` on a staging copy of the gate JSON, observe the overlay |
| 2D    | Old host returns nothing routable; `api.kaipu.app` unaffected; a Version URL for the API no longer exists                                                    | `curl` both; `wrangler versions list` shows versions but no preview URL                                                                  |
| 3     | Access blocks an anonymous request to a web Version URL and admits a service-token request; Lighthouse with `--extra-headers` scores the page, not the login | Manual `curl`; one Lighthouse run appended to the baseline with a note                                                                   |
| 4     | Dependabot opens a grouped PR and the comments match the new tags                                                                                            | First weekly run; `pr-checks.yml` runs on it                                                                                             |
| 5     | Web Worker boots without `DATABASE_URL`; the secret is gone                                                                                                  | `wrangler secret list`; `kaipu.app` serves after a cold start                                                                            |

## Acceptance criteria

1. No workflow expands `inputs.*` or `github.event.*` inside a `run:` script; every
   workflow declares top-level `permissions: contents: read`; every third-party action is a
   full SHA with a version comment. _(Done in PR #275.)_
2. `kaipu-api` is served on `api.kaipu.app`; its `workers.dev` host and Version URLs are
   off; the desktop release in production and the console use the new host; ADR 0011 is
   recorded.
3. Anonymous requests to `kaipu-web` Version URLs and to `console.kaipu.app` meet
   Cloudflare Access; the technical-debt entry about Access is closed with a dated check.
4. `.github/dependabot.yml` exists and has produced at least one grouped pull request.
5. The repository's default workflow token is read-only; the `preview` Environment uses a
   token that cannot touch zones.
6. `kaipu-web` holds no `DATABASE_URL` and its env schema does not require one.

## Rollout order

Phases are independent except where stated; the owner-only items can run any time.

1. Merge PR #275 (phase 1).
2. Phase 5 items 1, 2, 3, 4, 7 — dashboard only, no code, no risk to production.
3. Phase 4 — one new file.
4. Phase 5 items 5–6 — one schema change, one web release, one command.
5. Phase 2 A → B → C → D, each its own PR and release; C is calendar time.
6. Phase 3 measurement change — one edit to the baseline document once the service token
   exists (Phase 5 item 3).

Backout per phase is in each section; none of the phases needs another one undone first,
except that phase 2D must not run before 2C's exit criteria.

## Implementation status

Ordered and resumable: pick up at the first unchecked item.

- [x] **1.1** Workflow hardening, SHA pins, `DATABASE_URL` out of web workflows,
      `workers_dev: false` on web, deployment doc — PR #275, verified.
- [x] **1.2** This design document.
- [ ] **5.1** Default workflow token read-only (owner).
- [ ] **5.2** SHA-pin policy if available (owner).
- [ ] **5.3** Access on `kaipu-web` previews and on `kaipu-console`; service token
      (owner). Record the check in `backlog/technical-debt`.
- [ ] **5.4** Narrow Cloudflare token for the `preview` Environment (owner).
- [ ] **5.7** Remove any stored `DATABASE_URL` from the `preview` Environment (owner).
- [ ] **4.1** Add `.github/dependabot.yml`; confirm the first grouped PR passes
      `pr-checks.yml`.
- [ ] **5.5** Drop `DATABASE_URL` from `webServerEnvSchema`; release web.
- [ ] **5.6** `wrangler secret delete DATABASE_URL --name kaipu-web` right after 5.5.
- [ ] **2A** API custom domain added with `workers_dev: true` explicit; API released;
      both hosts verified; ADR 0011 written.
- [ ] **2B** `MAIN_VITE_SERVER_URL` and `CONSOLE_API_URL` moved (GitHub `production` +
      `testing`, Infisical `prod`); desktop released — version: _(fill in)_; docs updated.
- [ ] **2C** Window opened on _(date)_; `minVersion` raised on _(date)_; exit criteria met
      on _(date)_ with the Workers Logs query recorded.
- [ ] **2D** `workers_dev: false`, `preview_urls: false` on the API; released; ADR 0011
      marked implemented; "Public Worker URLs" doc updated.
- [ ] **3.1** Baseline document switched to `--extra-headers` with the service token;
      measurement windows (PageSpeed only) logged with start and end.

## References

- Deployment: [CI/CD pipelines](/deployment/ci-cd-pipelines/) ("Workflow hardening",
  "Public Worker URLs", "GitHub Environments"), [Secrets layout](/deployment/secrets-layout/).
- ADRs: [0007 — Version URLs](/architecture/decisions/0007-prod-previews-via-version-urls/),
  [0010 — checks in Actions](/architecture/decisions/0010-checks-run-in-actions-on-every-pr/).
- Related specs: [Desktop authentication](/specs/2026-09-02-desktop-authentication-design/),
  [Version gate](/specs/2026-06-28-version-gate-design/),
  [Auto-update](/specs/2026-06-28-auto-update-design/), [Kaipu Console](/specs/2026-09-15-kaipu-console/).
- Hub (reusable, product-agnostic):
  [deploy environments](https://github.com/csdev19/general-knowledge/blob/main/infra/deploy-environments.md),
  [custom domain migration](https://github.com/csdev19/general-knowledge/blob/main/infra/custom-domain-migration.md),
  [public-repo production protection](https://github.com/csdev19/general-knowledge/blob/main/monorepos/public-repo-production-protection.md),
  [wrangler and env config](https://github.com/csdev19/general-knowledge/blob/main/monorepos/wrangler-env-config.md).
- Cloudflare: [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
  (route inference, "intended for personal or hobby projects"),
  [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/),
  [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/),
  [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
  (Worker-level "Previews only"),
  [Worker Previews — compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/)
  (service bindings from a Preview call production).
- GitHub: [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
  (SHA pinning, no alerts for SHA-pinned actions, intermediate env var for untrusted input),
  [Dependabot options](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
  (`github-actions` ecosystem, `cooldown`, `groups`).
