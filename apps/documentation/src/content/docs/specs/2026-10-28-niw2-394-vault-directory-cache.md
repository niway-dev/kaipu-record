---
title: "NIW2-394: 11 Vault directory cache — approved spec"
description: "`vaultDirectory()` never touches the disk after the first call; the two write paths keep the cache exact."
---

# NIW2-394: 11 Vault directory cache

> Approved spec, committed **before** implementation (ADR-0010). Source: audit plan `apps/documentation/src/content/docs/plans/audit-2026-10-15/11-vault-directory-cache.md` on `main` @ `f10e39a4`, copied below unchanged except the heading level. Linear: https://linear.app/niway/issue/NIW2-394. Where they disagree, **this file wins**.
> Path: `apps/documentation/src/content/docs/specs/2026-10-28-niw2-394-vault-directory-cache.md` · Approved: 2026-10-28 (Cristian, all proposed defaults) · Batch 3 — Library fan-out (parent NIW2-383) · Closes: LIB-A3

## Vault directory cache — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vaultDirectory()` never touches the disk after the first call; the two write paths keep the cache exact.

**Architecture:** Only `main/library/vault-location.ts` changes. The parsed preferences are cached in module state **keyed by the preferences file path** (tests switch `userData` per test, so a plain cache would leak). `read()` serves from the cache; `setVaultDirectory`/`resetVaultDirectory` re-read from disk (so a hand edit of other keys is merged, not clobbered), write atomically, then refresh the cache only after the rename succeeded. Main is the only writer, so there is no `fs.watch`. The signature stays synchronous: no caller changes.

**Tech Stack:** Node sync fs, vitest with the existing `vi.hoisted` + `vi.mock("electron")` fixture in `vault-location.test.ts`.

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-A3 in [library lens A](/audits/2026-10-15/findings/library-a/). Closes: **LIB-A3**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- Behaviour change to state in the PR: a hand edit of `preferences.json` while the app runs is no longer seen by reads; it is picked up on the next app start, and its other keys are merged into the next choose/reset write. Before, a hand edit took effect on the very next call.
- `read()` returns the cached object by reference; no caller mutates it today (`resetVaultDirectory` mutates the fresh `readFromDisk()` object). Do not start mutating it.
- The two suites that mock `./vault-location` wholesale (`edit-project-probe.test.ts`, `video-edit-session.test.ts`) are unaffected.
- Commit messages in English, conventional-commit style.

## Review Focus

1. After `setVaultDirectory("/a")`, a hand edit of the file to `/b` is **not** seen by `vaultDirectory()` — Task 1 test (proves no re-read).
2. A set after a hand edit merges the file's other keys — Task 1 test.
3. A failed write (userData dir removed) throws and keeps the previous cached value — Task 1 test.
4. A different `userData` dir never sees another dir's cached value — Task 1 test.
5. The existing three tests pass unchanged.

---

### Task 1: Cache keyed by file path

**Files:**

- Modify: `main/library/vault-location.ts:18-35`, `:54-62`
- Test: `main/library/vault-location.test.ts`

- [ ] **Step 1: Write the failing tests** (import `readFileSync`, `writeFileSync` from `node:fs`; `prefs = () => join(mockState.userDataDir, "preferences.json")`)

```ts
it("serves later reads from memory", () => {
  setVaultDirectory("/a");
  writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/b" }));
  expect(vaultDirectory().path).toBe("/a");
});

it("a set after a hand edit merges the file's other keys", () => {
  writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/x", other: 1 }));
  setVaultDirectory("/y");
  expect(JSON.parse(readFileSync(prefs(), "utf-8"))).toEqual({ vaultDirectory: "/y", other: 1 });
  expect(vaultDirectory().path).toBe("/y");
});

it("reset after a hand edit drops only vaultDirectory", () => {
  writeFileSync(prefs(), JSON.stringify({ vaultDirectory: "/x", other: 1 }));
  resetVaultDirectory();
  expect(JSON.parse(readFileSync(prefs(), "utf-8"))).toEqual({ other: 1 });
  expect(vaultDirectory().isCustom).toBe(false);
});

it("a failed write keeps the previous value", async () => {
  setVaultDirectory("/ok");
  await rm(mockState.userDataDir, { recursive: true, force: true });
  expect(() => setVaultDirectory("/new")).toThrow();
  expect(vaultDirectory().path).toBe("/ok");
});

it("a different userData dir does not see another dir's cache", async () => {
  setVaultDirectory("/one");
  mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-prefs-b-"));
  expect(vaultDirectory().isCustom).toBe(false);
});
```

(The "failed write" test's `afterEach` `rm` is a no-op on the already-removed dir — `force: true`.)

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/main/library/vault-location.test.ts` → "serves later reads from memory" FAILS (returns `/b`); "merges other keys" passes already (the current code merges) — keep it as a regression guard.

- [ ] **Step 3: Implement** — replace `read`, `write`, `setVaultDirectory`, `resetVaultDirectory`:

```ts
/**
 * Parsed preferences, remembered per file path. Main is the only writer, so the
 * set/reset paths keep it exact and `vaultDirectory()` never touches disk after the
 * first call. Keyed by path so a different userData dir (tests) never sees another
 * dir's value. A hand edit of preferences.json while the app runs is picked up on
 * restart or merged into the next set/reset write.
 */
let cached: { file: string; preferences: StoredPreferences } | null = null;

function readFromDisk(): StoredPreferences {
  try {
    return JSON.parse(readFileSync(preferencesFile(), "utf-8")) as StoredPreferences;
  } catch {
    return {};
  }
}

function read(): StoredPreferences {
  const file = preferencesFile();
  if (cached?.file !== file) cached = { file, preferences: readFromDisk() };
  return cached.preferences;
}

function write(preferences: StoredPreferences): void {
  // Atomic write (temp + rename) so a crash mid-write can't truncate
  // preferences.json and lose the user's custom vault folder. Errors propagate
  // on purpose — a failed folder change should reject its IPC and surface to the
  // user, not be swallowed.
  const path = preferencesFile();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(preferences, null, 2));
  renameSync(tmp, path);
  // Only after the rename succeeded: a failed write leaves the cache on the old value.
  cached = { file: path, preferences };
}

export function setVaultDirectory(directory: string): void {
  // Re-read from disk so a hand-edited preferences.json (any key) is merged
  // into this write instead of being clobbered by a stale cache.
  write({ ...readFromDisk(), vaultDirectory: directory });
}

export function resetVaultDirectory(): void {
  const preferences = readFromDisk();
  delete preferences.vaultDirectory;
  write(preferences);
}
```

`vaultDirectory()` and `defaultVaultDirectory()` are unchanged.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library && bun run check-types` → PASS (8 tests in this file).

```bash
git add src/main/library/vault-location.ts src/main/library/vault-location.test.ts
git commit -m "perf(desktop): cache the parsed preferences so vaultDirectory() never blocks main"
```

### Task 2: Ship

- [ ] Open a PR titled `perf(desktop): stop re-reading preferences.json on every IPC call (audit LIB-A3)` linking this plan and the finding; state the behaviour change. End with **How to test it yourself**:
  1. Open the Library with many items → unchanged behaviour, lists at least as fast (with plan 01's `library_listed` event, `ms` drops by roughly 2n × 50 µs).
  2. Settings → Files → pick a new folder → the Library lists the new folder and posters load; Reset → the default folder is back.
  3. Quit, hand-edit `preferences.json` (`vaultDirectory`), relaunch → the edit is honoured.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.

## Dependencies

- No open `blocked by` relation. Independent of the other audit plans.

## Approved decisions

1. **Approval.** Cristian approved this ticket on 2026-10-28 with every proposed default; this file is the contract. Where the Linear description disagrees, this file wins.
2. **Failing test first.** Each task starts with a failing test, run before the fix. Selector names, helper names and line numbers were written by reading the code, not by running it: adapt them to today's code.
3. **Stop, don't improvise.** If a Review Focus line or a flagged assumption does not hold on today's `main`, stop and report it in a comment on the Linear ticket instead of improvising.
4. **One PR.** One PR for this ticket. It links NIW2-394, ends with a "How to test it yourself" section, and deletes the plan file `apps/documentation/src/content/docs/plans/audit-2026-10-15/11-vault-directory-cache.md` plus its row in `00-index.md`.
5. **Tooling.** Never run the Playwright desktop E2E suite locally (CI runs it). Use the pinned tools (`apps/kaipu-record/node_modules/.bin/vitest`, `bun run check-types`), never `bunx`.
6. **Human merge.** The ticket carries `needs-human-merge`: the PR is not auto-landed; Cristian reviews and merges it.
7. **Repo rule: no remote side effects.** No remote `db:push`/migrations against any real or dev database, no deploys, no releases or tags, no changes to remote storage or secrets. Local tests and fixtures only.
8. **Suggested model:** Sonnet.

## Change log

- 2026-10-28: Spec approved by Cristian with all proposed defaults; committed as the first commit of `feature/niw2-394-…` from audit plan `11-vault-directory-cache` (`main` @ `f10e39a4`).
