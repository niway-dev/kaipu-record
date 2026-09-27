---
title: "Known issue: one screen-recording dialog still appears during E2E runs"
description: "A full end-to-end run went from thirteen macOS permission dialogs to one, and the last one survived two guards. The trigger is not identified. What was tried, what was ruled out, and the probe that would name the caller."
---

# Known issue: one screen-recording dialog during E2E runs

> **Status: 🔵 Open, cause unknown** (2026-09-26). Parked deliberately: the impact is one
> dismissible dialog per run, and guessing further is more expensive than the annoyance.
> Owner's call: "no es tanta molestia como 13, creo que puedo trabajar con uno solo."

## Symptom

Running `bun run test:e2e` raises a macOS dialog:

> "cmux" is requesting to bypass the system private window picker and directly access
> your screen and audio.

It is attributed to the **terminal that spawned the run**, not to Kaipu, because the
Electron process inherits the parent's TCC identity. That is why the name in the dialog is
confusing and why a packaged build does not behave this way.

## Where it got to

| State                                    | Dialogs per full run    |
| ---------------------------------------- | ----------------------- |
| Before any guard                         | 13 — one per app launch |
| After guarding the source list           | 2                       |
| After guarding the permission escalation | **1**                   |

Both guards are merged ([#180](https://github.com/csdev19/kaipu-record-monorepo/pull/180))
and neither is suspected of regressing; the count dropped each time.

## What is already guarded

`KAIPU_DISABLE_SCREEN_CAPTURE=1`, set by the E2E launcher, short-circuits:

- `main/recording-sources.ts` — the `recording:get-screen-sources` handler, which the
  Record page (the app's default route) calls on mount for the picker's thumbnails.
- `main/permissions.ts` — the whole of `requestPermission`, whose screen branch nudges the
  permission with a 1×1 enumeration and then falls back to opening System Settings.

## What was ruled out

- **`recording/recording-hub.ts` → `displayIdForSource`.** It only runs while resolving the
  display of a source already chosen for recording, and asks for `thumbnailSize: 0×0`. No
  test records anything.
- **`useMicrophones`.** It did open a real audio stream on mount, which lit the microphone
  indicator, but that is the microphone and not the screen. Fixed separately in
  [#181](https://github.com/csdev19/kaipu-record-monorepo/pull/181).
- **`useCameraPreview`.** Already conditional on the camera toggle being on.

## Candidates not yet examined

- `main/screenshots/screenshot-capture.ts` shells out to the macOS `screencapture` CLI.
  The screenshot E2E edits a seeded fixture rather than capturing, so this is unlikely —
  but it was not proven.
- A prompt **queued by macOS from an earlier run** and surfaced on the next one, which
  would mean the count is lagging rather than the code still asking.
- Something in Electron's own startup on an unpackaged app, rather than in this
  repository's code at all.

## The probe that would settle it

Guessing has produced two correct guards and one wrong prediction, so the next step should
produce evidence instead:

Wrap `desktopCapturer.getSources` in the main process with a logging shim that prints
`new Error().stack` before delegating, run the suite once, and read which caller fires.
If nothing fires, the dialog is not coming from this repository's code and the last two
candidates above become the whole search space.

That is maybe twenty minutes, and it replaces the whole list above with one line.

## Not the same as the product issue

A real user who opens Kaipu just to browse their Library **also** gets a screen-recording
prompt, because the Record page enumerates sources on mount. That is a separate problem
with a known cause and a known fix: `canStartRecording` requires a `selectedSource`, so
deferring enumeration today would leave Start disabled. The default would have to come
from the display API, with enumeration waiting for the picker or for Start.

This page is only about the test suite.
