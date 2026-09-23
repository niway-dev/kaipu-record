---
title: "Bug — the last line of a full-screen terminal is missing from recordings"
description: "Owner report: recording the terminal, the last line is not captured, 'as if something were there'. Hypothesis: the floating control bar sits over that line and is excluded from the capture via content protection, which leaves a blank patch rather than showing what is underneath."
---

# Bug — last terminal line not recorded

> **Status: 🔵 Reported, hypothesis unverified** (2026-09-23). Owner: "when I record the
> terminal the last line of the terminal is not recorded, as if there were something
> there."

## Hypothesis

The floating control bar is placed at `workArea.bottom − 40 px`, 82 px tall
(`main/recording/control-bar-window.ts`), i.e. exactly over the last lines of any app
that fills the screen. It is excluded from the recording through
`setContentProtection(true)` (unless "Show bar in recording" is on). On macOS a
content-protected window is **omitted** from the capture — and what the capture shows
in its place is not the content underneath, it is a blank patch. That patch is "the
something there".

Supporting detail: the bar is only there while recording, so the missing line appears
only in the file, never on screen.

## How to confirm (5 minutes)

1. Settings → Recording → **Show bar in recording: on**. Record the same terminal. If the
   last line is now visible (with the bar drawn over it), the hypothesis holds.
2. Alternatively drag the bar elsewhere before recording (it is draggable) and check the
   line comes back.

## Fix options, in order of preference

1. **Move the bar off the content**: default position at the top-right or bottom-right
   **corner**, narrow, instead of bottom-centre across the width — a corner overlaps
   nothing a user reads (status lines, terminal prompts, video subtitles).
2. **Hide the bar's window from the capture the other way round**: keep the bar on a
   different display when there is one; or, since v2 already records with `desktopCapturer`,
   evaluate `getDisplayMedia` window-exclusion APIs available in the current Electron.
3. **Remember the user's bar position** per display so moving it once is enough.

## Not a fix

Turning content protection off by default: the bar would then be burned into every
recording.

## Acceptance

- [ ] Full-screen terminal, prompt on the last line, 10 s recording: the prompt is in the
      file.
- [ ] Same with a video player's subtitle line.
