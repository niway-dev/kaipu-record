---
name: verify
description: 'Run when the user or another agent says "verify" or names verify. Also use when a kaipu-record PR needs proof rows: screenshots or video of a criterion on the real app.'
---

# verify

Produce screenshots and a video of the real Kaipu Record desktop app for the `## Proof` table of a PR.

## When to use

- A PR criterion is visible UI behavior and its proof row needs a picture, not just a test log.
- The user or another agent says "verify".

Not for: pure logic (a unit test is the proof), and not a CI gate. Per ADR 0006 and ADR 0027 the macOS e2e
suite runs only on release candidates; this skill runs on demand and changes nothing in CI.

## Overview

Each scenario is a Playwright script in `apps/kaipu-record/verify/`. It launches the built Electron app with
`_electron.launch` (through the e2e `launchApp` helper, so userData and the vault are throwaway and seeded),
takes `page.screenshot` at named steps, and records video with `recordVideo`. This is the driver's own
recording: unattended, no screen-recording permission. Background:
https://github.com/csdev19/general-knowledge/blob/main/conventions/development-pipeline.md ("Verification on the real surface", "The proof list").

## How to run a scenario

From `apps/kaipu-record`, in the worktree of the PR (use the PR's code, not the main checkout):

1. Build once per code change (a stale `out/` proves the old code). The build bakes in `MAIN_VITE_*` URLs and
   needs no secret; with no env file, pass placeholders inline:
   `MAIN_VITE_SERVER_URL=http://localhost:3000 MAIN_VITE_WEB_URL=http://localhost:3001 bunx electron-vite build`
   (with a real `.env` present, `bun run build` also works; it type-checks first).
2. Run: `bun run proof:run <scenario>` (a file-name filter such as `launch`; omit it to run all).
   `bun run proof` = `bun run build` then the same, and needs the `.env` file.
3. Artifacts land in `apps/kaipu-record/test-results/verify/<scenario>/` (gitignored): `NN-<step>.png` per step
   and `video.webm` (main window). The folder is wiped at the start of each run of that scenario.
4. Attach to the PR: Playwright artifacts are local files, so upload them. Drag the PNGs and the `.webm` into
   the PR description or a comment in the browser (GitHub hosts them and gives a link), or use a gist or
   release asset. Put the link in the proof row's Evidence cell. Never commit them.

Environment: macOS or a dev machine for `export` (WebCodecs H.264; it self-skips on Linux). The app is
launched with `KAIPU_DISABLE_SCREEN_CAPTURE=1`, so no OS permission dialog appears. A running Kaipu dev
instance does not interfere (separate `--user-data-dir`).

## Feature map

| Scenario  | What it shows                                                           | Command                     | Artifacts                                                                     |
| --------- | ----------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `launch`  | First run: onboarding dialog, then the main window after "Skip setup"   | `bun run proof:run launch`  | `01-onboarding.png`, `02-main-window.png`, `video.webm`                       |
| `library` | Library list, then the seeded recording's detail page with "Edit video" | `bun run proof:run library` | `01-library-list.png`, `02-recording-detail.png`, `video.webm`                |
| `export`  | Editor, export sheet, "Ready to share" card after a real H.264 export   | `bun run proof:run export`  | `01-editor.png`, `02-export-sheet.png`, `03-ready-to-share.png`, `video.webm` |

Not covered yet: recording itself (needs screen-capture permission), screenshot editor, settings, auth.
Add a scenario when a PR's criterion lands there.

## How to add a scenario

1. Create `apps/kaipu-record/verify/<name>.verify.ts`; import `startScenario` from `./helpers` and, for
   onboarding and seeded ids, `dismissOnboarding` / `openEditor` / `RECORDING_ASSET_ID` from `../e2e/helpers/launch`.
2. `const s = await startScenario("<name>")`, drive `s.page` as an e2e test does, call `await s.shot("<step>")`
   once the UI has settled, and always `await s.finish()` in `finally` (the video is only written on close).
3. Copy locators from the matching `e2e/*.e2e.ts` spec; they already work against the real app.
4. Run it, open the PNGs, and add a row to the Feature map.

## Common mistakes

- Shooting before the UI settles: toasts and cards animate in; wait for the element, then a short pause.
- Verifying a stale build: rebuild after every code change; check `out/` is newer than your last edit.
- Skipping `finish()`: no video is written, and the app process may linger.
- Running from the main checkout instead of the PR's worktree.
- Committing `test-results/`, or pasting artifact paths as evidence: a local path is not a link a reviewer can open.
- Treating a seeded fixture (`sample.mp4`) as a real recording: say so in the proof row.

## Before reporting

- Paste the command, its exit code, and the artifact list with sizes (`ls -la test-results/verify/<scenario>`).
- Open at least one PNG and confirm it shows the criterion, not a blank or half-animated screen.
- Say which scenarios you did not run and why (for example `export` on Linux).
- Link the uploaded files in the PR's Proof table; keep claims to what the pictures show.
