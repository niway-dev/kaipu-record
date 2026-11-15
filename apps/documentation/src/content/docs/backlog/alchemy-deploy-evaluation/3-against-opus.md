---
title: "Alchemy evaluation: the case against (Claude Opus 5.5)"
description: "Verbatim attack report on replacing the wrangler deploys with Alchemy, from a second Claude Opus 5.5 agent, 2026-11-14."
sidebar:
  order: 3
---

> **Raw research, kept verbatim.** Attacker: Claude Opus 5.5 (general-purpose agent, web research plus repo reads), 2026-11-14. Its brief is quoted first, then its report exactly as it came back. It is evidence for [Alchemy as the deploy tool](/backlog/alchemy-deploy-evaluation/), not a decision: claims here were judged against the repo in that page, and some were corrected there.

## The brief it received

```text
Someone is confident in the claim below. Your job is to find where it is weak. Do not balance it with its strengths and do not soften findings. Do NOT edit any file; research only.

Claim:
Replacing our wrangler-CLI deploys with Alchemy (https://github.com/alchemy-run/alchemy, infrastructure-as-TypeScript) for the Kaipu Cloudflare Workers (web, api, console) is a net improvement: we gain infrastructure declared in code (Workers, service bindings, custom domains, R2 buckets, secrets) in one typed program, and lose nothing important.

Research Alchemy itself first with WebFetch/WebSearch (README, alchemy.run docs, GitHub issues, release cadence, state storage model, Cloudflare Workers/secrets/custom domains/preview versions support, maintainers, license, major version churn). Mark verified (URL) vs inferred.

Facts it must hold against (verified from the repo in the current working directory unless marked; you may read files, keep reads small):
- Three Workers with wrangler.jsonc: apps/server-hono (kaipu-api, Hono, nodejs_compat + nodejs_compat_populate_process_env, preview_urls, observability), apps/web-hono (kaipu-web, TanStack Start, assets binding, custom domains kaipu.app + www.kaipu.app, service binding API_SERVICE -> kaipu-api), apps/console (kaipu-console, custom domain console.kaipu.app, service binding to kaipu-api).
- Web proxies /api/auth/* and /api/v1/* to the API over a Service Binding so cookies are same-origin.
- Deploys: release-please per component -> .github/workflows/release-api.yml / release-web.yml -> scripts/deploy-worker.sh (pins wrangler 4.148.0, `wrangler deploy --secrets-file` so secrets ship atomically inside the version; --dry-run on the release-candidate PR). A shadowed wrangler version once broke api-v0.5.0.
- preview-web.yml uploads preview versions and reports version URLs (ADR 0007).
- No release workflow for console; deployed by hand from a laptop (inferred).
- DB is Neon Postgres via Drizzle. R2 buckets and DNS created by hand in the dashboard; no IaC today (assumed).
- Secrets: Infisical locally, GitHub secrets in CI.
- Solo developer, AI agents write most code; bun + turbo monorepo; rule: pinned tools, no postinstall.

Write a Markdown document:
1. Weak points, most serious first. For each: what breaks, the concrete scenario (inputs, state, sequence), how likely, the evidence that would confirm or rule it out, one way to fix or contain it.
2. Hidden assumptions the claim needs.
3. Alternatives that beat the claim, and under which conditions.
4. What would change your mind.
Mark known vs inferred. Say so if you found nothing serious; do not invent weak points.
```

## Its report

## Weak points in the claim "Alchemy instead of wrangler is a net improvement"

**Verdict: the claim does not hold today.** Four findings carry it:

- **Beta software.** Alchemy v2 is a beta that says "expect breaking changes". The v1 line, which uses the async API this repo once used, has been frozen since August.
- **Secrets.** Its handling of Worker secrets has two open bugs that point in opposite directions. Both conflict with how `--secrets-file` behaves today.
- **A new piece to own.** It adds a state store that this pipeline does not have now.
- **The repo already tried this.** Alchemy was added once and deleted on 2026-10-01.

Most of the "gain" (Workers, service bindings, custom domains declared in code) already exists in `wrangler.jsonc`.

Labels used below:

- **[V: URL]**: verified on the web.
- **[V: repo]**: verified in this checkout.
- **[I]**: inferred, not verified.

---

### 1. Weak points, most serious first

#### 1.1 The tool is a beta with heavy churn, and the stable line is frozen

**What breaks:** the deploy path of a production app depends on a moving target. You either stay pinned to a beta and live with its open bugs, or you upgrade and absorb API and state-format changes.

**Evidence:**

- The README says "alchemy v2 is in beta. Expect breaking changes." It is built on Effect ("Infrastructure-as-Effects") [V: https://github.com/alchemy-run/alchemy].
- npm `latest` is `2.0.0-beta.87`, published 2026-11-12. The first beta was 2026-04-13, so there were 87 betas in 7 months. About 41 versions shipped in April 2026 alone [V: `npm view alchemy time`].
- v1 moved to `alchemy-run/alchemy-async`. Its last release was 0.94.0 on 2026-08-01, and its last push was the same day [V: `gh api repos/sam-goodwin/alchemy`, which redirects there].
- The state format changes between versions:
  - beta.40 bumped the Cloudflare state store to v5, and older clients refuse to load it [V: search result for https://alchemy.run/blog/2026-05-15-beta-40/; I did not open that post].
  - The state docs warn: "State written by a newer version may use fields an older one can't read" [V: https://alchemy.run/state-store].
  - beta.61 lists a breaking change to `create` options [V: search snippet for https://alchemy.run/blog/2026-07-08-beta-61/].
- Bus factor: sam-goodwin has 1,479 commits; the next contributor has 209. There are 571 open issues plus PRs and about 1.9k stars. The license is Apache-2.0 [V: GitHub API].
- The peer dependencies are `effect ^4.1.4`, `@effect/platform-*`, `vite ^7||^8` and `@alchemy.run/frontend-frameworks` at the same beta. Effect 4.0.0 only went stable on 2026-10-01 [V: npm].

**Scenario:** a security or Cloudflare API change needs a newer beta. That beta bumps the state format, and nothing tested the migration for this stack.

**Likelihood:** high over a 12-month horizon.

**Would rule it out:** a 2.0.0 stable release with a stated compatibility policy for the state format.

**Containment:** wait for 2.0 stable. If you adopt earlier, pin an exact version and treat every upgrade as its own PR with a `plan` run against production state.

#### 1.2 Secret semantics change, and the provider's own behavior is unsettled

**What breaks:** secrets on `kaipu-api` and `kaipu-web`. Today they are additive. The workflow says so in plain words: "`--secrets-file` is additive: a secret left out of the file keeps its value." It also drops empty values with `select(.value != "")` [V: repo, `release-api.yml:90,127`, `release-web.yml:104,117`].

**Open Alchemy issues, which contradict each other:**

- [#2757](https://github.com/alchemy-run/alchemy/issues/2757): "A script upload replaces the Worker's whole binding set… every deploy deletes the secrets that were written to the Worker outside Alchemy" (the provider sends `keepBindings: undefined`) [V].
- [#2800](https://github.com/alchemy-run/alchemy/issues/2800), reported on beta.84: a secret dropped from `env` "is neither planned nor deleted, so it stays live on the Worker"; `plan` shows noop [V].

Taken together, nobody, including the maintainers, has settled whether an omitted secret survives a deploy. The answer apparently depends on how the account behaves.

**Scenario A, a secret is lost:**

1. A secret was set by hand with `wrangler secret put` or in the dashboard, or a GitHub secret is empty in the `production` environment.
2. Today the old value stays.
3. Under #2757 behavior, the next release removes it, and `kaipu-api` fails at runtime after a green deploy.

**Scenario B, a secret lingers:** you remove a leaked credential from code to revoke it. Under #2800 behavior it stays readable by the Worker, and `plan` does not show it.

**More evidence:**

- The docs do not say whether `secret_text` bindings travel inside the version upload, which is the atomicity `--secrets-file` gives you today [V: https://alchemy.run/cloudflare/security/secrets-env, silent on this].
- Only `Cloudflare.state()` encrypts `Redacted` values. Every other store keeps them in plaintext ([#3160](https://github.com/alchemy-run/alchemy/issues/3160), open). v1 had a state password; v2 dropped it [V].

**Likelihood:** medium-high. It only takes one secret that was set outside the program.

**Would rule it out:** both issues closed, with a test showing that an omitted secret is either kept or deleted, as documented, inside the same version upload.

**Containment:** declare every secret in the program, fail the deploy on any missing value, and compare the binding list after each deploy.

#### 1.3 A state store appears, with undocumented locking, and the current workflows race on it

**What breaks:** today wrangler is stateless; Cloudflare itself is the record of what exists. Alchemy adds a state store that can be lost, corrupted or raced.

**How the workflows run today** [V: repo]:

- `release-api.yml` and `release-web.yml` use different concurrency groups (`${{ github.workflow }}`), both with `cancel-in-progress: true`.
- `preview-web.yml` is deliberately not serialized with release-web: "uploading a version and deploying one are different operations and must not cancel each other."

**What Alchemy documents:**

- Only the Postgres store has a documented lock. The Cloudflare store does not document one [V: https://alchemy.run/state-store].
- On the AWS store, concurrent deploys of one stage "both succeed and leave corrupt state" ([#1967](https://github.com/alchemy-run/alchemy/issues/1967), closed) [V].
- [#2604](https://github.com/alchemy-run/alchemy/issues/2604), fixed around beta.84: a CI token without Workers Scripts Read made `Cloudflare.state()` treat the live store as missing, re-bootstrap it, and make "every entry already in it… unreadable" [V].
- The official CI example uses `cancel-in-progress: false` [V: https://alchemy.run/environments/ci]. This repo uses `true`, so a cancelled deploy leaves resources in an intermediate state [I that recovery always works; the docs claim it does].

**Scenario:** one release-please merge cuts `api-v*` and `web-v*`. To get "one typed program", both deploy the same stack and stage at the same time, or Preview Web runs during Release Web. Both write the same state with no documented lock.

The obvious fix is to split the stacks per Worker. That brings back cross-stack references (`Cloudflare.Worker.ref`, which lost RPC types until [#2607](https://github.com/alchemy-run/alchemy/issues/2607)), and most of the "one program" benefit goes with it.

**Likelihood:** medium.

**Would rule it out:** documented locking for `Cloudflare.state()`, or a single serialized deploy workflow.

**Containment:** one concurrency group for every Cloudflare deploy, set to `cancel-in-progress: false`, and a state backup before each deploy.

#### 1.4 Taking over the production apex domain is the riskiest single step

**What breaks:** `kaipu.app`, `www.kaipu.app` and `console.kaipu.app` are attached to Workers that wrangler created. They carry no Alchemy ownership tags.

**How adoption works:**

- A resource without Alchemy's ownership tags fails with `OwnedBySomeoneElse` unless you pass `--adopt`.
- Providers without ownership tags "adopt silently" [V: https://alchemy.run/cli/adopting-resources].
- Removal behavior for Worker custom domains is not documented. Only zones are documented as retained [V: https://alchemy.run/cloudflare/networking/custom-domains].

**Known bugs:**

- [#942](https://github.com/alchemy-run/alchemy/issues/942), fixed on beta.64: an omitted `domain` deleted custom domains attached out of band [V].
- [#1393](https://github.com/alchemy-run/alchemy/issues/1393), open: a Worker replacement "cannot transfer custom-domain traffic from its predecessor" [V].

**Scenario:** if the physical Worker name is not pinned exactly to `kaipu-web`, Alchemy creates a second Worker [I: I did not verify v2's default naming]. That Worker then contends for `kaipu.app` with the original. Any later change that forces a replacement hits #1393, and the apex either goes down or the deploy aborts.

**Likelihood:** low-medium if done carefully, and the damage is severe: the public site goes down.

**Would rule it out:** a dry adoption on a throwaway zone. Wrangler-created Worker plus custom domain, adopted by Alchemy, with no drop in traffic, then a forced replacement.

**Containment:** pin physical names, adopt one Worker at a time, rehearse on a test hostname first, and leave domains out of Alchemy at the start.

#### 1.5 The release-candidate gate loses its credential-free dry run

**What breaks:** the gate from the [local-first release verification ADR](apps/documentation/src/content/docs/architecture/decisions/0004-local-first-release-verification.mdx) and the [verify-only-the-component-it-ships ADR](apps/documentation/src/content/docs/architecture/decisions/0052-release-candidates-verify-only-the-component-they-ship.mdx). `pr-checks.yml:395-408` runs "the exact deploy command" with `--dry-run` and an empty `{}` secrets file, with no Cloudflare credentials [V: repo]. That check exists because api-v0.5.0 failed on the tag.

**On the Alchemy side:**

- The docs list no offline validate or bundle mode. The closest thing is `alchemy provider check-env` [V: https://alchemy.run/environments/ci, https://alchemy.run/cli/state].
- `alchemy plan` exists, since #2800 references it. Reading live state and resources almost certainly needs the production token [I].

**Scenario:** the release-candidate PR has two options.

- Give it production Cloudflare credentials. Then the stack program, arbitrary TypeScript from the branch, runs with a production token on a PR.
- Drop the check. Then deploy-command breakage reappears on the tag, which is the api-v0.5.0 failure mode.

**Likelihood:** certain that you must choose one of the two.

**Containment:** a read-only scoped token for `plan`, provided Alchemy can plan with read-only rights. For the AWS store it cannot ([#2751](https://github.com/alchemy-run/alchemy/issues/2751): "plan and drift take the S3 state lease, so they need write rights"). For the Cloudflare store this is unverified.

#### 1.6 Version URLs (ADR 0007) become stateful, and promoting the previewed version is unsupported

**What breaks:** the [Version-URL previews ADR](apps/documentation/src/content/docs/architecture/decisions/0007-prod-previews-via-version-urls.mdx). `preview-web.yml` runs `versions upload` from any ref with zero routed traffic, and it never touches deployment state [V: repo].

**On the Alchemy side:**

- The equivalent is `version: { traffic: 0 }` on the Worker resource, and you promote by removing the prop [V: https://alchemy.run/cloudflare/compute/gradual-deployments].
- That makes a preview a stack deploy with a changed prop, recorded in state.
- Deploying an already-uploaded version by id is not supported ([#2307](https://github.com/alchemy-run/alchemy/issues/2307), open) [V].
- Alchemy "Previews" are something else: separate named Workers, "not a Worker version" [V: https://alchemy.run/cloudflare/compute/previews].

**Scenario:** you preview `main@abc`, then cut the tag. Release Web uploads a new version again instead of promoting the one you inspected. A preview from a side branch leaves `traffic: 0` state that the next release has to reconcile.

**Likelihood:** high that the semantics change. The harm is moderate.

**Containment:** keep `preview-web.yml` on pinned wrangler. That means two tools, which brings us to 1.7.

#### 1.7 You end up with two declarations again, the exact reason Alchemy was deleted

**Repo history:** commit `52b45368` (2026-10-01), "chore(web): delete Alchemy, the deployment mechanism nothing deployed with" [V: repo]. A v1 `alchemy.run.ts` using `TanStackStart` and `CloudflareStateStore` sat next to wrangler. It "cost this repo exactly that — a design turn concluded the app deployed through Alchemy and planned around a migration that did not need to happen."

**Why wrangler.jsonc would stay** [V: repo]:

- Local dev for web and console uses `@cloudflare/vite-plugin`, which reads `wrangler.jsonc` (`apps/web-hono/vite.config.ts:6,13`).
- CLAUDE.md requires `wrangler types` to generate `worker-configuration.d.ts` from `wrangler.jsonc`.

Unless you also move dev to `alchemy dev`, `wrangler.jsonc` stays. Bindings are then declared twice and drift. Moving dev too brings its own open bugs: [#2156](https://github.com/alchemy-run/alchemy/issues/2156) (service-binding callers hit a missing target), [#3362](https://github.com/alchemy-run/alchemy/issues/3362) (rolldown plugins dropped in dev), and the recently closed [#3266](https://github.com/alchemy-run/alchemy/issues/3266) (cross-process service bindings return 503) [V].

**Also:** Alchemy bundles `main` with rolldown, or with its own `Website.Vite` for TanStack Start, instead of the Cloudflare Vite plugin. That changes the production bundle of both TanStack apps [V: Workers doc; I: impact not measured].

**Likelihood:** high.

**Containment:** migrate dev, types and deploy in one change, or don't migrate.

#### 1.8 The claimed gains are mostly already there, or don't apply

- **Workers, service bindings, custom domains, compatibility flags, assets, observability** are already declared in code in the three `wrangler.jsonc` files [V: repo]. The only new thing is a typed cross-reference instead of the string `"kaipu-api"`.
- **R2:** no Worker has an R2 binding.
  - `kaipu-api` reaches R2 through S3-style keys (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` as secrets) [V: repo, `release-api.yml:107-125`].
  - `kaipu-bucket` is the desktop release bucket that `release-desktop.yml:449-454` uploads to [V: repo].
  - Putting that bucket under a tool whose `destroy` and removal defaults for R2 are undocumented puts the desktop update feed at risk [I].
  - Read drift on R2 is broken: "R2.Bucket read returns saved lifecycle rules, CORS and domains, so drift can't see them change" ([#2985](https://github.com/alchemy-run/alchemy/issues/2985), open) [V].
- **Secrets:** the values still come from Infisical and GitHub. Alchemy only moves where the binding is declared, and section 1.2 shows that this is the least reliable part.
- **Not covered by any finding:** the Cloudflare Access app on preview URLs (required by ADR 0007), Neon, and the DNS records created by hand. I did not check whether Alchemy covers Access [I].

#### 1.9 Agents will write the wrong API

AI agents write most of the code here. Alchemy has v1 (async, `alchemy/cloudflare` helpers) and v2 (Effect, `Cloudflare.Website.Vite`), and docs for both are still online [V: search results show v1 `TanStackStart(...)` and v2 `Cloudflare.Website.Vite(...)` pages side by side].

The deleted file in this repo was v1-style [V: repo]. Agents will produce v1 code or mismatched beta APIs; wrangler config is a far more stable target [I].

**Containment:** pin the docs version in CLAUDE.md, or `llms.txt` for the pinned beta, and keep a compile check.

#### 1.10 Not a weak point: the "pinned tools, no postinstall" rule

The published package has no `install` or `postinstall` script; the listed scripts are repo development scripts. It is a regular dependency, which fits pinning [V: `npm view alchemy@2.0.0-beta.87 scripts`]. Alchemy also removes the wrangler-shadowing class of bug, because it calls the Cloudflare API directly [I]. That is a real point in the claim's favor.

---

### 2. Hidden assumptions the claim needs

1. **Stable enough for production.** A beta with "expect breaking changes" is treated as stable for a production deploy path. Its state format must not change under you, or every upgrade must be rehearsed.
2. **Secrets.** Declaring a secret in code means it gets set atomically with the version, removed when dropped, and kept when omitted. None of these is verified; two open issues contradict each other.
3. **One stack, no races.** A single typed program with no concurrent writers. That conflicts with three independent Cloudflare workflows today, two of them set to `cancel-in-progress: true`.
4. **Safe adoption.** Wrangler-created Workers and apex custom domains can be adopted without downtime or duplicate Workers.
5. **Nothing set out of band.** No secret, domain or setting (Access, observability tweaks) is changed outside the program, or the program will undo it, or keep it, inconsistently.
6. **Previews keep working.** Version-URL previews and the credential-free dry run can be expressed in Alchemy without new credentials or state coupling.
7. **One declaration.** Dev (vite-plugin) and types (`wrangler types`) move too, or the duplication is acceptable. History says it is not.
8. **Someone owns the state store.** A solo developer is willing to own it: bootstrap, backups, token scopes (#2604 shows what a wrong scope does).
9. **"IaC" means the bucket and DNS.** The real infrastructure gap is R2 and DNS. Those change rarely and are low-risk to create by hand.

---

### 3. Alternatives that beat the claim, and when

1. **Keep wrangler and fill the actual gaps.** This wins now.
   - Add a `release-console.yml` on `deploy-worker.sh`. Console is deployed by hand today [I: from the brief; not checked].
   - Write a short bootstrap note or script for R2, DNS and Access.
   - Optionally add a CI check that diffs the binding list after deploy.
   - Nothing about the release pipeline, Version URLs or the dry-run gate changes.
2. **Wrangler for Workers, plus IaC only for slow-moving account resources** (R2 buckets, DNS, Access apps, API tokens). Use the Cloudflare Terraform or OpenTofu provider, or Pulumi. These are mature and have documented state locking.
   - Wins when the hand-made resources start changing, or when a second environment has to be stamped out.
   - The deploy path stays untouched.
3. **Alchemy for new, non-production pieces only.** For example, the deferred development environment in ADR 0007 ("a persistent development environment… deliberately not built until something pre-production needs to write").
   - Wins once Alchemy 2.0 is stable and you need per-environment copies with binding resolution. That is the Service Binding problem the deploy-environments backlog page names.
   - Its blast radius is a Worker that holds nothing.
4. **Full Alchemy migration.** It only beats 1 and 2 after:
   - 2.0 stable;
   - #2757 and #2800 resolved;
   - documented locking on `Cloudflare.state()`;
   - a rehearsed apex adoption;
   - dev moved to `alchemy dev` without the open service-binding bugs.

---

### 4. What would change my mind

- Alchemy 2.0.0 ships stable, with a written state compatibility policy, and keeps it for about 3 months without a state-format bump.
- [#2757](https://github.com/alchemy-run/alchemy/issues/2757) and [#2800](https://github.com/alchemy-run/alchemy/issues/2800) close with documented, tested secret semantics (kept, deleted, atomic with the version).
- `Cloudflare.state()` documents a per-stage lock, and `plan` works with a read-only token, or offline.
- Promoting an uploaded version by id becomes possible ([#2307](https://github.com/alchemy-run/alchemy/issues/2307)), so Version-URL previews stay in the same tool.
- A rehearsal on a test zone works: adopt a wrangler-created Worker with a custom domain and a service binding, deploy, force a replacement, see no traffic loss.
- A real need for a second environment, which is the one place Alchemy's typed cross-resource wiring clearly beats per-environment wrangler config, whose bindings are not inherited.

---

**Not verified:** v2's default physical naming, the default removal policy for Worker custom domains and R2, whether `plan` needs write credentials on the Cloudflare store, whether a v2 Worker passes `nodejs_compat_populate_process_env` through unchanged, and how Alchemy's bundle differs from the Cloudflare Vite plugin's build of the TanStack apps.

Sources: [alchemy README](https://github.com/alchemy-run/alchemy), [state store](https://alchemy.run/state-store), [Workers](https://alchemy.run/cloudflare/compute/workers), [adopting](https://alchemy.run/cli/adopting-resources), [secrets](https://alchemy.run/cloudflare/security/secrets-env), [previews](https://alchemy.run/cloudflare/compute/previews), [gradual deployments](https://alchemy.run/cloudflare/compute/gradual-deployments), [custom domains](https://alchemy.run/cloudflare/networking/custom-domains), [CI](https://alchemy.run/environments/ci), [beta.40 notes](https://alchemy.run/blog/2026-05-15-beta-40/), [beta.61 notes](https://alchemy.run/blog/2026-07-08-beta-61/), and the GitHub issues linked inline.

Repo files: `scripts/deploy-worker.sh`, `.github/workflows/{release-api,release-web,preview-web,pr-checks,release-desktop}.yml`, `apps/{web-hono,console,server-hono}/wrangler.jsonc`, `apps/documentation/src/content/docs/backlog/deploy-environments.md`, `apps/documentation/src/content/docs/architecture/decisions/0007-prod-previews-via-version-urls.mdx`, and commit `52b45368`.
