---
title: "Editor — auto-select after creating a shape"
description: "After drawing a box/arrow/text/etc., auto-switch to the select tool and select the new annotation so it can be moved (and, ideally, resized) immediately — the Excalidraw behavior. Needs resize handles for the full experience."
---

# Editor — auto-select after creating a shape

> **Status: 🟢 Built locally** (on `feat/screenshot-editor-tools`). Finishing a
> box / arrow / text / blur / **pen** now **auto-switches to the select tool and selects
> the new shape**, so it can be **moved** right away — every tool behaves the same on
> release. **Phase 2 — resize handles** is now done too: a selected shape shows drag
> handles and can be **resized** (box/blur/path via an 8-handle bounding box, arrow via
> its two endpoints, text via a corner that snaps to the nearest size level). The
> geometry math lives in `handles.ts` (pure, unit-tested).

## The behavior (two references)

- **WhatsApp**: tapping the square tool drops a **pre-made, already-selected** square you
  then resize — you don't drag one out.
- **Excalidraw**: you **drag** to create the shape, and on mouse-up it **auto-switches to
  the select tool** with the new shape selected (handles showing) → resize/move at once.

The owner prefers **Excalidraw**: draw a box / arrow / text / pen / blur, release, and it
auto-selects so it can be **resized or at least moved** immediately.

## Current vs desired

|                       | Now                           | Desired                                  |
| --------------------- | ----------------------------- | ---------------------------------------- |
| After a shape commits | stays in the tool (draw more) | switch to `select`, select the new shape |
| The new shape         | not selected                  | selected, showing handles                |
| Resize                | ✓ drag handles                | ✓ drag handles                           |

## Two parts — very different cost

1. **Auto-select (cheap).** On commit (`onPointerUp` → `addAnnotation`, and `commitText`
   for text), also `tools.setTool("select")` + `scene.select(newId)`. The shape is then
   selected and movable (move already works). ~a few lines. Applies to **every tool
   including the pen** — a finished stroke auto-selects like the rest (draw another by
   re-picking the pen).
2. **Resize handles (done).** A selected shape shows drag handles; grabbing one starts a
   `resize` drag that updates the annotation's geometry:
   - box/blur: 8 handles (4 corners + 4 edges) move the corresponding edges (`x/y/w/h`).
   - arrow: two endpoint handles (`x1,y1` / `x2,y2`).
   - path: the same 8 handles, scaling every point into the new bounding box (a flat
     stroke keeps its coordinate on the zero axis, so it can't collapse to `NaN`).
   - text: one corner handle that snaps to the nearest discrete size level (font-based,
     so it scales uniformly rather than stretching).

   The math is a pure module — `handles.ts` (`annotationBox` / `handlesFor` /
   `resizeAnnotation` / `hitHandle`) — unit-tested in `handles.test.ts`. The layer
   hit-tests handles **before** the shape hit-test (so grabbing a corner resizes instead
   of moving) and commits to history via `beginInteract`/`endInteract` like move. Resize
   runs from the **original** geometry each frame, so fixed edges don't drift.

## Tradeoff to decide

Auto-select **removes** the "draw several in a row" flow. Excalidraw keeps a **tool-lock**
toggle for repeated drawing; we could add a small lock later. For v1, matching Excalidraw
(auto-select, no lock) is fine — drawing a second shape is one tool click away.

## Phasing (both shipped)

- **Phase 1:** auto-select on commit → the shape is selected and movable. ✅
- **Phase 2:** resize handles (box/blur/arrow/path bbox + text size), geometry in a pure,
  tested module. ✅
