<!--
Describe the change in prose above this section — why it exists, what it does.
Then fill in "What to review". That section is required; it is what makes a
large diff reviewable in the time a reviewer actually has.
-->

## What to review

<!--
Point the reviewer at the parts that carry the risk, in the order you want them
read. Aim for three to five entries. Rules that keep this section useful:

- Anchor every entry to `file.ts:line`, not to a feature name.
- Say what to *decide*, not what you did. "Check whether X holds when Y" beats
  "added X". The reviewer's job is judgement, not re-reading the diff.
- Name what is safe to skim, and why — generated files, i18n pairs, docs, tests
  that only restate the code. Permission to skip is half the speed-up.
- If a claim cannot be checked by reading (CSS layout, GPU compositing, an OS
  permission), say so and move it to the manual checklist instead of pretending
  the diff answers it.
- Omit the section only for a PR that is genuinely one obvious change.
-->

1. **`path/to/file.ts:NN` — the claim in one line.** What the reviewer should
   decide, and what makes it non-obvious.
2. …

**Safe to skim:** …

## Checks

<!-- Paste real output. "Tests pass" without a number is not evidence. -->

- `bun run check-types` —
- `bun run test` —

## Manual verification

<!--
What the suite cannot do: look at pixels, ask the OS for a permission, measure a
poller's CPU. One unchecked box per item, each one a thing a human does.
-->

- [ ]
