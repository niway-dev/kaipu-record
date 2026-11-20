---
title: "Alchemy evaluation: the case against (gpt-6.1-sol)"
description: "Verbatim attack report on replacing the wrangler deploys with Alchemy, from gpt-6.1-sol with high reasoning, 2026-11-14."
sidebar:
  order: 2
---

> **Raw research, kept verbatim.** Attacker: gpt-6.1-sol (Codex, reasoning effort high; it also read the Alchemy v2.0.0-beta.87 source), 2026-11-14. Its brief is quoted first, then its report exactly as it came back. It is evidence for [Alchemy as the deploy tool](/backlog/alchemy-deploy-evaluation/), not a decision: claims here were judged against the repo in that page, and some were corrected there.

## The brief it received

```text
Someone is confident in the claim below. Your job is to find where it is weak. Do not balance it with its strengths and do not soften findings. Do NOT edit any file in the repo; this is research only.

Claim:
Replacing our wrangler-CLI deploys with Alchemy (https://github.com/alchemy-run/alchemy, infrastructure-as-TypeScript) for the Kaipu Cloudflare Workers (web, api, console) is a net improvement: we gain infrastructure declared in code (Workers, service bindings, custom domains, R2 buckets, secrets) in one typed program, and lose nothing important.

Research Alchemy itself first (its README, docs at alchemy.run, GitHub issues, release cadence, state storage model, how it handles Cloudflare Workers/secrets/custom domains/preview versions, maintainer count, license, current major version). Mark what you verified from a source (with URL) vs what you infer.

Facts it must hold against (verified from the repo at the current working directory unless marked):
- Three Cloudflare Workers, each with a wrangler.jsonc: apps/server-hono (kaipu-api, Hono, nodejs_compat + nodejs_compat_populate_process_env, preview_urls true, observability on), apps/web-hono (kaipu-web, TanStack Start, static assets binding, custom domains kaipu.app + www.kaipu.app, service binding API_SERVICE -> kaipu-api), apps/console (kaipu-console, TanStack Start, custom domain console.kaipu.app, service binding to kaipu-api). (verified)
- The web Worker proxies /api/auth/* and /api/v1/* to the API Worker over a Service Binding so auth cookies are same-origin. (verified, CLAUDE.md)
- Deploys: GitHub Actions release-api.yml / release-web.yml, triggered per component by release-please, call scripts/deploy-worker.sh, which pins wrangler 4.148.0 and runs `wrangler deploy --secrets-file` so secrets ship atomically inside the deployed version; --dry-run of the same script runs on the release-candidate PR. Past incident: a shadowed wrangler version broke api-v0.5.0. (verified: scripts/deploy-worker.sh, .github/workflows/release-*.yml)
- preview-web.yml uploads preview versions and reports version URLs (ADR 0007, prod previews via version URLs). (verified)
- No release workflow exists for console; it is deployed from a laptop with the wrangler CLI. (inferred)
- Database is Neon Postgres via Drizzle (not on Cloudflare). R2 buckets exist (kaipu-private-bucket, a public releases bucket). DNS and buckets were created by hand in the Cloudflare dashboard; there is no IaC today. (DB verified; buckets/DNS assumed)
- Secrets source of truth is Infisical for local dev; CI uses GitHub secrets. (verified)
- Solo developer, tooling heavily driven by AI coding agents; bun monorepo with turbo. Repo rule: no postinstall scripts, pinned tools. (verified)
- Local dev uses `bun run dev` per app (wrangler/vite dev). (assumed)

Write a Markdown document with these sections:
1. Weak points, most serious first. For each: what breaks, the concrete scenario (inputs, state, sequence) in which it breaks, how likely it is, the evidence that would confirm or rule it out, and one way to fix or contain it.
2. Hidden assumptions the claim needs to be true.
3. Alternatives that beat the claim, and under which conditions.
4. What would change your mind: the observation that would make the claim safe.
Mark what you know versus what you infer. Say so if you found nothing serious; do not invent weak points to fill the list. Reply with the full document as your final message (no file).
```

## Its report

## Weak-point review: replacing Kaipu’s Wrangler deploys with Alchemy

**The claim is unsafe as written.** Alchemy introduces a deployment-state dependency and has verified behavior differences around secret removal and domain reconciliation. Its documented TanStack integration also requires replacing part of Kaipu’s build tooling. These are substantive changes that need containment and proof before calling the migration a net improvement.

Research checked on **14 November 2026**. No repository files were edited and no deployments were performed.

**Evidence labels:** **Verified** means inspected in repository code, upstream code, documentation, or package metadata. **Reported** means described in an upstream issue without independent reproduction. **Inference** means a plausible consequence or failure scenario, not an observed Kaipu incident. Likelihood estimates are qualitative.

The Alchemy baseline:

- **Verified:** The current npm `latest` is **2.0.0-beta.87**. The README explicitly identifies v2 as beta and warns of breaking changes. Its API uses Effect; old async/await v1 examples describe a different API. [README](https://github.com/alchemy-run/alchemy), [npm metadata](https://registry.npmjs.org/alchemy).
- **Verified:** Releases are frequent but irregular: beta.80–87 appeared between 2 October and 12 November, including two releases on 12 November. Beta.86 includes breaking changes. Release frequency does not establish compatibility. [Release history](https://github.com/alchemy-run/alchemy/releases).
- **Verified:** The license is **Apache-2.0**. npm lists **three publishing maintainers**: `pear-alchemy`, `blankparticle`, and `sam-goodwin`. This is a publisher count, not a verified count of active project maintainers. GitHub contribution totals are concentrated: Sam Goodwin has 1,479 commits versus 209 and 130 for the next two contributors. **Inference:** maintenance knowledge is concentrated; those totals do not establish a precise bus factor. [License](https://github.com/alchemy-run/alchemy/blob/main/LICENSE), [npm metadata](https://registry.npmjs.org/alchemy), [contributors API](https://api.github.com/repos/alchemy-run/alchemy/contributors?per_page=15).
- **Verified:** Alchemy supports ordinary async Workers without rewriting their runtime into Effect. It supports typed service bindings, R2, custom domains, and Worker secrets. [Workers](https://alchemy.run/cloudflare/compute/workers/), [secrets](https://alchemy.run/cloudflare/security/secrets-env/), [R2](https://alchemy.run/cloudflare/data/r2/).
- **Verified:** Traffic-free version uploads exist through `version.traffic: 0`; named Worker Previews and independent stages are separate mechanisms. “Alchemy cannot preserve version previews” would be an incorrect objection. [Gradual deployments](https://alchemy.run/cloudflare/compute/gradual-deployments/).

### 1. Weak points, most serious first

#### 1.1. Typed secrets can become readable deployment state

**What breaks:** The assumption that moving secrets into a typed program preserves their existing confidentiality boundary.

**Verified:** In beta.87, `encodeState` unwraps `Redacted` values into their actual contents under `__redacted__`. Redaction is not encryption. [Pinned state encoder](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.87/packages/alchemy/src/State/StateEncoding.ts).

**Reported:** An open issue documents plaintext credentials in non-Cloudflare state backends. Its proposed encryption change remained an open, unmerged PR when checked. This is evidence of an unresolved backend-dependent gap, not evidence that every backend exposes plaintext. [State encryption report](https://github.com/alchemy-run/alchemy/issues/3160), [proposed change](https://github.com/alchemy-run/alchemy/pull/3167).

**Concrete scenario — inference:** An agent declares `DATABASE_URL`, `BETTER_AUTH_SECRET`, or a generated token through Alchemy. A developer uses default local state, or chooses a backend assuming `Redacted` means encrypted. State is subsequently copied into a backup or diagnostic artifact readable by someone who cannot access GitHub production secrets.

**Likelihood:** Material if state storage is left to defaults. Lower with an explicitly configured, encrypted backend and restricted access. No Kaipu exposure was observed.

**Evidence to confirm or rule out:** Deploy a synthetic canary secret using the exact proposed package versions and backend. Inspect raw state, backups, logs, and exported diagnostics. Determine which identities can retrieve decrypted state.

**Containment:** Require the encrypted Cloudflare state backend, restrict its credentials, and exclude local state from artifacts. Do not approve a backend based on `Redacted` types alone.

#### 1.2. Adopting a Worker can detach an omitted production hostname

**What breaks:** Availability of `kaipu.app`, `www.kaipu.app`, or `console.kaipu.app`.

**Verified:** Beta.87’s Worker provider reads the live custom domains attached to a Worker and deletes attachments absent from the desired domain list. It does this using live state rather than relying solely on previously recorded Alchemy ownership. [Pinned Worker provider](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.87/packages/cloudflare/src/Workers/WorkerProvider.ts#L1436).

**Concrete scenario — inference:** The migration pins `name: "kaipu-web"` and adopts the existing Worker. Its declaration includes `kaipu.app` but misses `www.kaipu.app`, perhaps because the author expects dashboard-created attachments to survive. Reconciliation detaches the omitted hostname.

A declaration that accidentally makes domains conditional on the wrong stage can produce an empty desired list.

**Likelihood:** High **conditional on an incomplete declaration**. The current Wrangler files explicitly list these hostnames, so this is a migration omission hazard rather than an existing Kaipu defect.

**Evidence to confirm or rule out:** Rehearse adoption against a disposable Worker with two preattached domains. Omit one and observe the result. For production, inventory all attachments and inspect both hostname responses after adoption.

**Containment:** Explicitly declare every hostname, retain exact Worker names, and add a migration assertion against the live inventory. Avoid a blanket `--adopt` across unrelated resources.

**Important correction to the claim’s baseline:** Kaipu’s custom domains and service bindings are already declared in `wrangler.jsonc`. The unverified dashboard-created history does not mean those settings currently lack code representation.

#### 1.3. Secret omission has different semantics from Kaipu’s additive secrets file

**What breaks:** Availability of features whose secrets disappear from CI input, and the assumption that every secret change is one atomic version transition.

**Verified in Kaipu:** Release workflows drop empty GitHub values and intentionally rely on `wrangler deploy --secrets-file` being additive: omitted secrets keep their previous values.

**Verified upstream:** Alchemy tracks secrets it previously uploaded. On a full upload, it explicitly deletes previously managed secrets missing from the new declaration. Its source notes that these deletions each deploy a new version at 100%. Secrets set outside Alchemy are treated differently. [Pinned removal implementation](https://github.com/alchemy-run/alchemy/blob/v2.0.0-beta.87/packages/cloudflare/src/Workers/WorkerProvider.ts#L4192).

**Concrete scenario — inference:** Alchemy has successfully managed `GOOGLE_CLIENT_SECRET` or `RESEND_API_KEY`. A later workflow loses that GitHub secret. Porting Kaipu’s existing “filter empty inputs” logic omits the binding. Alchemy interprets this as removal and deletes it, disabling sign-in or email.

A required `Config.Redacted` lookup could instead fail before deployment. That avoids deletion but still changes today’s “preserve the deployed value” behavior.

**Likelihood:** Deterministic if the migration carries over empty-value filtering for Alchemy-managed secrets. Otherwise dependent on the chosen configuration policy.

**Evidence to confirm or rule out:** Exercise secret addition, rotation, omission, empty input, and intentional deletion after uploading an undeployed preview version. Inspect version history and live traffic after each operation.

**Containment:** Define missing-secret behavior explicitly. Fail before mutation for required secrets; handle intentional removal separately. Do not assume an env object has the same semantics as `--secrets-file`.

#### 1.4. One root deployment can violate independent component releases

**What breaks:** The guarantee that an API release changes the API component, and a web release changes the web component.

**Verified in Kaipu:** API and web have separate tag triggers, verification scopes, and deployment jobs.

**Verified upstream:** Alchemy’s single-stack monorepo pattern deploys all declared apps in one plan. Its documented alternative for independent deployment cadences is multiple stacks with references to persisted outputs. [Single-stack pattern](https://alchemy.run/project-structure/monorepo-single-stack/), [multiple-stack pattern](https://alchemy.run/project-structure/monorepo-multi-stack/).

**Concrete scenario — inference:** Both workflows call the same root stack. A newer web tag deploys first. An older API tag runs afterward; its checkout contains older web code. If the stack rebuilds and reconciles all three Workers from that checkout, the API release also redeploys an older web version.

The workflows currently have different concurrency groups, so routing them into one shared stack also requires reconsidering serialization.

**Likelihood:** High under a naïve “replace both shell commands with root `alchemy deploy`” migration. Avoidable with deliberate deployment boundaries.

**Evidence to confirm or rule out:** Deploy deliberately out-of-order component tags. Show that an API-only release leaves web and console code versions, settings, and domains unchanged. Repeat with overlapping workflows.

**Containment:** Use independently deployed app stacks and a separate shared-infrastructure stack. Share TypeScript declarations where useful, but preserve ownership and release scope.

#### 1.5. Production deployment now depends on recovering Alchemy’s state service

**What breaks:** The ability to deploy from a fresh runner or recovery laptop using the current configuration and deployment credentials.

**Verified:** Alchemy defaults to local `.alchemy/` state. CI needs shared state. The recommended Cloudflare backend adds a Worker, Durable Object SQLite storage, authentication token, and encryption key. Missing backend infrastructure fails in CI and must be bootstrapped beforehand. State records are scoped by stack, stage, and resource identity. [State model](https://alchemy.run/state-store/).

**Concrete scenario — inference:** An urgent API fix reaches CI, but the state Worker is unavailable or its credentials cannot be resolved. The application Workers can still serve requests, yet Alchemy cannot complete its normal deployment.

Alternatively, a recovery laptop selects a different stack/stage identity and reads a different state namespace.

**Likelihood:** The new dependency is certain. An actual outage is unquantified. Recovery mistakes become more plausible when setup is undocumented or mostly agent-generated.

**Evidence to confirm or rule out:** Deploy from a clean machine with no cached Alchemy profile. Simulate inaccessible state, interrupted apply, and restoration from backup. Verify exact resource identities afterward.

**Containment:** Pin account, stack, and stage; bootstrap the backend explicitly; test backup and restore. Keep a documented Wrangler emergency path with a subsequent state-reconciliation procedure.

#### 1.6. The documented TanStack path changes Kaipu’s build and development integration

**What breaks:** Build parity and local development behavior, potentially including SSR and the same-origin API proxy.

**Verified in Kaipu:** Both frontend Vite configurations use `@cloudflare/vite-plugin`. The web app obtains `API_SERVICE` through `cloudflare:workers`.

**Verified upstream:** Alchemy’s TanStack guide explicitly says its integration is incompatible with `@cloudflare/vite-plugin` and requires removing it. It also documents deferred access to `cloudflare:workers` bindings during development. [TanStack integration](https://alchemy.run/cloudflare/frontend/tanstack-start/).

**Concrete scenario — inference:** A migration follows the guide, removes the plugin, and obtains a successful frontend build. Static pages work, but the SSR/runtime integration no longer supplies the expected binding in one execution path. Authentication requests then fail or use an unintended fallback.

This would affect cookies because Kaipu depends on forwarding authentication through its own origin.

**Likelihood:** The integration change is certain **if using the documented Website.Vite path**. An authentication regression is plausible but unproven. A prebuilt-artifact approach would need its own validation.

**Evidence to confirm or rule out:** Test static assets, SSR, `/api/auth/*`, `/api/v1/*`, forwarded host/protocol headers, cookies, and OAuth redirects on custom domains. Verify the API’s explicit compatibility date, both compatibility flags, and observability settings survive.

**Containment:** Start with disposable names and domains. Preserve the existing application runtime and Service Binding architecture; do not combine deployment migration with an Effect/RPC rewrite.

#### 1.7. Beta upgrades and agent confusion add maintenance work the claim does not count

**What breaks:** The assumption that typed infrastructure removes complexity without introducing an equivalent operational burden.

**Verified:** v2 is a breaking-change beta. The v1 migration guide documents incompatible state and changed resource naming/API conventions. This makes old examples unsafe to reuse mechanically. [Migration guide](https://alchemy.run/migrating-from-v1/).

**Verified in Kaipu’s history:** Commit [`52b45368`](https://github.com/niway-dev/kaipu-record/commit/52b453685d236b1da3d7c25d6044b71a2c994e56) removed an unused Alchemy configuration using `^0.81.2`. Its commit message records that this second deployment description had misled an agent about production deployment.

That is evidence of a configuration-authority problem, **not evidence that Alchemy previously failed in production**.

**Concrete scenario — inference:** An agent resurrects the old configuration or mixes v1 examples with v2 documentation. Alternatively, a package upgrade requires infrastructure changes during an application release. The solo developer must diagnose framework, provider, and state behavior before shipping.

**Likelihood:** Material in this agent-heavy repository. No numeric failure rate is established.

**Evidence to confirm or rule out:** A pinned migration branch, clean installation under the repository’s no-postinstall policy, passing release rehearsals, and a controlled dependency upgrade without resource replacement.

**Containment:** Pin the Alchemy package family and lockfile, remove obsolete deployment instructions, and schedule framework upgrades independently from application releases.

### 2. Hidden assumptions the claim needs to be true

1. **Existing configuration is counted correctly.** Workers, custom domains, service bindings, compatibility settings, and assets already have declarative Wrangler configuration. The genuinely additional coverage must be identified.

2. **Live infrastructure matches the supplied inventory.** Dashboard-created DNS and bucket history remains assumed. Worker attachments, bucket names, public access, CORS, lifecycle rules, and release-download domains need an actual inventory.

3. **Resource adoption preserves physical identities.** Default Alchemy names must not create parallel Workers or empty replacement buckets.

4. **One program preserves component release boundaries.** Shared types do not automatically make separate tag workflows safe.

5. **Secret ownership is intentional.** Infisical, GitHub secrets, Worker bindings, and Alchemy state must have explicit roles. Adding Alchemy does not itself reconcile those authorities.

6. **The private bucket and public releases bucket remain distinct.** Declaring R2 resources is not proof that existing data, public URLs, or external S3 credentials remain correct.

7. **Preview behavior is reproduced exactly.** Kaipu’s accepted design uses production version URLs for read-only inspection. It is not an isolated test environment. Alchemy’s default full deployment, zero-traffic upload, named Preview, and separate stage must not be substituted for one another accidentally.

8. **Typed bindings establish behavioral correctness.** They do not prove cookie origins, OAuth configuration, domain ownership, external database schema compatibility, or Cloudflare permissions.

9. **Repository workflow evidence proves laptop practice.** Console’s actual deployment provenance was not established by this research; the supplied laptop-deployment statement remains an inference.

10. **The solo developer’s maintenance cost is lower overall.** That conclusion needs observed savings sufficient to offset state operations, migration work, dependency upgrades, and recovery procedures.

### 3. Alternatives that beat the claim, and under which conditions

#### Keep Wrangler for application releases; add IaC only for unmanaged infrastructure

**Inference:** This is the strongest alternative when the actual gap is reproducible bucket/DNS provisioning.

Retain the existing atomic deploy script, release-candidate validation, component tags, and version uploads. Manage buckets and other unmanaged resources separately. Define one owner for each resource so infrastructure automation and Wrangler do not fight over settings.

Cloudflare provides a Terraform provider and resource-import workflow. [Cloudflare Terraform documentation](https://developers.cloudflare.com/terraform/).

This beats a full replacement when infrastructure changes infrequently and application deployment already meets requirements.

#### Use Pulumi TypeScript for infrastructure while retaining Wrangler

**Verified:** Pulumi has a Cloudflare provider usable from TypeScript. [Provider documentation](https://www.pulumi.com/registry/packages/cloudflare/).

**Inference:** This beats the proposed migration when TypeScript infrastructure is required but replacing TanStack’s build integration and Worker publishing behavior is unnecessary. It still introduces state and ownership work; it does not eliminate those concerns.

#### Keep Wrangler and close specific operational gaps

**Inference:** This wins when the immediate problem is console automation, resource inventory, or deploy documentation. Those can be addressed without changing the working API/web publishing mechanism.

#### Adopt Alchemy incrementally with separate ownership boundaries

**Inference:** This beats the all-at-once proposal if Alchemy is still preferred.

Begin with disposable resources or a limited nonproduction stack. Keep existing application releases until adoption, secrets, preview semantics, and recovery are demonstrated. Stateful buckets should have explicit protection: Alchemy supports removal policies, while R2’s default refusal to delete nonempty buckets must not be mistaken for complete protection against replacement or misbinding. [Lifecycle policies](https://alchemy.run/infrastructure-as-code/resource-lifecycle/), [R2 deletion behavior](https://alchemy.run/cloudflare/data/r2/).

### 4. What would change my mind: the observation that would make the claim safe

A **pinned, rehearsed migration** would make a narrower net-improvement claim defensible if it demonstrates all of the following:

1. Existing Workers, domains, and buckets are adopted with unchanged physical identities and no lost attachments or data.
2. API-only and web-only releases remain isolated, including out-of-order tags and overlapping jobs.
3. Secrets rotate with their intended code version; missing inputs preserve or deliberately reject deployment; intentional removals have understood version effects.
4. Raw state and backups protect synthetic secrets under the exact backend chosen.
5. Manual web preview uploads leave production traffic unchanged and preserve the current version-URL behavior.
6. Authentication, same-origin proxying, SSR, static assets, compatibility settings, and observability pass end-to-end checks.
7. A fresh runner and recovery laptop can deploy, and interrupted applies and state restoration have been exercised.
8. The installation respects pinned tools and the no-postinstall rule.
9. Actual usage shows reduced operational work sufficient to pay for the added state and framework maintenance.

**“Lose nothing important” is already too strong:** the migration adds state-service dependence and changes specific configuration semantics. The supportable claim would be that Alchemy’s measured benefits outweigh those explicit costs after the rehearsals above.
