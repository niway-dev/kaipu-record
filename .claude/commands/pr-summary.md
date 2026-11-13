---
description: Generate a structured pull request description from the current branch changes
allowed-tools: Read, Write, Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git remote:*), Bash(git show:*), Bash(date:*), Bash(python3:*)
argument-hint: [ticket-url]
---

# Generate PR Summary

The PR description format is `.github/pull_request_template.md`: the shared template from cs-tack's
`cs-write-handoff`. This command gathers the facts; it does not define a second format.

## Step 1: Gather branch context

```bash
git branch --show-current
git log --oneline origin/main..HEAD
git diff origin/main..HEAD --stat
```

Read each changed file to understand what was modified and why.

## Step 2: Pick the PR type prefix

`feat:`, `fix:`, `refactor:`, `perf:`, `style:` (CSS / UI only), `docs:`, `test:`, `ci:`, `build:`,
`chore:`. Use the primary one; if the changes span many types, consider splitting the PR.

## Step 3: Write the description from the template

Fill `.github/pull_request_template.md` in its order, keeping its headings. Put what changed and the
result someone can observe in `## What` (no file list), where to look in the Changes table's
`Where to look` column, and anything only the owner can do in `## Needs you`.
Then run `pr_body.py check --pr <n>` (from cs-tack's `cs-write-handoff`) and fix until it passes.
