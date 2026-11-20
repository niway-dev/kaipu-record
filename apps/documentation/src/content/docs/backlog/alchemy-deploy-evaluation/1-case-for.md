---
title: "Alchemy evaluation: the case for (Claude Opus 5.5)"
description: "Verbatim advocate report on replacing the wrangler deploys with Alchemy, 2026-11-14."
sidebar:
  order: 1
---

> **Raw research, kept verbatim.** Advocate: Claude Opus 5.5 (general-purpose agent, web research plus repo reads), 2026-11-14. Its brief is quoted first, then its report exactly as it came back. It is evidence for [Alchemy as the deploy tool](/backlog/alchemy-deploy-evaluation/), not a decision: claims here were judged against the repo in that page, and some were corrected there.

## The brief it received

```text
You are the advocate. Build the strongest honest case FOR this claim. Do not edit any file; research only. Do not invent benefits: every benefit must be tied to a concrete fact below or to a verified Alchemy capability (cite the URL).

Claim:
Replacing our wrangler-CLI deploys with Alchemy (https://github.com/alchemy-run/alchemy, infrastructure-as-TypeScript) for the Kaipu Cloudflare Workers (web, api, console) is a net improvement.

Research Alchemy first with WebFetch/WebSearch: README, alchemy.run docs, how it models Cloudflare Workers, service bindings, custom domains, R2, secrets, preview/version uploads, state storage, local dev, CI usage, adoption, current version. Mark verified (URL) vs inferred.

Facts (verified from the repo in the current working directory unless marked; you may read files to confirm, keep reads small):
- Three Workers with wrangler.jsonc: apps/server-hono (kaipu-api, Hono), apps/web-hono (kaipu-web, TanStack Start, assets, custom domains kaipu.app + www, service binding API_SERVICE -> kaipu-api), apps/console (kaipu-console, custom domain console.kaipu.app, service binding to kaipu-api).
- Web proxies /api/auth and /api/v1 to the API over a Service Binding (same-origin cookies).
- Deploys: release-please per component -> .github/workflows/release-api.yml / release-web.yml -> scripts/deploy-worker.sh (pins wrangler 4.148.0, `wrangler deploy --secrets-file` so secrets ship atomically with the version; --dry-run on the release-candidate PR). A shadowed wrangler version once broke api-v0.5.0.
- preview-web.yml uploads preview versions and reports version URLs (ADR 0007).
- No release workflow for console; deployed by hand from a laptop (inferred).
- DB is Neon Postgres via Drizzle. R2 buckets (private recordings bucket, public releases bucket) and DNS created by hand in the dashboard; no IaC today (buckets/DNS assumed).
- Secrets: Infisical for local dev, GitHub secrets in CI; each workflow builds a jq secrets file by hand listing ~11 vars.
- Solo developer, AI agents write most code; bun + turbo monorepo; rule: pinned tools, no postinstall.

Reply in Markdown:
1. What we gain, strongest first: each with the concrete Kaipu situation it improves (before vs after).
2. What changes in the system (files, workflows, local dev, secrets flow, mental model).
3. The adoption path you would propose that keeps risk lowest (scope, order, rollback).
4. The weakest part of your own case, stated honestly.
```

## Its report

## The case for Alchemy (advocate)

**This case is weaker than the claim suggests, and you should know two things before reading the benefits.**

- **The repo already tried Alchemy and removed it.** Commit `52b45368` (2026-10-01, "delete Alchemy, the deployment mechanism nothing deployed with") deleted `apps/web-hono/alchemy.run.ts` and its `deploy`/`destroy`/`alchemy:dev` scripts. No workflow ever called them. Production always went through wrangler. The file also made a design session believe the app deployed through Alchemy (`backlog/deploy-environments.md` lines 33–35). The audit doc also found that `alchemy.run.ts` called `dotenv` directly and bypassed Infisical. So my case has to be "adopt it properly, as the only path", not "add it".
- **The current Alchemy line is a beta rewrite.** npm `latest` is `2.0.0-beta.87`, published 2026-11-12. The first v2 beta came out on 2026-04-13. The last stable v1 is `0.94.0` (2026-08-01). The README says "alchemy v2 is in beta. Expect breaking changes" ([GitHub](https://github.com/alchemy-run/alchemy)). v1 state cannot be used by v2 ([migrating-from-v1](https://alchemy.run/migrating-from-v1)), and the v1 docs now live at `v1.alchemy.run`. The project has 2.0k stars, about 305 open issues, about 266 open PRs, and is Apache-2.0.

### 1. What we gain, strongest first

**1. A second environment becomes possible without a staging web writing to the production database.**

- Before: `deploy-environments.md` calls this the real blocker. `kaipu-web` reaches `kaipu-api` through a Service Binding by the literal name `"kaipu-api"`. Any new environment has to work out which API its web half talks to, "or a staging front end writes to the production database."
- After: a stage is an isolated copy of the whole stack with its own state ([stages](https://alchemy.run/environments/stages)). The binding is a reference to a resource object, not a string, so a `pr-123` stage's web binds to `pr-123`'s API. That is inferred from the reference model, verified only for v1 (`bindings: { API: apiWorker }`, [v1 worker](https://v1.alchemy.run/providers/cloudflare/worker)).
- The docs themselves recommend a full stage for multi-Worker PRs, because a Preview's service binding resolves to the bound Worker's _production_ deployment ([previews](https://alchemy.run/cloudflare/compute/previews)). That is exactly Kaipu's trap, and today's version-URL previews have the same limit.
- A Neon provider with per-PR preview branches exists ([neon preview branches](https://alchemy.run/neon/guides/preview-branches); I verified the page is listed in llms.txt, not its details). That would close the database half of the problem.

**2. The R2 buckets and custom domains that exist only in the dashboard become code.**

- Before: the private recordings bucket, the public releases bucket and DNS were created by hand. There is no record of their settings and no way to recreate them.
- After: `Cloudflare.R2.Bucket` declares `domains` for the public bucket, `lifecycleRules`, `locationHint`/`jurisdiction`, and `RemovalPolicy.retain()` so that removing a declaration never deletes the data ([R2](https://alchemy.run/cloudflare/data/r2)). Worker `domain` provisions the DNS record and the certificate ([custom domains](https://alchemy.run/cloudflare/networking/custom-domains)).
- `alchemy plan --adopt` previews taking over existing resources before applying ([adopting](https://alchemy.run/cli/adopting-resources)).
- Caveat: `kaipu-api` talks to R2 through S3 credentials (`R2_ACCESS_KEY_ID` and others in `release-api.yml`), not an R2 binding. So the gain is codifying the buckets, not typed bindings.

**3. Secrets get one source and one declaration per Worker.**

- Before: each workflow builds a `jq -n --arg …` secrets file listing about 11 variables (`release-api.yml` lines 115–126). The same values are copied into GitHub secrets, separate from Infisical. `release-api.yml` line 90 notes that `--secrets-file` is additive, so a secret dropped from the file silently keeps its old value.
- After: a Worker declares `env: { BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"), … }`, and redacted values bind as `secret_text` ([secrets-env](https://alchemy.run/cloudflare/security/secrets-env)). Infisical is a built-in secret provider: machine identity locally, platform OIDC in CI ([secret providers](https://alchemy.run/environments/secret-providers)). That could remove the GitHub-secrets copy and the hand-written jq lists.
- Inferred, not verified: that a declarative deploy also removes stale secrets. The docs do not say whether secrets upload atomically with the version, and today's `--secrets-file` guarantees that.

**4. The console gets the same release path as web and api.**

- Before: there is no `release-console.yml`. It is deployed by hand (inferred).
- After: one stack file that declares all three Workers plus the buckets makes "console isn't in CI" structurally impossible.
- To be fair, the generic `deploy-worker.sh` could do this today with about 100 lines of workflow. This gain is real but cheap to get without Alchemy.

**5. Fewer generated and duplicated artifacts for agents to keep in sync.**

- Before: three `wrangler.jsonc` files, `wrangler types` to regenerate `worker-configuration.d.ts` after every change (a CLAUDE.md rule), and bindings repeated in JSON and in types.
- After: one TypeScript file that type-checks. v1 infers `Env` with `typeof worker.Env` ([v1 worker](https://v1.alchemy.run/providers/cloudflare/worker)). TanStack Start needs no Wrangler config ([tanstack-start](https://alchemy.run/cloudflare/frontend/tanstack-start)).
- For a solo developer whose code is mostly written by agents, a mistake becomes a type error instead of a runtime 500.

**6. The wrangler-shadowing class of failure goes away, but only if wrangler leaves the deploy path entirely.**

- Before: `server-hono` and `console` pin wrangler `4.63.0` as a devDependency. That shadowed the workflow's version and broke `api-v0.5.0`. `deploy-worker.sh` exists to work around it.
- After: deploys go through one pinned npm dependency that calls the Cloudflare API (inferred). This is still one pinned tool replacing another, not fewer tools.

**7. Optional: PR comments and teardown come with it.**

- A `GitHub.Comment` resource updates one PR comment in place, and a cleanup job destroys `pr-N` stages on close, with a guard that refuses to destroy `prod` ([CI](https://alchemy.run/environments/ci)).
- This overlaps with `preview-web.yml` (161 lines) and the version-URL decision in [ADR 0007 (prod previews via version URLs)](/architecture/decisions/0007-prod-previews-via-version-urls/).

### 2. What changes in the system

**Files**

- Added: `alchemy.run.ts` at the repo root (or `infra/`) declaring `kaipu-api`, `kaipu-web`, `kaipu-console`, both buckets and their domains.
- Removed: the three `apps/*/wrangler.jsonc`, the `worker-configuration.d.ts` files, `scripts/deploy-worker.sh`, and the wrangler devDependencies once local dev moves.
- Unverified: whether v2 lets a Worker keep the exact physical name `kaipu-api`. v1 had a `name` prop; the v2 Workers page shows only logical ids. This decides whether adoption is in-place or a rename.

**Workflows**

- `release-api.yml` and `release-web.yml` stop building jq secrets files and run `alchemy deploy --stage prod` behind the same release-please tags.
- The verify gate from [ADR 0004 (local-first release verification)](/architecture/decisions/0004-local-first-release-verification/) stays in front.
- The release-candidate `--dry-run` becomes `alchemy plan` (the `plan` command is named in the state-store docs).
- `preview-web.yml` either stays as is or becomes a `pr-N` stage.

**Local dev**

- The docs say to remove `@cloudflare/vite-plugin`, which Alchemy is "not compatible with". Both `apps/web-hono/vite.config.ts` and `apps/console/vite.config.ts` use it today.
- `alchemy dev` runs on emulated local services ([home](https://alchemy.run/)). The TanStack Start page also says bindings in dev point at real cloud resources and need a `src/env.ts` Proxy.
- Today's rule that `bun run dev` never calls Infisical has to be rechecked against Alchemy's secret providers.

**Secrets flow**

- Infisical becomes the provider for both local and CI through OIDC.
- GitHub secrets shrink to the Cloudflare token (it needs Secrets Store Write) plus the Infisical identity.

**Mental model**

- A new piece of state appears. `Cloudflare.state()` keeps it in a Durable Object with SQLite, encrypted at rest. With `CI=true`, a missing store fails the run ([state store](https://alchemy.run/state-store)).
- "What is deployed" becomes "what state says", and losing or corrupting that state becomes a new failure mode.

### 3. Lowest-risk adoption path

1. **Wait, or pin hard.** Either wait for v2 to leave beta, or pin an exact beta and treat every bump as its own PR, matching the pinned-tools rule. Do not start on v1, because its state cannot carry over to v2.
2. **Start with the resources that have no IaC today: the two R2 buckets and their domains.** Use `RemovalPolicy.retain()` and `alchemy plan --adopt`. No Worker deploy changes, so rollback means deleting the file and the state while the buckets stay.
3. **Next, the console Worker, which has no release workflow.** It is the lowest-traffic Worker, and it gets a CI path it lacks today. Rollback is `wrangler deploy` from the still-existing config.
4. **Then `kaipu-api`, then `kaipu-web`, one release each.** Keep `wrangler.jsonc` and `deploy-worker.sh` until two releases have passed.
5. **Delete the wrangler path in the same PR that makes Alchemy the only path.** That is the lesson of `52b45368`: two mechanisms side by side mislead readers. Stages and per-PR environments come last, as their own design with Infisical's second environment.

At every step, the rollback is the previous wrangler deploy of the same Worker name, as long as the physical names are kept.

### 4. The weakest part of this case

The benefits worth having are environments (gain 1) and codified buckets and DNS (gain 2). Neither is a current pain:

- `deploy-environments.md` explicitly deferred the environment decision.
- The buckets were made once and rarely change.

The gains that address today's actual incidents can be had with wrangler at a fraction of the cost:

- The console workflow (gain 4) is one more workflow around `deploy-worker.sh`.
- The shadowed wrangler (gain 6) is already fixed by `deploy-worker.sh`.
- The jq lists (gain 3) could be generated from a single list of names.

In return, Kaipu would take on:

- a beta dependency with 87 betas in seven months and a warning that APIs will break;
- an incompatibility with the `@cloudflare/vite-plugin` setup both frontends use;
- a new state store to protect;
- unverified answers to the two questions that decide whether migration is safe: whether v2 keeps the `kaipu-api` name, and whether secrets ship atomically with the version.

The repo has already paid once for an Alchemy file nobody deployed with. The honest version of my case is: **a net improvement when Kaipu needs a second environment, and not before.**

Verified means I read the cited page or the npm registry on 2026-11-14. Everything marked inferred was not checked against Alchemy's source.

Sources:

- [alchemy-run/alchemy on GitHub](https://github.com/alchemy-run/alchemy)
- [alchemy.run](https://alchemy.run/) and [llms.txt](https://alchemy.run/llms.txt)
- [v1 Worker provider](https://v1.alchemy.run/providers/cloudflare/worker)
- [State store](https://alchemy.run/state-store)
- [CI](https://alchemy.run/environments/ci)
- [Secret providers](https://alchemy.run/environments/secret-providers)
- [Secrets & env](https://alchemy.run/cloudflare/security/secrets-env)
- [TanStack Start](https://alchemy.run/cloudflare/frontend/tanstack-start)
- [Adopting resources](https://alchemy.run/cli/adopting-resources)
- [Worker previews](https://alchemy.run/cloudflare/compute/previews)
- [Custom domains](https://alchemy.run/cloudflare/networking/custom-domains)
- [R2](https://alchemy.run/cloudflare/data/r2)
- [Workers](https://alchemy.run/cloudflare/compute/workers)
- [Migrating from v1](https://alchemy.run/migrating-from-v1)
- [Neon preview branches](https://alchemy.run/neon/guides/preview-branches)
