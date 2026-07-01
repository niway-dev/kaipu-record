---
title: "Editor — auto-select after creating a shape"
description: "After drawing a box/arrow/text/etc., auto-switch to the select tool and select the new annotation so it can be moved (and, ideally, resized) immediately — the Excalidraw behavior. Needs resize handles for the full experience."
---

# Editor — auto-select after creating a shape

> **Status: 🟡 Phase 1 built locally** (on `feat/screenshot-editor-tools`). Finishing a
> box / arrow / text / blur now **auto-switches to the select tool and selects the new
> shape**, so it can be **moved** right away. The **pen is excluded** (it stays active for
> scribbling several strokes). **Phase 2 — resize handles** (below) is still 🔵 proposed;
> until it lands, a selected shape can be moved but not resized.

## The behavior (two references)

- **WhatsApp**: tapping the square tool drops a **pre-made, already-selected** square you
  then resize — you don't drag one out.
- **Excalidraw**: you **drag** to create the shape, and on mouse-up it **auto-switches to
  the select tool** with the new shape selected (handles showing) → resize/move at once.

The owner prefers **Excalidraw**: draw a box / arrow / text / pen / blur, release, and it
auto-selects so it can be **resized or at least moved** immediately.

## Current vs desired

|                       | Now                            | Desired                                  |
| --------------------- | ------------------------------ | ---------------------------------------- |
| After a shape commits | stays in the tool (draw more)  | switch to `select`, select the new shape |
| The new shape         | not selected                   | selected, showing handles                |
| Resize                | ✗ (only move, via select-drag) | ✓ drag handles                           |

## Two parts — very different cost

1. **Auto-select (cheap).** On commit (`onPointerUp` → `addAnnotation`, and `commitText`
   for text), also `tools.setTool("select")` + `scene.select(newId)`. The shape is then
   selected and movable (move already works). ~a few lines.
2. **Resize handles (the real work).** Selection currently only supports **move**. To
   resize, render 8 handles on the selected shape's bounding box and handle
   pointer-drag on each to update the annotation's geometry:
   - box/blur: adjust `x/y/w/h` per handle (corner + edge).
   - arrow: two endpoint handles (`x1,y1` / `x2,y2`).
   - text: a font-size handle (or corner scales `size`).
   - path: scale/translate all points within the bounding box (or skip resize for paths
     — move only).
     Add a hit-test for handles (before the shape hit-test) and a `resize` drag mode. Commit
     to history via `beginInteract`/`endInteract` like move.

## Tradeoff to decide

Auto-select **removes** the "draw several in a row" flow. Excalidraw keeps a **tool-lock**
toggle for repeated drawing; we could add a small lock later. For v1, matching Excalidraw
(auto-select, no lock) is fine — drawing a second shape is one tool click away.

## Suggested phasing

- **Phase 1:** auto-select on commit (cheap) → the shape is selected and movable. Ships the
  core of the ask.
- **Phase 2:** resize handles (box/blur/arrow first; text size; path move-only) — the
  substantial part; do it as its own slice with tests for the geometry math.
