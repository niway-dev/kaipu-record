---
title: Git hooks — migrate husky + lint-staged to lefthook (design spec)
description: Replace the husky + lint-staged setup with one lefthook.yml that encodes a real hook contract (commit fixes, push verifies, commit-msg guards release-please). What we found in this repo, what we gain beyond the library swap, the exact files, and how to verify it.
---

# Git hooks — migrate husky + lint-staged to lefthook

**Date:** 2026-09-06 · **Branch:** not started (design only) · **Scope:** repo root tooling
(`package.json`, `.husky/`, `lefthook.yml`, `.gitignore`) and three docs pages. No app or package
code changes.

**Status: 🔵 Proposed — pending approval.** Nothing in this spec is implemented. The reusable
half (the decision, the hook contract, the migration procedure, the gotchas) lives in the hub:
[general-knowledge · git-hooks-lefthook-playbook](https://github.com/csdev19/general-knowledge/blob/main/monorepos/git-hooks-lefthook-playbook.md).
This page is Kaipu's application of it: what is true in this repo today and exactly what changes.

## Goal

Every hook this repo runs is declared in one file, does one clearly stated job, and can be copied
verbatim to the other twelve repos that share this tooling. The commits that reach `main` are
formatted and lint-clean, and every commit message is one release-please can turn into a version
and a changelog line.

## What we found in this repo (evidence)

1. **`.husky/pre-push` will break on the next husky major.** It still starts with
   `#!/usr/bin/env sh` and `. "$(dirname "$0")/_/husky.sh"`. husky 9.1.7 (installed) prints
   `husky - DEPRECATED ... They WILL FAIL in v10.0.0` on every push. The same two lines are in
   `monorepo-template` and eleven other repos: this is inherited, not a local slip.
2. **`pre-push` writes and stages during a push.** It runs `oxfmt --write` on all 848 tracked
   source files and then `git add -u`. The commits being pushed are unchanged; the fixes stay
   behind as a dirty index. CI's `oxfmt --check .` is the actual gate. The hook adds surprise, not
   safety.
3. **Config lives in three places** that nothing checks together: the `lint-staged` block in
   `package.json`, `.husky/pre-commit` (`lint-staged`) and the 30-line `.husky/pre-push` script.
4. **No commit-message validation, while release-please depends on it.** `release-please-config.json`
   versions three components from Conventional Commit prefixes. A typo like `feta:` or a bare
   `update stuff` silently drops out of the changelog and the version bump. Nothing in the repo
   (nor in any of the thirteen) catches it.
5. **Speed is not a problem to solve.** `oxlint` on the whole repo takes 0.1 s; `lint-staged`'s
   own startup is 0.16 s; `oxfmt --check .` is 1.4 s. The migration must not be sold on speed.
6. **Bun trusts lefthook's postinstall out of the box.** `lefthook` is on Bun 1.3's default
   trusted-dependencies list, so `bun install` installs the hooks without a `trustedDependencies`
   entry. Verified against Bun's source.
7. **husky leaves a clone-local trap.** `git config core.hooksPath` is `.husky/_` on this clone.
   Deleting `.husky/` does not unset it; git would then look at a missing directory and run no
   hook at all, silently. lefthook 2.1.12 refuses to install in that state and prints the fix
   (verified in a scratch repo). Every existing clone needs a one-time `git config --unset-all
--local core.hooksPath`.

## Decision

Adopt lefthook, and use the migration to fix the hook contract, not just the tool. The decision
and its rejected alternatives (keep husky and delete two lines, hand-rolled `.githooks`,
simple-git-hooks, hk, pre-commit) are recorded once, in the hub playbook. No project ADR: the
choice is cross-repo tooling, not an architecture of this product.

### The hook contract this repo adopts

| Hook         | Job                                                                                                                          | Change vs today                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | Format + lint **staged files only**; re-stage the fixes.                                                                     | Same behaviour as `lint-staged`, declared in `lefthook.yml`. `md`/`mdx` staged files are now formatted too (they were only touched on push). |
| `commit-msg` | Reject a first line that is not a Conventional Commit. `fixup!`, `squash!`, `Merge`, `Revert` pass; skipped on merge/rebase. | **New.** One `grep`, no commitlint dependency.                                                                                               |
| `pre-push`   | `oxlint` + `oxfmt --check .`, in parallel, **read-only**.                                                                    | Stops writing and staging. Same commands as `ci.yml`'s Lint and Check formatting steps.                                                      |
| CI           | Unchanged.                                                                                                                   | Nothing in `.github/workflows/` changes in this PR.                                                                                          |

Type-checking stays out of `pre-push` on purpose: `check-types` goes through Turbo across all
apps and is the slow step; CI runs it. Reopen when CI type failures become the common reason PRs
go red.

## Target configuration

### `lefthook.yml` (new, repo root)

```yaml
# Git hooks. Docs: https://lefthook.dev — contract: /specs/2026-09-06-lefthook-migration-design
# commit = fix what you commit · push = verify what you share (read-only, same as CI)
# commit-msg = reject what release-please cannot parse. Bypass once: LEFTHOOK=0 git <cmd>.
min_version: 2.0.0

pre-commit:
  jobs:
    - name: format
      glob: "*.{js,jsx,cjs,mjs,ts,tsx,cts,mts,json,jsonc,css,md,mdx}"
      run: bunx oxfmt --write {staged_files}
      stage_fixed: true
    - name: lint
      glob: "*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}"
      run: bunx oxlint {staged_files}

commit-msg:
  skip:
    - merge
    - rebase
  jobs:
    - name: conventional-commit
      run: |
        first="$(head -1 {1})"
        echo "$first" | grep -qE '^(fixup!|squash!|Merge |Revert )' && exit 0
        echo "$first" | grep -qE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9._/-]+\))?!?: .+' && exit 0
        echo "Commit message must follow Conventional Commits, e.g. 'feat(web): add recordings page'."
        echo "release-please derives versions and changelogs from these prefixes."
        exit 1

pre-push:
  parallel: true
  jobs:
    - name: lint
      run: bunx oxlint
    - name: format-check
      run: bunx oxfmt --check .
```

Validated with `lefthook validate` and `lefthook dump` on lefthook 2.1.12; the `commit-msg` regex
was exercised against accepted and rejected samples (see the playbook). `pre-commit` is
deliberately sequential: `oxfmt --write` and `oxlint` on the same staged files would race if run
in parallel. `pre-push` is parallel because both jobs are read-only.

### `package.json` (root)

- Remove `husky`, `lint-staged` from `devDependencies`; add `lefthook` (`^2.1.12`).
- Remove the `"lint-staged": { ... }` block.
- `"prepare": "husky"` → `"prepare": "lefthook install"`. Kept on purpose: it fails loudly on a
  clone whose `core.hooksPath` still points at `.husky/_` (finding 7), where the npm
  postinstall's `install -f` would quietly install into the stale path instead.

### Other files

| File                                                                                      | Change                                                                              |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `.husky/pre-commit`, `.husky/pre-push`                                                    | Deleted (`git rm -r .husky`).                                                       |
| `.gitignore`                                                                              | Add `lefthook-local.yml`.                                                           |
| `apps/documentation/src/content/docs/briefings/stack.md`                                  | "wired into `lint-staged`" → "wired into `lefthook`".                               |
| `apps/documentation/src/content/docs/backend/environment-variables.mdx`                   | "add `dotenvx ext precommit` to husky" → "as a `pre-commit` job in `lefthook.yml`". |
| `apps/documentation/src/content/docs/backlog/lefthook-migration.md` + `backlog/index.mdx` | Status tracker (flip to 🟢 on merge, drop after the first week of real commits).    |
| `.github/workflows/*`                                                                     | No change.                                                                          |

## Migration steps (one PR, `chore(hooks): migrate husky + lint-staged to lefthook`)

```sh
bun remove husky lint-staged
bun add -d lefthook
git rm -r .husky
# edit package.json (prepare script, lint-staged block); add lefthook.yml; edit .gitignore; docs
git config --unset-all --local core.hooksPath    # once per existing clone
bun install                                       # prepare → lefthook install
bunx lefthook validate && bunx lefthook dump
```

The PR body must tell existing clones to run the `git config --unset-all --local core.hooksPath`
line once. Fresh clones need nothing.

## Verification (before merge)

- [ ] `git config core.hooksPath` prints nothing; `ls .git/hooks` lists `pre-commit`,
      `commit-msg`, `pre-push`.
- [ ] A staged, badly formatted `.tsx` file is committed already formatted (`git show HEAD`).
- [ ] A staged file with an `oxlint` error is rejected with the lint output.
- [ ] `git commit -m "update stuff"` is rejected; `git commit -m "chore: update stuff"` passes;
      `fixup! ...` passes.
- [ ] `bunx lefthook run pre-push` exits 0 on a clean tree and 1 with a formatting error in a
      committed file, and **does not modify the file**.
- [ ] `LEFTHOOK=0 git commit --allow-empty -m "update stuff"` goes through.
- [ ] `git push` prints no `husky - DEPRECATED` line.
- [ ] `ci.yml` is green on the PR with no workflow changes.

## Non-goals

- Changing what CI runs, or moving type-check/build/tests into hooks.
- Adding commitlint or any commit-message tooling beyond the one-line regex.
- Migrating the other twelve repos in this PR. The order (template first, repos with a release
  pipeline next, idle repos on their next touch) is in the playbook; each is its own PR.
- Excluding `.claude/worktrees/` from `oxfmt --check .`. Today one stale local worktree makes the
  check fail locally while CI is green; keeping the working tree clean is the fix for now.

## What would reopen this

- lefthook stops being maintained, or Bun drops it from the default trusted list and the
  `prepare` fallback becomes a support burden.
- A hook needs two writers on the same files in parallel (lefthook has no file locking).
- CI type failures become the common reason PRs go red → add `check-types` to `pre-push`.
