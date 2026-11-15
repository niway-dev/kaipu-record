---
title: "Alchemy as the deploy tool: evaluation for a future staging or nightly environment"
description: What replacing the wrangler deploys of kaipu-web, kaipu-api and kaipu-console with Alchemy would gain, lose and change, argued by three agents, with the decision to stay on wrangler and the conditions that reopen it.
---

# Alchemy as the deploy tool

> **Status: 🔵 Proposed · 2026-11-14 · decision: stay on wrangler for now.** Research only;
> nothing in the deploy path changes. Tracked in Linear as NIW2-798. Read this before
> designing a staging or nightly environment, so that session starts from the evidence
> instead of repeating it.

## Summary

[Alchemy](https://github.com/alchemy-run/alchemy) is infrastructure as TypeScript: one
program declares Workers, bindings, domains, buckets and secrets, and a state store records
what it created. We asked whether it should replace `scripts/deploy-worker.sh` (pinned
wrangler) for the three Cloudflare Workers.

**Answer: not today.** Alchemy would change almost the whole deploy path for gains we do not
need yet. Its real case is **ephemeral full stacks per PR** (web + api + a Neon branch,
created and destroyed automatically), and only once its 2.0 line is stable.

For the **nightly build** we expect to want soon, a single persistent environment, wrangler
environments are enough. See [The nightly path](#the-nightly-path).

| Decision                                          | Why                                                                                                               | ADR                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Keep wrangler for Worker deploys                  | Alchemy v2 is a beta, adds a state store, changes secret semantics and the frontend build                         | none yet; write one if this is reopened |
| A nightly environment uses wrangler `env.nightly` | A single persistent environment needs its own Service Binding target, which wrangler environments already declare | none                                    |
| Revisit Alchemy only for ephemeral per-PR stacks  | That is the one gain wrangler cannot match without custom scripting                                               | none                                    |

**Open questions:** none blocking. The unverified points are listed under
[What was not verified](#what-was-not-verified).

**Out of scope:** the desktop release pipeline, Neon itself, and the Lighthouse series.

## How this was evaluated

Three agents worked from the same facts about this repository, each with its own brief, on
2026-11-14:

- **For:** Claude Opus 5.5, asked for the strongest honest case.
- **Against:** gpt-6.1-sol (Codex, high reasoning), asked only to find weak points. It also
  read the Alchemy `v2.0.0-beta.87` source.
- **Against:** Claude Opus 5.5, with the same attack brief.

The attackers saw the claim and the facts, never the case for it. Every repository claim
below was checked against the code; Alchemy claims carry their source.

## What we deploy today

- **Three Workers**, each with a `wrangler.jsonc`:
  - `apps/server-hono` (`kaipu-api`);
  - `apps/web-hono` (`kaipu-web`, custom domains `kaipu.app` and `www.kaipu.app`);
  - `apps/console` (`kaipu-console`, `console.kaipu.app`).
  - Web and console reach the API through a Service Binding (`API_SERVICE`) whose target is
    the Worker named `kaipu-api`.
- **API and web deploy from CI.** release-please cuts a tag per component, and
  `release-api.yml` / `release-web.yml` run `scripts/deploy-worker.sh`. That script pins
  wrangler 4.148.0 and runs `wrangler deploy --secrets-file`, so secrets ship inside the
  same version as the code.
  - `--secrets-file` is additive: a secret left out of the file keeps its deployed value.
  - The release-candidate PR runs the same command with `--dry-run` and no Cloudflare
    credentials (`pr-checks.yml`), because api-v0.5.0 once failed only on the tag.
- **The console has no release workflow.** No file in `.github/workflows/` mentions it.
- **Previews** are version uploads with zero traffic, inspected through their version URL
  ([prod previews via version URLs](/architecture/decisions/0007-prod-previews-via-version-urls/)).
- **No IaC exists** for the R2 buckets (private recordings, public desktop releases), DNS or
  Cloudflare Access. They were created in the dashboard.
- **Alchemy was here once.** Commit `52b45368` (2026-10-01) deleted
  `apps/web-hono/alchemy.run.ts` and its `deploy`/`destroy` scripts. No workflow ever called
  them, and the file led a design session to believe the app deployed through Alchemy.

## What we would gain

These survived the attacks:

1. **Isolated environments by reference, not by name.** Today any second environment must
   work out which API its web half talks to, or a staging front end writes to the production
   database (see [Deploy environments](/backlog/deploy-environments/)). In Alchemy a binding
   points to a resource object, so the web Worker of stage `pr-123` binds to the API of
   `pr-123` ([stages](https://alchemy.run/environments/stages)).
   - A Neon provider with per-PR branches covers the database half
     ([Neon preview branches](https://alchemy.run/neon/guides/preview-branches)).
   - Destroying a stage on PR close is a documented CI pattern
     ([CI](https://alchemy.run/environments/ci)).
2. **The buckets and DNS become code.** `R2.Bucket` declares domains, lifecycle rules and a
   retain policy ([R2](https://alchemy.run/cloudflare/data/r2)). A Worker `domain` provisions
   the DNS record and the certificate
   ([custom domains](https://alchemy.run/cloudflare/networking/custom-domains)).
3. **Secrets declared once, read from Infisical.** This would remove the hand-written `jq`
   list in each release workflow
   ([secret providers](https://alchemy.run/environments/secret-providers)).
4. **No wrangler-version shadowing.** Alchemy calls the Cloudflare API itself. `deploy-worker.sh`
   already contains that failure, so this gain is small.

What did **not** survive: "Workers, bindings and domains declared in code." They already are,
in `wrangler.jsonc`. "The console gets CI" is also not an Alchemy gain: one more workflow
around `deploy-worker.sh` does it.

## What we would lose

1. **A stable tool.** npm `latest` is `2.0.0-beta.87` (2026-11-12): 87 betas since
   2026-04-13. The README says "Expect breaking changes", and beta.40 bumped the state format
   so that older clients refuse it. The stable v1 line (0.94.0) has been frozen since
   2026-08-01, and its state does not carry over to v2
   ([migrating from v1](https://alchemy.run/migrating-from-v1)).
2. **A stateless deploy.** Today Cloudflare is the only record. Alchemy adds a state store (a
   Worker plus a Durable Object in `Cloudflare.state()`) that must be bootstrapped, backed up
   and reachable on every deploy ([state store](https://alchemy.run/state-store)).
   - Locking is documented only for the Postgres store.
   - Our release workflows use `cancel-in-progress: true`; the Alchemy CI example uses `false`.
3. **Today's secret guarantees.** In the beta.87 source, a secret Alchemy managed before and
   that is now missing from the declaration is **deleted**, and each deletion deploys a new
   version at 100% traffic.
   - Scenario: a GitHub secret goes empty, the ported "drop empty values" filter omits it,
     and Google sign-in or email stops working after a green deploy.
   - Two open issues disagree on how omitted secrets behave
     ([#2757](https://github.com/alchemy-run/alchemy/issues/2757),
     [#2800](https://github.com/alchemy-run/alchemy/issues/2800)).
   - Only `Cloudflare.state()` encrypts `Redacted` values; other stores keep them readable
     ([#3160](https://github.com/alchemy-run/alchemy/issues/3160)).
4. **The credential-free release check.** `alchemy plan` reads live state, so the
   release-candidate PR would need a production token, or the check goes away.
5. **The current frontend build.** The TanStack Start guide requires removing
   `@cloudflare/vite-plugin`, which both `apps/web-hono` and `apps/console` use
   ([TanStack Start](https://alchemy.run/cloudflare/frontend/tanstack-start)). That changes the
   production bundle and the dev server, and the same-origin auth proxy runs through both.

## What would change in the system

- The three `wrangler.jsonc`, the generated `worker-configuration.d.ts` and
  `deploy-worker.sh` are replaced by a TypeScript program and a state store.
- **Several stacks, not one.** With a single root stack, an older `api-v*` tag would also
  redeploy an older web from its checkout. Per-component releases need one stack per Worker
  plus one for shared infrastructure
  ([multi-stack](https://alchemy.run/project-structure/monorepo-multi-stack/)).
- Previews become stack deploys with `traffic: 0`, recorded in state.
- Local dev moves from Vite to `alchemy dev`, which has open service-binding bugs
  ([#2156](https://github.com/alchemy-run/alchemy/issues/2156)).
- The Worker provider deletes live custom domains missing from the declaration. Leaving out
  `www.kaipu.app` during the migration would detach it.

## Where the attacks did not hold

- **"Alchemy cannot keep version previews."** False: `traffic: 0` exists
  ([gradual deployments](https://alchemy.run/cloudflare/compute/gradual-deployments)). The
  semantics change; the capability is there.
- **"The release would not ship the version that was previewed."** True for Alchemy, which
  cannot deploy an uploaded version by id
  ([#2307](https://github.com/alchemy-run/alchemy/issues/2307)), but `release-web.yml` already
  runs a fresh `wrangler deploy` today. Nothing is lost; promote-by-id is a gain neither tool
  gives us now.
- **"Secrets end up in plaintext state."** True only for stores other than
  `Cloudflare.state()`. It is a requirement to set, not a blocker.
- **"It can detach `www.kaipu.app`."** Only if the declaration omits it. The domains are
  already written in wrangler, and a check against the live domain list contains it.
- **"It breaks the no-postinstall rule."** False: the published package has no install
  scripts.

## The nightly path

A nightly build is **one persistent environment** that `main` deploys to on a schedule. It
does not need Alchemy:

- Wrangler environments (`env.nightly` in each `wrangler.jsonc`) deploy as separate Workers
  (`kaipu-api-nightly`, `kaipu-web-nightly`).
- Bindings are not inherited between wrangler environments, so `env.nightly` in
  `apps/web-hono` declares its own `services` entry pointing at `kaipu-api-nightly`. That
  closes the API half of the "staging web writes to the production database" trap from
  [Deploy environments](/backlog/deploy-environments/).
- `scripts/deploy-worker.sh` takes only an app directory today. A nightly workflow needs it to
  pass `--env nightly` through, so the pinned-wrangler path stays the one deploy path.
- `routes` is inherited, unlike bindings. Without its own `routes`, `env.nightly` of
  `apps/web-hono` would try to claim `kaipu.app` and `www.kaipu.app`, so it must declare a
  nightly hostname (or none, with `workers_dev`).
- It does not close the other half. The web Worker also receives `DATABASE_URL` directly
  (`release-web.yml`), so a nightly deploy needs its own secrets file with a non-production
  database URL for **both** Workers. Alchemy would not remove that step either: a stage still
  needs its own database value or a Neon branch.
- The rest of that design (database, Infisical folder, hostname, Access) stays open in that
  page; this evaluation does not decide it.

## Reopen when

Adopt Alchemy only when **both** hold:

1. We need **ephemeral full stacks per PR**, created and destroyed automatically, not just one
   nightly or staging environment.
2. Alchemy 2.0 is stable, and the secret omission and rotation behaviour is documented and
   tested (the two issues above closed).

Even then, start with a non-production stage and separate stacks. Production and the
`kaipu.app` domain go last, after rehearsing adoption of a wrangler-created Worker with a
custom domain on a test zone.

## What was not verified

- Whether v2 keeps the exact physical Worker name (`kaipu-api`) on adoption, or creates a
  second Worker.
- Whether `alchemy plan` on the Cloudflare state store works with a read-only token.
- Whether a v2 Worker passes `nodejs_compat_populate_process_env` through unchanged.
- How the Alchemy bundle of the TanStack apps differs from the Cloudflare Vite plugin build.
- Whether Alchemy covers Cloudflare Access applications.
