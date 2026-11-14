---
title: Onboarding v2 — four steps with animated feature demos
description: The first-run onboarding as the owner's v2 design. Welcome shows what the app does, through short animated demos, and only the permissions step blocks.
---

> 🟢 Ready to validate: [NIW2-769](https://linear.app/niway/issue/NIW2-769). Built from the owner's
> HTML mock "Kaipu Onboarding v2", without a design round: the owner asked for the finished
> product and will refine it after review.

## In one minute

The onboarding goes from three steps to four, and only Permissions blocks:

1. **Welcome** shows what Kaipu does, in five cards: Record, Capture, Edit and share,
   The video editor and Workspaces. Clicking a card plays a demo of a few seconds.
   Each demo is CSS keyframes over simplified versions of the app's own UI, with a cursor
   in a mint halo.
2. **Permissions**: Screen Recording and Microphone are required, Camera and Accessibility
   optional. Each row says why in one line.
3. **Shortcuts** (new): the four shortcuts that make up the app. Pressing one marks it as
   tried. Trying them is optional.
4. **You're set**: says where Kaipu lives (the menu bar and the Library) and gives two ways out,
   "Record something" and "Take a screenshot".

| Decision                                                                                 | Why                                                                                                                                                             | ADR  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Demos are pure CSS keyframes generated from small timelines, the mock's own technique    | Nothing to download and nothing that drifts from the real UI. A demo is code we can edit, not a video to re-record                                              | none |
| The Shortcuts step detects a press through a new main → renderer event, `shortcut:fired` | Global shortcuts reach main before the window, so the renderer never sees the keydown                                                                           | none |
| A press on the Shortcuts step runs the real action                                       | That is what "press one now to try it" means. ⇧⌘1 opens the capture widget, ⌃⌘X takes a real capture                                                            | none |
| Shortcut keys come from the live bindings, never literals                                | The user can rebind them. The old Done step shipped a ⌘⇧P that no shortcut matched                                                                              | none |
| The "why" moves out of the (i) popover into a line under each permission                 | The design shows it, and the 900 × 670 window fits four one-line rows                                                                                           | none |
| The language picker stays on Welcome, as one compact row                                 | The mock leaves it out, but without it a user who cannot read the default language finishes onboarding unable to read it. Dropping it would remove a capability | none |
| Reduced motion freezes each demo on a late frame, where the outcome is visible           | A looping animation is what the setting asks us to stop. A frozen late frame still shows the result                                                             | none |

**Open questions** (for the owner's review, built with the default):

- Cursor colour: mint `#35F2C4`, the mock's default. The mock offered yellow, blue and lime too.
- Done-step buttons: they close the onboarding, then open the capture widget in the record or
  screenshot intent, the same path as ⇧⌘2 and ⇧⌘1.
- A shortcut card does nothing on click. Only a real key press marks it tried, so the counter
  stays honest.

**Out of scope**: teaching the editors (they teach in context), the mock's "onboarding closed"
preview screen, and analytics on the funnel.

## Detail

### Flow and footer

- Footer: Back on the left, or "All features" inside a demo. Four clickable dots with the step
  label in the middle (WELCOME, PERMISSIONS · REQUIRED, SHORTCUTS · OPTIONAL, READY). The
  primary button and the skip link on the right.
- Skip link: "Skip to permissions" on Welcome. On Permissions, "Skip the tour" once screen and
  microphone are granted; until then it is plain text saying they are needed. "Skip the tour"
  on Shortcuts. No skip link on You're set.
- Dots ahead of Permissions do not jump past it while the required permissions are missing.
  The mock lets them, but then "only Permissions blocks" would not hold.
- Keyboard: Enter advances when allowed, ← and → move, Esc closes. Esc inside a demo returns
  to the cards first.
- Esc closes the onboarding on every step, Permissions included, and marks it complete. It is
  the one exit that does not wait for the required permissions; the Record page checks screen
  access again and shows its permission notice if it is still missing.
- Closing or skipping marks the onboarding complete, as before. Settings → Onboarding → Replay
  opens it again at Welcome.

### Demos

Each demo has a duration T (10 to 13 s) and a list of timed beats. A helper turns
`[time, css]` pairs into `@keyframes` with short eased transitions between them. A ring
helper marks clicks. The beat chips under the stage light up as the demo reaches them.
All five run in a 660 × 330 stage. The scenes match the mock:

| Demo             | Shows                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Record           | the control bar toggles mic, system audio and camera, then Record starts a take with a REC badge |
| Capture          | an area is selected, the toast opens the image editor, then Box, Steps, Measure, Text and Copy   |
| Edit and share   | the destination list picks GitHub (~2 MB) and then YouTube (~48 MB); the original never changes  |
| The video editor | sections, a zoom landing on a click, a blur over private data and an arrow                       |
| Workspaces       | switch from Personal to Work; the next recording lands in the company Drive                      |

### Window

The onboarding is an overlay inside the main window, not a window of its own. While it
shows, the renderer asks main for the onboarding floor (`setOnboardingWindowMode`): a
minimum of 720 × 720 (`ONBOARDING_MIN_WIDTH` is the base width, `ONBOARDING_MIN_HEIGHT` is
720), clamped to the screen's work area, and the window grows to it if it is smaller. Closing
the onboarding restores the base minimum. The 900 × 670 content area of the mock is the
design target: each step is built to fit it without scrolling. The `onboarding` entry in
`WINDOW_PRESETS` (1000 × 760, minimum 900 × 700) is not what this overlay applies.
