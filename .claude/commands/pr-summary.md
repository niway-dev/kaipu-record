---
description: Generate a structured pull request description from the current branch changes
allowed-tools: Read, Write, Bash(git log:*), Bash(wachiman pr-template:*), Bash(git diff:*), Bash(git branch:*), Bash(git remote:*), Bash(git show:*), Bash(date:*)
argument-hint: [ticket-url]
---

# Generate PR Summary

The PR description format is `.github/pull_request_template.md`, managed by `wachiman pr-template`
(it formats the body, checks it and scores its risk). This command gathers the facts; it does not
define a second format.

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
`Where to look` column, and anything only the owner can do in `## Needs you`. Leave the
`Agent context` block as the template has it.
Then run `wachiman pr-template check --pr <n>` and fix until it passes.
