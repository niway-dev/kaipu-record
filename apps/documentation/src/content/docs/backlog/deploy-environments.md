---
title: "Deploy environments: where a pre-production step fits"
description: Captured design state for adding an intermediate environment to the Cloudflare Workers deploy flow — research, options, the answers already given, and what is left to decide.
---

# Deploy environments

> **Status: 🔵 Proposed · design captured 2026-10-01, not decided.** The research and the
> owner's answers are recorded here so the next session writes the spec instead of repeating
> the investigation. No code or configuration has changed.
>
> Direction agreed: **start with per-branch Previews for the web app**, and treat a persistent
> intermediate environment as a separate, later decision.

## Why this came up

The landing is finished and about to be optimized for Core Web Vitals (see
[the baseline](/frontend/web-vitals-baseline/)). Measuring it properly needs a
production-equivalent target with real edge compression, which localhost cannot give. That
pulled in the larger question of whether the product needs an environment between `main` and
production at all.

## What the repository already does

- **Tags already mean production, unambiguously.** `release-web.yml` fires on `web-v*.*.*`,
  `release-api.yml` on `api-v*.*.*`, `release-desktop.yml` on `desktop-v*.*.*`. There is no
  second destination today.
- **`kaipu-web` reaches `kaipu-api` through a Service Binding by worker name.** This is the
  constraint that makes environments a real decision: any new environment must resolve which
  API its web half talks to, or a staging front end writes to the production database.
- **`web-hono` deploys through Alchemy**, not `wrangler deploy`. `alchemy.run.ts` already
  branches on `ENVIRONMENT === "production"` for its state store. The API and console are
  plain wrangler.
- **Infisical has a single environment, `dev`.** A persistent new environment needs a second
  one with its four folders — this is half the real work, not a detail.
- The repository has **no ADRs yet**. Whatever is decided here becomes `0001`.

## What the state of the art does

Cloudflare's guidance moved recently; designing from older material would pick the wrong option.

| Mechanism                                  | Persistence                   | Cloudflare's stated use                                                                                        |
| ------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Worker Previews** (`wrangler preview`)   | ephemeral, per branch         | _"the recommended way to test changes before production"_ — own vars, secrets, bindings, custom domain support |
| **Wrangler environments** (`deploy --env`) | persistent, `name-env` worker | when an environment needs persistent Workers with different settings, routes or domains                        |
| **Version URLs**                           | ephemeral, per version        | inspecting one version before promoting it — the docs say explicitly **not** for branch or PR testing          |

The trap in Wrangler environments: **bindings and vars are not inherited between
environments**. Each must be redeclared, so the day a binding is added to production and not
to staging, staging breaks in a way that does not resemble production.

Sources: [Compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/) ·
[Introducing Worker Previews](https://blog.cloudflare.com/worker-previews/) ·
[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

## The owner's answers (2026-10-01)

| Question                                         | Answer                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Does kaipu.app serve real users?                 | Yes, but **fewer than 10**.                                      |
| Does the API need the same treatment?            | **No** — this is a web test only.                                |
| Is a Preview enough?                             | Enough to ship now, **not a permanent answer**.                  |
| Is an intermediate environment wanted long term? | **Yes** — treated as a need for new products, not only this one. |

## The flow question, and why `main` should not be dev

The flow today is `branch → main → tag → prod`. The question was where a `dev` step fits, with
the note that breaking `dev` freely would be acceptable.

**Making `main` the breakable environment does not work with this release setup.** Tags are cut
from `main`; if `main` is the place where anything may be broken, a tag stops being a trustworthy
cut and every release becomes a gamble on what landed since the last one. The breakage has to
happen somewhere that is not the branch releases are cut from.

Two shapes fit the existing tags without changing their meaning:

1. **Pre-merge (the Previews shape).** `branch → preview URL → main → tag → prod`. The
   intermediate environment lives _before_ the merge, one per branch. `main` stays always
   releasable, tags keep meaning exactly what they mean today, and nothing new is maintained
   between deploys.
2. **Post-merge (the persistent-staging shape).** `branch → main → staging → tag → prod`, where
   every merge to `main` auto-deploys to a persistent staging worker and the tag promotes what
   was already verified there. `main` still has to stay releasable; staging is where
   accumulated changes are seen together before a release.

These are not exclusive — shape 2 is the natural second step once there is something that needs
a fixed address, and it leaves shape 1 in place for per-PR work.

## Decided for now

**Per-branch Previews for the web app.** It gives a real edge target with real compression today,
keeps production untouched, needs no second Infisical environment, and adds nothing to maintain
between deploys. Tags are not touched: `web-vX.Y.Z` continues to mean production.

## What would reopen this

Any one of these turns the persistent environment from overhead into value, and is the trigger
to write the full spec and `ADR 0001`:

- a second person testing before a release, so an ephemeral per-branch URL is no longer enough;
- the Lighthouse series needing a **fixed address** measured over months rather than per PR;
- user count passing the point where a bad release costs more than the environment does;
- the API needing its own pre-production target, which brings the Service Binding problem back.

## Not yet done

- The spec (`docs/specs/`) and `ADR 0001` — deliberately deferred; the decision above is
  provisional and recorded here, not ratified.
- Any configuration change. Previews are not set up yet.
- The Infisical question, which only arises with the persistent shape.
