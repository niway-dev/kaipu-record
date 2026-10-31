---
title: "\"Your video is ready\" floats on the desktop"
description: "After a take, the post-recording card (NIW2-584) opens in its own frameless, always-on-top window in a corner of the recorded display, outside the main window, like the screenshot capture toast."
---

# "Your video is ready" floats on the desktop

> **Status: 🟢 Ready to validate** (2026-10-30). Branch `feature/floating-ready-window`,
> stacked on `feature/niw2-587-prepare-drop-zone`. No Linear ticket (the workspace hit its
> issue limit). Unit-tested; not run in Electron yet — owner QA pending.

## What it does

The "Your video is ready" card ([NIW2-584](./prepare-screen)) used to live in the main
window's top-right status stack. The owner expected it to float on the desktop, like a
system notification. It now opens in its own window:

- frameless, transparent, always on top, at the top-right of the display the take recorded
  (the display under the pointer when that is unknown);
- on screen whether the main window is hidden, minimized or behind another app;
- shown inactive and, on macOS, as a non-activating panel, so it never takes focus from the
  app the user is in;
- content-protected, so a later recording or screenshot never captures it;
- on every Space, full-screen ones included, while shown (the capture toast's behavior).

The content, styles and i18n are the same `PostRecordingCard` as before. It has no timer:
it stays until an action, ✕ or Escape (Escape works once the user has clicked into it,
because the window never takes focus by itself). The next recording replaces it.

Every action closes the window, then shows and focuses the main window and navigates it:
a chip or More places into Prepare (through `preparePath`), Edit first into the editor,
Open onto the recording's page.

## How it is built

The screenshot capture toast's pattern (`main/screenshots/capture-toast-window.ts`):

| Piece                                                      | Where                                                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Window manager (create, replace, close, action → hand-off) | `main/recording/recording-ready-window.ts`                                                     |
| Contract (payload, actions, hand-off, validation)          | `shared/types/recording-ready.ts`                                                              |
| IPC channels `recording-ready:*`                           | `shared/types/ipc.ts`, `preload/index.ts`                                                      |
| Card window root (`?window=recording-ready`)               | `renderer/src/features/recording-ready/recording-ready-card.tsx`                               |
| Hand-off → route in the main window                        | `renderer/src/features/recording-ready/use-recording-ready-hand-offs.ts`                       |
| The ask, and the in-app fallback                           | `renderer/src/features/recording-ready/use-floating-ready-card.ts`, used by the recording page |
| The take's display                                         | `RecordingHubHandle.lastTakeDisplayId()`                                                       |

The recording page still decides **when** the card shows (fresh recording, a local video,
the Settings toggle on). It asks main once per arrival, after the file has been read, so the
card opens with its numbers. Main answers false when it cannot create the window, and the
page then shows the in-app card instead; the card never shows twice.

## Not done

- A window that is created but fails to load its renderer shows nothing and does not fall
  back to the in-app card; only a failed creation (or a failed IPC) does.
- Not run in Electron: the window's size, shadow and position need the owner's check.
