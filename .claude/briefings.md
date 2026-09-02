# Briefings binding

Where the briefings live and what regenerates them. Read by the
`generate-briefings` skill. Paths are relative to the repo root.

## Location

`apps/documentation/src/content/docs/briefings/` — this repo calls the set
**briefings**, served by the docs site (Astro Starlight, `apps/documentation`),
registered as its own sidebar section in `apps/documentation/astro.config.mjs`.

## Briefings in this repo

| Briefing         | File                          | Notes                               |
| ---------------- | ----------------------------- | ----------------------------------- |
| `index`          | `briefings/index.md`          |                                     |
| `pitch`          | `briefings/pitch.md`          |                                     |
| `ai-briefing`    | `briefings/ai-briefing.md`    |                                     |
| `stack`          | `briefings/stack.md`          |                                     |
| `roadmap`        | `briefings/roadmap.md`        |                                     |
| `design-brief`   | `briefings/design-brief.md`   | feasible — `packages/tokens` exists |
| `business-brief` | `briefings/business-brief.md` | founder interviewed 2026-09-02      |

## Sources of truth

| For                 | Read                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shipped / in flight | `gh pr list --state merged --limit 100` and `--state open` against `csdev19/kaipu-record-monorepo` (real PR history exists — no `git log` fallback needed)                                                                      |
| public interface    | `apps/server-hono/src/contract/*.contract.ts` (oRPC); `apps/kaipu-record/src/shared/types/{ipc.ts,electron-api.ts}` (desktop IPC, compiler-checked)                                                                             |
| schemas             | `packages/domain/src/schemas/*.ts`                                                                                                                                                                                              |
| stack               | every `apps/*/package.json` + `packages/*/package.json` + root `package.json` (workspace catalog) + `apps/documentation/src/content/docs/architecture/decisions/` (ADRs)                                                        |
| design values       | `packages/tokens/src/{base.ts,themes/dark.ts,themes/light.ts}`; brand assets in `apps/kaipu-record/resources/` and `apps/web-hono/public/demos/`                                                                                |
| positioning copy    | `apps/web-hono/src/components/landing/*.tsx` + `packages/i18n/messages/en.json` (`landing.*` keys)                                                                                                                              |
| published version   | `apps/kaipu-record/package.json` version + `.release-please-manifest.json` vs `gh release list` (GitHub Releases tags `desktop-vX`/`web-vX`/`api-vX`) — **not published to npm**; distributed via `kaipu.app` + GitHub Releases |
| business facts      | the founder (interview only — the repo has no source of truth for this)                                                                                                                                                         |

## Repo rules

- Language: English on every durable/published artifact (global + project
  `CLAUDE.md`), including these briefings — conversation with the user may be
  Spanish, the artifact never is. Some **legacy docs in this repo are already in
  Spanish** (`desktop/ipc-contract.mdx`, most of `backlog/*`) — that is documented
  tech debt per project `CLAUDE.md`; do not copy that pattern into new briefings,
  and do not "fix" those legacy docs as part of a briefings run.
- Safe positioning: local-first / private-by-default recording, "an Obsidian for
  screen recordings" (cloud is a capability, not the product), no account required
  to record today, macOS-only today (Windows is "coming soon" copy, not shipped),
  free to use, a quick/frictionless capture-and-share loop, a quick-edit tool
  (trim/annotate/export) rather than a full NLE.
- Never claim: an enterprise/team-collaboration platform (seats, SSO, org admin);
  a cloud-first framing; a general/advanced video editor positioning (Final-Cut
  class); cross-platform availability (no Windows build exists); an
  always-required account (cloud is optional and paid, never a gate to recording).
- The root `README.md`, root `package.json` description, and
  `apps/documentation`'s own `index.mdx` describe an earlier generic "monorepo
  template + Todo CRUD" state (`apps/web`/`apps/server`/`apps/mobile`, Fumadocs)
  that predates this repo's customization into Kaipu Record. Treat those three
  files as stale scaffold leftovers, not sources of truth about the current
  product — the `ai-briefing`'s Corrections section calls this out explicitly so
  a reader doesn't get misled by them.
- Business-brief sections with no committed number/target (e.g. the success-signal
  target) are written as "no number committed yet," never filled with an invented
  figure.

## Validation

`cd apps/documentation && bun run build` (Astro build — fails on broken links/MDX).
