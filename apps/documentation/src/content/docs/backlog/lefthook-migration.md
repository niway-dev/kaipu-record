---
title: Git hooks — husky + lint-staged to lefthook
description: Status tracker for replacing husky + lint-staged with one lefthook.yml that encodes the hook contract (commit fixes, push verifies, commit-msg guards release-please).
---

# Git hooks — husky + lint-staged to lefthook

> **Status: 🟡 In progress (2026-09-06).** Design approved; migration PR
> [#85](https://github.com/csdev19/kaipu-record-monorepo/pull/85) open and verified on the
> branch. Effort: Low (one small PR at the repo root, no app code).

## Why it is on the map

- `.husky/pre-push` still uses the husky 4 sourcing lines; husky 9 warns on every push that they
  **will fail in v10**. The same lines are in the template and eleven sibling repos.
- The current `pre-push` formats and stages files during a push, which does nothing for the
  commits being pushed. CI is the real gate; the hook only produces surprise.
- release-please derives versions from Conventional Commits and nothing validates them. The
  migration adds a one-line `commit-msg` guard at no dependency cost.

## Where the detail lives

- **Design:** [/specs/2026-09-06-lefthook-migration-design](/specs/2026-09-06-lefthook-migration-design)
  — findings with evidence, the hook contract, the exact `lefthook.yml`, files touched,
  migration steps, verification checklist, non-goals.
- **Reusable playbook (hub):**
  [general-knowledge · git-hooks-lefthook-playbook](https://github.com/csdev19/general-knowledge/blob/main/monorepos/git-hooks-lefthook-playbook.md)
  — the decision, alternatives rejected, the migration procedure and gotchas for every repo.

## Done when

- [ ] PR merged; `git push` prints no `husky - DEPRECATED` line.
- [ ] One week of real commits with the `commit-msg` guard and no false rejections.
- [ ] Then drop this row; the lasting knowledge is already in the hub playbook.
