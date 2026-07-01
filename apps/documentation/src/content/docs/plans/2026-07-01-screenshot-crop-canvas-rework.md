---
title: "Screenshot crop — canvas-relative rework (handoff)"
description: "Self-contained handoff to resume the crop-tool rework: change crop from image-relative to CANVAS/frame-relative (bg + padding + shot). Root-cause diagnosis of the padding/transparent-export bugs, the confirmed new model, a module-by-module plan, and all workflow context."
---

# Screenshot crop — canvas-relative rework (handoff)

> **Read this first when resuming after a context clear.** It is self-contained: it has the
> decision, the diagnosis, the current state, the exact rework plan, and the workflow rules.
> Branch: `feat/screenshot-crop`. Open PR: **#15**
> (`https://github.com/csdev19/kaipu-record-monorepo/pull/15`).

## 0. TL;DR — what to do

The crop tool was built (spec + plan + 10 TDD tasks + a code-review fix pass) but has a
**fundamental design flaw**: the crop is defined relative to the **base image** and its
overlay only covers the **shot** (inside the padding). The owner needs the crop to operate
on the **whole canvas** (background + padding + shot). **Rework it to canvas/frame-relative.**

**Confirmed with the owner (do not re-ask):**

1. **Model = crop over the CANVAS** (bg + padding + shot), not the capture. This enables the
   headline use case: *capture a 3:4 shot, add padding to make room, crop it to a square
   including the padding.*
2. **Implement now, with tests** (module by module, typecheck + vitest green each step), the
   owner validates in the running build.

Work on `feat/screenshot-crop` (same PR #15). Commit style + conventions in §8.

## 1. Root-cause diagnosis (the bugs the owner hit)

Current crop = normalized `{x,y,w,h}` of the **base image**; the crop overlay lives in
`AnnotationLayer`, which is `position:absolute; inset:0` of `.shotWrap` — i.e. it covers only
the **shot**, not the padding/background. Consequences the owner reproduced:

- **The crop rect can't reach the padding/background** — the handles stop at the shot edges.
  ("nuestra herramienta debería ir sobre el canvas no sobre la captura.")
- **Crop + padding export breaks** — the export takes a slice of the *image* (`cropW =
  crop.w * naturalW`) and then **re-adds `2·pad` around it**. If you then re-open a shot that
  already had padding baked in and add padding again, it **compounds** → the saved PNG is
  mostly background with a sliver of image (owner's imgs 101–102), and in the worst case
  effectively transparent.
- **The earlier "all transparent on the 2nd overwrite"** is the same chain: image-relative
  crop + re-added padding over an already-cropped/padded base.

The compositor's crop *math is internally consistent* (no-crop path is byte-identical, verified),
and the SVG clip coords are correct (local group space, consistent with the validated v2 blur).
The problem is the **model**, not a compositor arithmetic bug. The rework replaces the model.

## 2. The new model — crop is a viewBox window over the composed frame

Define `crop` as normalized `0–1` of the **beautified frame** (bg + padding + shot). Default
`undefined` = whole frame. The frame is composed **once** at full size; the crop only selects a
sub-rectangle of that composed output.

- **Frame pixel size (natural):** `fullW = naturalW + 2·pad`, `fullH = naturalH + 2·pad`
  (pad in native px = `round(padding * scale)`, `scale = naturalW / shotDisplayedW`).
- **Export = viewBox window.** Build the full frame in `[0..fullW, 0..fullH]` (bg rect at
  `(0,0,fullW,fullH)`, shot `<use>` at `(pad,pad)` clipped rounded, annotations
  `translate(pad,pad)`), then set the output SVG to:
  - `viewBox = "${crop.x*fullW} ${crop.y*fullH} ${crop.w*fullW} ${crop.h*fullH}"`,
  - `width = crop.w*fullW`, `height = crop.h*fullH`, rasterize at those dims.
  - No crop → `viewBox="0 0 fullW fullH"`, `width=fullW`, `height=fullH` (byte-identical to
    today's no-crop output — **keep the existing compositor tests green**).
  - **Padding is NOT re-added** around the crop; the crop is a window of the already-padded
    frame. This is the whole point.
- **Annotations stay shot-relative** (unchanged: `a.x*naturalW`, `translate(pad,pad)`). Only
  `crop` changes coordinate space (to frame-relative). Two independent spaces — fine.

This is *simpler* than the current base-offset approach: revert the `baseX/baseY/offX/offY`
shifting and the `rc`/`rcLocal` crop-window rects back to their no-crop forms, and add the
viewBox window instead.

## 3. Rework plan (module by module, TDD)

### 3.1 `annotations/scene.ts`
- `CropRect` stays `{x,y,w,h}`. Update the JSDoc: "normalized 0–1 of the beautified **frame**
  (bg+padding+shot), not the base image." `FULL_CROP`, `sameScene` unchanged.

### 3.2 `annotations/crop.ts` (pure helpers) — mostly unchanged
- `clampCrop`, `moveCrop`, `isFullCrop`, `cropHandles`, `hitCropHandle`, `resizeCrop` still
  operate on a normalized box — they don't care whether it's image- or frame-normalized. Keep.
- These are unit-tested in `crop.test.ts` (keep).

### 3.3 `annotations/compositor.ts` (+ `compositor.test.ts`) — the core change
- In `buildSvg`: **remove** the crop-window base-offset logic (`offX/offY/baseX/baseY`, the
  crop-sized `rc`/`rcLocal`/shadow/bg). Restore the base `<use href="#shot" x="pad" y="pad"
  clip-path="url(#rc)"/>`, `rc = rect(pad,pad,naturalW,naturalH,rx)`, `rcLocal =
  rect(0,0,naturalW,naturalH,rx)`, shadow/bg at full `fullW/fullH` — i.e. the **pre-crop** frame.
- Compute `fullW = naturalW + 2*pad`, `fullH = naturalH + 2*pad`.
- Derive the window from `scene.crop`:
  ```ts
  const c = scene.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const vbX = c.x * fullW, vbY = c.y * fullH, vbW = c.w * fullW, vbH = c.h * fullH;
  ```
  Output `<svg width="${vbW}" height="${vbH}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" ...>`.
  (Round vbW/vbH for the raster size in `compositeScene`.)
- `compositeScene`: `frameW/frameH` passed to `rasterize` become the **cropped** output size
  `round(c.w*fullW) × round(c.h*fullH)` (full when no crop). Keep `scale`/`pad` as today
  (`scale = displayedW>0 ? naturalW/displayedW : 1`). NOTE: `Geom.frameW/frameH` were already
  "dead" (buildSvg recomputes) — this rework is a good moment to make buildSvg own all frame
  math and either drop those fields or keep them consistent.
- **Tests:** keep the no-crop cases (byte-identical). Add: a frame-relative crop → correct
  `viewBox` + output `width/height`; a crop that spans into the padding (e.g. `x:0,y:0,w:0.5,h:1`
  with padding>0) → viewBox starts at 0 and includes the padding strip; **3:4→square**: given a
  3:4 shot + padding chosen so `fullW==fullH` isn't required — assert a square crop
  (`w*fullW == h*fullH`) yields a square output.

### 3.4 `beautify/beautified-frame.tsx` (+ `.module.css`) — window the FRAME, not the shot
- Current code windows the **shot** via an image-plane inside `.shotWrap`. Change it to window
  the **whole `.frame`**: the `.frame` (bg+padding+shot+overlay) becomes the "plane"; wrap it in
  a viewport that clips to the crop sub-rect of the frame.
  - Viewport aspect = `(crop.w*fullW)/(crop.h*fullH)`. `fullW/fullH` come from the frame's
    displayed size (measure the `.frame` element, or compute from the shot's natural aspect +
    padding). Simplest: measure the `.frame` bounding box with a ResizeObserver and derive.
  - Plane = the `.frame` at full size, `width: ${100/crop.w}%`, `left: ${-100*crop.x/crop.w}%`
    (same for y), inside `overflow:hidden` viewport.
- The annotation overlay stays inside the shot as today; it scales with the frame, so
  annotations remain aligned.
- **Windowing only applies when the crop tool is INACTIVE** (owner edits the crop over the full
  frame). Editor passes the applied crop only when `tools.tool !== "crop"` (see §3.6).
- ⚠️ Re-check the "viewport collapses to 0×0" risk (a prior review flagged it; the owner didn't
  hit it, but the frame-level viewport must get a definite size — measure-based sizing is safest).

### 3.5 Crop overlay + interaction — MOVE from `AnnotationLayer` to a frame-level overlay
- **Remove** all crop code from `annotations/annotation-layer.tsx`: the `Drag` crop modes
  (`crop-draw/move/resize`), the `onPointerDown/Move/Up`/abort crop branches, the Esc-crop
  handler, `CropOverlay`, `cropRect`, `toolRef`, and the crop imports. AnnotationLayer goes back
  to shot-only (select/pen/box/arrow/text/blur).
- **Add** a new `beautify/crop-overlay.tsx` (or `annotations/crop-tool-overlay.tsx`) rendered
  over the **`.frame`** (inside `BeautifiedFrame`, or as a sibling absolutely positioned over the
  frame) when the crop tool is active. It:
  - measures the frame's displayed size (its own `inset:0` box = the frame),
  - renders the dim mask (4 rects outside the crop) + the crop rect + 8 handles, in
    **frame-normalized** coords,
  - handles pointer down/move/up: hit a handle → `resizeCrop`; inside an existing crop → `moveCrop`;
    empty → `crop-draw` (with the `CROP_DRAW_MIN` guard); commits via `beginInteract` →
    `setCropLive` → `endInteract` (one undo step per drag),
  - Esc → `setCrop(undefined)` (abort in-progress drag first — see the already-fixed logic in git
    history, commit `dba897e`, to reuse the same guards),
  - normalizes a full-frame result to `undefined` on release via `isFullCrop`.
- Reuse `crop.ts` (`cropHandles/hitCropHandle/resizeCrop/moveCrop/clampCrop/isFullCrop`) — the box
  math is identical; only the measured element (frame vs shot) changes.

### 3.6 `pages/screenshot-editor/screenshot-editor-page.tsx`
- `exportPng`: keep passing `crop: scene.crop` (now frame-relative) to `compositeScene`.
- Pass the applied crop to `BeautifiedFrame` only when the crop tool is inactive:
  `crop={tools.tool === "crop" ? undefined : scene.crop}` (already there).
- Render the new frame-level crop overlay when `tools.tool === "crop"` (wire
  `scene`/`beginInteract`/`setCropLive`/`endInteract`/`setCrop`).

### 3.7 Tests
- `crop.test.ts` — keep.
- `compositor.test.ts` — no-crop unchanged; add frame-relative viewBox cases + 3:4→square + a
  crop that includes padding.
- `use-editor-scene.test.ts` — `setCrop/setCropLive/undo` (keep).
- Remove/rewrite any AnnotationLayer crop expectations if present (crop leaves that file).
- The pointer path of the new overlay isn't unit-testable in jsdom (layout is 0) — cover the pure
  geometry (`crop.ts`, compositor) and validate interaction manually.

## 4. Current state (what exists on the branch)

- Feature built via subagent-driven execution. Commits (newest first) include:
  `dba897e` code-review fixes (crop interaction: draw-a-fresh-rect, isFullCrop normalize, Esc
  abort, Reset-disabled, min-width:0 on `.plane`); `9e54f18` fresh captures open plain
  (DEFAULT_BEAUTIFY = transparent + 0/0/0); Tasks `c569e94`..`d5d0134`; docs specs/plans.
- **Design spec:** `apps/documentation/src/content/docs/specs/2026-06-30-screenshot-crop-design.md`
  (describes the OLD image-relative model — now superseded by this doc for the coordinate space).
- **Original impl plan:** `apps/documentation/.../plans/2026-07-01-screenshot-crop-tool.md`.
- **Backlog:** `backlog/screenshot-crop.md` (🟢), `backlog/index.mdx` row.
- Everything currently green: `bun run typecheck`, `bunx vitest run` (~374), `oxlint` clean.

## 5. Already-fixed review findings (DON'T redo)

From the high-effort review (commit `dba897e`): draw-a-fresh-rect when no crop; normalize
full→undefined (`isFullCrop` now used); ignore click/tiny twitch in crop-draw (`CROP_DRAW_MIN`);
Esc aborts the in-progress drag; Reset disabled without a crop; Reset accessible name is Spanish
("Restablecer"); `.plane` has `min-width/height:0`. **Reuse these behaviors in the new frame-level
overlay** — most of the logic ports over directly (the geometry space changes from shot to frame).

## 6. Verified-correct, do NOT "fix" (they were refuted in review)

- Compositor SVG **clip coordinate space** (`rcLocal` at local group coords) is correct — the
  annotation group's clip is in local post-transform space, consistent with the validated v2 blur.
  (In the rework the crop-window rects go away anyway; keep `rc/rcLocal` in their no-crop forms.)
- Handle hit tolerance is fine (crop is edited in the non-windowed view).

## 7. Deferred follow-ups (non-blocking)

Aspect-ratio locks (Free / 16:9 / 1:1); `sameScene` reference-equality no-op drags push a history
entry (shared with move/resize); export beautify `scale` depends on the active tool at Save time;
`Geom.frameW/frameH` dead fields (the rework can resolve this by letting `buildSvg` own frame math).

## 8. Workflow & conventions (must follow)

- **Run tests/typecheck from `apps/kaipu-record`:** `bunx vitest run <path>`, `bun run typecheck`.
  Full suite: `bunx vitest run`. Lint: `bunx oxlint src/renderer/src/features/screenshots`.
- **Format before every commit:** `bun run format:tracked` from the **repo root** (there is no
  such script in the app package). Then commit with **`git commit --no-verify`** (oxfmt pre-commit
  churn hold — `--no-verify` is expected and correct).
- **Code + comments in English**; **user-facing copy in neutral Spanish (no voseo)**. Tool labels
  in the toolbar are currently English (Select/Pen/…/Crop) — keep consistent.
- **No TS enums** — `as const` arrays + `(typeof x)[number]`.
- **Git:** branch `feat/screenshot-crop`. Push with the **`csdev19`** gh account
  (`gh auth switch --user csdev19` before any `gh` command — the repo remote uses the
  `github-personal` SSH host). PR #15 is already open; new commits land on the same branch/PR.
- **Docs live in `apps/documentation`** (Starlight). Update `backlog/screenshot-crop.md` if the
  model/behavior changes.
- The owner **manually reviews every finished feature in the running build** before merge — expect
  iteration; "done" ≠ merge-ready. Validate the 3:4→square case and crop-into-padding with them.

## 9. First steps on resume

1. Read this doc. Confirm branch `feat/screenshot-crop` is checked out and clean.
2. Start with the **compositor** (§3.3): switch to full-frame + viewBox window, keep no-crop
   byte-identical, add the frame-relative + 3:4→square + padding-inclusive tests. Commit.
3. Then the **frame-level crop overlay** (§3.5) + remove crop from `AnnotationLayer`. Commit.
4. Then **BeautifiedFrame** windowing the frame (§3.4). Commit.
5. Wire the editor page (§3.6). Typecheck + full suite + lint. Commit.
6. Hand to the owner to validate in the build (3:4→square, crop into padding, save/overwrite,
   re-open). Then update the PR.
