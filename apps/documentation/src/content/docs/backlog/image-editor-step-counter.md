---
title: Image editor step counter
description: Numbered step badges in the image editor, placed with a click, numbered in order and renumbered when one is deleted.
---

# Image editor step counter

> **Status: 🟢 Ready to validate (prod review pending) — no flag.**

Design: [image editor canvas and inspect](../specs/2026-11-11-image-editor-canvas-and-inspect-design/),
milestone M5. Issue: [NIW2-701](https://linear.app/niway/issue/NIW2-701).

## What it does

- **Step tool.** The toolbar's Step tool drops a numbered badge where you click. The tool stays
  active, so three clicks give 1, 2 and 3.
- **Numbers follow order.** A badge's number is its position among the badges, in the order they
  were placed. Deleting one renumbers the rest; undo brings it back with its old number.
- **Color and size.** The options panel sets the badge color and one of four sizes, for the next
  badge or for the selected one. A new badge is not selected, so picking a color for the next
  one never repaints the last. The number is dark on light fills (white, yellow, green) and
  white otherwise.
- **In the export.** Badges are drawn into the copied, saved and exported image, with the same
  numbers as on screen. With the `image-canvas` flag on they can sit outside the image, and the
  export grows to include them.

## How it is stored

A badge is a `step` annotation with a center, a color and a size index. The number is **not**
stored: `stepNumbers()` in `features/screenshots/annotations/scene.ts` derives it from the scene,
and both the editor and the compositor read it from there. That keeps the annotation plain
serializable data, so the canvas document from NIW2-700 can persist it like any other kind.

## Not in it yet

- Continuing the numbering after reopening an item: needs the saved canvas document (NIW2-700).
  Until then a reopened item shows its badges baked into the image, and new badges start at 1.
- Resizing a badge by dragging: size comes from the options panel only.
- The final editor UI: the mocks land in M11.
