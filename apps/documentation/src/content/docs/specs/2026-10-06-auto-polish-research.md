---
title: Auto polish — research brief (open a new recording already beautified)
description: Research task for the night shift — what it takes for a just-recorded video to open in the editor already trimmed, framed on a background and zoomed, how established tools do it, and what each piece would cost Kaipu.
---

# Auto polish — research brief

**Status: ⚪ Research · 2026-10-06.** A research task, not an implementation. The night
shift fills in [Findings](#findings-to-be-filled-by-the-research) and opens the result as a
docs PR. Related direction: "Product direction and monetization" (Auto Polish), added to
`marketing/` in PR #239.

## Summary (one minute)

Goal: the user stops a recording and the editor opens with the video **already polished** —
dead time and silences trimmed, the screen framed on a default background with padding and
rounded corners, zooms on the clicks, and possibly a layout ("panels", e.g. screen and
camera side by side). Every change is an editable decision the user can keep or remove,
never a baked-in edit. The question is what each piece needs and what it costs. Kaipu already
has the pattern: the video editor opens with automatic zooms computed from the cursor track
(`withInitialZooms`) without marking the session dirty. Auto polish extends that one loader
step.

| #   | Decision (already fixed for the research)                                                          | Why                                                                          | ADR         |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- |
| 1   | Auto edits are proposals in the same session model as manual edits, applied when the editor opens. | Same as auto-zoom today; the user corrects decisions instead of making them. | —           |
| 2   | The original file is never modified.                                                               | ADR 0003.                                                                    | reuses 0003 |
| 3   | Prefer deterministic, local analysis; an LLM only where nothing else works.                        | Local is free and private; model costs are a business decision.              | —           |

### Questions the research must answer

1. **Silence and dead-time trim.** Can cut proposals come from the audio alone (RMS below a
   threshold for longer than N ms), from the cursor track (no movement or clicks), or from
   frame differences (nothing changes on screen)? Which combination avoids cutting a pause the
   user wanted? What thresholds do tools use?
2. **Default look for video.** The screenshot editor already has backgrounds
   (`features/screenshots/beautify`). The video editor has none. What does adding
   background, padding, rounded corners and shadow to the video preview and the export cost
   (preview compositing + export renderer)? Can the screenshot backgrounds be shared?
3. **"Panels" / layouts.** Which layouts do tools offer (screen only, screen + camera side by
   side, camera full screen for intro/outro)? What does each need from the camera box and the
   export?
4. **Defaults vs presets.** Is a single default enough, or do users need saved presets (Screen
   Studio shares them across a team)? Where would presets live — the tags store pattern
   ([ADR 0012](/architecture/decisions/0012-recording-tags-local-first-with-cloud-replica/))
   fits.
5. **When it runs.** At stop (background job, ready when the editor opens) or when the editor
   opens (like auto-zoom)? What is the analysis time for a 10-minute recording on a base
   Apple Silicon Mac?
6. **What is free and what is paid.** Following the product direction (PR #239): which pieces are
   "editing tools" (free) and which are "Kaipu does the work" (candidate paid)?

### Out of scope

Implementation; transcription and captions (separate item); AI summaries.

## What established tools do (starting points)

| Tool                                                                   | Automatic on open                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Screen Studio](https://screen.studio/guide/adding-editing-zooms)      | Zooms created from clicks; background, padding, rounded corners and cursor style from a preset; shareable presets                 |
| [Descript](https://help.descript.com/script-editing/shorten-word-gaps) | "Shorten word gaps": threshold (e.g. gaps over 0.5 s) and target length (e.g. 0.25 s); keeps a 0.2–0.3 s floor so speech breathes |
| [Cap](https://cap.so/)                                                 | Default backgrounds and auto-zoom in Studio Mode; cursor effects from its own cursor data                                         |

## What Kaipu has today (verified on `main`, 2026-10-06)

- `features/video-editor/initial-zooms.ts` — `withInitialZooms` decides the zooms of the
  scene the editor opens with, from the cursor track; a saved session wins over detection;
  opening does not mark the editor dirty. **This is the hook auto polish extends.**
- `features/video-editor/session.ts` — versioned edit session with clips, overlays, zooms,
  redactions and mute ranges; cuts are already representable.
- `features/screenshots/beautify/` — backgrounds, beautified frame and panel for screenshots.
- `features/video-editor/mute-edits.ts` — audio ranges; a silence detector could reuse its
  range model.

## Findings (to be filled by the research)

For each question: answer, evidence (file paths, measurements, links), effort (S/M/L) and
whether it runs locally. End with a recommended first slice and its acceptance criteria.

## Deliverable

This page, completed, in a docs-only PR. No code beyond throwaway measurement scripts, which
are described in the findings rather than committed.
