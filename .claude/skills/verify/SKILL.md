---
name: verify
description: 'Run when the user or another agent says "verify" or names verify. Also use when kaipu-record work needs evidence: a mockup or design idea to show, a renderer component or card to screenshot (rest and hover), a before/after of a visible change, or proof rows with screenshots or video of the real app. cs-capture-evidence loads this skill as the project''s evidence configuration.'
---

# verify — Kaipu Record's evidence skill

The one place kaipu-record configures evidence. `cs-capture-evidence` (`produce`, Step 0) looks for
this skill and follows it; the generic procedure, the script and the stack traps live there and in
the hub recipes, not here:

- procedure: `cs-capture-evidence` → `references/produce.md` (deliver, record, secrets, layout);
- browser recipe: [general-knowledge `verification/web-playwright.md`](https://github.com/csdev19/general-knowledge/blob/main/verification/web-playwright.md);
- Electron recipe: [general-knowledge `verification/electron.md`](https://github.com/csdev19/general-knowledge/blob/main/verification/electron.md).

## Configuration

| Setting           | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces          | Browser (mockups, renderer components in a harness) and the Electron app                                                                                                                                                                                                                                                                                                                                                                                                         |
| Owner's machine   | **Browser scenarios only.** Never launch Electron, the Playwright desktop suite or the Electron scenarios below there (owner rule): a killed Electron leaves a macOS dialog. Screenshots and video of the Electron app come only from running these scenarios on another machine. CI (`gh workflow run "PR checks" --ref <branch>`) runs the macOS E2E and proves the flows pass; it uploads Playwright artifacts only on failure, so it is a pass/fail proof row, not a picture |
| Shot script       | `cs-capture-evidence/scripts/shots.mjs` (symlinked from the skills clone into `~/.claude*/skills/`; `<skills>` below), run with `bun` from the repo root (rest + hover, settled animations)                                                                                                                                                                                                                                                                                      |
| `playwright-core` | `node_modules/.bun/playwright-core@<v>/node_modules/playwright-core` (bun, not hoisted); the script finds it, also from a fresh worktree via the main checkout                                                                                                                                                                                                                                                                                                                   |
| Browser           | System Google Chrome (`executablePath`). Never `playwright install`                                                                                                                                                                                                                                                                                                                                                                                                              |
| Evidence folder   | `.evidence/<branch-or-topic>/` at the repo root (git-ignored)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Mockups           | `apps/documentation/public/mockups/*.html`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Tokens            | `packages/tokens/css/tokens.css` (dark is `:root`)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Renderer aliases  | `@renderer` → `apps/kaipu-record/src/renderer/src`, `@shared` → `apps/kaipu-record/src/shared`                                                                                                                                                                                                                                                                                                                                                                                   |
| Delivery          | Chat: `![state](<absolute path>)`. PR: `gh pr edit <n> --attach '<file>#<alt>'`. One row per state, growing down: `State \| Before \| After` or `State \| Capture`                                                                                                                                                                                                                                                                                                               |

## When to use

- A design idea or mockup is on the table and the owner should see it, not read about it.
- A UI change is about to be reported done or a PR's proof row needs a picture.
- The user or another agent says "verify".

Not for: pure logic (a unit test is the proof), and not a CI gate. Per ADR 0006 and ADR 0027 the macOS e2e
suite runs only on release candidates; this skill runs on demand and changes nothing in CI.

## Browser scenarios (no Electron)

### Mockup

```bash
bun <skills>/cs-capture-evidence/scripts/shots.mjs apps/documentation/public/mockups/<name>.html \
  .evidence/<topic> full "hover:<card selector> as card"
```

Copy a mockup that is not committed yet into its own `/tmp` folder first; run the script from the
repo root either way, so it finds `playwright-core`.

### Real-app picture of one state (preferred)

For any screen or state the UI catalog names, the real Electron app on the Mac mini is the source,
not a harness. From `apps/kaipu-record`:

```bash
bun run ui-catalog:remote --only '<screen>/<state>'            # e.g. 'record/countdown'
bun run ui-catalog:remote --sha <base sha> --only '<screen>/<state>'   # the same state on the base, for a before/after
```

The images land in `.evidence/ui-catalog/<short sha>/screens/` (and `areas/`); run the command once
per SHA for a before/after. Electron starts only on the mini (`ssh macmini`), never on this machine.
The state ids are in `apps/kaipu-record/ui-catalog/catalog/README.md`. The catalog publishes
nothing unless `ui-catalog:publish` is run, so this is safe on a branch.

Run it for the screens a UI change touches as soon as the change compiles, before any review, and
open every PNG. Unit tests run in jsdom, which has no layout, so collapsed columns, truncated copy
and overlapping badges show up only in these pictures.

`.evidence/` is relative to the checkout the command runs in. When that checkout is a worktree
(`git rev-parse --git-dir` differs from `git rev-parse --git-common-dir`), its `.evidence/` is
deleted with the worktree, and a hook removes the worktree right after `gh pr create`. Copy the
PNGs the PR needs to the main checkout's `.evidence/` (or `/tmp`) before opening the PR.

### Renderer component in a harness (fallback only)

Label every shot from here as a harness shot: it proves what a component renders, never main's
behaviour, and it is never a catalog image or a before/after of the real app. Use it only when
the state is not in the catalog yet or the mini is unreachable.

For a real component (a card, a floating window, a dialog), without Electron. Proven on NIW2-606
(the capture preview card):

1. In a worktree of the branch (`bun install --frozen-lockfile`, never symlinked `node_modules`),
   add a throwaway `apps/kaipu-record/harness-tmp/` with `index.html`, `harness.tsx` and a
   `vite.config.ts` that sets the `@renderer` / `@shared` aliases and `@vitejs/plugin-react`
   (components on CSS modules need no StyleX plugin; add it when the component uses StyleX).
2. `harness.tsx` imports `../src/renderer/src/assets/main.css`, wraps the component in
   `I18nProvider` (`@kaipu/i18n`, `messages/es` and `messages/en`) and passes a **fake bridge**
   (the component's `api` prop, or a stub `window.electronAPI`) that sends the payload of the scene
   in `?s=<scene>`. Set `document.body.dataset.window` like `main.tsx` does for that window.
3. `node_modules/.bin/vite build --config harness-tmp/vite.config.ts`, then serve `harness-tmp/dist`
   with `python3 -m http.server <free port>` (module scripts do not load from `file://`).
4. Shoot at the **window's real size**: the viewport main gives that window, or a page `clip` of the
   card plus its window padding.
5. Delete `harness-tmp/` and stop the server. Never commit it.

Say in the proof row that the shot proves what the component renders, not main's behaviour.

### Before / after

Stand up the base in a second worktree (`git worktree add --detach … origin/main`), build the same
harness there with the same scenes and the same thumbnail, and shoot both at each side's real
window size. A state the base did not have gets `—`; a "before" that only exists as the owner's
screenshot is marked reported, not re-shot.

## Electron app scenarios

Each scenario is a Playwright script in `apps/kaipu-record/verify/`. It launches the built Electron app with
`_electron.launch` (through the e2e `launchApp` helper, so userData and the vault are throwaway and seeded),
takes `page.screenshot` at named steps, and records video with `recordVideo`. This is the driver's own
recording: unattended, no screen-recording permission. Background:
https://github.com/csdev19/general-knowledge/blob/main/conventions/development-pipeline.md ("Verification on the real surface", "The proof list").

## Where Electron scenarios run

On the owner's Mac mini, never on the owner's laptop (Configuration). The owner is logged in at
its console, so a window launched over SSH opens in that session.

- `ssh macmini`; the clone is `~/Documents/Workspace/Agent/kaipu-record`. Add a worktree there for
  the PR's branch; keep that clone's `main` clean.
- Non-interactive SSH has no node on `PATH`. Prefix every command with
  `export PATH="$HOME/.local/share/mise/installs/node/24/bin:$HOME/.bun/bin:/opt/homebrew/bin:$PATH"`.
- Build with `./node_modules/.bin/electron-vite build` (same inline `MAIN_VITE_*` placeholders as
  below) and run with `node node_modules/@playwright/test/cli.js test -c verify/playwright.config.ts <scenario>`.
- Copy the artifacts back with `scp` into `.evidence/<topic>/`, then remove the worktree there.

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
4. Attach to the PR: `gh pr edit <n> --attach '<file>#<alt>'` (gh ≥ 2.99, 10 MB per file), laid out one row
   per state as in Configuration. Put the link in the proof row's Evidence cell. Never commit them.

Environment: macOS or a dev machine for `export` (WebCodecs H.264; it self-skips on Linux). The app is
launched with `KAIPU_DISABLE_SCREEN_CAPTURE=1`, so no OS permission dialog appears. A running Kaipu dev
instance does not interfere (separate `--user-data-dir`).

## Feature map

| Scenario      | What it shows                                                                   | Command                         | Artifacts                                                                     |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| `launch`      | First run: onboarding dialog, then the main window after "Skip setup"           | `bun run proof:run launch`      | `01-onboarding.png`, `02-main-window.png`, `video.webm`                       |
| `library`     | Library list, then the seeded recording's detail page with "Edit video"         | `bun run proof:run library`     | `01-library-list.png`, `02-recording-detail.png`, `video.webm`                |
| `export`      | Editor, export sheet, "Ready to share" card after a real H.264 export           | `bun run proof:run export`      | `01-editor.png`, `02-export-sheet.png`, `03-ready-to-share.png`, `video.webm` |
| `kaipu-black` | A plain launch at the default size, every main page at 1440×900, a rail tooltip | `bun run proof:run kaipu-black` | `00-plain-launch.png` … `06-sidebar-tooltip.png`, `video.webm`                |

Not covered yet: recording itself (needs screen-capture permission), screenshot editor, settings, auth.
Add a scenario when a PR's criterion lands there.

## Before / after in the real app

Run the **same scenario** on a worktree at the commit without the change: the commit before the
first edit, or for a stacked PR the commit the stack's first PR starts from (the PR below already carries part of
the change). A step whose UI does not exist on the old tree is skipped there, not failed, so one
file runs on both sides (`kaipu-black.verify.ts` does this). Keep one shot at the window size the
app opens with, before any `setSize`: a layout that breaks only at the launch size is invisible
in shots taken at 1440×900. The browser harness is a layout check, not this evidence; when it is
all there is, the proof row says so.

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
- `git worktree add <path> <branch>` fails with "already used by worktree" when the owner has the
  PR branch checked out (to test it). Work detached instead: `git worktree add --detach <path>
origin/<branch>`, commit there, `git push origin HEAD:<branch>`. Never switch the owner's checkout.
- Committing `test-results/`, or pasting artifact paths as evidence: a local path is not a link a reviewer can open.
- Treating a seeded fixture (`sample.mp4`) as a real recording: say so in the proof row.

## Before reporting

- Paste the command, its exit code, and the artifact list with sizes (`ls -la test-results/verify/<scenario>`).
- Open at least one PNG and confirm it shows the criterion, not a blank or half-animated screen.
- Say which scenarios you did not run and why (for example `export` on Linux).
- Link the uploaded files in the PR's Proof table; keep claims to what the pictures show.
