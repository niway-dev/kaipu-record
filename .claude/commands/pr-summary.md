---
description: Generate a structured pull request description from the current branch changes
allowed-tools: Read, Write, Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git remote:*), Bash(git show:*), Bash(date:*)
argument-hint: [ticket-url]
---

# Generate PR Summary

## Step 1: Gather branch context

```bash
# Current branch and base
git branch --show-current
git log --oneline main..HEAD

# Changed files
git diff main..HEAD --stat

# Full diff for understanding changes
git diff main..HEAD --name-only
```

Read each changed file to understand what was modified and why.

## Step 2: Determine PR type

Based on the changes, select the appropriate prefix:

| Prefix      | When to use                                |
| ----------- | ------------------------------------------ |
| `feat:`     | New feature or capability                  |
| `fix:`      | Bug fix                                    |
| `refactor:` | Code restructuring without behavior change |
| `perf:`     | Performance improvement                    |
| `style:`    | CSS / UI-only changes                      |
| `docs:`     | Documentation only                         |
| `test:`     | Adding or updating tests                   |
| `ci:`       | CI/CD pipeline changes                     |
| `build:`    | Build system or dependency changes         |
| `chore:`    | Maintenance tasks                          |

If multiple types apply, use the primary one. If changes span many types,
consider whether the PR should be split.

## Step 3: Identify technical decisions

Look for places where alternatives existed:

- New dependencies added (why this library over others?)
- Architectural patterns chosen (why this approach?)
- Trade-offs made (performance vs readability, etc.)

Frame each as a question: "Why X instead of Y?"
Skip obvious choices that don't need justification.

## Step 4: Build the commit summary

```bash
git log --oneline main..HEAD
```

For each commit, write: **`commit message`** — what this commit includes.

## Step 5: Generate the PR description

Use this exact format:

```markdown
# {type}: {short description}

## Ticket

- {$ARGUMENTS or ask user for ticket link}

## Description

{2-3 sentences: user problem/business need → solution at high level.
Start with WHY, not WHAT.}

## What to review

{3-5 entries, ordered by risk. Each anchored to `file.ts:NN`.}

1. **`path/to/file.ts:NN` — the claim in one line.** What the reviewer should
   decide, and what makes it non-obvious.

**Safe to skim:** {generated files, i18n pairs, docs, tests that restate the code}

## Changes

| File           | Change            |
| -------------- | ----------------- |
| `path/to/file` | Brief description |

## Technical Decisions

### {Decision as a question}

{1-3 sentences on reasoning and trade-offs.}

## Evidence

| State / Scenario | Screenshot                            |
| ---------------- | ------------------------------------- |
| {state}          | {ask user to paste or note "pending"} |

## Steps to Reproduce

1. {Setup}
2. {Action}
3. {Expected result}

## Commits

1. **`commit msg`** — what it covers
```

## Step 6: Quality checks before presenting

Verify:

- [ ] Description starts with user need, not code details
- [ ] "What to review" exists, is ordered by risk, and every entry cites `file:line`
- [ ] "What to review" names what is safe to skim
- [ ] Changes table covers all modified files
- [ ] Technical decisions only include non-obvious choices
- [ ] Steps to reproduce start from a clean state
- [ ] Commit list matches `git log` output

## Step 7: Write to file and present to user

Save the generated PR description to a markdown file:

```bash
# Get branch name and date for the filename
BRANCH=$(git branch --show-current)
DATE=$(date +%Y-%m-%d)
```

Write the PR description to `pr-summaries/${DATE}-${BRANCH}.md` using the Write tool.
If a file with that name already exists, overwrite it (regenerating is intentional).

Then show the user:

- The file path where the summary was saved
- A brief preview (title + description section only)

Ask:

- "Want me to adjust anything?"
- "Do you have screenshots to add to the Evidence section?"
- If $ARGUMENTS was empty: "What's the ticket link?"

## Writing guidelines

### Description section

- Start with the **user need** or **problem**, not the code
- Explain the **solution** at a high level
- Mention any **design specs** or **constraints**
- Good: "Users needed a way to save recordings locally before uploading.
  This PR adds a Download button that opens a native save dialog."
- Bad: "Added a button and IPC handler."

### What to review section

This is the section that decides whether a large PR gets reviewed or rubber-stamped.
Write it as a reading route, not a summary.

- **Order by risk**, not by directory or by the order you wrote the code.
- **Anchor to `file.ts:NN`.** A feature name sends the reviewer hunting; a line
  number puts them in front of the code.
- **Say what to decide, not what you did.** "Check whether the step index can
  outrun the array once `status` flips" beats "added an Accessibility step". The
  reviewer's job is judgement, not re-reading the diff.
- **Name what is safe to skim, and why** — generated files, i18n pairs that were
  key-checked, docs, tests that only restate the code. Permission to skip is half
  the speed-up.
- **Be honest about what the diff cannot answer.** CSS layout, GPU compositing, an
  OS permission prompt: say it is unreviewable by reading and move it to the
  manual checklist instead of dressing it up as a code concern.
- **Flag anything you changed that the reader would assume is cosmetic** but is
  not — a test-helper fix, a default that changed, a widened type.
- Three to five entries. A list of twelve is the same as no list. Skip the
  section only when the PR is genuinely one obvious change.

### Technical Decisions section

- Only decisions where **alternatives existed**
- Focus on **trade-offs**, not implementation details

### Evidence section

- Show **before and after** when modifying existing UI
- Show **each state** for interactive elements (idle, loading, success, error)

### Commits

- If commits are messy, suggest running `/commit-reorder` first
