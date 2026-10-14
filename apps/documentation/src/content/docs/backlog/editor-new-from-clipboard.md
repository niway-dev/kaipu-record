---
title: "Editor — New: edit an image from the clipboard"
description: "A New button in the Editor opens an empty page that takes a pasted image (⌘V or a Paste button) and opens it in the image editor, without the capture conveniences (frame, auto-save, auto-copy)."
---

# Editor — New: edit an image from the clipboard

> **Status: 🟢 Ready to validate** (2026-10-14, branch `feat/paste-image-editor`). Owner:
> "sometimes I have photos I copied to my clipboard and I want to edit them in Kaipu —
> paste them and have them appear on the canvas." The first, smallest slice of the
> [standalone editor idea](./standalone-editor): an image that did not come from a Kaipu
> capture, edited with the same tools.

## What it does

- **New** sits in the Editor home's header and in the image editor's toolbar. It opens
  `/editor/new`, an empty page that waits for an image.
- **⌘V** on that page, or its **Paste from clipboard** button, brings in the clipboard
  image and opens the image editor on it. The New page replaces itself in history, so
  Back from the editor returns to where New was pressed.
- The pasted image opens as an in-memory source (`{ kind: "blob", origin: "paste" }`).
  It is unsaved from the start, so leaving asks before dropping it, like a fresh capture.
- When the clipboard holds no image, the page says so and stays.

## Decisions

| Decision                                                                                                    | Why                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The "canvas" is the pasted image, not a blank artboard of a chosen size                                     | Covers the owner's case (copy, paste, edit) with the existing editor unchanged. A blank artboard with several pasted images is a new annotation type (move, scale, order), deferred: see below.                                                                                            |
| A paste opens **unframed** and with **no auto-save and no auto-copy**, whatever the screenshot settings say | Those settings exist for captures. Auto-copy would replace the user's original on the clipboard with a re-encoded copy of it; auto-save would fill the Library with every paste. `openKindOf()` in `auto-capture-policy.ts` names the three ways the editor opens (capture, local, paste). |
| ⌘V reads the paste event first, then main's `clipboard.readImage()`                                         | The event carries JPEGs and Finder-copied image files; the native reader covers apps that put only a native image on the pasteboard. The button has no event, so it uses the native reader directly.                                                                                       |
| Pasted bytes are re-encoded as PNG                                                                          | The editor's readers, Copy and Save treat the bytes as PNG; a pasted photo is often JPEG.                                                                                                                                                                                                  |

## Not in this slice

- **Collage / several images on one canvas** — the owner found it interesting but not
  needed now. It needs images as scene elements (an annotation kind with move, scale and
  z-order) and a canvas size of its own.
- **⌘V inside an open image editor** (replace the image, or add it as a layer) — the
  second half of the collage question.
- **New in the video editor** — the request was about images.
- **Drag a file from Finder onto the New page** — cheap to add later with the same
  decode path.

## How to validate

1. `bun run dev`, open **Editor** in the sidebar, press **New**.
2. Copy an image in another app (a photo in Photos, "Copy Image" in a browser), come
   back and press ⌘V: the image editor opens on it, no frame, title "Pasted image — …".
3. Press **Save**: it lands in the Library. Nothing was saved or copied before that,
   even with auto-save and auto-copy on in Settings → Screenshots.
4. Copy some text, press **New** in the editor toolbar (confirm discarding), then
   **Paste from clipboard**: the page says there is no image on the clipboard.
