---
title: "Prepare — where is your video going?"
description: "NIW2-578: a full-screen Prepare flow replaces the recording's Share sheet. Destinations are grouped by who compresses the video last (YouTube, Reels · TikTok · Shorts, LinkedIn · feeds send more; GitHub · Jira · Linear and Slack · Discord · email keep it light; an archive copy keeps everything), each explained in plain words, and one button makes the copy in the background."
---

# Prepare — where is your video going?

> **Status: 🟢 Ready to validate — NIW2-578, on `feature/niw2-578-prepare-screen`, stacked on
> [#436](https://github.com/niway-dev/kaipu-record/pull/436) (YouTube 1440p / 4K, NIW2-564).**
> Unit and component tests pass; nothing has run in Electron yet. Owner QA pending. Design:
> Claude Design project `71546ef1-baf5-42e9-8fcc-9b9b44f2c7ab`, file
> `Kaipu Prepare Screen.dc.html`.

## Why

The export sheet ([export presets](./export-presets)) grouped presets by intent, but the owner
found two problems with it as the way to share a recording: the YouTube 1440p / 4K option was
hidden inside a modal list, and "make it bigger to look better" is not intuitive. A beginner does
not think in presets; they think in places. Prepare asks one question — **where is it going?** —
and explains what that place needs.

The recording is the original and is never modified (ADR 0003). Prepare makes a **new copy**, a
library item derived from the recording, in the background.

## What the user sees

### The Prepare screen (`/prepare/:assetId`, `?to=<destination>` preselects one)

Three columns, read left to right:

1. **The original** — thumbnail, title, duration, picture size, file size, "Copies are made from
   this file. It is never changed or replaced.", an amber note when the edit session holds edits
   no file carries (the copy is made from the file on disk, so it would not have them), and
   **Already prepared**: the copies this recording already has, each linking to its page.
2. **Where is it going?** — the destinations, grouped by who compresses the video last, each with
   its estimated size:
   - **They re-compress it · send more**: YouTube (1440p or 4K), Reels · TikTok · Shorts
     (vertical), LinkedIn · Feeds (square).
   - **They play it as-is · keep it light**: GitHub · Jira · Linear (Light), Slack · Discord ·
     Email (Balanced). GitHub's line says "Under the 10 MB limit" only when the estimate fits
     GitHub's free-plan limit.
   - **Keep**: Archive copy (Maximum quality).
     A destination that already has a matching copy shows **Ready** instead of a size.
3. **The copy** — the destination's name and one sentence, a size meter (the recording against
   the copy, on one scale, tagged "Bigger on purpose", "N% lighter", "Not lighter" or "Same as
   the recording"), a "why bigger / why smaller / why keep one" paragraph, the YouTube 1440p / 4K
   choice (with each size), Fill / Fit for vertical and square (with the existing framing
   preview), GitHub's free / paid plan chips, a folded **What changes in the copy** (picture,
   smoothness, sound — in words), and the button **Prepare for &lt;destination&gt; · ~size**.
   When a matching copy exists the button becomes **Open the copy you have**, with **Prepare
   again** next to it.

Nothing preselected (from "More places" or the Library) shows "Pick where it's going".

Clicking Prepare starts the export and goes back to the recording page; the existing progress
card (Cancel, time left) and then the Ready card take over. While another export runs, the
existing "Already exporting …" toast shows and the user stays on Prepare. An unreadable file shows
the existing "Couldn't read this recording" toast and goes back to the recording. Screenshots and
GIFs are not preparable.

### Ways in

- **Right after recording**: the recording page shows "Your video is ready. Where is it going?"
  with shortcuts — YouTube, TikTok · Reels, GitHub · Jira, Slack · Discord, More places — plus
  **Edit first** and **Not now — keep it in the Library**. It shows after every recording (not
  only a heavy one) and stays until a shortcut or Not now. Settings → Export quality → "Ask where
  a new recording is going" turns it off (stored as `showRecordingSavedCard`, its NIW2-218 name).
  It replaces the "Recording saved" card.
- **The recording page**: **Prepare for…** replaces Share as the primary button, with quick chips
  (YouTube, TikTok · Reels, GitHub) under the title. The heavy-to-send banner's action is now
  "Prepare a light copy →", which opens Prepare on GitHub.
- **The Library**: a Prepare for… icon button on every local recording's card and row, next to
  Edit.

## How it works

- `features/prepare/destinations.ts` (pure, tested) maps each destination to its preset(s) and
  groups them; `planCopy` describes one destination's copy of this recording — the resolved
  target, size kind and estimate, size direction, GitHub's free-limit fit, and the picture,
  smoothness and sound changes. Every number comes from `resolveExportTarget`; this module only
  describes it. `destination-copy.ts` holds the i18n keys.
- `features/prepare/use-prepare-copy.ts` is the old Share start logic, extracted: one clip over
  the whole file (`initialScene`), `WHOLE_RECORDING_FINGERPRINT`, the chosen preset and framing,
  through `useVideoExport().start`. No second pipeline. `useSourceProbe` reads the file's size,
  frame rate and duration.
- "Already prepared" is `findReusableExports(exports, WHOLE_RECORDING_FINGERPRINT)` plus the
  lineage's exports list.
- The recording page re-lists when an export becomes ready, so the new copy shows under Exports.

## Decisions

- **The editor keeps its export sheet.** Only the recording's Share moved to Prepare; the
  editor's Export still opens the sheet (it applies the edits, Prepare does not).
- **No time estimate** in "What changes": there is no honest number for encode time yet, so the
  row is left out rather than guessed.
- **Generic icons**, not brand marks: lucide has none in the version the app uses, and the tile
  colours carry the recognition.
- **"Under the 10 MB limit"** is said only when the estimate fits GitHub's free plan
  (`githubPlans().free`); `githubFit()` is against the paid 100 MB limit, which would make the
  claim false for most recordings.
- **The progress and ready cards** are shared with the editor's export; NIW2-586 names the
  destination on them ([background copies](./background-copy-toasts)).

## Out of scope

Importing outside videos (separate ticket), a sidebar entry, a real before/after frame from the
recording, a recording-quality floor, and uploading to any platform.

## How to validate

Record a short clip → the "Where is it going?" panel appears → YouTube → Prepare opens on YouTube,
1440p selected → try 4K, unfold "What changes in the copy" → Prepare → back on the recording, the
progress card, then the Ready card → the copy is in the Library and under Already prepared. Then
GitHub (Light) from the quick chip or the heavy banner, Fit / Fill on Reels, and a screenshot's
page (no Prepare).
