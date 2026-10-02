# Session handoff

## Goal

Update the brand documentation in PR #203 so it describes the Kai section that actually
shipped — a tappable mood ring — instead of the single still portrait it was written against.

## Mode

code (documentation)

## Where we stopped

- Last done: the web work this PR documents all merged to `main` (#202, #207), and the
  branch was left untouched and stale. Its five commits are intact and still build.
- Next: run `git merge origin/main` on this branch (it is **17 commits behind**), then fix
  the three claims listed under **Open** below, starting with
  `apps/documentation/src/content/docs/marketing/brand-identity.md` — its artwork table says
  `record` · `screenshot` appear in "the menu bar when recording or screenshot mode is
  selected", which is now incomplete: they also appear on the website, in the mood ring.

## Decided

- The mood ring deliberately puts `record` and `screenshot` artwork on the website — settled
  in #202's commit `e9568ea`, reversing the earlier "no capture-mode marks on the web" rule.
  Do not re-argue it; document it.
- Each mood's caption states where that mark really appears, verified against
  `apps/kaipu-record/src/main/tray.ts` (exactly two capture states). Copy must not claim Kai
  reacts to events on its own. Settled.
- Docs live in the docs site, never a root `docs/` folder. ADRs are at
  `architecture/decisions/` (0001–0006), not `docs/adr/`. Settled by repo convention.
- The marketing landing stays 🟡 In progress while conversion v2 is pending. Settled.

## Open

Three claims in this PR that `main` now contradicts. Each needs a decision, not just an edit:

1. **`brand-identity.md`** — the artwork table's "Where" column for `record` · `screenshot`
   omits the website. Decide whether the mood ring counts as a brand placement worth listing.
2. **`brand-identity.md` "Website:" bullet** — describes "a dedicated Meet Kai introduction"
   plus camera bubble plus closing `done`. The section is now a five-mood interactive ring
   with an origin block laid out as `kay + khipu = Kaipu` cards. Rewrite needed.
3. **`home-copy-review.md` / `home-conversion-audit.md`** — mark rows as resolved in PR #202,
   which is correct, but `homeKaiBody` was **rewritten again** in `e9568ea` after those rows
   were written. Check the quoted EN/ES values against `packages/i18n/messages/*.json` on
   `main` character by character; the previous values are stale.

Unanswered by the user: whether the landing should also gain a light-theme mention anywhere
in the brand docs, now that the theme switch shipped in #202.

## State

- Branch `docs/home-kai-reconcile`, PR https://github.com/csdev19/kaipu-record-monorepo/pull/203
  (draft, MERGEABLE/CLEAN, **17 commits behind `main`**)
- Committed: five documentation commits (`0a79593`, `20903b8`, `aa1316f`, `9fb9253`,
  `c58d1e8`) covering brand-identity, brand-and-kai, the rollout plan, the copy review and
  audit, and the backlog status. All still build; all partly stale in the ways listed above.
- Uncommitted at park time: nothing but this handoff file.

## For the agent

- Original request, verbatim: "la 203 tenemos que actualizarla pero en otro lado"
- Files in play:
  - `apps/documentation/src/content/docs/marketing/brand-identity.md` (the main one)
  - `apps/documentation/src/content/docs/marketing/brand-and-kai.md`
  - `apps/documentation/src/content/docs/marketing/home-copy-review.md`
  - `apps/documentation/src/content/docs/marketing/home-conversion-audit.md`
  - Read-only ground truth: `apps/web-hono/src/components/home/kai.tsx` on `main`,
    `packages/i18n/messages/{en,es}.json`, `apps/kaipu-record/src/main/tray.ts`
- Check command: `cd apps/documentation && bun run build` — result at park time: **exit 0**,
  239 pages, no broken-link or frontmatter error. It covers link and frontmatter integrity
  only; it cannot tell you a sentence is factually stale.
- Conventions to keep:
  - Doc bodies in English; chat may be Spanish.
  - Never write "shipped in #N" before N is merged. #202 and #207 **are** merged, so past
    tense is now correct for them.
  - Verify every claim against code, not against another document. `cs-audit-product-page`
    (niway-dev/skills#16) is the procedure for that and applies directly here.
  - This branch owns `apps/documentation/**` only.

## Also open elsewhere, not part of this branch

- `kaipu#208` — the manual web preview workflow, ready to merge. After merging, run
  **Preview Web** from Actions with `ref: main`, set the `preview` environment's
  `DATABASE_URL` to an unusable value first, and append the result as the second row of
  `frontend/web-vitals-baseline`.
- One-line bug found by the audit and **not yet fixed**: `homeFilesBody` promises
  `~/Movies/Kaipu`; `vault-location.ts` writes `~/Movies/Kaipu Record`. Both locales.
- `general-knowledge#47` (vitals + deploy environments) and `#49` (product playbook), and
  `niway-dev/skills#16` (`cs-audit-product-page`) are open and independent.
- The skills repo working tree holds unrelated uncommitted work (`install.sh`,
  `cs-respond-clearly/`, `tests/`) that is not mine — left untouched.
