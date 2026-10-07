---
title: Auto polish research — plan
description: Night-shift plan for NIW2-158 — how the auto polish research brief gets its Findings, which measurements are taken and on what machine, and what the PR contains.
---

# Auto polish research — plan

**Status: 🟢 Ready to validate · 2026-10-07.** Findings written into the brief. Plan for
[NIW2-158](https://linear.app/niway/issue/NIW2-158). Research only: no product code.

## Inputs

- The brief, `specs/2026-10-06-auto-polish-research.md`, read from commit
  `76389771797a98477f97deb0c56d2268b99e3cbd` (PR #241, not merged yet). This branch adds it
  as-is in its own commit, so the Findings commit diffs cleanly against the original.
- The code the brief names: `features/video-editor/initial-zooms.ts`, `session.ts`,
  `scene.ts`, `mute-edits.ts` / `audio-edits.ts`, `export/`, `features/screenshots/beautify/`,
  the recorder engine and the cursor track.
- `marketing/product-direction.md` for the free/paid boundary.

## Steps

1. Read the code paths above and note what each question can reuse.
2. Measure on this machine (Apple M4, 10 cores, 16 GB — the base Apple Silicon config) with
   throwaway scripts kept outside the repo:
   - a synthetic 10-minute 1080p30 H.264 recording with AAC narration and known pauses;
   - audio decode + RMS silence detection, scored against the known pauses;
   - frame-difference detection (decode, downscale, compare);
   - the repo's own `detectZoomSegments` plus a cursor-idle pass on a worst-case 10-minute
     cursor track.
3. Fill the brief's Findings: per question an answer, evidence, effort (S/M/L) and whether it
   runs locally; end with a recommended first slice and its acceptance criteria.
4. Gate: `oxfmt --check` on the changed docs and the docs build.
