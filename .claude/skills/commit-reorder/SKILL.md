---
name: commit-reorder
description: Organize changes into logical, atomic commits. Works with both
  staged/unstaged changes (no commits yet) and existing commits ahead of base.
  Use when the user asks to clean up commits, reorder commits, squash and
  reorganize, or prepare a branch for PR review.
---

# Git Commit Reorder

Split N messy commits into M logical, atomic ones while preserving
the exact same final diff.

## Safety Rules

1. **ALWAYS confirm the base branch with the user** — never assume `develop`/`main`; stacked branches exist
2. **ALWAYS create a backup branch first** — never reorder on the original branch
3. **ALWAYS save the full diff as a patch** before any reset
4. **ALWAYS verify the final diff matches** the original after reordering
5. **ALWAYS present the commit plan to the user** before executing
6. **Run build/lint after each commit** if the project has these commands

## Process

### Phase 0: Detect base branch

The base branch is the branch this work was forked FROM — not necessarily
`develop` or `main`. In stacked workflows (`develop -> feat/base -> feat/ticket-A`),
the base is `feat/base`, not `develop`.

**Detection strategy (in order):**

1. **Check upstream tracking branch:**

   ```bash
   git rev-parse --abbrev-ref @{upstream} 2>/dev/null
   ```

   If the branch tracks a remote feature branch (not `origin/main` or `origin/develop`),
   that's likely the parent.

2. **Find the nearest ancestor branch:**

   ```bash
   # List all local branches and find which one shares the most recent common ancestor
   git log --oneline --decorate --graph HEAD~20..HEAD  # visual check
   ```

3. **Fall back to default branch:**

   ```bash
   git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
   ```

4. **ALWAYS confirm with the user before proceeding:**

   ```
   Detected base branch: `feat/checklist-base`
   Commits ahead: 8
   Changed files: 42

   Is this the correct base? (i.e. the branch you forked FROM / will merge INTO)
   ```

   If the user says no, ask them to provide the correct base branch name.

This step is **critical** — an incorrect base branch means the diff will include
changes from other branches, and the reorder will silently bundle unrelated work.

### Phase 1: Setup and backup

```bash
# Save current branch name
ORIGINAL_BRANCH=$(git branch --show-current)

# BASE_BRANCH is already confirmed from Phase 0

# Detect mode: are there commits ahead of base, or only staged/unstaged changes?
COMMIT_COUNT=$(git rev-list --count ${BASE_BRANCH}..HEAD 2>/dev/null || echo "0")
HAS_STAGED=$(git diff --cached --quiet 2>/dev/null; echo $?)    # 1 = has staged changes
HAS_UNSTAGED=$(git diff --quiet 2>/dev/null; echo $?)           # 1 = has unstaged changes
```

**Mode A: No commits ahead** (`COMMIT_COUNT == 0` and `HAS_STAGED == 1` or `HAS_UNSTAGED == 1`)
Changes exist only in the working tree / staging area. No backup branch needed since
there are no commits to lose — the working tree IS the backup.

```bash
# Save the full diff (staged + unstaged combined) as backup
git diff HEAD > /tmp/full-unstaged.patch
git diff --cached > /tmp/full-staged.patch

# Unstage everything so we start clean
git reset HEAD
```

**Mode B: Commits ahead of base** (`COMMIT_COUNT > 0`)
The current flow — reorder existing commits.

```bash
# Create backup branch
git branch "${ORIGINAL_BRANCH}-backup"

# Create clean working branch
git checkout -b "${ORIGINAL_BRANCH}-reorder"

# Save full diff as backup
git diff ${BASE_BRANCH}..HEAD > /tmp/full.patch
```

### Phase 2: Analyze changes

**Mode A (no commits):**

```bash
# List all changed files (staged + unstaged)
git status --porcelain | awk '{print $2}'

# Get stats overview
git diff HEAD --stat
```

**Mode B (commits ahead):**

```bash
# List all commits
git log --oneline ${BASE_BRANCH}..HEAD

# List all changed files
git diff ${BASE_BRANCH}..HEAD --name-only

# Get stats overview
git diff ${BASE_BRANCH}..HEAD --stat
```

For each changed file, determine: **does this file belong to exactly one commit?**

| Answer                | Action                                                        |
| --------------------- | ------------------------------------------------------------- |
| Yes                   | Stage directly with `git add` in the right commit             |
| No (mixed changes)    | Needs intermediate versions using write/stage/restore pattern |
| Entire file rewritten | Include in the commit where the primary change lives          |

### Phase 3: Plan commit groups

Categorize each file into a logical group:

| Group                     | Examples                             | Commit prefix          |
| ------------------------- | ------------------------------------ | ---------------------- |
| Infrastructure / plumbing | IPC handlers, preload, types, config | `feat:` or `refactor:` |
| i18n / translations       | locale JSON files                    | `feat(i18n):`          |
| UI / components           | React components, CSS                | `feat(ui):`            |
| Services / business logic | services, stores, orchestrators      | `feat:` or `fix:`      |
| Tests                     | test files, mocks                    | `test:`                |
| Build / CI                | workflows, scripts, package.json     | `ci:` or `build:`      |
| Docs                      | README, CLAUDE.md                    | `docs:`                |

Order commits inside-out:

1. Infrastructure / config / types
2. Services / business logic
3. i18n / translations
4. UI / components + styles
5. Tests
6. Build / CI
7. Docs

**STOP HERE. Present the plan to the user as a table:**

```
Proposed commits:
1. refactor: extract video types to shared module
   - src/types/video.ts, src/types/index.ts
2. feat: add chapter service with API integration
   - src/lib/api.ts, src/hooks/useVideoData.ts
3. feat(ui): add chapters panel component
   - src/components/ChaptersPanel.tsx, src/index.css
...
```

Ask: "Does this grouping look right? Want to move any files between commits?"

### Phase 4: Execute reorder

Only after user approval:

**Mode A (no commits):** Changes are already unstaged from Phase 1. Skip reset.

**Mode B (commits ahead):**

```bash
# Reset all commits but keep changes in working tree
git reset --soft ${BASE_BRANCH} && git reset HEAD
```

**Both modes — create the planned commits:**

```bash
# For each planned commit:
git add <files-for-this-commit>
git commit -m "<type>(<scope>): <description>"
```

#### Handling files with mixed changes (intermediate versions)

When a file has changes belonging to multiple commits:

```bash
cp file.ts /tmp/file-final.ts          # 1. Save final version
# Edit file to contain only this commit's changes
git add file.ts                         # 2. Stage intermediate version
cp /tmp/file-final.ts file.ts           # 3. Restore final version on disk
```

To build the intermediate version, use `git show ${BASE_BRANCH}:<filepath>` to get
the original and apply only the subset of changes for the current commit.

#### Lock files

Lock files (`bun.lock`, `package-lock.json`, etc.) cannot have intermediate
versions. Include them in whichever commit adds the most dependencies.

#### Renames and deletions

```bash
git add -u packages/old-name/     # Stage deletions of tracked files
git add packages/new-name/        # Stage new files
# Git auto-detects renames when both are staged together
```

### Phase 5: Verify

```bash
# Compare diffs — must be identical
git diff ${BASE_BRANCH}..HEAD > /tmp/new.patch
diff /tmp/full.patch /tmp/new.patch

# Show final commit list
git log --oneline ${BASE_BRANCH}..HEAD
```

For **Mode A**, compare against the combined staged+unstaged patch saved in Phase 1.

If the diff comparison is NOT empty, something went wrong.

**Mode A recovery:** Changes are still in the working tree. Re-stage with `git add -A`.
**Mode B recovery:** Restore from backup:

```bash
git checkout "${ORIGINAL_BRANCH}"
git branch -D "${ORIGINAL_BRANCH}-reorder"
```

### Phase 6: Optional build verification

If the project has build/lint commands, verify each commit compiles:

```bash
git log --oneline ${BASE_BRANCH}..HEAD --reverse | while read hash msg; do
  git checkout $hash
  npm run build 2>/dev/null || echo "⚠️ Build fails at: $msg"
done
git checkout "${ORIGINAL_BRANCH}-reorder"
```

This is optional but recommended — broken intermediate commits make
bisecting harder later.

### Phase 7: Present results

Show the user:

- 📋 Old commits vs new commits (side by side)
- ✅ Diff verification result
- ⚠️ Any build warnings per commit

Ask:

- "Want me to replace the original branch with these clean commits?"
- If yes: `git checkout ${ORIGINAL_BRANCH} && git reset --hard ${ORIGINAL_BRANCH}-reorder`
- Clean up: `git branch -D ${ORIGINAL_BRANCH}-backup ${ORIGINAL_BRANCH}-reorder`

## Commit message format

```
<type>(<scope>): <short description>

<body: what changed and why, 2-4 lines>
```

Rules:

- Subject line: imperative mood, max 72 chars
- Body: explain **what** and **why**, not **how**
- One logical change per commit

## Useful commands reference

| Command                                     | Purpose                           |
| ------------------------------------------- | --------------------------------- |
| `git diff ${BASE_BRANCH}..HEAD > patch`     | Save full diff as backup          |
| `git diff ${BASE_BRANCH}..HEAD --stat`      | Overview of all changes           |
| `git diff ${BASE_BRANCH}..HEAD --name-only` | List changed files only           |
| `git show ${BASE_BRANCH}:<path>`            | See original file version         |
| `git diff --cached --name-status`           | Verify staged files before commit |
| `git add -u <dir>`                          | Stage deletions of tracked files  |
| `git status --porcelain`                    | Machine-readable status check     |
