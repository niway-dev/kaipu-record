---
title: "Video frame captures linked to their video"
description: "A Capture frame button in the video editor saves the frame on screen into the library, linked to the video, and lists that video's captures to view and copy."
---

# Video frame captures linked to their video

> **Status: 🟡 In progress.** Ticket [NIW2-764](https://linear.app/niway/issue/NIW2-764/video-editor-the-frame-button-saves-into-kaipu-linked-to-the-video).
> The owner's request (2026-11-13) is the approved contract; this page records it and the
> decisions taken to build it.

## Problem

The owner picks a thumbnail (cover) for a video by grabbing frames from it while editing.
There is no way to do that inside Kaipu: the top-bar image button the owner reached for is
**Add image**, which opens a file picker to insert an image slide into the timeline. A frame
taken with a system screenshot ends up outside the library, with no tie back to the video.

## What it does

1. A **Capture frame** button in the video editor's top bar, next to Add image, saves the
   frame at the playhead into the active workspace's library as a screenshot. No save dialog.
2. The capture records the video it came from (`sourceVideoAssetId`) and the time in the
   video (`sourceTimeSeconds`), in its sidecar.
3. The button also opens a **Captures** panel in the editor's right column: this video's
   captures, newest first, each with its time in the video and a Copy button that puts the
   image on the clipboard. Clicking a capture moves the playhead to its moment. A
   **Captures** toggle next to the button opens and closes the panel without capturing.
   The panel takes the inspector's place, so opening it clears the selection.
4. The video's detail page in the Library lists the same captures, so covers can be found
   from there too.

## Acceptance criteria

- Clicking Capture frame writes a PNG into the library and never shows a save dialog.
- The new item's sidecar has the source video's asset id and the frame's time in the source
  video. A frame of an image slide has no source time: it is linked with no time, and
  clicking it in the panel does nothing.
- The Captures panel lists only this video's captures and shows a new one right after it is taken.
- Each capture can be copied to the clipboard as an image.
- Add image, the ⌘⇧1 screenshot flow, and the video's edit, export and files are unchanged.

## Decisions

| Decision                                                                         | Why                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A new button; Add image stays                                                    | Turning Add image into a capture button would remove image slides.                                                                                     |
| The capture is the composed frame (background, zoom, webcam, privacy redactions) | It is what the preview shows, and a raw frame would leak what Privacy covers. Built with the export composer, so a capture and an export never differ. |
| A new sidecar field, not `derivedFromAssetId`                                    | `derivedFromAssetId` means "an export of"; reusing it would make captures count as exports of the video in the export-reuse check.                     |
| Frames at the video's own resolution                                             | A cover needs full resolution; the preview size depends on the window.                                                                                 |

## Out of scope

- Setting a capture as the video's actual cover or library thumbnail.
- Cloud sync of the link.
