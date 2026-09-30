---
title: "Open-source security sweep"
description: "The pass the repository goes through before it becomes public under AGPL-3.0: secrets in history, the cloud security workstreams, docs language, personal references, and the repository files a public project needs. None of it is done yet: this is the plan and the measured baseline."
---

# Open-source security sweep

> **Status: 🟡 In progress** (2026-09-27). Owner: "first a sweep; put it as a PR in a separate
> worktree, generate a doc and a draft PR, and do all the security changes in that PR."
> Parent: [Open source under AGPL-3.0](/marketing/open-source/) · pre-open checklist.
> **The plan merged ahead of the work.** Holding it in a long-lived PR kept it
> invisible and let it rot against a moving `main`, so this page lands on `main`
> as the tracker instead. **Nothing below is done** — the checklist is 0 of 18 —
> and the baseline was measured on 2026-09-27, so re-measure before trusting it.
> The repository must not go public until every box is ticked or explicitly
> accepted.

## What the sweep is for

The whole monorepo opens at once, server and workers included. The owner's view is that the
code itself is not the asset worth protecting; what must not leak is credentials, private
infrastructure detail, and anything that lets a stranger abuse the cloud layer. So the sweep
is about **what a public repository exposes**, not about hiding the code.

## Baseline (measured 2026-09-27, before any change)

| Check                                                     | Result                                                                                                                                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitleaks git` over the full history (671 commits, 12 MB) | **1 finding**: a PostHog project key committed in a plan doc (`plans/2026-06-27-flags-and-error-handling.md`, line 56, commit `c372abd6`). Project keys are client-side by design, but a key in history is a key to rotate. |
| Docs pages still in Spanish (heuristic word match)        | **19** in the docs site: 8 `desktop/`, 5 `plans/`, 4 `backlog/`, 1 `features/`, 1 `specs/`                                                                                                                                  |
| Cloud security workstreams                                | 7, all 🔵 Proposed (listed below)                                                                                                                                                                                           |
| `SECURITY.md`, `CONTRIBUTING.md`, issue templates         | Absent                                                                                                                                                                                                                      |
| Public release with signed artifacts attached             | macOS signed via the release pipeline; Windows pending ([Windows beta](/backlog/windows-beta/))                                                                                                                             |

## Work items, in order

Each item is a commit or a small group of commits. Tick it here when it lands; this page
is the record, so a box ticked here is the claim that it was actually done.

### 1. Secrets

- [ ] Rotate the PostHog project key found by gitleaks and replace the value in the doc with a
      placeholder.
- [ ] Decide whether to rewrite history for that one blob. Recommendation: **no**. Rewriting
      671 commits to hide a client-side key that is rotated anyway costs more than it protects,
      and a rewrite breaks every existing clone and PR. Rotation is the fix.
- [ ] Add a `.gitleaks.toml` allowlist for the placeholder and run `gitleaks git` in CI on
      every PR (`pr-checks`), so a new secret cannot land after the repo is public.
- [ ] Grep the tree for Infisical project IDs, Cloudflare account IDs, R2 bucket names,
      database hosts and email addresses that are not the public contact. Move what must stay
      private into Infisical; what is harmless stays.

### 2. Cloud security workstreams

These already exist as backlog pages; opening the repo turns them from "before production"
into "before public". Link each PR here as it lands, or record an explicit accept-the-risk
note with the reason.

| Workstream                                     | Page                                           | Decision for the sweep                                          |
| ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| Backend security hardening (hub)               | [page](/backlog/backend-security-hardening/)   | Do                                                              |
| Dependency security upgrades                   | [page](/backlog/dependency-security-upgrades/) | Do; a public repo shows its lockfile                            |
| R2 upload integrity and immutable tickets      | [page](/backlog/r2-upload-integrity/)          | Do                                                              |
| Production cloud security configuration        | [page](/backlog/production-cloud-security/)    | Do the least-privilege part; the observability part can follow  |
| API abuse controls                             | [page](/backlog/api-abuse-controls/)           | Do; rate limits are the first thing a public API needs          |
| Electron security hardening                    | [page](/backlog/electron-security-hardening/)  | Do the IPC/navigation boundary items; the rest per its own plan |
| Cloud recording lifecycle and account deletion | [page](/backlog/cloud-data-lifecycle/)         | Do the deletion path; expiration can follow                     |

### 3. Docs language

The repo content rule is English. The pages below still read as Spanish. Translate in place,
keep the slugs, keep the tables. Legacy Spanish is tech debt already declared in
`CLAUDE.md`; this is where it gets paid because a public docs site is the front door.

- `backlog/index.mdx`
- `backlog/playwright-e2e.mdx`
- `backlog/settings-roadmap.mdx`
- `backlog/video-editor-camera-box-ux.md`
- `desktop/analytics-and-flags.mdx`
- `desktop/electron-vs-tauri.mdx`
- `desktop/filesystem-first-monetization.mdx`
- `desktop/ipc-contract.mdx`
- `desktop/library-vault.mdx`
- `desktop/main-process-architecture.mdx`
- `desktop/permissions-and-onboarding.mdx`
- `desktop/recording-pipeline.mdx`
- `features/library-detail-player.mdx`
- `plans/2026-09-02-desktop-authentication.md`
- `plans/2026-09-15-01-transactional-email.md`
- `plans/2026-09-15-03-cloud-access-states.md`
- `plans/video-editor-v2/03-click-hook-permissions-and-gating.md`
- `plans/video-editor-v2/08-editor-layout-and-tracks.md`
- `specs/2026-09-15-cloud-trial-and-approval.md`

### 4. Personal and private references

- [ ] Names of employers, clients, friends and private machines in docs, fixtures, comments
      and commit-facing text. Keep roles, drop names.
- [ ] Internal URLs (dashboards, staging hosts) moved to Infisical or removed.
- [ ] `.claude/` directory: decide what stays public. Skills and settings are fine; anything
      with local paths or personal notes is not.

### 5. Repository files a public project needs

- [ ] `CONTRIBUTING.md` with the [contribution policy](/marketing/open-source/#contribution-policy):
      issue before PR, small PRs, disclose generated code, no drive-by dependency changes.
- [ ] `SECURITY.md` with a private disclosure address and a response-time promise that one
      person can keep.
- [ ] Issue templates: bug (version, OS, a recording of the problem), feature (linked to the
      public roadmap).
- [ ] PR template that points at the policy and the local `verify` gate.
- [ ] `README.md` for a visitor: what it is, download links, build from source, license.
- [ ] License headers are **not** added file by file; the root `LICENSE` and the
      `package.json` fields are enough for AGPL.

### 6. Before flipping the repository to public

- [ ] All of the above ticked or explicitly accepted.
- [ ] Branch protection and required checks confirmed on `main`.
- [ ] Secret scanning and Dependabot alerts enabled on the GitHub repository.
- [ ] The first public release exists with signed macOS and Windows artifacts attached.
- [ ] The announcement bundle is ready ([timing](/marketing/open-source/#timing)).

## Out of scope for the sweep

Feature work, the landing, and the Windows beta. Those have their own pages. This PR is
allowed to be long-lived; it merges when the checklist is done, not before.
