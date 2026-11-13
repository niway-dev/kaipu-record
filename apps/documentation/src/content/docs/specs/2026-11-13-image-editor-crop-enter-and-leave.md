---
title: Image editor — entering and leaving the crop tool
description: Figma-style crop in the image editor - the crop tool shows the whole image, leaving it shows only the cropped part, and a "Cropped" chip on hover brings the user back. Classic crop and canvas export frame alike.
---

# Image editor — entering and leaving the crop tool

**Status: 🟡 In progress · 2026-11-13.** Approved by the owner in chat, with an HTML mock of the
three states. Tracked in
[NIW2-759](https://linear.app/niway/issue/NIW2-759/image-editor-figma-style-crop-leave-the-tool-to-see-the-result-cropped).

## Summary

The owner cropped a screenshot, pressed Save, and still saw the whole image. The crop had been
saved; the crop tool simply stayed active, and the crop tool always shows the whole image with the
frame on top. Nothing said the crop was applied, and nothing pointed back to it.

The crop is already non-destructive: the frame is stored in the document (`scene.crop` in the
classic editor, `scene.exportFrame` in canvas mode), the base image stays whole, and every change
is an undo step. This spec changes only how the editor enters and leaves the crop tool.

| Decision                                                                 | Why                                                                                                    | ADR  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---- |
| Leaving the crop tool shows only the cropped part                        | The result is visible the moment the user is done                                                      | none |
| Leave on Done, Enter, Esc, a click outside the frame, or another tool    | The usual ways out of a modal tool (Figma, Photos)                                                     | none |
| Releasing a drag does not leave the tool                                 | A crop takes several drags; leaving on each one forces re-entering                                     | none |
| Esc keeps the crop instead of clearing it                                | Esc is now the natural way out; clearing on it would throw the work away. Reset and ⌘Z still remove it | none |
| A neutral "Cropped" chip on hover, plus double-click and X, to come back | The crop is discoverable without permanent chrome on the image                                         | none |
| Same behavior in canvas mode (export frame)                              | One crop model for the owner across both editors                                                       | none |

**Out of scope:** the crop data model, the saved document format, the exported PNG, and the undo
history. No new ADR: none of these decisions is structural.

## Behavior

**While cropping.** The stage shows the whole image with the frame; outside the frame is dimmed.
The panel shows Reset and a primary **Done** button (accent color, the panel's one action).

**Leaving.** Each of these keeps the crop, switches to the select tool, and shows only the cropped
area:

- Done in the panel;
- Enter;
- Esc;
- a click outside the frame (on the stage, not on the frame or its handles);
- choosing another tool.

Ending a drag of a handle or of the frame does not leave the tool.

**Coming back.** With a crop set and the crop tool inactive, hovering the image shows a **Cropped**
chip above the image's top-left corner: `bg-card`, hairline border, 4 px radius, the crop icon and
the word "Cropped". Its tooltip names the shortcuts. Any of these re-enters the crop tool with the
current crop:

- a click on the chip;
- a double-click on the image;
- the crop tool's key (X).

With no crop set there is no chip.

**Removing.** Unchanged: Reset in the panel, or ⌘Z.

## Canvas mode

In canvas mode the crop tool edits the export frame, not one image. The same rules apply: leaving
the tool shows only what the frame exports, and the chip appears above the frame's top-left corner
when the pointer is over the canvas content.
