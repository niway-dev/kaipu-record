---
title: "Video frame captures linked to their video"
description: "A Capture frame button in the video editor saves the frame on screen into the library, linked to the video, and lists that video's captures to view and copy."
---

# Video frame captures linked to their video

> **Status: 🟡 In progress.** Tickets [NIW2-764](https://linear.app/niway/issue/NIW2-764/video-editor-the-frame-button-saves-into-kaipu-linked-to-the-video)
> (first version) and [NIW2-768](https://linear.app/niway/issue/NIW2-768/video-frame-captures-go-to-copy-delete-per-capture-no-duplicates-link)
> (the owner's QA of it). The owner's requests (2026-11-13) are the approved contract; this
> page records them and the decisions taken to build them.

## Problem

The owner picks a thumbnail (cover) for a video by grabbing frames from it while editing.
There is no way to do that inside Kaipu: the top-bar image button the owner reached for is
**Add image**, which opens a file picker to insert an image slide into the timeline. A frame
taken with a system screenshot ends up outside the library, with no tie back to the video.

## What it does

1. A **Capture frame** button in the header of the editor's **Captures** panel saves the
   frame at the playhead into the active workspace's library as a screenshot. No save dialog.
   (NIW2-764 put it in the top bar as a camera icon; NIW2-768 moved it into the panel, the
   one place the captures are.)
2. The capture records the video it came from (`sourceVideoAssetId`) and the time in the
   video (`sourceTimeSeconds`), in its sidecar.
3. The **Captures** panel, in the editor's right column, lists this video's captures, newest
   first, each with its time in the video and three buttons: **Go to** moves the playhead to
   its moment, **Copy** puts the image on the clipboard, **Delete** removes it from the library
   after the same confirmation the Library asks for. A frame of an image slide has no time, so
   it has no Go to. The **Captures** button in the tool column (right of the preview) opens and
   closes the panel. The panel takes the inspector's place, so opening it clears the selection.
4. A second capture at a moment that already has one (same video, same millisecond) saves
   nothing: the panel outlines the existing capture and a toast says it already exists.
5. The video's detail page in the Library lists the same captures in a **Captures (n)** tab,
   shown only when the video has captures, so covers can be found from there too. Clicking
   a capture opens its own page.
6. A capture's own page says where it came from: "From _video title_ at 0:33.4". Clicking it
   opens that video's page with the player paused on that second. When the video is no longer
   in the library, the line is not shown.

## Acceptance criteria

- Clicking Capture frame writes a PNG into the library and never shows a save dialog.
- The new item's sidecar has the source video's asset id and the frame's time in the source
  video. A frame of an image slide has no source time: it is linked with no time, and has no
  Go to in the panel.
- The Captures panel lists only this video's captures and shows a new one right after it is taken.
- Each capture can be copied to the clipboard as an image.
- Pressing Capture frame twice at the same moment leaves one capture. Captures of slides
  are never treated as duplicates.
- Each capture in the panel can be deleted, after a confirmation.
- A capture's page links to its video at the captured second.
- Add image, the ⌘⇧1 screenshot flow, and the video's edit, export and files are unchanged.

## Decisions

| Decision                                                                         | Why                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A new button; Add image stays                                                    | Turning Add image into a capture button would remove image slides.                                                                                     |
| The capture is the composed frame (background, zoom, webcam, privacy redactions) | It is what the preview shows, and a raw frame would leak what Privacy covers. Built with the export composer, so a capture and an export never differ. |
| A new sidecar field, not `derivedFromAssetId`                                    | `derivedFromAssetId` means "an export of"; reusing it would make captures count as exports of the video in the export-reuse check.                     |
| Frames at the video's own resolution                                             | A cover needs full resolution; the preview size depends on the window.                                                                                 |
| One Capture frame button, in the panel (NIW2-768)                                | Two entry points for one action; the panel is where the result appears and where Go to, Copy and Delete live.                                          |
| A duplicate is the same source millisecond, checked before composing             | The owner's rule; checking first answers at once and spends no composer run. Slides have no source time, so they are never duplicates.                 |
| The capture's link opens the video's Library page, paused on the second          | It plays the original, whose clock the stored second uses; the editor's timeline may have cut that second out.                                         |

## Out of scope

- Setting a capture as the video's actual cover or library thumbnail.
- Cloud sync of the link.
