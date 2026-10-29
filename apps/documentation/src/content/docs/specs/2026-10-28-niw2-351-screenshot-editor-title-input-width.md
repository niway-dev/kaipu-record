---
title: "NIW2-351: Screenshot editor title input width — approved spec"
description: "The capture title in the screenshot editor toolbar is readable at the default window size; action buttons compact to icons before the title truncates."
---

# NIW2-351: Screenshot editor: title input is too narrow and truncates the capture name

> Approved spec, committed **before** implementation (ADR-0010). Source: the Linear ticket body (https://linear.app/niway/issue/NIW2-351). Where they disagree, **this file wins**.
> Path: `apps/documentation/src/content/docs/specs/2026-10-28-niw2-351-screenshot-editor-title-input-width.md` · Approved: 2026-10-28 (Cristian, all proposed defaults) · Base: `main` @ `f10e39a4`

## Context

The owner first deferred this to the Editor workspace (NIW2-157). Re-checked on `origin/main` (2026-10-24): Editor workspace phase 1 merged on 2026-10-06 (5e66bb2f), before this ticket was filed (2026-10-13), and the screenshot editor toolbar still renders `<CaptureTitleInput>` between `<AnnotationToolbar>` and the actions in `pages/screenshot-editor/screenshot-editor-page.tsx`. `.field` in `capture-title-input.module.css` is still `flex: 1; min-width: 0; max-width: 520px`, so the cause below still applies and the fix is standalone.

## Goal

The capture title in the screenshot editor toolbar is readable at the default window size. The screenshot editor toolbar (niway-dev/kaipu-record#256) squeezes the title input between the annotation tools and the undo/redo buttons; at a normal width it shows only "Scree…", so the user cannot read the name they are editing.

## Expected

The field is wide enough to read a typical capture name (e.g. "Screenshot — 10/13/2026, 9:41:02 AM"), or grows to fill the free toolbar space.

## Cause (from reading the CSS, not measured)

After niway-dev/kaipu-record#260 (responsive toolbar), the action buttons collapse to icons only once the row cannot fit (`useCompactRow` in the page). The title field is `flex: 1; min-width: 0`, so it shrinks to nothing first and the buttons compact only after that. Likely fix: give `.field` a `min-width` (e.g. 160px) so the buttons compact before the title truncates.

Files: `apps/kaipu-record/src/renderer/src/features/screenshots/capture-title-input.module.css`; check `useCompactRow` and the toolbar styles of `pages/screenshot-editor/` if the compact threshold needs to follow.

## Tests (write first)

- jsdom cannot measure layout, so a layout assertion is not possible. Write the failing test on what is observable: `capture-title-input.test.tsx` keeps passing, and add a test that the input exposes the full title as its `title` attribute (tooltip) so a truncated name is still readable on hover (add it only if it is not already there).
- Layout is verified by hand (see "How to test it yourself"); say so in the PR instead of inventing a flaky test.

## Does not include

- Reworking the toolbar layout or moving the field to another row.
- Changes to the video editor or the Editor workspace.

## Executor instructions

1. Read this spec in full, then the CSS module, `capture-title-input.tsx`, and the toolbar part of `screenshot-editor-page.tsx` and its styles.
2. Start with the failing test where one is possible; otherwise state why not.
3. If the `min-width` fix does not stop the truncation (for example the compact threshold does not fire before the toolbar overflows), stop and comment on the ticket with what you saw.
4. One PR for this ticket, linking it, ending with a "How to test it yourself" section.
5. Never run the Playwright desktop E2E suite locally. Use pinned tools (`apps/kaipu-record/node_modules/.bin/vitest`, `bun run check-types`), never `bunx`.
6. English in every artifact. UI copy through i18n (en + es) if any is touched (none expected).

## How to test it yourself

1. `bun run dev`, take a screenshot.
2. In the editor toolbar, the title field shows the full auto title without truncation at the default window size.
3. Narrow the window: the field may shrink, but toolbar buttons must not overlap or wrap. The action buttons collapse to icons before the title is cut.

## Dependencies

- No open `blocked by` relation. Standalone (Editor workspace phase 1, NIW2-157, already merged).

## Approved decisions

1. **Approval.** Cristian approved this ticket on 2026-10-28 with every proposed default; this file is the contract. Where the Linear description disagrees, this file wins.
2. **Failing test first.** Each task starts with a failing test, run before the fix. Selector names, helper names and line numbers were written by reading the code, not by running it: adapt them to today's code.
3. **Stop, don't improvise.** If a Review Focus line or a flagged assumption does not hold on today's `main`, stop and report it in a comment on the Linear ticket instead of improvising.
4. **One PR.** One PR for this ticket. It links NIW2-351, ends with a "How to test it yourself" section.
5. **Tooling.** Never run the Playwright desktop E2E suite locally (CI runs it). Use the pinned tools (`apps/kaipu-record/node_modules/.bin/vitest`, `bun run check-types`), never `bunx`.
6. **Human merge.** The ticket carries `needs-human-merge`: the PR is not auto-landed; Cristian reviews and merges it.
7. **Repo rule: no remote side effects.** No remote `db:push`/migrations against any real or dev database, no deploys, no releases or tags, no changes to remote storage or secrets. Local tests and fixtures only.
8. **Suggested model:** Sonnet.
9. **Fix (proposed default, approved):** give `.field` in `capture-title-input.module.css` a `min-width` (about 160px) so the action buttons collapse to icons (`useCompactRow`) before the title truncates. Adjust the compact threshold only if the min-width alone does not achieve that.
10. **Tests:** jsdom cannot measure layout, so no layout assertion. Keep `capture-title-input.test.tsx` passing and add a failing-first test that the input exposes the full title as its `title` attribute (tooltip) — only if it is not already there. Layout is verified by hand; say so in the PR instead of inventing a flaky test.
11. **If `min-width` does not stop the truncation** (e.g. the compact threshold does not fire before the toolbar overflows), stop and comment on the ticket with what you saw.
12. **Copy:** English in every artifact; UI copy only through i18n (en + es) if any is touched (none expected).
13. **Out of scope:** reworking the toolbar layout, moving the field to another row, the video editor and the Editor workspace.

## Change log

- 2026-10-28: Spec approved by Cristian with all proposed defaults; committed from the Linear ticket body as the first commit of `feature/niw2-351-screenshot-editor-title-input-is-too-narrow-and-truncates`.
