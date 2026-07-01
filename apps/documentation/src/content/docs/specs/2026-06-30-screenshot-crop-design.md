---
title: "Screenshot crop tool — design spec"
description: "Technical design for a non-destructive crop tool in the screenshot editor: a normalized crop rect carried in the scene, an edit-then-apply UI reusing the resize handles, live-preview windowing via a transform wrapper, and native-pixel export via clip + offset in the compositor."
---

# Screenshot crop tool — design spec

> **Status: 🟢 Approved design, ready to plan.** Brainstormed and agreed with the owner
> on `feat/screenshot-crop`. Builds on the editor-tools v2 work (pen / blur / auto-select /
> resize) merged in #14. Supersedes the analysis in [backlog/screenshot-crop](../backlog/screenshot-crop).

## 1. Goal & scope

"Keep only this section and save just that." A **Crop tool** in the screenshot editor:
activate it, drag a rectangle over the shot (reposition it by dragging the interior,
resize it with 8 handles), confirm, and the editor + export narrow to that region. It is
**non-destructive** (a scene field, undoable, re-adjustable) and exports at **native
pixels** (no upscaling).

**In scope (v1):**

- A `crop` scene field (normalized 0–1 of the base image), default unset = full image.
- A `crop` tool: edit-then-apply UX with a dim overlay, drag-to-move, 8 resize handles,
  Enter/tool-switch to apply, Esc to revert, a Reset-to-full affordance.
- Live preview windowed to the applied crop (annotation coordinates unchanged).
- Export windowed to the crop at native resolution.
- Undo/redo (crop is a committed scene change like any other).

**Out of scope (v1, documented as follow-up):**

- Aspect-ratio locks (Free / 16:9 / 1:1).
- Upscale-to-width export (softens the image; see [editor-zoom](../backlog/editor-zoom)).
- Moving the shot _inside_ the beautify frame, or pan-when-zoomed (different features).

## 2. Key decisions (agreed)

1. **"Move" = reposition the crop rectangle**, not the shot inside the frame. Dragging the
   rect interior pans the crop window; the handles resize it.
2. **Edit-then-apply model.** While the crop tool is active the full image shows with the
   area outside the rect dimmed; confirming narrows the frame. Re-activating the tool
   shows the current crop rect again for re-adjustment. (Matches Photos / WhatsApp / Figma.)
3. **Rendering approach = "image plane + clip viewport"** (see §4). The annotation
   coordinate system stays invariant — annotations remain normalized to the _original_
   image; the crop is only a viewport. Rejected alternatives:
   - _Crop-aware coordinate transform in the layer_ — would touch every `a.x*W` /
     `toNorm` / handle call site; fragile.
   - _Bake a smaller base image on crop_ — destructive, breaks re-edit, re-normalizes
     annotations. Contradicts the non-destructive model.

## 3. Data model

Add one optional field to the scene (normalized, like everything else):

```ts
interface Scene {
  beautify: BeautifyState;
  annotations: Annotation[];
  crop?: CropRect; // undefined = full image
}

interface CropRect {
  x: number; // 0–1 of base image
  y: number;
  w: number;
  h: number;
}
```

- `sameScene()` gains a `crop` comparison (reference/shallow) so undo history detects it.
- `use-editor-scene` gains `setCrop(crop: CropRect | undefined)` committing via the
  existing `commit()` (one undoable step), plus live updates during the drag via the
  existing `beginInteract` / `updateAnnotation`-style path (a dedicated
  `setCropLive` + `endInteract` mirrors how beautify sliders already work).
- A constant `FULL_CROP = { x: 0, y: 0, w: 1, h: 1 }` seeds the editing rect when no crop
  is set yet.

## 4. Rendering — "image plane + clip viewport"

The invariant to protect: `AnnotationLayer` measures its own displayed pixel size and
renders annotations with `a.x * W` (full-image normalized → displayed px). We must NOT
change that math. So we window the image by transforming the container, not the coords.

**`BeautifiedFrame`** gains an optional `crop` prop. Inside `shotWrap`:

- A **viewport** element clips to the crop's displayed size (`overflow: hidden`), with the
  crop's aspect ratio driving its box.
- An inner **image plane** sized to the _full_ image, scaled so the crop fills the
  viewport (`scale = 1 / crop.w` horizontally) and translated by `-crop.x`, `-crop.y` (in
  plane units). The `<img>` fills the plane; the `overlay` (annotation layer) is positioned
  over the plane exactly as today.
- Because the annotation layer still measures the **full plane**, `a.x * W`, `toNorm`, and
  the resize handles are unchanged. Off-viewport annotations are simply clipped by
  `overflow: hidden`.

Simplest implementation: percentage-based. Viewport width = `100%`; plane width =
`100% / crop.w`; plane `left = -crop.x / crop.w * 100%` (same for vertical with `crop.h` /
`crop.y`). When `crop` is unset (or equals `FULL_CROP`), the plane is identity — current
behavior exactly.

**While the crop tool is active**, the frame renders the **full image** (identity plane)
regardless of the applied crop, so the user can see and drag the rect over the whole shot.
The windowing only applies in the non-editing view.

`zoom` (view magnification) composes: it already scales the whole frame; the crop viewport
sits inside, so zoom × crop just works.

## 5. Crop tool interaction (in `AnnotationLayer`)

The crop rect editing lives in the annotation layer (it owns the pointer + the handle
infra), but the rect is **not** an annotation — it's the scene's `crop`, edited through a
transient "draft crop" while the tool is active.

- **Activate**: seed the draft from the applied `crop` (or `FULL_CROP`). Render:
  - a **dim overlay** — four rects (or an even-odd mask) covering everything outside the
    draft rect, at ~50% black;
  - the draft rect outline;
  - the **8 resize handles** via the existing `handlesFor` / `hitHandle` / `resizeAnnotation`
    geometry (treat the draft crop as a box for the math — reuse `handles.ts` directly).
- **Pointer**:
  - grab a handle → resize the draft (clamped to `[0,1]`, min size guard);
  - grab the interior → move the draft rect (clamp so it stays within `[0,1]`);
  - grab outside → start a fresh rect (drag-out), like the box tool.
- **Commit / cancel**:
  - **Enter** or **switching tools** → `scene.setCrop(draft)` (one undoable step);
  - **Esc** → discard the draft, keep the last applied crop;
  - **Reset** (a control in the options panel, see §6) → `scene.setCrop(undefined)` (full).
- Handle geometry reuse: `resizeAnnotation` operates on a `box`-shaped object; wrap the
  draft crop as `{ kind: "box", x, y, w, h }` for the call and read back `x/y/w/h`. A tiny
  adapter keeps `handles.ts` untouched.

Because the crop tool paints its own overlay + handles, the normal selection handles are
suppressed while it's active (the tool isn't "select").

## 6. Options panel (`AnnotationOptions`)

The crop tool has no colour/stroke. When the crop tool is active, the panel shows:

- a short hint ("Arrastrá para recortar"),
- a **Reset** button (full image) — enabled only when a crop is applied or the draft
  differs from full.

`resolveControls` returns `null` for the crop tool (no colour/stroke), and the panel gains
a crop branch parallel to the existing delete-button branch: `if (tool === "crop") show
the reset control`.

## 7. Export (`compositeScene` / `buildSvg`)

The one real pipeline change. Today the base draws at `(pad, pad)` sized
`naturalW × naturalH`, the frame is `naturalW + 2pad`, and annotations render under
`translate(pad,pad)` scaled by `naturalW/H`. With a crop `c`:

- **Cropped pixel size**: `cw = round(c.w * naturalW)`, `ch = round(c.h * naturalH)`.
- **Frame**: `frameW = cw + 2·pad`, `frameH = ch + 2·pad`.
- **Base image**: keep the shared `#shot` (`<use>`), but the base `<use>` and the rounded
  clip target the cropped window — draw the plane offset by `-c.x*naturalW`, `-c.y*naturalH`
  inside a clip of `(pad, pad, cw, ch)`. Concretely, the base becomes a `<use href="#shot"
x="pad - c.x*naturalW" y="pad - c.y*naturalH" .../>` clipped to the rounded crop rect.
- **Annotations**: the group is `translate(pad - c.x*naturalW, pad - c.y*naturalH)` and
  each annotation still renders with `a.x * naturalW` — so full-image coords land correctly
  inside the cropped window (same invariant as the live layer). The rounded clip
  (`rcLocal`) is the crop window in that translated space.
- **Blur** boxes: unchanged — they already reference `#shot` and clip to their own rect;
  they render correctly under the shifted group and get clipped by the crop window.
- No upscaling: the output is exactly `cw × ch` of base pixels (+ padding).
- When `crop` is unset, all offsets are `0` and the output is byte-for-byte today's path.

Geometry stays pure/testable: `buildSvg(scene, geom)` reads `scene.crop`; add crop-derived
fields to `Geom` (or derive inside). Unit tests assert frame size, base offset, and the
annotation group transform for a cropped scene, and that an unset crop is unchanged.

## 8. Testing

- **`handles.ts`** — already covered; the crop adapter reuses it (add one test that the
  box-adapter round-trips `x/y/w/h`).
- **crop scene field** — `use-editor-scene` test: `setCrop` commits + undoes; `sameScene`
  detects a crop change.
- **compositor** — new `buildSvg` cases: cropped frame dimensions; base + annotation-group
  offsets; unset crop identical to current output; a blur inside a crop stays clipped.
- **crop math helper** (if extracted) — clamping the draft to `[0,1]`, min-size guard,
  move-clamp keeps the rect inside the canvas.
- Interaction (pointer drag in jsdom) stays out of automated tests — the layer's pointer
  path isn't unit-tested today (getBoundingClientRect is 0 in jsdom); rely on the pure
  geometry + manual validation, consistent with the existing editor tests.

## 9. Files touched

- `annotations/tools.ts` — add `"crop"` to `ANNOTATION_TOOLS`; Crop icon in the toolbar map.
- `annotations/scene.ts` — `CropRect`, `Scene.crop`, `sameScene` crop check, `FULL_CROP`.
- `annotations/use-editor-scene.ts` — `crop`, `setCrop`, live-crop path.
- `annotations/crop.ts` (new) — pure helpers: clamp/move the draft rect, box adapter for
  `handles.ts`, and the applied-vs-full check. Unit-tested.
- `annotations/annotation-layer.tsx` — crop-tool branch: draft state, dim overlay, handles,
  commit/cancel; suppress selection handles while cropping.
- `annotations/annotation-options.tsx` — crop branch (hint + Reset).
- `annotations/annotation-toolbar.tsx` — Crop button (via the tools list; onPick already
  deselects).
- `beautify/beautified-frame.tsx` (+ module.css) — `crop` prop, viewport + image-plane
  wrapper (identity when unset / while cropping).
- `annotations/compositor.ts` (+ test) — crop-aware frame size, base offset, annotation
  group transform.
- `pages/screenshot-editor/screenshot-editor-page.tsx` — pass `crop` to `BeautifiedFrame`;
  wire the crop tool's active state (hide the windowing while the crop tool is active).
- Docs: flip `backlog/screenshot-crop` to 🟢 (in local) + backlog index row.

## 10. Rollout

Single branch `feat/screenshot-crop`, small squash PR (per the repo workflow). Manual
validation in the running app (crop, re-adjust, reset, undo, export at native pixels,
crop + blur, crop + zoom). A high-effort code review before merge, as with v2.
