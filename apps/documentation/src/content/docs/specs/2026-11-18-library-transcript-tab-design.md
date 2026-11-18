---
title: "Transcript tab on the Library detail page — design"
description: The editor's Transcript panel also lives as a tab on the Library detail page, beside Versions and Details. It follows the detail page's own player, highlights the word being spoken, seeks on click, and offers "Transcribe now" when the video has no transcript yet.
---

# Transcript tab on the Library detail page — design

**Status: 🟡 In progress · [NIW2-870](https://linear.app/niway/issue/NIW2-870/transcript-tab-on-the-library-detail-page-with-a-transcribe-now-call).**
Written alone under GSD on 2026-11-18; every choice the owner was not asked about is a
`Yes, your call` row below. It is the next layer of the
[local transcription](/specs/2026-11-15-local-transcription-design/) stack, on top of the
in-app engine download (PR #668); nothing in that stack is on `main` yet.

## Summary (one minute)

Today a transcript can only be read inside the video editor, behind the last icon of the
editor's tool column. The owner looks for it where they watch the video: the Library detail
page. This change puts the **same Transcript panel** in a new **Transcript** tab of that page's
right panel. While the detail page's video plays, the word being spoken is highlighted and the
list follows it; clicking a word moves the video there; search, copy and SRT/VTT/TXT export
work as in the editor. When the video has no transcript yet, the tab shows a **Transcribe now**
button that starts the job (or offers the model download first), and the words appear in the
tab when the job ends.

The detail page plays the untouched recording, so the panel gets a one-clip layout where
timeline time equals source time: the projection of
[ADR 0063](/architecture/decisions/0063-a-transcript-is-stored-per-recording-in-source-time-and-projected-through-the-edit/)
is reused as it is, with no edits to apply.

### Decisions

| #   | Decision | Options considered | Chosen, and why | Assumed? | ADR |
| --- | -------- | ------------------ | --------------- | -------- | --- |
| 1 | Where the transcript lives on the detail page | A tab in the right panel; a section under the player; a drawer | A **Transcript** tab: the panel already holds per-video content in tabs (Versions, Details, Captures), and it is a column beside the player, as in the Yui call replay the owner showed | No, the owner's request ("un side panel que se ilumina") | none |
| 2 | Which panel | A new Library-only panel; the editor's `TranscriptPanel` | Reuse `TranscriptPanel`: highlight, follow, seek, search, copy and export already exist and are tested; two panels would drift | No, repository (existing component) | none |
| 3 | Time base on the detail page | Feed source time with a new code path; a one-clip identity layout | One clip from 0 to the duration, no mutes: the projection returns source time unchanged, and the panel needs no second mode | Yes, your call | none (applies 0063) |
| 4 | When the tab exists | Always; same rule as the header's Transcribe button | Same rule as the header's Transcribe button (`LibraryTranscribeButton`): flag `transcription` on, a recording item with local media, audio not known to be absent. Where the button does not appear, the tab does not either | Yes, your call | none |
| 5 | Tab order and default | First; after Versions; last | After **Versions**, before **Details**. The default tab does not change, so "Where is it going?" still leads for a fresh original | Yes, your call | none |
| 6 | The empty state | Only the header button; a call to action in the tab | A **Transcribe now** button in the tab, as the owner asked. The header's Transcribe button stays; both drive the same job, so they always agree | No, the owner's request ("que haya un CTA de transcribir ya") | none |
| 7 | Copy of the empty-state button | Keep "Transcribe"; "Transcribe now" in the tab only; "Transcribe now" in both panels | "Transcribe now" (es "Transcribir ahora") in both panels: one key, the editor panel is the same component | Yes, your call | none |
| 8 | The header's **Transcribed** badge | A static badge; a button that opens the tab | A button that selects the Transcript tab. It answers "what do I do with Transcribed?" from the same chat | Yes, your call | none |
| 9 | Panel chrome inside the tab | Keep the close button and `<aside>` root; embedded mode | Embedded: no close button (a tab is left by picking another tab), a `<section>` root (the page's panel is already an `<aside>`) and its own UI-map area | Yes, your call | none |
| 10 | How the panel reads and moves the player | Lift the `<video>` ref into the page; a small handle from `RecordingPlayer` | `RecordingPlayer` takes an optional `onHandle?: (handle: PlayerHandle \| null) => void` prop (called with `null` on unmount), whose handle has `seek(seconds)`, `readTime()` and `subscribeTime(listener)` at frame rate while playing. The page passes it to the panel; nothing else changes for other callers | Yes, your call | none |
| 11 | Release strategy (one PR) | `safe`, `flag`, `direct` | `flag`: everything is behind the existing `transcription` flag, default off | No, the stack's spec (decision 10) | none |

**Picture of the controls.** The PR's Evidence section carries the owner's screenshot with
each control marked: the new Transcript tab, the Transcribe now button in the tab, and the
Transcribed badge that now opens the tab. Nothing is removed or moved.

### Criteria

- [ ] **T1** With the flag on, a recording with audio shows a **Transcript** tab in the
      Library detail panel, after Versions. With the flag off, or for any item where the header's
      Transcribe button does not appear (a screenshot, a GIF, a recording without audio), there
      is no tab.
- [ ] **T2** The tab lists the transcript. While the detail video plays, the word being spoken
      carries the highlight and the list scrolls to keep it in view.
- [ ] **T3** Clicking a word sets the detail video's time to that word's start.
- [ ] **T4** With no transcript, the tab shows **Transcribe now**. It starts the job, or opens
      the model offer when the model is missing; progress shows in the tab; the words replace
      the progress when the job ends, without leaving the tab.
- [ ] **T5** Clicking the header's **Transcribed** badge selects the Transcript tab.
- [ ] **T6** Search, copy and SRT/VTT/TXT export work in the tab.
- [ ] **T7** The editor's Transcript panel behaves as before (its tests pass unchanged except
      the button copy), and its empty-state button reads "Transcribe now".
- [ ] **T8** `libraryDetail.transcriptPanel` is declared in the UI map with its states, the
      `libraryDetail.tabs` area gains a `transcript` state, the UI catalog has a state for
      each, and the catalog coverage test passes.

### Open questions

None blocking. Every assumption above can be reversed after seeing the PR.

### Out of scope

- Transcribing new recordings automatically in a background queue:
  [NIW2-871](https://linear.app/niway/issue/NIW2-871/transcribe-new-recordings-automatically-in-a-background-queue).
- Translation (out of scope in the stack's spec).
- A transcript for an exported copy: a copy is its own file and the transcript belongs to the
  recording.
- Segment rows with timestamps or speaker labels, as in Yui: the panel shows paragraphs of
  words; speaker labels are out of scope in the stack's spec.

## Failures this must protect against

1. **The highlight runs on the wrong clock.** The panel reads timeline seconds; the detail page
   must hand it the player's own `currentTime`, and the one-clip layout must start at 0. A test
   seeks the player and checks the highlighted word.
2. **The panel keeps following a player that is gone.** Leaving the page, changing item with
   the arrows, or switching tab must unsubscribe the clock (no frame loop left running).
3. **Changing item shows the previous video's words.** The panel is keyed to the item; moving
   with the ‹ › arrows shows the new item's state at once.
4. **Two Transcribe controls disagree.** The header button and the tab read the same job store,
   so one shows progress whenever the other does. A test starts from one and checks the other.
5. **The tab bar overflows.** Five tabs (Versions, Transcript, Details, Where is it going?,
   Captures) must fit the panel's width or scroll; no tab label is clipped unreadably.
6. **The editor's panel changes by accident.** Embedded mode is opt-in; the editor passes
   nothing new and keeps its close button, `<aside>` root and area id.

## Layers

One PR, on top of PR #668 (the in-app engine download), in the NIW2-818 native stack.

## How it is built

- `features/library/components/recording-player.tsx`: an optional
  `onHandle?: (handle: PlayerHandle | null) => void` prop (called with `null` on unmount)
  exposing `seek`, `readTime` and `subscribeTime`; the frame loop runs only while playing and at
  least one listener is subscribed, and stops on pause, end and unmount.
- `features/video-editor/transcript-panel.tsx`: optional `onClose` (no close button when
  absent), an `embedded` prop (`<section>` root) and an `area` prop (default
  `editorVideo.transcriptPanel`).
- `pages/library-detail/library-detail-page.tsx`: `PanelTab` gains `"transcript"`; the tab
  shows under decision 4's rule; its content is `TranscriptPanel` with the one-clip layout,
  `audioMuted: false`, `mutedRanges: []`, and the player handle.
- `features/transcription/transcribe-button.tsx`: the `done` badge takes an optional
  `onOpenTranscript`; with it the badge is a button.
- i18n: `library.tabTranscript` (en "Transcript", es "Transcripción");
  `videoEditor.transcriptTranscribe` becomes "Transcribe now" / "Transcribir ahora".
- UI map and catalog: `libraryDetail.transcriptPanel` with states `idle`, `needsModel`,
  `transcribing`, `done`, `stale`; `libraryDetail.tabs` gains `transcript`.
