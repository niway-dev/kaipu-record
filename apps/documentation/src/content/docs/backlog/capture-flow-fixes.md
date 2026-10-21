---
title: "Capture flow: every shot saved, Capture opens the editor"
description: "Production audit of the desktop capture flow (v0.14.0) and the fix: every capture is saved to the Library, Capture opens the editor on the saved item, Copy stays quiet with the toast, the editor saves edits instead of blocking navigation, and the toast's Edit always lands on the image."
---

# Capture flow: every shot saved, Capture opens the editor

> **Status: 🟢 Ready to validate** — branch `fix/capture-flow` (2026-10-20). Supersedes the
> "save automatically or on click" preference ([settings-screenshots](./settings-screenshots)).
> Parent: [screenshots](./screenshots).

## What production (desktop v0.14.0) did

| Report                                                       | Cause                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Capture showed the toast instead of the editor               | `decideAfterCapture` opened the editor only when `screenshotSave` was `manual`, and its default is `auto`.                                                                                                                                                                                             |
| A second Capture + Copy did nothing (two displays connected) | Each overlay called `show()` when it painted, which makes it the key window: the last overlay to paint took the keyboard, not the one with the frame. Fixed by [#352](https://github.com/niway-dev/kaipu-record-monorepo/pull/352) (only the frame's overlay is shown active), not yet in a release.   |
| The editor would not let you leave without saving            | `useBlocker` held every navigation while the editor was dirty. A fresh capture was dirty from the moment it opened.                                                                                                                                                                                    |
| The toast's Annotate opened the editor without the image     | `/editor/image/:assetId` resolved the id against a library list read when the page mounted. Moving from one image to another kept the page mounted, so a shot saved since then was missing and the route fell back to the Editor home. Saving a screenshot did not broadcast `library:changed` either. |

## The behaviour now

| Action on the overlay | Library      | Clipboard                 | What appears                      |
| --------------------- | ------------ | ------------------------- | --------------------------------- |
| Capture (Enter)       | Always saved | When "copy automatically" | The editor, on the saved item     |
| Copy (⌘C / Ctrl+C)    | Always saved | Always                    | The toast only; the app stays put |

- **Main saves first.** `createCaptureHandler` writes the vault before anything else and answers
  `saved: { id, assetId }`. The renderer opens `/editor/image/:assetId`, which also stamps the item
  as opened, so every Capture appears on the Editor home's Continue list. A Copy appears there once
  it is opened with the toast's **Edit** (renamed from Annotate).
- **The editor saves, it does not ask.** On a shot in the Library, edits are written over that item
  800 ms after the last one, and leaving the editor saves what is pending, then goes. Only an image
  the Library has never seen (a paste, or a capture whose vault write failed) still asks before it
  is lost.
- **The "save automatically" preference is gone.** It had nothing left to decide. "Copy
  automatically" stays: it now applies to Capture.
- **Every screenshot vault write broadcasts `library:changed`**, and the image route re-lists once
  before giving up on an id it does not know.

## Known limits

- **Edits are baked into the PNG.** The saved item is a flat image, so after leaving the editor an
  arrow can no longer be moved or removed, and the unannotated original is overwritten. Keeping the
  scene in a sidecar (as the video editor does with its edit session) would keep shots editable;
  it is the follow-up.
- **The editor opens a fresh capture unframed.** It is now a Library item like any other, so it gets
  the flat look instead of the default beautify frame. What you see is what was saved.
- **Up to 800 ms of edits** can be lost if the app quits right after the last edit.

## How to verify

See the PR's "How to test it yourself"; the unit coverage is `after-capture-policy.test.ts`,
`capture-handler.test.ts`, `use-screenshot-capture.test.ts`, `auto-capture-policy.test.ts` and
`editor-routes.test.tsx`. The image editor's autosave has no component test (the page needs a laid
out image), so it is verified by hand.
