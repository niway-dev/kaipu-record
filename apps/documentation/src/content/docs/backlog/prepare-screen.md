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

Two columns (NIW2-583, design file `Kaipu Prepare.dc.html`, section 3 "Prepare · a screen of
its own"):

1. **Where is it going?** (left, 280–330 px) — **Back to recording**, then the destinations,
   grouped by who compresses the video last, each with a one-line hint and its estimated size:
   - **Post · they re-compress it · send more** (pink): YouTube (1440p or 4K), Reels · TikTok ·
     Shorts (vertical), LinkedIn · Feeds (square). Their sizes are amber, with "up to" above the
     number: a fixed-canvas estimate is a ceiling.
   - **Send · they play it as-is · keep it light** (teal): GitHub · Jira · Linear (Light),
     Slack · Discord · Email (Balanced). GitHub's line says "Under the 10 MB limit" only when
     the estimate fits GitHub's free-plan limit.
   - **Keep · a full-quality copy**: Archive copy (Maximum quality).
     A destination that already has a matching copy shows **✓ Ready** instead of a size. The
     selected row has a pink tint and border. **Prepare another video** is pinned to the bottom:
     it opens Prepare with no recording, and a video dropped on it is prepared
     ([NIW2-587](./prepare-drop-zone)).
2. **For &lt;destination&gt;** (right) — the destination's tile and name, "From your recording ·
   duration · W × H · size", the amber unexported-edits note when it applies, then:
   - **What changes**: Size (recording → copy, amber when bigger, teal when lighter), Picture
     (recording W × H → copy W × H), Smoothness (only when the frame rate is capped), Sound,
     and Length ("· nothing cut").
   - **Why it gets bigger** (pink) / **Why it gets lighter** (teal) / **Why keep one**: the
     destination's explanation. A keep-light copy that is not lighter gets "Why this copy",
     never a promise the numbers do not keep.
   - One card for the destination's choice: YouTube's **Upload size** (1440p / 4K, each with
     its size, and an illustrated before / after of small text — drawn, labelled as an
     illustration, not a frame of the recording); for GitHub and Slack · Discord · Email, the
     recording and the copy on one scale with "N% lighter" and, for GitHub, "under the 10 MB
     limit" or "over GitHub's 10 MB free-plan limit"; Fill / Fit with the framing preview for
     vertical and square. The archive copy has no choice.
   - **Prepare for &lt;destination&gt; · size ↵** and "Runs in the background. We'll tell you when
     it's ready. Your original stays as it is." When a matching copy exists the button is
     **Open the copy you have ↵**, with **Prepare again** next to it.

A destination is always selected: `?to=` when it names one, otherwise YouTube. **Enter** runs
the primary button, from anywhere on the page, including a focused destination row or the
1440p / 4K choice; not while typing in a field, with a modifier held, or on another button or
link (those answer Enter themselves).

Clicking Prepare starts the export and goes back to the recording page; the progress card
("Preparing your YouTube copy…", Cancel, time left) and then the ready card ("Your YouTube copy
is ready") take over, top-right — see [background copies](./background-copy-toasts) (NIW2-586). While another export runs, the
existing "Already exporting …" toast shows and the user stays on Prepare. An unreadable file shows
the existing "Couldn't read this recording" toast and goes back to the recording. Screenshots and
GIFs are not preparable.

### Ways in

- **Right after recording** (NIW2-584): the "Your video is ready" card, top-right in the app's
  status-card stack, over the recording page a fresh recording lands on. It shows the file's
  length, picture size and weight, a "Master · full quality" tag, chips — YouTube, TikTok,
  GitHub, More places — and **Edit first** / **Open**. It shows after every recording (not only
  a heavy one), has no timer, and stays until a chip, Open, ✕ or leaving the page. Settings →
  Export quality → "Ask where a new recording is going" turns it off (stored as
  `showRecordingSavedCard`, its NIW2-218 name). It replaces the "Recording saved" card and the
  inline panel NIW2-578 first shipped. It lives in the app, not in a floating window, because
  main already shows and focuses the app window when a recording stops.
- **The recording page** (reworked in NIW2-585, then laid out after Claude Design
  `Kaipu Export v3.dc.html`, sections 1 and 2, on `feature/recording-detail-title-and-copies` —
  no Linear ticket, the workspace hit its issue limit): the recording is the **master**.
  - **Title row.** The top row is "← Library", the title (rename pencil, the full width the row
    leaves, ellipsis only at that edge) and a "MASTER · FULL QUALITY" tag. The owner's feedback:
    the title shared its row with the actions and was truncated as buttons were added. The
    metadata line sits under it — Local · age · duration · resolution (once the file is read) ·
    size · N copies — and the action row under the player holds only buttons, wrapping as it
    grows. The tag also stays over the player.
  - **Before the first copy** (and right after recording): a dismissable green notice
    ("Saved to your Library. This is the original — every copy you export is made from it and
    it never changes.", only when the page was opened by a fresh recording), the player, and at
    the bottom **Where is it going?**: one row of equal cards, one per destination — logo, name,
    short line, and the size of its copy (amber where the platform compresses again, teal where
    it plays as is; the archive card shows the recording's own size). A card opens Prepare on
    that destination through `preparePath`; "Not now" hides the panel for that visit and brings
    back **Export a copy** among the actions. On a heavy master the heavy-to-send hint sits
    inside this panel (its GitHub card makes the light copy). It replaces the "Where is this
    going?" strip.
  - **With copies**: a pink **Export a copy** first among the actions (it replaces "Send to…")
    and, at the bottom, **Copies from this original** with "Open in Export →" and the copies two
    to a row: the destination logo and name, "2560 × 1440 · 566 MB" (the picture size follows
    from the master's probe and the copy's preset) or "Exporting · 38% · 2 min left" with a bar,
    ✓ Ready, and a **Drag** handle that starts a native file drag through the same IPC as the
    ready card. A copy's name links to its page, which links back to its source.
  - A heavy copy, or a heavy master with copies, keeps the banner with "Prepare a light copy →".
  - The page now reads the file whenever it shows a local recording (for the resolution and the
    estimates), not only when it is heavy.
  - The design has seven destinations (email apart from Slack · Discord); the code has six, and
    the panel shows what `DESTINATION_IDS` lists, so the Export screen and this panel cannot
    disagree.
- **The Library**: a Send to… icon button on every local recording's card and row, next to
  Edit; an original's card and row carry the master tag instead of the Recording badge.

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
- "Ready" (a destination's ✓ Ready on Prepare) is
  `findReusableExports(exports, WHOLE_RECORDING_FINGERPRINT)` over the lineage's exports list.
- The recording page re-lists when an export becomes ready, so the new copy shows under Copies
  from this master. A copy made for a destination (`WHOLE_RECORDING_FINGERPRINT`) is named by
  `destinationOfPreset`; an editor export or a GIF goes by its own title. The running row comes
  from `useExportRunner()` (`runningCopyOf`), whose job now records `wholeRecording`.

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
- **Sized for the window the app opens at** (NIW2-583). `createWindow` opens the main window at
  900 × 670 (the `main` preset's minimum; the first screen does not resize it), which leaves the
  page 828 × 614 below the status bar. Both columns fit that without scrolling; below it each
  column scrolls on its own, never the page.
- **YouTube is the default, not the last destination used** (NIW2-583). The page is reached from
  a recording; a remembered choice from another recording would make the same link open
  differently from one day to the next. `?to=` still wins.
- **The before / after crop is an illustration** (NIW2-583). The design calls it "your own text,
  not a sample", but the app has no full-resolution frame of the recording to crop, and a
  softened copy of it would claim to show YouTube's output. It is drawn text, captioned as an
  illustration, until a real frame crop exists.
- **"Prepare another video" says "Drop a file here or from your Library"** since
  [NIW2-587](./prepare-drop-zone) made dropping a file work.
- **No time estimate** next to the button, for the same reason as in "What changes".
- **Dropped from the page in NIW2-583**: the "Original" column (its facts moved to the header
  line), the "Already prepared" list (each row's ✓ Ready replaces it), the folded "What changes
  in the copy" (now always shown, as a card), and GitHub's free / paid plan chips (the size bar
  says the free-plan fit; the ready card still shows where a light copy fits on GitHub). Their
  i18n keys, and the old quick chips' and "Prepare for…" keys NIW2-585 replaced, were pruned
  once the sibling branches were stacked (NIW2-586's branch).

## Out of scope

Importing outside videos (separate ticket), a sidebar entry, a real before/after frame from the
recording, a recording-quality floor, and uploading to any platform.

## How to validate

Record a short clip → the "Your video is ready" card appears top-right → YouTube → Prepare opens
on YouTube, 1440p selected, at the default window size with no scrollbar → try 4K → press Enter →
back on the recording: the master tag by the title and over the player, the copy under Copies
from this original with its progress, "Preparing your YouTube copy…" top-right, then "Your YouTube
copy is ready" → the copy is in the Library, and its row on Prepare reads ✓ Ready. Drag the copy's
row out of the page into Finder. Then GitHub from the "Where is it going?" panel on another fresh
recording, Export a copy (no `?to=`, so Prepare opens on YouTube), Fit / Fill on Reels, and a
screenshot's page (no Prepare). At 900 × 670 the title, tag and actions never truncate each other.
