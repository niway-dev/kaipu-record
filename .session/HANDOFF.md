# Session handoff

## Goal

Decide how to make the CI pipeline stop taking so long and burning so many Actions minutes —
specifically whether Depot, Namespace or Blacksmith fit our flow, and how hard a self-hosted
runner on the owner's own machines would be.

## Mode

discussion (design). No code or workflow change was made in this repository.

## Where we stopped

- **Last done:** measured the pipeline's real cost, researched all three vendors, delivered a
  full design reply with five numbered options and five open gaps, and shipped the reusable
  knowledge to the hub as
  [general-knowledge PR #43](https://github.com/csdev19/general-knowledge/pull/43).
- **Next:** the user has not answered the five gaps under "Open". Ask for those answers (in prose,
  not the AskUserQuestion picker), then create the backlog issue
  (`gh issue create --label backlog`) and write, on a `design/ci-runner-strategy` branch:
  `apps/documentation/src/content/docs/specs/2026-09-28-ci-runner-strategy.md` plus one ADR in
  `apps/documentation/src/content/docs/architecture/decisions/` that narrows ADR 0004's
  "self-hosted runners" non-goal to whichever option is chosen. Do not start writing the spec
  before the model question (gap 5) is answered.

## Decided

- **All three vendors are ruled out for this repository.** Not on price first — all three require
  a GitHub organization (Blacksmith: "not available for personal repositories"; Depot: "you must
  have the organization owner role"; Namespace: "connect Namespace with your GitHub
  organization") and this is a private personal repo. Settled; do not reopen unless the org
  question (gap 3) is answered yes.
- **A faster runner is the wrong purchase for the measured bottlenecks.** The three real ones are
  Apple notarization wait, a cache that never hits, and per-job minute rounding. None is
  CPU-bound. Settled.
- **On macOS every vendor is at or above GitHub's $0.062/min** (Depot $0.08, Blacksmith $0.08,
  Namespace $0.06 prepaid but $0.09 overage without the $100/mo plan). Settled.
- **The reusable knowledge belongs in the hub, not in this repo's docs.** Already shipped as
  PR #43: new page `monorepos/ci-runner-hosting.md`, plus additions to `ci-runner-cost.md`
  (per-job minimum as its own budget line) and `actions-cache-lifecycle.md` (measured evidence
  for the existing Rule 4). Settled.
- **The recommended sequence**, pending the user's answers: confirm the real bill first → the
  four zero-cost fixes → the i7 PC as a Linux runner → the Mac mini for the _candidate_ macOS
  E2E only → the signed release stays on GitHub-hosted runners. The reasoning is that the
  candidate E2E ran 7 times that week against the release job's 3, so it is the repeated cost,
  while the signed release is where the clean-environment guarantee and the signing secrets
  matter most.

## Open

Five gaps stated in the design reply and still unanswered by the user:

1. **Is the x64 macOS build actually needed?** `electron-builder --mac --arm64 --x64` does two
   sequential Apple notarization round-trips. Default if unanswered: keep x64 but split the two
   architectures into two parallel macOS jobs — same minutes, half the wall clock.
2. **Is the complaint wall-clock or money?** 15 min per desktop release and ~$21/mo are different
   problems. Default: optimize both, money first.
3. **Is moving the repo to a GitHub organization on the table?** It is the prerequisite for any
   vendor, and it drops the included quota from Pro's 3,000 to a Free org's 2,000. Default: no,
   and the vendor options stay discarded.
4. **Is the spending limit now non-zero?** Runs were previously blocked by billing, not by the
   branch. Default: assume yes, but verify before claiming anything.
5. **Which model writes the spec and the ADR** — Opus 5, Fable or astra-gpt-6? This session ran
   on Opus 5 (1M). Per the global convention this question has no default; the spec waits for it.

Two unresolved factual questions the agent still has:

- **We may already be inside the included quota.** Excluding the already-retired workflows, the
  measured week extrapolates to roughly 1,030 Linux + 159 macOS billed minutes per month, which
  is ~2,620 quota-minutes against Pro's 3,000. This is a one-week extrapolation, and the `gh`
  token lacks the `user` scope needed to read billing. Confirm with the detailed usage report
  (Settings → Billing → Get usage report → Detailed usage report) before any savings claim. If it
  holds, the remaining problem is wall-clock, not cost, and the effort budget changes.
- **Whether real hardware makes the export tests actually run** is a hypothesis, not a finding.
  On headless Linux Chromium the H.264 export test self-skips; on the i7 PC with a real ffmpeg
  (and possibly NVENC on the RTX 3060) it might genuinely execute. Must be tried before it is
  claimed as a coverage win.

## State

- Branch `wip/ci-runner-strategy`, cut from `origin/main` at `3ba10c2` (local `main` was 56
  commits behind and was not used). PR: see the draft PR opened by this checkpoint.
- Committed: nothing of this session's work beyond this handoff file. The repository's workflow
  code is untouched.
- Uncommitted at park time: only `.session/HANDOFF.md` (new file). Nothing is half-done.
- Shipped elsewhere: `general-knowledge` branch `docs/ci-runner-hosting`, PR #43, pushed and open.

### Measurement, so a pickup does not re-run 243 API calls

Week of 2026-09-21 → 2026-09-28, 243 workflow runs, 284 billed jobs:

| Bucket                                 | Jobs | Real sec | Billed min | Linux-eq |
| -------------------------------------- | ---- | -------- | ---------- | -------- |
| Release Desktop (macOS)                | 3    | 1,225    | 21         | 210      |
| PR checks — candidate E2E (macOS)      | 7    | 780      | 16         | 160      |
| PR checks — gate + legacy-gate (Linux) | 81   | 1,912    | **106**    | 106      |
| Desktop/CI/API/Web Tests (now retired) | 102  | 9,499    | 210        | 210      |
| release-please                         | 44   | 2,080    | 59         | 59       |
| `verify` on candidate and release      | 21   | 1,880    | 49         | 49       |

Totals: 450 Linux + 37 macOS billed minutes = 820 Linux-equivalent, ~$4.99 at list price.

Three findings behind those rows:

- **81 jobs, 32 real minutes, 106 billed.** ~70% is the per-job minute minimum, paid by
  `Merge requirements` and the transitional `Release candidate verified` alias, both ~3 s. Deleting
  the alias (ADR 0005 says to, once the ruleset requires the new name) halves the row.
- **The single most expensive step is 387 s of "Sign, notarize & package"** in
  `release-desktop.yml` — two sequential Apple notarization round-trips. External wait, not
  compute.
- **`verify` takes 361 s in CI against 27 s cold locally**, and it is not the CPU. The Turbo cache
  entry exists, is 655 KB, and is never restored: every entry is scoped to a release tag's ref
  (`ref=refs/tags/desktop-v0.9.0`) and nothing ever writes one on `refs/heads/main`, so the
  restore step reports 0 s and reads nothing. Verified through
  `gh api /repos/csdev19/kaipu-record-monorepo/actions/caches`.

## For the agent

- **Original request, verbatim:** "estamos teniendo problemas con el pipeline demora muchisimo y
  nos gasta muchos minutos / tengo opciones que me encantaria que investiguemos /
  https://depot.dev/ / https://namespace.so/ / https://www.blacksmith.sh/pricing / estuve
  escuchando varias cosas de eso / hemos aplicado vaarias estrategias. puede que estas
  herramientas se adapten a nuestro flujo y lo reduzca mucho mas"
- **Follow-up request, verbatim:** "significa que ninguno nos ayuda realmente. esto es de estudio
  porque es interesante / y sobre mis notas. nuestro propio servidor que corra el CI se empieza a
  volver tentador / que tan complicado seria? pensemoslo tambien. / tienes 2 tareas aparte de
  explicar mas. / 1. guardar todo esto en general-knowledge es muy valioso y tenerlo en cuenta
  para cuando si haga falta / 2. pensar en que necesitamos para local ci o self-hosted. hay
  paquetes o proyectos que nos permitan convertir nuestras maquinas en self-hosted? tengo una PC
  con i7-12k y 32ram con una rxt-3060 que no le saco suficiente provecho. una mac mini. mackbook
  pro 14 y 15. pensemos en eso un segundo"
- **The owner's hardware**, for the self-hosted design: a PC with an i7-12700K, 32 GB RAM and an
  RTX 3060; a Mac mini; MacBook Pro 14" and 15". Only the PC and the Mac mini are viable runners —
  laptops sleep and move, which is a liveness problem, not a performance one.
- **Files in play** (all read, none modified): `.github/workflows/pr-checks.yml` (411 lines, the
  current PR gate — note local `main` still has the older `release-candidate.yml`),
  `.github/workflows/release-desktop.yml`, `apps/kaipu-record/electron-builder.yml`, `turbo.json`,
  the root `package.json` `verify` script,
  `apps/documentation/src/content/docs/architecture/decisions/0004-local-first-release-verification.mdx`,
  `apps/documentation/src/content/docs/specs/2026-09-23-ci-minutes-audit.md`.
- **Check command:** `bun run verify` — run at park time on `wip/ci-runner-strategy` after
  `bun install --frozen-lockfile`, **exit 0**. It covered `check-workflows`, lint, `oxfmt --check`,
  the `@kaipu/*` package builds, all-workspace type checks and the unit/component suites
  (187 files, 1,252 tests). It does not cover E2E, packaging, signing or any cloud workflow.
- **Conventions to keep:**
  - Design conversations go in prose with numbered options, never the AskUserQuestion picker.
  - Specs go to `apps/documentation/src/content/docs/specs/`, ADRs to
    `.../architecture/decisions/`, plans to `.../plans/`. Doc bodies in English.
  - Design work runs on Opus 5, Fable or astra-gpt-6 and the user picks; execution subagents run
    on Sonnet, never Fable. Name the model before dispatching anything.
  - `gh` must be the `csdev19` account (the remote uses the `github-csdev` SSH alias).
  - Reusable, product-agnostic knowledge goes to the hub and this repo links it; do not copy hub
    content into the project docs.
