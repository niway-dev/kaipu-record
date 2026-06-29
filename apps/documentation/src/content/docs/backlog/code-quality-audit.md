---
title: Code-quality audit — playbook & refinement backlog
description: The reusable prompt + method for systematically auditing kaipu-record (component health, feature boundaries, practical test coverage), plus the running log of what's been refined, what was deemed mature, and what's left as optional.
---

# Code-quality audit — playbook & refinement backlog

> **Status: 🔵 Living doc.** Run this when the desktop codebase grows and warrants a consolidation
> pass. It is **not** a feature to "finish" — it's a method + a log. Pick up items as desired.

The core is solid. This captures the audit method so future passes are consistent, and logs what's
already been done / deliberately skipped, so we don't re-litigate mature code.

## The audit prompt (reusable)

Systematic code review of **only `kaipu-record`** (the Electron desktop app). Strict parameters:

**Quality parameters (non-negotiable):**

1. No giant components.
2. No component that shows **UI** _and_ does elaborate/complex **logic** in the same file. If found:
   split in two, extract a hook, or use the composition pattern.
3. Use the composition pattern whenever possible.
4. Analyze `features/` for logic/components/code that could become **its own feature** (the codebase
   is growing).
5. Analyze tests and coverage; improve where useful. The **main paths / use cases** must be mapped
   and tested.

**On coverage (important):**

- Coverage is **not** a static target. Don't chase a %.
- Want **practical** tests that cover the use cases we need to ensure — not percentage-chasing.
- Console-only coverage report (no thresholds that break the build).

**Workflow (mandatory):**

- Go for everything, but **one by one**.
- First **PROPOSE** the change; the human reviews; **only then execute**.
- Explain the **"why"** of each decision (especially pure function vs hook vs `useMemo`).
- **If the code is already mature, say so and skip it** — don't refactor for its own sake.

**Project patterns to respect:**

- Pure function (testable) + infra/hook split — e.g. `settings.service.ts` (pure) vs
  `settings-store.ts` (infra); `recording-activity.ts` (pure) vs `recording-hub.ts` (infra).
- CSS Modules co-located per component.
- No TS enums: `as const` + `(typeof [...])[number]`.
- Code/comments in English; user-facing copy in neutral Spanish.
- Atomic commits per scope, with `--no-verify` (oxfmt churn hold). **Stage explicit paths**, never
  `git add -A` mid-pass (it sweeps unrelated docs into the commit).
- Each new feature gets a doc under `apps/documentation`.

**Scope:**

- Only `kaipu-record` desktop. Local-first. No backend/web in scope.
- **IPC:** don't test the transport. Test by extracting the logic behind the handlers into a pure
  module (same pure/infra split), then unit-test that.

## Method cheatsheet — pure fn vs hook vs RTL

- **Pure function** when the logic is deterministic, no React, no I/O (state transitions, parsing,
  geometry, formatting). Easiest to test; prefer it. (e.g. `recording-activity.applyTick`,
  `version-gate.evaluateGate`.)
- **Hook** when the logic needs React state/effects or a subscription (e.g. `useUpdateStatus`,
  `useVersionGate`). Test with `renderHook` + mocked bridges.
- **RTL component test** when the value is **UI behavior with branches + interaction** (render
  states, clicks, keyboard). Test the component's _contract_, not internals. (e.g.
  `ScreenSourceSelector`, `VideoRow`.)
- **`useMemo`** is for perf, not correctness — never reach for it to make something testable; extract
  a pure function instead.

## Done

**Prior pass** (feat/screen-recording-control-bar):

- Library → extracted `library-filters.ts` (pure) + hook + `sort-menu`/`filter-chip`; page 309→200.
- Permissions → promoted to its own feature (`features/permissions/`).
- Recording indicator → reusable component with `bar`/`banner` variants.
- Library detail → `use-rename-recording` hook + `recording-player` + `recording-title`; 159→92.
- Coverage block in vitest config + `test:coverage`, **console-only** (no thresholds).
- `recorder-engine` → 7 characterization tests (~93%).

**Post-launch consolidation pass** (refactor/kaipu-record-consolidation):

- `recording-hub.ts` → extracted pure **`recording-activity.ts`** (`startedActivity`/`stoppedActivity`/
  `applyTick`, incl. the "re-broadcast only on status flip or whole-second advance" rule) + unit test.
- **`ScreenSourceSelector`** → practical RTL test (default screens tab + select fires callbacks,
  Windows-tab filtering, permission/loading/error/empty branches, close via button + backdrop).
- **`VideoRow`** → practical RTL test (click + keyboard navigate; Delete/Upload don't bubble to the
  row — `stopPropagation`; `canUpload` branch; empty-title fallback).

## Skipped — deliberately mature (don't re-open without a reason)

- **`watermark-compositor.ts`** — the pure geometry (`watermarkRect`) is already extracted + tested
  in `features/watermark/watermark.ts`; the rest is DOM/canvas/MediaStream infra. A file-move to
  `features/watermark/` would be cosmetic churn.
- **`settings-store.ts`** — pure merge/validate already in `settings.service.ts` (tested); the rest is
  thin Electron/fs infra with trivial decisions (`showInDock ? "regular" : "accessory"`). Testing it
  would test mocks, not logic.
- **`ui/cx.ts`** — a one-liner `parts.filter(Boolean).join(" ")`; unbreakable, not worth a test.
- **`features/permissions/permissions.ts`** — only exports a seed constant; no logic to test.
- **Electron-coupled main modules** (`global-shortcuts.ts`, `auto-updater.ts`, window classes, tray,
  media-protocol) — no extractable pure logic; validated in prod, by repo convention.

## Pending / optional (low priority)

- **`MicPicker`** — RTL test (toggle open/close, select fires `onSelect`, active match). Real path,
  moderate value; the twin of the already-covered `ScreenSourceSelector`.
- **`recording-player`** — a wrapper over the native `<video>`; little useful unit surface.
- **`webcam-preview`** — visual (a live `<video>`); not meaningfully unit-testable.

## When to run another pass

Trigger a new audit when: a feature folder grows past ~6–8 files and starts mixing concerns; a
component crosses ~200 lines while doing both UI and logic; or a new main-path component ships
without a test. Otherwise, leave mature code alone.
