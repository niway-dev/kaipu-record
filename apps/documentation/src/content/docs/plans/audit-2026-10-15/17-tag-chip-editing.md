---
title: "17 · Tag chip editing"
description: "Closes LIB-B2: pasting several tags at once assigns only the last one, and chip edits build on a stale id list."
---

# Tag chip editing — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pasted `a, b, c` ends in exactly one `setItemTags` call carrying every tag; two quick chip removals both apply.

**Architecture:** `TagEditor` keeps the latest id list in a ref plus an in-flight counter: while a save is pending, edits build on the last list sent, not on the render-closure prop; when the counter returns to zero the ref re-syncs with the props. A multi-tag paste resolves each piece (existing tag, or sequential `onCreate` to keep order and avoid racing the registry write chain), then makes **one** `onAssign`. `onAssign` widens to `void | Promise<void>`, and the three callers return the `setTags` promise so the counter is meaningful. Main's `assign` already replaces the whole list, so no main change.

**Tech Stack:** React refs, vitest + RTL (existing `tag-editor.test.tsx` helpers `tag()`, `input()`, `chips()`).

**Spec:** [Audit report](/audits/2026-10-15/report/) → LIB-B2 in [library lens B](/audits/2026-10-15/findings/library-b/). Closes: **LIB-B2**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- The existing test `Harness` updates state synchronously, so it can never reproduce the bug; new tests use a static `assigned` prop with a `vi.fn` `onAssign` (optionally returning a deferred promise). The 5 existing tests must pass unchanged.
- Writing a ref during render (`if (pending.current === 0) idsRef.current = ids`) may trip a strict `react-hooks` lint rule; fallback is `useLayoutEffect` keyed on `ids.join(",")`.
- `tag-panel.tsx` `ItemTags.toggle` has the same stale-list bug (two fast quick-tag clicks); fixing it is optional step C, logged as a follow-up if skipped.
- Plan 04 makes the two concurrent `setItemTags` writes safe at the file level; this plan removes the need for them.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Paste `design, demo, ` → `onAssign` called once with both ids — Task 1 test.
2. Mixed existing + new in a paste: `onCreate` only for the missing one, one `onAssign` with existing + both — Task 1 test.
3. Two chip removals before the first save settles → calls `[["b","c"]]` then `[["c"]]` — Task 1 test (needs Task 2's promise-returning callers in the app).
4. Duplicates and invalid pieces in a paste are ignored; the per-item cap holds — Task 1 tests.
5. After the deferred save settles, further edits build from the props again — Task 1 test.

---

### Task 1: `TagEditor` builds from the latest list

**Files:**

- Modify: `features/library/components/tag-editor.tsx:1`, `:18`, `:38-62`, `:93-98`, `:106-107`
- Test: `features/library/components/tag-editor.test.tsx`

**Interfaces:**

- Produces: `TagEditorProps.onAssign(tagIds: readonly string[]): void | Promise<void>`.

- [ ] **Step 1: Write the failing tests** (keep the existing `Harness`; these render `<TagEditor>` directly with a static `assigned`)

```tsx
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

it("assigns a pasted list of new tags in one onAssign call", async () => {
  const onCreate = vi.fn(async (name: string) => tag(name));
  const onAssign = vi.fn();
  render(<TagEditor assigned={[]} all={[]} onAssign={onAssign} onCreate={onCreate} />);
  fireEvent.change(input(), { target: { value: "design, demo, " } });
  await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
  expect(onAssign).toHaveBeenCalledWith(["t-design", "t-demo"]);
  expect(input().value).toBe("");
});

it("keeps existing tags and mixes existing and new in a paste", async () => {
  const onCreate = vi.fn(async (name: string) => tag(name));
  const onAssign = vi.fn();
  render(<TagEditor assigned={[tag("a")]} all={[tag("Demo")]} onAssign={onAssign} onCreate={onCreate} />);
  fireEvent.change(input(), { target: { value: "demo, fresh, " } });
  await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
  expect(onAssign).toHaveBeenCalledWith(["t-a", "t-Demo", "t-fresh"]);
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(onCreate).toHaveBeenCalledWith("fresh");
});

it("ignores duplicates and invalid pieces in a paste", async () => {
  const onCreate = vi.fn(async (name: string) => tag(name));
  const onAssign = vi.fn();
  render(<TagEditor assigned={[]} all={[]} onAssign={onAssign} onCreate={onCreate} />);
  fireEvent.change(input(), { target: { value: "a, A, ../x, b, " } });
  await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
  expect(onCreate.mock.calls.map(([n]) => n)).toEqual(["a", "b"]);
  expect(onAssign).toHaveBeenCalledWith(["t-a", "t-b"]);
});

it("caps a paste at the per-item limit", async () => {
  const assigned = Array.from({ length: TAGS_PER_ITEM_MAX - 1 }, (_, i) => tag(`t${i}`));
  const onAssign = vi.fn();
  const onCreate = vi.fn(async (n: string) => tag(n));
  render(<TagEditor assigned={assigned} all={[]} onAssign={onAssign} onCreate={onCreate} />);
  fireEvent.change(input(), { target: { value: "x, y, z, " } });
  await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
  expect(onAssign.mock.calls[0][0]).toHaveLength(TAGS_PER_ITEM_MAX);
  // Only the tag that fits is created; the rest would be orphans in the registry.
  expect(onCreate).toHaveBeenCalledTimes(1);
});

it("two quick chip removals before the first save settles both apply", async () => {
  const d = deferred();
  const onAssign = vi.fn(() => d.promise);
  render(<TagEditor assigned={[tag("a"), tag("b"), tag("c")]} all={[]} onAssign={onAssign} onCreate={async (n) => tag(n)} />);
  fireEvent.click(screen.getByRole("button", { name: /remove tag a/i }));
  fireEvent.click(screen.getByRole("button", { name: /remove tag b/i }));
  expect(onAssign.mock.calls).toEqual([[["t-b", "t-c"]], [["t-c"]]]);
  d.resolve();
});

it("re-syncs with the props after a save settles", async () => {
  const d = deferred();
  const onAssign = vi.fn(() => d.promise);
  const { rerender } = render(<TagEditor assigned={[tag("a"), tag("b")]} all={[]} onAssign={onAssign} onCreate={async (n) => tag(n)} />);
  fireEvent.click(screen.getByRole("button", { name: /remove tag a/i }));
  d.resolve();
  await act(async () => {});
  rerender(<TagEditor assigned={[tag("b")]} all={[]} onAssign={onAssign} onCreate={async (n) => tag(n)} />);
  fireEvent.click(screen.getByRole("button", { name: /remove tag b/i }));
  expect(onAssign).toHaveBeenLastCalledWith([]);
});
```

(Confirm the chip remove button's accessible name in `tag-chip.tsx`; adjust the regex. Import `TAGS_PER_ITEM_MAX` from `@kaipu/domain/constants` and `act` from RTL.)

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/library/components/tag-editor.test.tsx` → the paste tests see multiple `onAssign` calls each with one id; the removal test sees `[["t-b","t-c"]], [["t-a","t-c"]]`.

- [ ] **Step 3: Implement**

Imports: `import React, { useId, useMemo, useRef, useState } from "react";`. Prop: `onAssign(tagIds: readonly string[]): void | Promise<void>;` (doc: "may return a promise; the list counts as in flight until it settles"). Replace the state block and handlers:

```tsx
  const ids = assigned.map((tag) => tag.id);
  // Latest list this editor knows of: the prop when idle, the last list sent while
  // a save is in flight. Edits build on this, never on the render closure, so two
  // quick edits (or a multi-tag paste) cannot drop each other's changes.
  const idsRef = useRef<readonly string[]>(ids);
  const pending = useRef(0);
  const [, rerender] = useState(0);
  if (pending.current === 0) idsRef.current = ids;
  const atLimit = ids.length >= TAGS_PER_ITEM_MAX;

  const suggestions = useMemo(() => {
    const needle = tagSlug(draft.replace(/^#/, ""));
    if (needle === "") return [];
    return all.filter((tag) => !ids.includes(tag.id) && tag.slug.includes(needle)).slice(0, SUGGESTIONS_MAX);
  }, [draft, all, ids]);

  const commit = (next: readonly string[]): void => {
    idsRef.current = next;
    pending.current += 1;
    void Promise.resolve(onAssign(next)).finally(() => {
      pending.current -= 1;
      // Re-render so the idle branch above re-syncs the ref with the props (also
      // restores the list when the save failed and the props never changed).
      rerender((n) => n + 1);
    });
  };

  const assignMany = (tagIds: readonly string[]): void => {
    const next = [...idsRef.current];
    for (const id of tagIds) {
      if (next.length >= TAGS_PER_ITEM_MAX) break;
      if (!next.includes(id)) next.push(id);
    }
    if (next.length !== idsRef.current.length) commit(next);
  };

  const assign = (tag: TagSummary): void => assignMany([tag.id]);

  /** Resolves each piece to a tag (creating missing ones one at a time), then assigns all in ONE call. */
  const addMany = async (raws: readonly string[]): Promise<void> => {
    if (idsRef.current.length >= TAGS_PER_ITEM_MAX) return;
    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const raw of raws) {
      // Stop before creating a tag that the per-item cap would refuse to assign.
      if (idsRef.current.length + resolved.length >= TAGS_PER_ITEM_MAX) break;
      const name = normalizeTagName(raw.replace(/^#/, ""));
      if (name === null) continue;
      const slug = tagSlug(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const tag = all.find((candidate) => candidate.slug === slug) ?? (await onCreate(name));
      if (tag) resolved.push(tag.id);
    }
    assignMany(resolved);
  };

  const add = (raw: string): Promise<void> => {
    setDraft("");
    return addMany([raw]);
  };

  const remove = (id: string): void => commit(idsRef.current.filter((other) => other !== id));
```

Paste branch in `onChange`:

```tsx
            if (value.includes(",")) {
              const pieces = value.split(",");
              const rest = pieces.pop() ?? "";
              void addMany(pieces);
              setDraft(rest.trimStart());
              return;
            }
```

Backspace: `else if (e.key === "Backspace" && draft === "" && idsRef.current.length > 0) { remove(idsRef.current[idsRef.current.length - 1]!); }`. Enter (`void add(draft)`) and the suggestion `onMouseDown` (`assign(tag)`) stay.

- [ ] **Step 4: Run and commit** — PASS (if React logs `act()` warnings for the sync Harness tests, flush with `await act(async () => {})` in those tests).

```bash
git add src/renderer/src/features/library/components/tag-editor.tsx src/renderer/src/features/library/components/tag-editor.test.tsx
git commit -m "fix(desktop): tag editor builds every edit on the latest list; a paste assigns once"
```

### Task 2: Callers return the save promise

**Files:**

- Modify: `features/library/components/tag-panel.tsx:27`, `:147` (prop types), `pages/library/library-page.tsx:374-376`, `pages/library-detail/library-detail-page.tsx:265`

- [ ] **Step 1: Implement**

`tag-panel.tsx`: `onAssign(tagIds: readonly string[]): void | Promise<void>;` on both `TagPanelProps` and `ItemTags`' props. `library-page.tsx`: `onAssign={(next) => (tagging?.id ? setTags(tagging.id, next) : undefined)}`. `library-detail-page.tsx`: `onAssign={(next) => setTags(localId, next)}`.

(Optional step C: extract the ref/pending logic into `components/use-latest-ids.ts` and use it in `ItemTags.toggle` too. If skipped, log it in the PR as a follow-up.)

- [ ] **Step 2: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/library src/renderer/src/pages/library src/renderer/src/pages/library-detail && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/library/components/tag-panel.tsx src/renderer/src/pages/library/library-page.tsx src/renderer/src/pages/library-detail/library-detail-page.tsx
git commit -m "fix(desktop): tag editors learn when a tag save settles"
```

### Task 3: Ship

- [ ] Open a PR titled `fix(desktop): multi-tag paste and quick chip edits keep every change (audit LIB-B2)` linking this plan and the finding. End with **How to test it yourself**:
  1. On a recording's detail page, paste `design, demo, ` into the tag field → both chips appear; reopen the page → both persist.
  2. With three tags, click the × of two chips quickly → both disappear and stay gone after reload.
  3. Type a tag name and press Enter twice quickly → one chip, no duplicate.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
