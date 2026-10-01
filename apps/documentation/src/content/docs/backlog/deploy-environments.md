---
title: "Deploy environments: where a pre-production step fits"
description: Captured design state for adding an intermediate environment to the Cloudflare Workers deploy flow — research, options, the answers already given, and what is left to decide.
---

# Deploy environments

> **Status: 🟢 Ready to validate · 2026-10-01.** The preview step is implemented; the persistent-environment question is captured, not decided. The research and the
> owner's answers are recorded here so the next session writes the spec instead of repeating
> the investigation.
>
> Shipped: **on-demand version uploads from any ref** (`preview-web.yml`). A persistent
> intermediate environment remains a separate, later decision.

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
- **The release path is plain wrangler, and now it is the only one.** `release-web.yml` builds
  and runs `cloudflare/wrangler-action@v3.14.1` with `command: deploy`. An unused second
  mechanism (`alchemy.run.ts` plus `deploy`/`destroy`/`alchemy:dev` scripts) sat beside it,
  called by no workflow, and was removed — it was already making readers believe the app
  deployed through Alchemy.
- **Infisical has a single environment, `dev`.** A persistent new environment needs a second
  one with its four folders — this is half the real work, not a detail.
- **ADRs live at `architecture/decisions/`**, numbered `0001`–`0006` (mediabunny over ffmpeg,
  plan entitlements, export never replaces the original, local-first release verification,
  release-candidate readiness, desktop E2E tier). A decision here would be `0007`.

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

## Decided, and shipped

**On-demand version uploads, not per-branch Previews.** The owner's described flow is "send what
is on `main` somewhere to look at it, when I choose to" — which is not branch testing, it is
exactly what Cloudflare documents **Version URLs** for: inspecting one uploaded version before
promoting it.

That distinction decided the implementation, because **`wrangler preview` does not exist in the
installed wrangler 4.63.0** — it would need an upgrade to ~4.146, and wrangler is a dependency of
`console` and `server-hono` as well. `wrangler versions upload` works today, with no upgrade.

Shipped as `.github/workflows/preview-web.yml`: `workflow_dispatch` with a `ref` input, the same
build as the release job, then `versions upload`. It prints the URL into the run summary with the
Lighthouse commands ready to paste. Production is untouched, because a version is uploaded and
never deployed.

Tags are not touched: `web-vX.Y.Z` still means production.

**It is a looking glass, not a gate.** Nothing forces anyone to run it before cutting a tag. That
is the right trade today — the goal is measuring against real edge and brotli — but it must not be
mistaken for protection. Making it protect a release means making it a required step, which is a
different decision.

Upgrading wrangler (4.63 → current) is captured separately as its own task; it unlocks
`wrangler preview` if the per-branch shape is ever wanted.

## What would reopen this

Any one of these turns the persistent environment from overhead into value, and is the trigger
to write the full spec and `ADR 0001`:

- a second person testing before a release, so an ephemeral per-branch URL is no longer enough;
- the Lighthouse series needing a **fixed address** measured over months rather than per PR;
- user count passing the point where a bad release costs more than the environment does;
- the API needing its own pre-production target, which brings the Service Binding problem back.

## Not yet done

- An ADR (`architecture/decisions/0007-…`) for the persistent environment — deferred, because
  that decision is not made. The preview step shipped without one: it adds a reversible manual
  workflow and changes no existing behaviour.
- **Upgrade wrangler 4.63 → current (~4.146).** Its own task: wrangler is a dependency of
  `console` and `server-hono`, so the upgrade is not scoped to the web app. It unlocks
  `wrangler preview` for the per-branch shape and clears the "update available" notice on every
  `wrangler dev`.
- The Infisical question, which only arises with the persistent shape.
- Local `deploy`/`destroy` scripts are gone with Alchemy and were not replaced. Production is
  reached by cutting a `web-v*` tag, which runs the verify gate first (ADR 0004). A laptop
  script that deploys straight to production would route around that gate, so its absence is
  the point, not an omission.
