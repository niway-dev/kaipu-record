---
title: Release automation with release-please (monorepo)
description: Adopt release-please to drive independent, drift-free versioning and releases for the desktop, web, and api apps from Conventional Commits.
---

## Problem

The desktop version lives only in `apps/kaipu-record/package.json` and was never
bumped off `0.1.0`. The `desktop-v*` git tag merely _triggers_ the release
workflow — it does not set the build version. So tagging `desktop-v0.2.0` without
bumping `package.json` produced a build stamped `0.1.0`: artifacts named
`kaipu-record-0.1.0-*.dmg`, and an update feed (`latest-mac.yml`) advertising
`version: 0.1.0` — byte-identical to the first release.

Consequence: an installed `0.1.0` app checks the feed, sees `0.1.0`, and correctly
concludes "nothing newer". **There has never been a version greater than `0.1.0`
in the feed, so `electron-updater` has never had anything to offer.** The
auto-updater code (`src/main/updater/auto-updater.ts`) is correct; the release
pipeline lets the tag and the built version drift apart silently.

The same decoupling affects web and api: their `package.json` are at `0.1.0` while
their tags advanced to `web-v0.1.1` / `api-v0.1.2`. It matters less there (they are
deployed services, where the version is cosmetic) but the root cause is identical.

## Goal

A release pipeline where the version that ships is always a real, committed fact
in the repo, the git tag can never disagree with the built version, and each app
(desktop / web / api) still releases **independently, one at a time**, exactly as
today — without hand-tagging.

## Decision

Adopt **[release-please](https://github.com/googleapis/release-please)** in
**manifest (monorepo) mode**, driven by Conventional Commits (which the repo
already uses: `feat(...)`, `fix(...)`, `docs(...)`, `test(...)`).

Why release-please over the alternatives:

- **vs. tag-first + CI commit-back:** avoids CI writing to `main`, and avoids the
  wart where the tag points at the pre-bump commit. release-please bumps
  `package.json` _inside_ a reviewable release PR, so the tagged commit already
  carries the correct version.
- **vs. manual bump + CI guard:** no manual two-step; the bot maintains the bump
  and changelog for us. A guard only _catches_ drift; release-please makes drift
  structurally impossible.
- **vs. semantic-release:** semantic-release leaves `package.json` at
  `0.0.0-development` (version derived at publish time). We explicitly want the
  repo to reflect the shipped version, which release-please and changesets do.

## How it works

Two layers of pull requests, kept separate:

1. **Your feature/fix PRs (unchanged).** Normal branches merged to `main` with
   Conventional Commit titles. release-please does not touch this.
2. **The release PRs (the bot).** release-please watches `main` and maintains a
   **rolling release PR per app**, updated on every merge — accumulating the
   changelog and recomputing the next version. Merging a release PR is the act of
   "publish this version": the bot bumps that app's `package.json`, writes its
   `CHANGELOG.md`, creates the tag, and opens a GitHub Release.

```
main
│  (your PRs — Conventional Commits)
├─ feat(recording): …   (apps/kaipu-record/**) ─┐
├─ fix(recording):  …   (apps/kaipu-record/**) ─┼─▶ release PR "desktop x.y.z" ─(merge)▶ desktop-v… ▶ release-desktop.yml ▶ bundle
├─ feat(api): …         (apps/server-hono/**)  ────▶ release PR "api x.y.z"     ─(merge)▶ api-v…     ▶ deploy-api.yml
└─ fix(web): …          (apps/web-hono/**)     ────▶ release PR "web x.y.z"     ─(merge)▶ web-v…     ▶ deploy-web.yml
```

Commits route to an app by the **files they touch**. `separate-pull-requests:
true` gives one release PR per app, each independently mergeable — so releases
stay one-at-a-time, and the existing `desktop-v*` / `web-v*` / `api-v*` tag
convention (and every downstream workflow) is unchanged. release-please simply
becomes the thing that _creates_ those tags instead of a human.

## App → component → tag → workflow

| App                 | Component | Tag pattern      | Downstream workflow   | Seed version |
| ------------------- | --------- | ---------------- | --------------------- | ------------ |
| `apps/kaipu-record` | `desktop` | `desktop-v*.*.*` | `release-desktop.yml` | `0.2.0`      |
| `apps/web-hono`     | `web`     | `web-v*.*.*`     | `deploy-web.yml`      | `0.1.1`      |
| `apps/server-hono`  | `api`     | `api-v*.*.*`     | `deploy-api.yml`      | `0.1.2`      |

`apps/documentation` is not released.

## Configuration

`release-please-config.json` (repo root):

```json
{
  "separate-pull-requests": true,
  "bump-minor-pre-major": true,
  "packages": {
    "apps/kaipu-record": { "release-type": "node", "component": "desktop" },
    "apps/web-hono":     { "release-type": "node", "component": "web" },
    "apps/server-hono":  { "release-type": "node", "component": "api" }
  }
}
```

`.release-please-manifest.json` (repo root) — seeded to the highest existing tag
per app so release-please always moves forward without colliding with a tag that
already exists:

```json
{
  "apps/kaipu-record": "0.2.0",
  "apps/web-hono": "0.1.1",
  "apps/server-hono": "0.1.2"
}
```

`.github/workflows/release-please.yml` — runs on push to `main`, opens/updates the
release PRs. Uses `googleapis/release-please-action@v4` (manifest mode by default:
it reads the two files above from the repo root).

### Triggering downstream workflows (token gotcha)

A tag created by the workflow's default `GITHUB_TOKEN` does **not** trigger other
workflows — GitHub suppresses events raised by `GITHUB_TOKEN` to prevent recursion.
So with the default token, release-please would create `desktop-v0.2.1` but
`release-desktop.yml` (which listens on `push: tags: desktop-v*`) would never fire,
and nothing would build.

Fix: run the release-please action with a **non-default token** so the tag push is
attributed to a real identity and the `on: push: tags` workflows fire normally.

- **Chosen approach:** a fine-grained **PAT** stored as `secrets.RELEASE_PLEASE_TOKEN`
  (permissions: Contents = read/write, Pull requests = read/write). One-time setup;
  it keeps the existing `release-desktop.yml` / `deploy-web.yml` / `deploy-api.yml`
  completely unchanged.
- Alternative (no PAT): move the build jobs into the release-please workflow, gated
  on the action's per-component `*--release_created` / `*--tag_name` outputs. More
  wiring; rejected to keep the downstream workflows untouched.

**Manual setup required (owner):** create the PAT and add it as
`RELEASE_PLEASE_TOKEN`. Until then, release PRs open correctly but merging one will
tag without building.

## Pre-1.0 policy

We are pre-`1.0` and want to stay there while iterating, but keep standard semver
intuition (a feature is a minor bump):

- `feat` bumps **minor** (`0.2.0 → 0.3.0`) — standard semver, the default.
- `bump-minor-pre-major: true` → a breaking change bumps **minor** (`0.2.0 →
0.3.0`) instead of jumping to `1.0.0`, so a stray `feat!` can't accidentally
  declare stability.

`1.0.0` is then declared deliberately, by landing a commit with a
`Release-As: 1.0.0` footer.

(We deliberately do **not** set `bump-patch-for-minor-pre-major`, which would make
`feat` a patch bump — the owner wants a feature to be a minor.)

## Commit → bump reference

For a batch, the bump is the **highest** among the accumulated commits:

| Commit type                                         | Bump (pre-1.0 policy)              |
| --------------------------------------------------- | ---------------------------------- |
| `fix:`                                              | patch                              |
| `feat:`                                             | minor                              |
| `feat!:` / `BREAKING CHANGE:`                       | minor (via `bump-minor-pre-major`) |
| `docs:` `chore:` `test:` `refactor:` `ci:` `style:` | no release                         |

A batch of only `chore`/`docs`/`refactor` produces **no** release PR — nothing
ships until a `feat`/`fix` accumulates.

## Shared packages

Commits touching only `packages/*` (e.g. `@kaipu/i18n`, `@kaipu/domain`) do not
belong to any app by path. Policy for now (simplest, matches current habit):
**bundle the shared-package change with the consuming app in the same PR/commit**,
so it routes to that app. If a shared package later needs to fan out to multiple
apps automatically, revisit with release-please's `node-workspace` plugin
(`linked-versions` / dependent bumping). Out of scope for this first adoption.

## Migration

The current tag history drifted, so seed carefully instead of deleting tags:

- Seed each app's manifest to its **highest existing tag** (table above). The
  phantom `desktop-v0.2.0` (which actually shipped `0.1.0` artifacts) is left in
  place, harmless — the next release-please desktop release supersedes it.
- With the accumulated `feat(i18n)` commits and the `feat → minor` policy, the
  first release-please releases are **desktop `0.3.0`** (seed `0.2.0`) and **web
  `0.2.0`** (seed `0.1.1`). The desktop build is stamped `0.3.0`, the feed
  advertises `0.3.0`, and an installed `0.1.0` app finally sees a newer version and
  auto-updates — the end-to-end proof of the fix.
- **api has no commits since `api-v0.1.2`**, so release-please proposes no api
  release. To bring it onto the same aligned baseline the owner can force it with a
  `Release-As: 0.2.0` empty/chore commit under `apps/server-hono`; otherwise api
  simply releases when it next has a real `feat`/`fix`.
- The one-time jump of each `package.json` (e.g. desktop `0.1.0 → 0.3.0`,
  release-please skipping the phantom `0.2.0`) is expected and harmless.

## Downstream workflow changes

Minimal. Because release-please bumps `package.json` in the release PR **before**
the tag exists, `release-desktop.yml` / `deploy-web.yml` / `deploy-api.yml` keep
reading the version from `package.json` exactly as they do today — the drift is
fixed structurally, not by editing them. Optional hardening (a step that asserts
the tag version equals `package.json`) can be added but is redundant with
release-please and is out of scope.

## Test plan

1. **Config dry check:** land the config + manifest, confirm the release-please
   action opens (or would open) three separate release PRs with sane versions and
   changelogs, none colliding with an existing tag.
2. **Non-shipping validation first:** inspect the desktop release PR's computed
   version and changelog before merging — merging is the only thing that ships.
3. **Desktop end-to-end (the real proof):** merge the desktop release PR → confirm
   `desktop-v0.3.0` is created → `release-desktop.yml` builds/signs/notarizes and
   publishes `latest-mac.yml` advertising `0.3.0` → install the prior signed
   `0.1.0` build, leave it running, and confirm it downloads the update and shows
   the restart banner. (Requires a signed/notarized build; a locally-built
   unsigned app will not accept updates.)

## Rollout

1. Add `release-please-config.json`, `.release-please-manifest.json`,
   `.github/workflows/release-please.yml`.
2. Merge to `main`; verify the three release PRs appear.
3. Cut the desktop release first (highest value: it fixes auto-update). Validate
   per the test plan.
4. Document the developer-facing flow in a `deployment/` reference doc once
   validated; drop this spec's backlog row.

## Out of scope

- Automatic dependent bumping for shared `packages/*` changes.
- Windows/Linux desktop builds (release currently builds macOS only).
- Changelog website / release-notes styling beyond release-please defaults.
