---
title: "Screenshot freehand pen"
description: "A freehand pen/marker for the screenshot editor: drag to write or scribble. New `path` annotation kind (normalized point list), smoothed in the live layer and the compositor."
---

# Screenshot freehand pen

> **Status: 🔵 Proposed.** Drag to **write or scribble** on the shot — circle a thing,
> hand-draw an arrow, scratch over a detail. WhatsApp-practical, drops straight into the
> existing annotation pipeline.

## Model — a new `path` annotation kind

Annotations are already normalized (0–1) with a `seed`; add one kind:

```ts
interface PathAnnotation {
  id: string;
  kind: "path";
  points: { x: number; y: number }[]; // normalized, in capture order
  color: string;
  stroke: number; // index into STROKE_WIDTHS (reuses the existing picker)
}
```

This slots into the `Annotation` union next to box/arrow/text — no new infrastructure;
the colour + stroke options panel already drives it.

## Interaction

- A **Pen** tool in the tool group. `pointerdown` starts a path; `pointermove` appends a
  point (throttled to ~every few px so the list stays small); `pointerup` commits via
  `addAnnotation`. Stay in the tool to draw several (matches box/arrow).
- Reuses the existing **colour + stroke** options panel — no new controls.

## Rendering

- **Live + export** are the same SVG `<path>`. Build a `d` from the points — a smooth
  curve (Catmull-Rom → Bézier) reads nicer than a raw polyline; the same builder runs in
  `AnnotationLayer` and in `compositeScene` (scale points by natural W/H). Round line
  caps/joins.
- Optionally render it in the hand-drawn "rough" style for visual consistency with the
  box/arrow strokes (double-stroke with a seed), but a plain smoothed stroke is fine and
  cheaper.

## Hit-testing (for select/move/recolor)

- Hit = min distance from the pointer to any segment of the polyline < a threshold
  (reuse `distToSegment`, loop over consecutive points). Move = translate every point.

## Complexity

**Low–Medium.** New bits: the points array, a smoothing function (shared live/export),
and the polyline hit-test. Everything else (colour, stroke, undo, selection-aware
recolor) is already there. Smaller than the text tool.

## Note vs redaction

A thick opaque scribble can *visually* scratch something out, but it is **not** secure
redaction — edges leak and it's a stroke, not a fill. For hiding sensitive data use the
[blur box](./screenshot-redaction), which destroys the pixels.
