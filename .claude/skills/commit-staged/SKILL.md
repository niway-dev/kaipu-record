---
name: commit-staged
description: Read all local uncommitted changes, group them into logical atomic commits, and commit them in order. Use when the user asks to "commit my changes", "commit staged", or "organize my changes into commits".
---

# Git Commit Staged

Read all local uncommitted changes, group them into logical atomic commits,
and create them in order. Unlike commit-reorder (which works on existing
commits), this skill works on changes that haven't been committed yet.

## Safety Rules

1. **NEVER force push or reset --hard** — only create new commits
2. **ALWAYS present the commit plan to the user** before executing
3. **ALWAYS read file contents** to understand what changed, not just filenames
4. **ALWAYS verify no changes are left uncommitted** after finishing
5. **Skip files that look like secrets** (.env, credentials, keys) — warn the user

## Process

### Phase 1: Inventory all changes

```bash
# Show all changes: staged, unstaged, and untracked
git status --porcelain

# Get stats overview
git diff --stat          # unstaged
git diff --cached --stat # staged

# List untracked files
git ls-files --others --exclude-standard
```

Classify every file into one of:

- **Modified (staged)** — `M` in index
- **Modified (unstaged)** — `M` in worktree
- **New (untracked)** — `??`
- **Deleted** — `D`
- **Renamed** — `R`

### Phase 2: Read and understand changes

For each changed file, **read the diff or file content** to understand
what actually changed:

```bash
# For modified files
git diff <file>          # unstaged changes
git diff --cached <file> # staged changes

# For untracked files
# Read the file directly to understand its purpose
```

Do NOT group by filename alone. Read the actual changes to understand
which logical unit they belong to.

### Phase 3: Plan commit groups

Group files into logical commits. Each commit should represent ONE
coherent change.

**Grouping rules:**

| Group                   | Examples                          | Commit prefix      |
| ----------------------- | --------------------------------- | ------------------ |
| Infrastructure / config | config files, env schemas, types  | `feat:` / `chore:` |
| Database / schema       | migrations, schema changes, seeds | `feat:` / `fix:`   |
| Domain / business logic | domain types, schemas, constants  | `feat:` / `fix:`   |
| Services / use cases    | application layer, services       | `feat:` / `fix:`   |
| API / routes            | route handlers, middleware        | `feat:` / `fix:`   |
| UI / components         | React components, CSS, pages      | `feat:` / `fix:`   |
| Tests                   | test files, mocks, fixtures       | `test:`            |
| Build / CI              | workflows, scripts, package.json  | `ci:` / `build:`   |
| Docs                    | documentation, README, CLAUDE.md  | `docs:`            |

**Ordering commits inside-out:**

1. Infrastructure / config / types
2. Database / schema
3. Domain / business logic
4. Services / use cases
5. API / routes
6. UI / components + styles
7. Tests
8. Build / CI
9. Docs

**When a file has changes for multiple commits:**

If a single file contains changes that logically belong to different
commits, include the entire file in the commit where the PRIMARY change
lives. Don't try to split individual file changes across commits unless
the user specifically asks.

### Phase 4: Present the plan

**STOP. Show the plan to the user before committing.**

Format:

```
Local changes: X files modified, Y files added, Z files deleted

Proposed commits (in order):
1. feat: add salary rate type domain constants
   - packages/domain/src/constants/salary-rate-type.ts (new)
   - packages/domain/src/constants/index.ts
2. feat: add salary rate type to database schema
   - packages/infra-db/src/schema/hiring-process.ts
   - packages/infra-db/src/enums/salary-rate-type.ts (new)
3. feat(ui): add rate type selector to hiring process form
   - apps/web/src/components/hiring-process/hiring-process-form.tsx
   - apps/web/src/components/hiring-process/hiring-process-table.tsx
...
```

Ask: "Does this grouping look right? Want to move any files between commits?"

### Phase 5: Execute commits

Only after user approval:

```bash
# For each planned commit:
git add <files-for-this-commit>
git commit -m "<commit message>"
```

Use specific file paths with `git add` — **NEVER use `git add -A` or `git add .`**.

### Phase 6: Verify

```bash
# Verify nothing is left uncommitted
git status

# Show the commits created
git log --oneline -<N>  # where N = number of commits created
```

If `git status` shows remaining changes, warn the user and ask
if they should be included in an additional commit.

## Commit message format

```
<type>(<scope>): <short description>

<body: what changed and why, 2-4 lines>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Rules:

- Subject line: imperative mood, max 72 chars, lowercase after prefix
- Body: explain **what** and **why**, not **how**
- One logical change per commit
- Scope is optional — use when it adds clarity (e.g., `feat(ui):`, `fix(auth):`)

## Type reference

| Type       | When to use                           |
| ---------- | ------------------------------------- |
| `feat`     | New capability or enhancement         |
| `fix`      | Bug fix                               |
| `refactor` | Internal change, no behavior change   |
| `chore`    | Maintenance, config, dependency bumps |
| `docs`     | Documentation only                    |
| `test`     | Test files only                       |
| `ci`       | CI/CD pipeline changes                |
| `build`    | Build system or dependency changes    |
| `style`    | Formatting, whitespace, no logic      |

## Edge cases

### Lock files

Lock files (`bun.lock`, `package-lock.json`, `pnpm-lock.yaml`) go with
whichever commit adds/removes the most dependencies.

### Generated files

Generated files (`.d.ts`, compiled output, `worker-configuration.d.ts`)
go with the commit that caused them to be regenerated.

### Mixed feature + refactor

If a file was both refactored AND had a feature added, it goes in the
feature commit. Refactoring alone gets its own commit only when
no feature changes exist in that file.
