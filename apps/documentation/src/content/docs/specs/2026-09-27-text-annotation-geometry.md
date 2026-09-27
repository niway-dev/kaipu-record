---
title: "Text annotation geometry — one owner, box-governed"
description: "Design for a single module that owns text-annotation geometry across both editors, and for giving the video editor the width-bound wrapping the screenshot editor already has. Four bugs in a row came from five copies of this measurement drifting apart."
---

# Text annotation geometry — one owner, box-governed

> **Status: 🔵 Design, not implemented** (2026-09-27). Written after four consecutive
> defects in the video editor's text annotations, each one a different copy of the same
> measurement being wrong.

## Why this exists

Making video-editor labels editable and multi-line took one feature PR and four fix PRs.
Each fix was correct and each one left the next defect in place:

| Defect                                                                                  | The copy that had drifted |
| --------------------------------------------------------------------------------------- | ------------------------- |
| Line breaks vanished from the exported video                                            | the export SVG            |
| The label drew twice while being edited                                                 | the preview renderer      |
| The body of a tall label was not clickable, so clicks fell through and played the video | the hit test              |
| Reopening showed one line until you arrowed down                                        | the textarea's own sizing |

These are not four mistakes. **Five places compute the geometry of a text annotation and
none of them owns it**, so fixing one leaves the other four lying. The hit test even
carried a comment claiming it "matches the rendered bounds", which stopped being true the
day the label became multi-line.

The deeper cause is that **the text governs the box**. Every consumer has to measure the
string to know where the annotation is, so every consumer needs the same measuring code,
and copies drift.

## The decision: the box governs the text

Owner's words: _"que el resize funcione así que el texto no mande… que tenga un máximo la
caja y si el texto pasa la caja el texto se quiebra como Excalidraw… si agrando la caja de
texto el texto se redimensiona."_

A text annotation gains a **width**. Text word-wraps to it. Dragging the box's east edge
changes the width and the text reflows. Nothing is clipped: the box grows taller as lines
are added.

### This model already exists, in the other editor

The screenshot editor shipped it. `scene.ts` carries
`width?: number` in normalized units, "set by dragging the right-edge handle: the text
word-wraps to it (Excalidraw-style). Absent = auto width". `handles.ts` routes the east
edge to the wrap width, and `tools.ts` has `wrapText(text, fs, maxWidthPx)` and
`textBoxPx(text, fs, maxWidthPx)`.

The video editor's `TextOverlay` has no width at all. So this is not a new model to
invent — it is **the model that already works, brought to the video editor, with one owner
serving both**.

### On Excalidraw

Worth recording because it came up. Excalidraw does not draw an input into the canvas —
nothing can type into a canvas. It overlays a real DOM `<textarea>` positioned and styled
to match the drawn text, and commits the value to the canvas on blur. Our SVG plus overlaid
textarea is the same family. The difference was never the rendering technology; it was that
Excalidraw measures text in one place and we measured it in five. **Rewriting the preview
to canvas is explicitly rejected**: it would not touch the cause and would throw away a
working SVG export path.

## Architecture

One module owns text geometry and every consumer reads from it. It lives with the
screenshot editor's annotation tools, where `wrapText` and `textBoxPx` already are, and is
re-exported for the video editor — the path `overlay-raster.ts` already uses for `TEXT_PX`
and `HAND_FONT`.

It exposes exactly three things, because three is what the five consumers need:

| Export                          | Answers                           | Consumers                                   |
| ------------------------------- | --------------------------------- | ------------------------------------------- |
| `textLines(text, fs, widthPx?)` | which lines are drawn             | preview renderer, export rasterizer         |
| `textBoxPx(text, fs, widthPx?)` | where the annotation is           | hit test, selection outline, resize handles |
| `textEditorStyle(fs, widthPx?)` | how the editor must look to match | the inline textarea, in both editors        |

`textLines` and `textBoxPx` exist. Today `textLines` breaks only on newlines and
`wrapText` adds width-wrapping on top of it, which is a pair a caller can get wrong by
reaching for the narrower one — the video editor's renderer does exactly that today.
`textLines` therefore takes over the wrap parameter and becomes the single entry point;
`wrapText` stops being exported and its body moves into it, so calling the narrower
function is no longer possible rather than merely discouraged. **`textEditorStyle` is new**, and it is the piece that
makes the fourth defect unexpressible: font, size, line-height, `white-space`, `wrap` and
width all come from the same place as the drawing, instead of being hand-written inline in
two components — where they had already diverged.

### The invariant, stated so it can be tested

**No consumer computes text geometry.** A test asserts that neither annotation layer, the
overlay shapes, nor the export rasterizer contains a literal advance constant or a
`text.length` measurement. That is source inspection, which is normally a junk pattern; it
is justified here because the failure it guards has now happened four times and no
behavioural test catches "someone wrote a sixth copy".

## Data model

`TextOverlay` gains `width?: number`, normalized, mirroring the screenshot annotation:

```ts
export interface TextOverlay extends OverlayBase {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  /** Optional wrap width in normalized units. Absent = auto width (break only on
   *  the user's own newlines), which is exactly today's behaviour. */
  width?: number;
}
```

**Optional is load-bearing.** Every label already saved has no width, and without one the
behaviour is what it is today. No migration, no session rewrite, no risk to recordings
people have edited.

## Behaviour

- **Width absent.** Lines break only where the user pressed Enter. Today's behaviour.
- **Width set.** Lines break by whole words to fit. A single word wider than the box
  overflows on its own line rather than splitting mid-letter — the rule the screenshot
  editor already chose, kept for consistency.
- **Height always follows the text.** More lines, taller box. A fixed height would hide
  text, and hiding a user's words is worse than a tall label.
- **East edge sets the width.** Resizing a text annotation reflows it instead of scaling
  the font. Font size stays on the XS/S/M/L control, where it is today.
- **The editor matches the label.** With a width the textarea soft-wraps at that width, so
  what you type is what you see.

## Testing

Unit tests on the pure geometry: wrapping by words, the overflowing single word, the box
with and without a width, and the height growing per line. These are cheap and exhaustive
because the module is pure.

Consumer tests assert they _delegate_, not that they compute: the hit test accepts a click
on the last line of a wrapped label, the export SVG emits one `tspan` per wrapped line, the
outline matches the box.

**What cannot be tested here, said plainly.** jsdom has no layout engine, so the textarea's
rendered height and the visual match between editor and label cannot be asserted. The last
four defects included two that jsdom could not have caught. The honest home for those is
the Playwright suite, which now runs pre-push and in the release candidate; adding one
assertion there on a real render is the follow-up this spec recommends rather than
pretending unit tests cover it.

## Scope

**In:** the geometry module, `width` on `TextOverlay`, east-edge resize for video text,
the shared editor style, and migrating all five consumers in both editors.

**Out:** colour, font size levels, the annotation inspector, and the recurring question of
whether clicking the video should play it. That last one is real and related — a hit-test
miss is what made the clicks reach the player — but it is a product decision about the
player, not about text geometry.

## Risks

- **Both editors change at once.** That is the point (a shared owner that only one editor
  uses will drift again), but it doubles the blast radius. Mitigation: the screenshot
  editor's behaviour is the reference, so its tests should pass unchanged. Any change in
  them means the port is wrong, not that they need updating.
- **`textEditorStyle` is new surface.** It is the only genuinely new code here; everything
  else is consolidation.

## Reopen when

- A sixth consumer of text geometry appears and cannot use the module.
- Text annotations need per-line alignment or rich text, which this flat model does not
  carry.
