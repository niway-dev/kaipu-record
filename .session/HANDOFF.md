# Session handoff

## Goal

Fix Kaipu dropping out of Cmd+Tab (only reachable again from the menu-bar icon), and work through the 2026-10-15 code-audit fix plans, at least 3 at a time, one worktree and branch each.

## Mode

code

## Where we stopped

- Last done: three audit plans shipped as PRs and every review-bot comment on them answered in its thread (#358 plan 07, #359 plan 02, #360 plan 05 — #360 had no comments). Cmd+Tab bug diagnosed, not yet fixed.
- Next: once the owner says go, on a new branch from `main` (e.g. `fix/desktop-cmd-tab-floating-panels`), add `skipTransformProcessType: true` to the `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` calls in `apps/kaipu-record/src/main/recording/camera-bubble-window.ts:47` and `apps/kaipu-record/src/main/recording/control-bar-window.ts:62`, with tests mirroring the capture panel's (`capture-panel-window.test.ts`). Owner validates manually: camera on, record, stop → Kaipu still in Cmd+Tab; control bar still shows over a full-screen app.

## Decided

- Cmd+Tab diagnosis (hypothesis, strong but not reproduced): the camera bubble and control bar call `setVisibleOnAllWorkspaces(..., { visibleOnFullScreen: true })` without `skipTransformProcessType`, so Electron transforms the process to a UI-element app and back, which can drop it from the Dock/Cmd+Tab. Commit 78e20a25 (2026-10-07) made `setActivationPolicy` in `settings-store.ts` skip unchanged policies, so the old re-assertions (`applyDockPolicy` after camera-on / recording stop / rescue shortcut) became no-ops. Capture panel, overlays and toast already pass the flag (see bafe872e). Settled.
- Keep the 78e20a25 policy cache — it fixed the main window vanishing on camera-on. Settled; do not reopen.
- Audit fix branches start from `main`, not from the docs branch; the plans live only on `docs/code-audit-2026-10-15` (PR #301), so fix PRs do not delete them. Settled.
- Plans picked in parallel must not share files (02, 05, 07 were disjoint). Settled.
- Every review comment addressed gets a reply in its thread: "Fixed in <sha>: ..." or why it is not a real issue. Never resolve the reviewer's thread. Settled (owner rule).
- Never push with `--no-verify`; fix the environment instead. Settled.

## Open

- Owner go-ahead for the Cmd+Tab fix.
- Whether `skipTransformProcessType` keeps the control bar visible over full-screen apps (worked for the capture panel; unverified for the bar).
- After #358/#359/#360 merge: delete plans 02, 05, 07 and their index rows on `docs/code-audit-2026-10-15` (PR #301).
- Follow-up outside plan 07's scope: renderer `use-tags.ts` `create` calls `listTags()` unguarded in its catch, so with a corrupt registry `create` rejects instead of returning null.
- #359 residual: a dev build and a packaged build running together, vault unavailable, a take paused >2 min in `os.tmpdir()` — documented in `backlog/recording-finalize-recovery.md` Limits, not fixed.
- #359 needs owner manual check: the parentless save dialog appears in front while the main window is hidden.
- Next batch of plans: candidates without file overlap with open PRs — 06 library delete ordering, 09 video autosave assets; 04 and 08 overlap with 02/07 code, wait for those merges.
- 5 leftover agent worktrees from other sessions under `.claude/worktrees/` (niw2-325..329, ci-cloudflare-hardening) plus `../kaipu-wt-env-test`; not touched, owner may want them cleaned.

## State

- Branch `wip/cmd-tab-and-audit-followups`, PR: see draft PR for this branch
- Committed: only this handoff file. Real work is in PRs #301 (docs, rebased onto main 2026-10-21), #358, #359, #360 — all pushed, none merged.
- Uncommitted at park time: nothing (main checkout is on `feature/niw2-324-...`, clean, pushed by another session).

## For the agent

- Original request, verbatim: "hay veces donde desaparece de nuestra lista de apps: command + tab tengo que abrirlo desde el top bar para que aparezca audita eso ... desempolva este [docs/code-audit-2026-10-15]. desde esta rama manda subagentes sonnet para que podamos desarrollar al menos 3 issues de ese repo. cuando acabemos iremos por lo dems. pero cada uno en su worktree y en su rama"
- Files in play: `apps/kaipu-record/src/main/recording/camera-bubble-window.ts`, `control-bar-window.ts`, `recording-hub.ts`, `src/main/infrastructure/settings-store.ts`; plans at `apps/documentation/src/content/docs/plans/audit-2026-10-15/` on branch `docs/code-audit-2026-10-15`.
- Check command: `bun run test && bun run check-types && bun run lint` from `apps/kaipu-record` — not run at park time (handoff-only commit); each PR's agent reported green suites (2208–2218 tests, exit 0).
- Conventions to keep: execution subagents on Sonnet, named before dispatch; each subagent in its own worktree; after its PR is pushed, verify HEAD == origin and remove the worktree plus its `worktree-agent-*` helper branch. `gh` needs `--repo niway-dev/kaipu-record`. A worktree needs `bun install --frozen-lockfile` before checks/hooks run.
