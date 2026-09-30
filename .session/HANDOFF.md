# Session handoff

## Latest update — home audit documentation (2026-09-30)

This update supersedes the old Next instructions only for the current documentation task; the decisions and related editor-audio work below remain context.

- Owner request: "quiero que todo esto que recomiendas lo pongas en documentos y generes un PR directamente para que podamos revisar esos cambios en otra maquina".
- Work: documented the conversion/i18n/Kai audit, proposed EN/ES copy, and ordered implementation/acceptance steps. No runtime copy or UI fix is included in this documentation pass.
- Review in draft PR #196 on `feat/marketing-landing`. Start at `apps/documentation/src/content/docs/marketing/home-conversion-audit.md`, then `home-copy-review.md`, then `plans/2026-09-30-home-conversion-review.md`.
- Updated facts: optional watermark is already integrated; landing catalogs now contain 106 keys each with no missing/empty values; site-level SEO was aligned by the merge. Public downloaded-release behavior remains unverified here. The origin component exists but is not rendered by the new home.
- Next implementation: H04/H05 (truthful audio claims and approved shortcuts), coordinated with the editor-audio branch; the owner retains theme/locale work. Then translation coverage, conversion proof/FAQ, and restrained use of the existing fox Kai.
- The previous knot direction is historical exploration; reconcile visual-status docs with the implemented fox without changing KAY + khiPU or the coined-name qualification.
- Documentation-session checks: `bun run build` in `apps/documentation` exited 0 with 234 pages (duplicate-content-ID and missing-sitemap-site warnings); `bun run test` in `packages/i18n` exited 0 with 3 files / 13 tests. Push-hook evidence is recorded in the PR after it runs. Historical failures below must not be presented as current results or dismissed as contention without reproducing them.

## Goal

Finish the marketing landing and get its PR mergeable, integrate the free-tier
watermark and AGPL relicense, design the editor's audio work, and untangle the
branch stack. Owner's words: "dime en que orden hago merge las ramas que tenemos
y de una vez arregla todos los conflicts".

## Mode

code

## Where we stopped

- **Last done:** `feat/marketing-landing` is pushed at `177fa48` with `origin/main`
  merged in and its four conflicts resolved. `verify` and the 13 desktop E2E both
  passed in the pre-push hook. PR #196 now shows the merge.
- **Next:** fix the two things the landing states that are false, both small and
  both on `feat/marketing-landing`:
  1. `packages/i18n/messages/{en,es}.json` → `homeChapter3Pill3` still reads
     "Mute or boost audio" / "Silenciar o subir audio". The corrected copy
     ("Mute audio" / "Silenciar audio") already exists on `design/editor-audio`;
     either merge that branch in or repeat the two-line edit.
  2. The shortcut glyphs in `apps/web-hono/src/components/home/app-window.tsx`
     (lines 84, 101, 106, 111) and `hero.tsx` (line 21) are hardcoded and wrong.
     Implement the approved shared constant — see
     `backlog/open-decisions-editor-audio` §3 for the exact shape — in
     `packages/domain/src/constants/shortcuts.ts`, keyed by platform, plus a
     `formatAccelerator()` for the web.

  **Then** ask the owner whether to flip PR #196 out of draft.

## Decided

Settled; do not reopen.

- **Boost audio is dropped entirely.** Mute ships alone and stays binary, so the
  non-goal in `backlog/video-editor-mute` is never reopened and that doc stands
  as written. The owner's call after the research: "solo mute, nada de
  multiplicador".
- **The shortcut defaults move to `@kaipu/domain/constants`**, keyed by platform
  (`mac` / `windows`). `Command` is macOS-only, so today's defaults would be dead
  bindings on Windows; `CommandOrControl` was rejected because it collapses to
  plain `Ctrl`, putting copy on "start recording" globally. The Windows column is
  written but **unvalidated** — there is no Windows build to test against.
- **The library shortcut is `Command+Control+L`**, joining the existing family. A
  global `⌘L` would take that combination from every other app.
- **The rail's permanent label is gone** on this branch; `design/editor-audio`
  carries a hover/focus version instead. The owner has not picked between them.
- **The landing's viewport ladder keys on HEIGHT, not width** — the hero is a
  fixed ~990px tall once the headline caps, so it broke on a wide-but-short
  laptop. Steps at `height < 1040 / 940 / 860`, all scoped to `width >= 1080px`.
- **The top bar's contents share the page container**, at
  `calc(--kl-max-w + 2 * --kl-gutter)` — the sections put the gutter outside
  their container, so a plain `max-width` lands 24px too far in.
- **The watermark and the AGPL relicense went in via `main`**, not by moving
  commits between branches. PR #192 merged; #191 followed.

## Open

- **`brand-origin.tsx` is orphaned.** It renders the Kay + khipu origin story that
  `marketing/brand-identity.md` calls canonical, and it was written for the home
  page this branch replaced. Not deleted (it is the owner's brand content) and not
  ported (it uses Tailwind and `--kaipu-*` tokens, both forbidden in the new
  landing, so it needs rewriting against `--kl-*`). Where it belongs in the
  four-moments narrative is the owner's call.
- **The rail label:** removed, or the hover version on `design/editor-audio`?
  Unanswered. The two branches differ in `rail.tsx` / `rail.module.css` until it
  is.
- **PR #196 is still a draft.** Recommendation is to fix the two Next items first,
  because they publish false claims on a marketing page.
- **Nobody has reviewed the landing in a browser.** It was measured at five
  viewports, which verifies geometry, not judgement.
- **`main` window disappears whenever the app loses focus** — diagnosed, not
  fixed, in `backlog/bug-main-window-hides-on-blur`. macOS orders the window out;
  nothing in our code calls `hide()`. The camera was the trigger, not the cause.
- **The editor audio spec is not written.** The design is closed
  (`backlog/open-decisions-editor-audio`); the spec and plan come next.

## State

- Branch `feat/marketing-landing` at `177fa48`, PR
  https://github.com/csdev19/kaipu-record-monorepo/pull/196 (draft)
- Branch `design/editor-audio` at `fb43e4d`, stacked on it, **no PR**
- Both are pushed and identical to their remotes.
- **Committed on `feat/marketing-landing`** (6 beyond `a72a555`):
  `54dee13` brand moment marks · `4a895a0` onboarding at 96px + sidebar at 40px ·
  `23a2f6a` onboarding window floor 720x700 · `97aed58` hero fits a laptop, bar on
  the page grid · `80bf27b` docs · `177fa48` merge of `main`
- **Committed on `design/editor-audio`** (4): the open-decisions doc, its index
  row, the audio decisions + dropping the boost promise, and the rail hover label.
- **Uncommitted at park time:** nothing.

## For the agent

- **Original request, verbatim:** "hay que agregar unos cambios mas en el editor …
  aun no tneemos el mute o boost audio hay que implementarlo aqui" — later
  narrowed to "solo mute nada de multiplicador eliminalo y quitalo del landing,
  super simple".
- **Files in play:**
  - `apps/web-hono/src/components/home/` — the landing (hero, top-nav, rail,
    app-window)
  - `packages/i18n/messages/{en,es}.json` — the `landing` namespace
  - `packages/domain/src/constants/` — where the shortcut constant goes
  - `apps/kaipu-record/src/shared/types/ipc.ts` — `SHORTCUT_DEFINITIONS` today
  - `apps/documentation/src/content/docs/backlog/` — marketing-landing,
    open-decisions-editor-audio, bug-main-window-hides-on-blur
- **Check command:** `bun run verify` — **exit 0** at park time, run by the
  pre-push hook (20.6s) alongside the 13 desktop E2E (43.7s).
- **Conventions to keep:**
  - Landing CSS never uses a Tailwind utility and never a `--kaipu-*` token.
  - New copy needs both `en.json` and `es.json`; grep before adding a key
    (`homeHeroSerif` was silently overwritten once).
  - **This machine's test suite lies under load.** `vitest` fails with "Timeout
    starting forks runner" when the load average is high, and the failures look
    like real test failures. It happened four times this session — the `playback`,
    `shortcuts` and `auth` E2E, and the unit suite — and every one passed when
    re-run alone or with `--pool=threads`. Check `uptime` before believing a
    failure, and close the dev servers on 3000 / 3001 / 5174.
  - `infisical` is installed under node 22.23.2 while the shell runs node 24, so
    the pre-push hook cannot find it. Prefix with
    `PATH="$HOME/.local/share/mise/installs/node/22.23.2/bin:$PATH"` or reinstall
    it under the active node.
  - The repo-local `core.sshCommand` points at `id_ed25519_github_csdev19` with
    keepalive, because `~/.ssh/config` lost the `github-personal` alias. Do not
    remove it until that config is fixed.
