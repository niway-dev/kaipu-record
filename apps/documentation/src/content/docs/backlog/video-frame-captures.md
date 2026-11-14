---
title: "Video frame captures linked to their video"
description: "The camera button in the video editor's top bar saves the frame on screen into the library, linked to the video, skips a duplicate of the same moment, and the Captures panel lists that video's captures to add to the timeline, go to, copy and delete."
---

# Video frame captures linked to their video

> **Status: 🟡 In progress.** Tickets [NIW2-764](https://linear.app/niway/issue/NIW2-764/video-editor-the-frame-button-saves-into-kaipu-linked-to-the-video)
> (first version) and [NIW2-768](https://linear.app/niway/issue/NIW2-768/video-frame-captures-go-to-copy-delete-per-capture-no-duplicates-link)
> (the owner's QA of it, corrected after a first reading). The owner's requests
> (2026-11-13) are the approved contract; this page records them and the decisions taken
> to build them.

## Problem

The owner picks a thumbnail (cover) for a video by grabbing frames from it while editing.
There is no way to do that inside Kaipu: the top-bar image button the owner reached for was
**Add image**, which opened a file picker to insert an image slide into the timeline. A frame
taken with a system screenshot ends up outside the library, with no tie back to the video.

## What it does

1. A **Capture frame** button, the camera icon in the editor's top bar, saves the frame at the
   playhead into the active workspace's library as a screenshot. No save dialog. It takes the
   place **Add image** had in the top bar, which is removed. It is disabled while a capture
   runs and until the first read of this video's captures lands (the duplicate check needs
   the real list). A successful capture opens the Captures panel on the new capture.
2. The capture records the video it came from (`sourceVideoAssetId`) and the time in the
   video (`sourceTimeSeconds`), in its sidecar.
3. The **Captures** panel, in the editor's right column, lists this video's captures, newest
   first. Its header holds only the title and the close button. Each capture shows its image
   and, below it, its time in the video and three buttons: **Add to timeline** inserts that
   image into the timeline as an image slide at the playhead's nearest item boundary (what
   Add image did), **Copy** puts the image on the clipboard, **Delete** removes it from the
   library after the same confirmation the Library asks for. **Go to** is on the image:
   hovering it shows a subtle dark veil with a round Go to button centered on it, and
   clicking that button moves the playhead to the capture's moment. A frame of an image slide
   has no time, so it has no Go to. The **Captures** button in the tool column (right of the
   preview) opens and closes the panel. The panel takes the inspector's place, so opening it
   clears the selection.
4. A second capture at a moment that already has one (same video, same millisecond) saves
   nothing: the panel outlines the existing capture and a toast says it already exists.
5. The video's detail page in the Library lists the same captures in a **Captures (n)** tab,
   shown only when the video has captures, so covers can be found from there too. Clicking
   a capture opens its own page.
6. A capture's own page says where it came from: "From _video title_ at 0:33.4". Clicking it
   opens that video's page with the player paused on that second. When the video is no longer
   in the library, the line is not shown.

## Acceptance criteria

- Clicking Capture frame in the top bar writes a PNG into the library and never shows a save dialog.
- There is no Add image button in the video editor, and no Capture frame button in the panel.
- The new item's sidecar has the source video's asset id and the frame's time in the source
  video. A frame of an image slide has no source time: it is linked with no time, and has no
  Go to in the panel.
- Add to timeline on a capture inserts its image as an image slide, undoable like any edit.
- The Captures panel lists only this video's captures and shows a new one right after it is taken.
- Each capture can be copied to the clipboard as an image.
- Pressing Capture frame twice at the same moment leaves one capture. Captures of slides
  are never treated as duplicates.
- Each capture in the panel can be deleted, after a confirmation.
- A capture's page links to its video at the captured second.
- The ⌘⇧1 screenshot flow, the screenshot editor's own Add image, and the video's edit,
  export and files are unchanged.

## Decisions

| Decision                                                                              | Why                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add image is removed; the camera takes its place in the top bar (NIW2-768 correction) | The owner reaches for that spot to capture a frame; inserting an image is now a capture's own action, so no file picker is needed.                     |
| The capture is the composed frame (background, zoom, webcam, privacy redactions)      | It is what the preview shows, and a raw frame would leak what Privacy covers. Built with the export composer, so a capture and an export never differ. |
| A new sidecar field, not `derivedFromAssetId`                                         | `derivedFromAssetId` means "an export of"; reusing it would make captures count as exports of the video in the export-reuse check.                     |
| Frames at the video's own resolution                                                  | A cover needs full resolution; the preview size depends on the window.                                                                                 |
| One Capture frame button, in the top bar; none in the panel                           | One entry point for one action; the panel is where the result appears and where Add to timeline, Copy and Delete live.                                 |
| Add to timeline per capture replaces Add image                                        | The slide's source is a capture the library already holds; main reads its PNG by id, so no file picker and no bytes through the renderer's fetch.      |
| Go to is a veil button on the image, shown on hover and keyboard focus                | The image is the moment; the row keeps only actions on the file. The veil is subtle and the button stays in the tab order.                             |
| A duplicate is the same source millisecond, checked before composing                  | The owner's rule; checking first answers at once and spends no composer run. Slides have no source time, so they are never duplicates.                 |
| The capture's link opens the video's Library page, paused on the second               | It plays the original, whose clock the stored second uses; the editor's timeline may have cut that second out.                                         |

## Out of scope

- Setting a capture as the video's actual cover or library thumbnail.
- Cloud sync of the link.
