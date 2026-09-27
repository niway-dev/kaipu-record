---
title: Open source under AGPL-3.0
description: Why Kaipu opens its source, why the whole monorepo opens at once, what has to happen before the repository goes public, and how contributions are kept from breaking the product.
---

# Open source under AGPL-3.0

**Owner decision · 2026-09-27.** Kaipu Record will be open source under the
**GNU Affero General Public License v3**. The license file and every `package.json` `license`
field already say `AGPL-3.0-only` on this branch; the repository itself stays private until
the checklist below is done. Opening it is the launch event, not a quiet flag flip.

## Why open source is an asset here

- **Trust.** A screen recorder asks for screen capture, accessibility and system audio. "Read
  the code" is the strongest answer to "what does this do with my screen?" That matters more
  in this category than in most.
- **Distribution.** The two closest competitors are open source. Cap's stars and Recordly's
  "free alternative to Screen Studio" story are their acquisition channel. A closed app
  competes for the same users without that channel.
- **It does not conflict with the model.** The [monetization ADR](/desktop/filesystem-first-monetization/)
  already commits to "local is free, the network layer is what is sold." Cap runs exactly that
  model on AGPL. Opening the source changes nothing about what is charged for.

## Why AGPL and not MIT

The repository was MIT. MIT lets anyone repackage the app and sell it, or run the cloud
server as their own service, with no obligation to publish changes. AGPL requires anyone who
distributes a modified app **or runs a modified server for users over a network** to publish
their changes. That protects the cloud layer, which is the business, while leaving every user
free to read, build and modify the app. Cap and Recordly both chose AGPL for the same reason.

**Relicensing is clean.** Every commit in the history is by the owner; there are no outside
contributors whose consent would be needed. Nobody outside received the code under MIT, so
there is no earlier MIT copy in circulation. The change is a single commit on this branch.

## The monorepo opens as a whole

The monorepo means there is no "open the desktop app, keep the server private." Splitting
`apps/server-hono`, `packages/infra-*` and the Cloudflare workers into a second repository
would cost more than it protects, and would break the single-source-of-truth docs site. So
the decision is: **everything opens**, as Cap does, and the cost of that is a security pass on
the server before the day it happens. That pass is already the
[backend security hardening](/backlog/backend-security-hardening/) workstream; opening the
repo makes it a hard prerequisite rather than a nice-to-have.

## Pre-open checklist

Nothing below is optional. Each item is a way a public repository has hurt a project like
this one.

1. **Secrets.** Scan the _entire git history_, not just `HEAD`, for tokens, keys, database
   URLs and Infisical exports. Rotate anything found, then rewrite or squash history if
   needed. Infisical already keeps secrets out of files; the scan is for the past.
2. **Security hardening.** The seven "blocks cloud production" backlog items
   ([backend](/backlog/backend-security-hardening/), [dependencies](/backlog/dependency-security-upgrades/),
   [R2 integrity](/backlog/r2-upload-integrity/), [cloud config](/backlog/production-cloud-security/),
   [abuse controls](/backlog/api-abuse-controls/), [Electron](/backlog/electron-security-hardening/),
   [data lifecycle](/backlog/cloud-data-lifecycle/)) are done or explicitly accepted.
3. **Docs language.** The remaining Spanish pages are translated or moved out of the public
   site; the repo content rule is English.
4. **Personal references.** Nothing in docs, fixtures or comments that names people, clients
   or private infrastructure that should not be public.
5. **`CONTRIBUTING.md`** with the contribution policy below.
6. **`SECURITY.md`** with a private disclosure address.
7. **Issue templates** that ask for the app version, OS and a recording of the problem.
8. **A first public release** with signed macOS and Windows artifacts already attached, so the
   first visitor can download, not only clone.

## Contribution policy

Recordly's public post-mortem is the warning: unreviewed, AI-generated pull requests introduced
export crashes, memory leaks and audio desync, and with one maintainer offline there was no one
to catch them. Kaipu is also a one-person project. The rules exist so that stays survivable.

- **Issue before pull request.** A PR without a linked, accepted issue is closed with a
  pointer to this rule. It is the only way to keep the maintainer's review queue bounded.
- **Small, single-purpose PRs.** One behavior per PR; refactors travel separately.
- **The existing gates apply to everyone.** `verify` locally, CI green, no new failing check on
  the commit ([ADR 0004](/architecture/decisions/0004-local-first-release-verification/)).
- **Disclose generated code.** A PR must say whether it was produced with an AI tool and
  confirm the author ran it. Undisclosed generated PRs are closed.
- **No drive-by dependency changes.** Adding or upgrading a dependency needs its own issue,
  because there is no `postinstall` and native rebuilds are explicit by design.
- **Maintainer bandwidth is the limit.** Response time is best-effort; the roadmap is the
  owner's. Forks are welcome, that is what the license is for.

## Timing

Open the repository as part of the launch bundle, not before: Windows beta, no-watermark free
tier, the new landing, the benchmarks page and the AGPL repository land in one announcement.
Each of those is stronger with the others beside it. Until then the license change sits on
`main` in a private repo, which is harmless.

## Alternatives kept in reserve

- **Source-available (Fair Source / BSL).** Readable code without redistribution rights. Less
  community pull, more control. The fallback if AGPL turns out to invite a fork-as-product
  anyway.
- **Split repositories.** Only if the server grows a life of its own; today the cost outweighs
  the benefit.

## Reopens when

A fork ships as a competing product, or maintenance load from contributions exceeds what one
person can review. Either would prompt the source-available fallback.
