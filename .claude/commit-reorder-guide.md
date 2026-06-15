# Git Commit Reorder Guide

Split N messy commits into M logical, atomic ones while preserving the exact same final diff.

## Process

```bash
# 1. Backup
git diff main..HEAD > /tmp/full.patch

# 2. Reset (keep changes in working tree, nothing staged)
git reset --soft main && git reset HEAD

# 3. For each logical commit: stage files, commit, repeat
git add <files>
git commit -m "message"

# 4. Verify
git diff main..HEAD > /tmp/new.patch
diff /tmp/full.patch /tmp/new.patch   # must be empty
```

## Core Technique: Intermediate File Versions

When a file has changes belonging to **multiple commits** (e.g. import renames in commit 1 + logic refactor in commit 5), you can't just `git add` it — the working tree has the final state with all changes baked in.

**Pattern: write → stage → restore**

```bash
cp file.ts /tmp/file-final.ts          # 1. save final version
# ... write intermediate version ...    # 2. edit file to commit-1-only state
git add file.ts                         # 3. stage intermediate version
cp /tmp/file-final.ts file.ts           # 4. restore final version on disk
```

Git keeps the intermediate version in the index. The working tree is back to the final state. The remaining changes get picked up by a later `git add`.

**To build the intermediate version:** use `git show main:<filepath>` to get the original, then apply only the subset of changes for the current commit.

## Staging Renames/Deletions

When old directories no longer exist on disk:

```bash
git add -u packages/old-name/        # stage deletions of tracked files
git add packages/new-name/           # stage new files
```

Git auto-detects renames when both deletion + addition are staged together.

## Decision Framework

For each changed file, ask: **does this file belong to exactly one commit?**

- **Yes → stage directly** with `git add` in the right commit
- **No → needs intermediate versions** using the write/stage/restore pattern
- **Entire file rewritten → skip early commits**, include in the commit where the primary change lives

## Lock Files

Lock files (`bun.lock`, `package-lock.json`, etc.) can't have intermediate versions generated manually. Include them in whichever commit adds the most dependencies.

## Commit Order

Work inside-out: infrastructure renames → domain → infra implementations → application → consumers (server/web) → new apps → docs.

## Useful Commands

| Command                           | Purpose                           |
| --------------------------------- | --------------------------------- |
| `git diff main..HEAD > patch`     | Save full diff as backup          |
| `git show main:<path>`            | See original file version         |
| `git diff --cached --name-status` | Verify staged files before commit |
| `git add -u <dir>`                | Stage deletions of tracked files  |
| `git status --porcelain`          | Machine-readable status check     |
