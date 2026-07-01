---
title: "Screenshot crop tool — implementation plan"
description: "Task-by-task TDD plan for the non-destructive crop tool: crop scene field, pure crop helpers reusing handles.ts, crop-aware compositor export, BeautifiedFrame image-plane windowing, and the crop-tool interaction in the annotation layer."
---

# Screenshot crop tool — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-destructive Crop tool to the screenshot editor — drag a rectangle to
keep only that region, undoable and re-adjustable, exporting at native pixels.

**Architecture:** `crop` is an optional normalized rect on the `Scene`. The annotation
coordinate system stays invariant (annotations remain normalized to the full image); the
crop is a viewport. Live preview windows via a transform wrapper in `BeautifiedFrame`; the
compositor windows the export via clip + offset. The crop-rect editing reuses the existing
`handles.ts` geometry through a thin box adapter (`crop.ts`), and commits like a resize
(one undoable step per drag). While the crop tool is active the frame shows the full image
with a dim overlay; leaving the tool shows the windowed result.

**Tech Stack:** React + TypeScript, SVG overlay, CSS Modules, Vitest (jsdom + node),
mediabunny (unrelated here). Run commands from `apps/kaipu-record`.

**Conventions:** commit with `--no-verify` (oxfmt churn hold); run `bun run format:tracked`
from the repo root before each commit; no TS enums; code/comments in English. Branch:
`feat/screenshot-crop` (already checked out; the design spec + a docs fix are already
committed on it).

---

## File structure

- **Create** `src/renderer/src/features/screenshots/annotations/crop.ts` — pure crop
  helpers: `FULL_CROP` re-export, `isFullCrop`, `clampCrop`, `moveCrop`, and box-adapter
  wrappers over `handles.ts` (`cropHandles`, `hitCropHandle`, `resizeCrop`).
- **Create** `src/renderer/src/features/screenshots/annotations/crop.test.ts`.
- **Modify** `annotations/scene.ts` — `CropRect`, `Scene.crop`, `FULL_CROP`, `sameScene`.
- **Modify** `annotations/use-editor-scene.ts` — `crop`, `setCrop`, `setCropLive`.
- **Modify** `annotations/tools.ts` — add `"crop"` to `ANNOTATION_TOOLS`.
- **Modify** `annotations/annotation-toolbar.tsx` — Crop icon in `TOOL_META`.
- **Modify** `annotations/compositor.ts` (+ `compositor.test.ts`) — crop-aware export.
- **Modify** `beautify/beautified-frame.tsx` (+ `.module.css`) — `crop` prop + windowing.
- **Modify** `annotations/annotation-layer.tsx` — crop-tool interaction + dim overlay.
- **Modify** `annotations/annotation-options.tsx` (+ `.module.css`) — crop hint + Reset.
- **Modify** `pages/screenshot-editor/screenshot-editor-page.tsx` — pass `crop` to frame +
  export; window only when the crop tool is inactive.
- **Modify** docs: `backlog/screenshot-crop.md` (→ 🟢) + `backlog/index.mdx` row.

---

## Task 1: Scene model — `crop` field

**Files:**
- Modify: `src/renderer/src/features/screenshots/annotations/scene.ts`
- Test: `src/renderer/src/features/screenshots/annotations/scene.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `scene.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FULL_CROP, sameScene, type Scene } from "./scene";

const base: Scene = { beautify: {} as Scene["beautify"], annotations: [] };

describe("sameScene with crop", () => {
  it("is true when crop is the same reference (or both unset)", () => {
    expect(sameScene(base, base)).toBe(true);
  });
  it("is false when crop changes", () => {
    const cropped: Scene = { ...base, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } };
    expect(sameScene(base, cropped)).toBe(false);
    expect(sameScene(cropped, { ...cropped, crop: { ...cropped.crop! } })).toBe(false);
  });
  it("FULL_CROP is the whole image", () => {
    expect(FULL_CROP).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/scene.test.ts`
Expected: FAIL — `FULL_CROP` / `crop` not exported.

- [ ] **Step 3: Implement**

In `scene.ts`, add the interface, the field, the constant, and extend `sameScene`:

```ts
/** A crop window over the base image, normalized 0–1. Undefined = full image. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
```

Add `crop?: CropRect;` to the `Scene` interface (after `annotations`).

Extend `sameScene`:

```ts
export function sameScene(a: Scene, b: Scene): boolean {
  return (
    a.beautify === b.beautify && a.annotations === b.annotations && a.crop === b.crop
  );
}
```

Add near `nextAnnotationId`:

```ts
/** The default crop: the whole image (used as the starting rect for the crop tool). */
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/scene.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/kaipu-record/src/renderer/src/features/screenshots/annotations/scene.ts \
        apps/kaipu-record/src/renderer/src/features/screenshots/annotations/scene.test.ts
git commit --no-verify -m "feat(screenshots): add crop field to the editor scene"
```

---

## Task 2: Pure crop helpers (`crop.ts`)

Reuse `handles.ts` (already: `handlesFor`, `hitHandle`, `resizeAnnotation`, `type HandleId`,
`type Handle`, `type Pt`, `type Size`) through a box adapter, and add clamping.

**Files:**
- Create: `src/renderer/src/features/screenshots/annotations/crop.ts`
- Test: `src/renderer/src/features/screenshots/annotations/crop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { clampCrop, cropHandles, hitCropHandle, isFullCrop, moveCrop, resizeCrop } from "./crop";
import type { CropRect } from "./scene";

const size = { w: 1000, h: 1000 };
const c: CropRect = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

describe("isFullCrop", () => {
  it("is true for the whole image (within epsilon)", () => {
    expect(isFullCrop({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.0005, y: 0, w: 0.9996, h: 1 })).toBe(true);
  });
  it("is false for a real crop", () => {
    expect(isFullCrop(c)).toBe(false);
  });
});

describe("clampCrop", () => {
  it("keeps a valid crop unchanged", () => {
    expect(clampCrop(c)).toEqual(c);
  });
  it("clamps into [0,1] and enforces a min size", () => {
    const out = clampCrop({ x: -0.5, y: 0.9, w: 2, h: 0.0001 });
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.x + out.w).toBeLessThanOrEqual(1.0001);
    expect(out.h).toBeGreaterThan(0);
  });
});

describe("moveCrop", () => {
  it("translates and clamps so the rect stays inside the canvas", () => {
    const out = moveCrop(c, 0.9, 0); // would push right edge past 1
    expect(out.x + out.w).toBeCloseTo(1);
    expect(out.w).toBeCloseTo(c.w); // size preserved
  });
  it("clamps the near edge at zero", () => {
    const out = moveCrop(c, -0.9, -0.9);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(0);
  });
});

describe("cropHandles / resizeCrop / hitCropHandle (box adapter over handles.ts)", () => {
  it("exposes 8 handles", () => {
    expect(cropHandles(c, size)).toHaveLength(8);
  });
  it("resizes via the se corner and clamps to the canvas", () => {
    const out = resizeCrop(c, "se", { x: 0.9, y: 0.9 }, size);
    expect(out.w).toBeCloseTo(0.7);
    expect(out.h).toBeCloseTo(0.7);
  });
  it("finds the handle under the point", () => {
    // se corner at (0.6, 0.6)
    expect(hitCropHandle(c, { x: 0.605, y: 0.598 }, { x: 0.02, y: 0.02 }, size)).toBe("se");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/crop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `crop.ts`**

```ts
/**
 * Pure crop-rect helpers. A crop is a normalized box; its editing (resize/move) reuses
 * the annotation resize geometry in `handles.ts` through a box adapter, so there's one
 * source of truth for handle math. All values are 0–1 of the base image.
 */

import { handlesFor, hitHandle, resizeAnnotation, type Handle, type HandleId, type Pt, type Size } from "./handles";
import { FULL_CROP, type CropRect } from "./scene";

const MIN = 0.02; // smallest crop side (2% of the image) so it can't collapse
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** True when the crop covers (essentially) the whole image. */
export function isFullCrop(c: CropRect): boolean {
  const e = 0.001;
  return c.x <= e && c.y <= e && c.w >= 1 - e && c.h >= 1 - e;
}

/** Clamp a crop into the canvas with a minimum size. */
export function clampCrop(c: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN, c.w));
  const h = Math.min(1, Math.max(MIN, c.h));
  const x = Math.min(1 - w, Math.max(0, c.x));
  const y = Math.min(1 - h, Math.max(0, c.y));
  return { x, y, w, h };
}

/** Translate a crop by (dx,dy), keeping it fully inside the canvas (size preserved). */
export function moveCrop(c: CropRect, dx: number, dy: number): CropRect {
  const x = Math.min(1 - c.w, Math.max(0, c.x + dx));
  const y = Math.min(1 - c.h, Math.max(0, c.y + dy));
  return { x, y, w: c.w, h: c.h };
}

/** Wrap a crop as a box-shaped annotation so `handles.ts` can operate on it. */
function asBox(c: CropRect) {
  return { id: "crop", kind: "box", x: c.x, y: c.y, w: c.w, h: c.h, color: "#000", stroke: 0, seed: 0 } as const;
}

/** The 8 resize handles for a crop rect. */
export function cropHandles(c: CropRect, size: Size): Handle[] {
  return handlesFor(asBox(c), size);
}

/** The handle under a point, or null. */
export function hitCropHandle(c: CropRect, p: Pt, tol: Pt, size: Size): HandleId | null {
  return hitHandle(cropHandles(c, size), p, tol);
}

/** Resize a crop by dragging `handle` to point `p`, clamped to the canvas. */
export function resizeCrop(c: CropRect, handle: HandleId, p: Pt, size: Size): CropRect {
  // resizeAnnotation returns Partial<Annotation> (a union partial); for a box it is
  // {x,y,w,h}. Read it through an explicit shape so the union types don't fight us.
  const patch = resizeAnnotation(asBox(c), handle, p, size) as unknown as {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  };
  return clampCrop({ x: patch.x ?? c.x, y: patch.y ?? c.y, w: patch.w ?? c.w, h: patch.h ?? c.h });
}

export { FULL_CROP };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/crop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/kaipu-record/src/renderer/src/features/screenshots/annotations/crop.ts \
        apps/kaipu-record/src/renderer/src/features/screenshots/annotations/crop.test.ts
git commit --no-verify -m "feat(screenshots): pure crop-rect helpers reusing handles.ts"
```

---

## Task 3: Scene controller — `crop`, `setCrop`, `setCropLive`

**Files:**
- Modify: `src/renderer/src/features/screenshots/annotations/use-editor-scene.ts`
- Test: `src/renderer/src/features/screenshots/annotations/use-editor-scene.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing test file)

```ts
import { act, renderHook } from "@testing-library/react";
import { useEditorScene } from "./use-editor-scene";

it("setCrop commits an undoable crop change", () => {
  const { result } = renderHook(() => useEditorScene());
  act(() => result.current.setCrop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }));
  expect(result.current.crop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  expect(result.current.canUndo).toBe(true);
  act(() => result.current.undo());
  expect(result.current.crop).toBeUndefined();
});

it("setCropLive updates without pushing history; endInteract commits once", () => {
  const { result } = renderHook(() => useEditorScene());
  act(() => {
    result.current.beginInteract();
    result.current.setCropLive({ x: 0, y: 0, w: 0.8, h: 0.8 });
    result.current.setCropLive({ x: 0, y: 0, w: 0.6, h: 0.6 });
    result.current.endInteract();
  });
  expect(result.current.crop).toEqual({ x: 0, y: 0, w: 0.6, h: 0.6 });
  expect(result.current.canUndo).toBe(true);
  act(() => result.current.undo());
  expect(result.current.crop).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/use-editor-scene.test.ts`
Expected: FAIL — `setCrop` / `setCropLive` / `crop` missing.

- [ ] **Step 3: Implement**

Add to the `EditorScene` interface:

```ts
  crop?: CropRect;
  /** Set the crop as one undoable change (Reset/Esc, or an external set). */
  setCrop(crop: CropRect | undefined): void;
  /** Live crop update during a drag (no history); pair with beginInteract/endInteract. */
  setCropLive(crop: CropRect | undefined): void;
```

Import `CropRect`:

```ts
import { sameScene, type Annotation, type CropRect, type Scene } from "./scene";
```

Add the callbacks (near `commitAnnotation`):

```ts
  const setCrop = useCallback(
    (crop: CropRect | undefined) => {
      commit({ ...sceneRef.current, crop });
    },
    [commit],
  );

  const setCropLive = useCallback((crop: CropRect | undefined) => {
    setScene((s) => ({ ...s, crop }));
  }, []);
```

Return them + `crop: scene.crop` in the returned object.

**Also update the `EditorScene` mocks in other test files** — `setCrop`/`setCropLive`/`crop`
are now part of the interface, so every hand-built `EditorScene` mock must include them or
typecheck breaks. In `annotation-options.test.tsx` and `annotation-layer.test.tsx`, add to
the `makeScene` return object:

```ts
    crop: undefined,
    setCrop: vi.fn(),
    setCropLive: vi.fn(),
```

- [ ] **Step 4: Run test to verify it passes** (and typecheck the mocks)

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/use-editor-scene.test.ts && cd apps/kaipu-record && bun run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/kaipu-record/src/renderer/src/features/screenshots/annotations/use-editor-scene.ts \
        apps/kaipu-record/src/renderer/src/features/screenshots/annotations/use-editor-scene.test.ts
git commit --no-verify -m "feat(screenshots): crop state + setCrop/setCropLive in the scene controller"
```

---

## Task 4: Crop tool in the toolbar

**Files:**
- Modify: `annotations/tools.ts`
- Modify: `annotations/annotation-toolbar.tsx`
- Test: `annotations/annotation-toolbar.test.tsx`

- [ ] **Step 1: Update the toolbar test count**

Open `annotation-toolbar.test.tsx`. The existing test renders the tools and asserts a
count. Update it to expect the crop tool present:

```ts
it("renders every tool including crop", () => {
  render(<AnnotationToolbar tools={makeTools()} />);
  expect(screen.getByRole("button", { name: "Crop" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/annotation-toolbar.test.tsx`
Expected: FAIL — no "Crop" button.

- [ ] **Step 3: Implement**

In `tools.ts`:

```ts
export const ANNOTATION_TOOLS = ["select", "pen", "box", "arrow", "text", "blur", "crop"] as const;
```

In `annotation-toolbar.tsx`, import `Crop` from lucide-react and add to `TOOL_META`:

```ts
import { ArrowUpRight, Crop, Droplet, MousePointer2, Pencil, Square, Type } from "lucide-react";
```

```ts
  crop: { label: "Crop", Icon: Crop },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/annotation-toolbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/kaipu-record/src/renderer/src/features/screenshots/annotations/tools.ts \
        apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-toolbar.tsx \
        apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-toolbar.test.tsx
git commit --no-verify -m "feat(screenshots): add the crop tool to the toolbar"
```

---

## Task 5: Crop-aware export (compositor)

The compositor must window the export. Keep the unset-crop path byte-identical.

**Files:**
- Modify: `annotations/compositor.ts`
- Test: `annotations/compositor.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `compositor.test.ts`)

```ts
it("windows the export to the crop at native pixels", () => {
  // crop = middle half in each axis of a 1000x600 image
  const cropped = { ...scene([]), crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };
  const svg = buildSvg(cropped, geom);
  // frame = cw+2pad x ch+2pad = 500+80 x 300+80 = 580 x 380
  expect(svg).toContain('width="580" height="380"');
  // base is shifted left/up by crop offset (0.25*1000=250, 0.25*600=150), plus pad(40)
  expect(svg).toContain('<use href="#shot" x="-210" y="-110"');
});

it("leaves the export unchanged when there is no crop", () => {
  const svg = buildSvg(scene([]), geom);
  // full frame 1080x680, base at (pad,pad)=(40,40)
  expect(svg).toContain('width="1080" height="680"');
  expect(svg).toContain('<use href="#shot" x="40" y="40"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/compositor.test.ts`
Expected: FAIL — current base `<use>` is always `x="40" y="40"` and frame is always full.

- [ ] **Step 3: Implement**

`buildSvg` derives the crop window from `scene.crop` + `g.naturalW/H` (NOT from `Geom` — so
a direct `buildSvg(scene, geom)` call reflects the crop). It computes its own `frameW/frameH`
from the crop; `compositeScene` computes the same values for the raster canvas. `Geom` is
UNCHANGED (still carries `frameW/frameH` for `rasterize`; `buildSvg` recomputes them).

In `compositeScene`, size the frame from the crop before rasterizing. Replace the
`frameW/frameH` computation:

```ts
  const c = scene.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const frameW = Math.round(c.w * naturalW) + pad * 2;
  const frameH = Math.round(c.h * naturalH) + pad * 2;
```

(Keep passing `frameW, frameH` into the `buildSvg` geom and into `rasterize(svg, frameW,
frameH)` exactly as today.)

In `buildSvg`, add the crop derivation right after `const paint = ...` / the `defs` setup,
before the `rc` clip push:

```ts
  const c = scene.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const cropW = Math.round(c.w * g.naturalW);
  const cropH = Math.round(c.h * g.naturalH);
  const offX = Math.round(c.x * g.naturalW);
  const offY = Math.round(c.y * g.naturalH);
  const frameW = cropW + g.pad * 2; // computed here (ignores g.frameW), stays consistent
  const frameH = cropH + g.pad * 2;
  const baseX = g.pad - offX; // shift the shared image so the crop window sits at (pad,pad)
  const baseY = g.pad - offY;
```

Change the `rc` clip rect (currently `width=naturalW height=naturalH`) to the crop window:

```ts
  defs.push(
    `<clipPath id="rc"><rect x="${g.pad}" y="${g.pad}" width="${cropW}" height="${cropH}" rx="${g.radius}"/></clipPath>`,
  );
```

Change the `rcLocal` clip (currently `x=0 y=0 width=naturalW height=naturalH`) to the crop
window in the annotation-group's local (shifted) space:

```ts
  defs.push(
    `<clipPath id="rcLocal"><rect x="${offX}" y="${offY}" width="${cropW}" height="${cropH}" rx="${g.radius}"/></clipPath>`,
  );
```

Change the outer background rect + shadow rect + base `<use>` + annotation group to use the
local `frameW/frameH`, `cropW/cropH`, and the base shift. In the block that builds `bg`,
`shadow`, `image`, `anno`:

```ts
  const bg =
    bgFill === "none"
      ? ""
      : `<rect width="${frameW}" height="${frameH}" rx="${outerR}" fill="${bgFill}"/>`;
  const shadow =
    sv > 0
      ? `<rect x="${g.pad}" y="${g.pad}" width="${cropW}" height="${cropH}" rx="${g.radius}" fill="#000" filter="url(#sh)"/>`
      : "";
  const image = `<use href="#shot" x="${baseX}" y="${baseY}" clip-path="url(#rc)"/>`;
  const anno = `<g transform="translate(${baseX},${baseY})" clip-path="url(#rcLocal)">${scene.annotations
    .map((a) => annotationSvg(a, g.naturalW, g.naturalH, g.scale))
    .join("")}</g>`;
```

And the outer `<svg>` open tag must use the local `frameW/frameH`:

```ts
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frameW}" height="${frameH}" viewBox="0 0 ${frameW} ${frameH}"><defs>${defs.join("")}</defs>${bg}${shadow}${image}${anno}</svg>`;
```

Verify: with no crop, `cropW=naturalW`, `offX=0`, `frameW=naturalW+2pad` → the output is
byte-identical to today (base `<use x="pad" y="pad">`, frame `1080×680`).

- [ ] **Step 4: Run tests to verify they pass** (and the whole compositor suite)

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/compositor.test.ts`
Expected: PASS — including the pre-existing "embeds once", blur, and text cases.

- [ ] **Step 5: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/kaipu-record/src/renderer/src/features/screenshots/annotations/compositor.ts \
        apps/kaipu-record/src/renderer/src/features/screenshots/annotations/compositor.test.ts
git commit --no-verify -m "feat(screenshots): window the export to the crop at native pixels"
```

---

## Task 6: Live-preview windowing in `BeautifiedFrame`

Show only the crop window (with padding around it) when a crop is applied. Keep the
annotation coordinate system invariant: the `<img>` + `overlay` live in a full-image
"plane" scaled/offset inside a clipping "viewport".

**Files:**
- Modify: `beautify/beautified-frame.tsx`
- Modify: `beautify/beautified-frame.module.css`

- [ ] **Step 1: Add the `crop` prop + windowing markup**

Replace the component body of `beautified-frame.tsx`:

```tsx
import React, { useState } from "react";
import { backgroundCss, frameRadius, shadowCss, type BeautifyState } from "./backgrounds";
import type { CropRect } from "../annotations/scene";
import styles from "./beautified-frame.module.css";

export function BeautifiedFrame({
  src,
  beautify,
  overlay,
  imgRef,
  zoom = 1,
  crop,
  onImageLoad,
}: {
  src: string;
  beautify: BeautifyState;
  overlay?: React.ReactNode;
  imgRef?: React.Ref<HTMLImageElement>;
  zoom?: number;
  /** Applied crop window (normalized). Undefined = full image. */
  crop?: CropRect;
  onImageLoad?: () => void;
}): React.JSX.Element {
  const [aspect, setAspect] = useState<number | null>(null); // natural W/H

  const windowed = crop != null && aspect != null;
  // Viewport aspect = cropped pixel aspect = (crop.w*W)/(crop.h*H) = (crop.w*aspect)/crop.h.
  const viewportAspect = windowed ? (crop.w * aspect!) / crop.h : undefined;
  const planeStyle: React.CSSProperties = windowed
    ? {
        position: "absolute",
        width: `${100 / crop.w}%`,
        height: `${100 / crop.h}%`,
        left: `${(-100 * crop.x) / crop.w}%`,
        top: `${(-100 * crop.y) / crop.h}%`,
      }
    : { position: "relative" };

  return (
    <div
      className={styles.frame}
      style={{
        background: backgroundCss(beautify.bg),
        padding: `${beautify.padding}px`,
        borderRadius: `${frameRadius(beautify.bg, beautify.radius)}px`,
        transform: zoom === 1 ? undefined : `scale(${zoom})`,
      }}
    >
      <div
        className={windowed ? styles.viewport : styles.shotWrap}
        style={windowed ? { aspectRatio: `${viewportAspect}` } : undefined}
      >
        <div className={styles.plane} style={planeStyle}>
          <img
            ref={imgRef}
            src={src}
            alt="Screenshot"
            className={styles.shot}
            style={{ borderRadius: `${beautify.radius}px`, boxShadow: shadowCss(beautify.shadow) }}
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalHeight > 0) setAspect(el.naturalWidth / el.naturalHeight);
              onImageLoad?.();
            }}
          />
          {overlay}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the viewport/plane CSS**

Append to `beautified-frame.module.css`:

```css
/* Crop windowing: the viewport clips to the crop's aspect; the plane holds the full
 * image (and the annotation overlay) scaled + offset so only the crop shows. The
 * annotation layer measures the plane, so its coordinates stay full-image-normalized. */
.viewport {
  position: relative;
  overflow: hidden;
  max-width: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
}

.plane {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* In the windowed case the img fills the plane; in the full case it keeps max-100% fit. */
.viewport .plane .shot {
  width: 100%;
  height: 100%;
}
```

Note: in the non-windowed case the existing `.shotWrap` + `.shot` rules still apply and the
`.plane` wrapper is `position: relative` with the img at its natural fit — identical layout
to before (the extra `.plane` div is display-flex, contents-sized).

- [ ] **Step 3: Manual smoke (no unit test — layout)**

There's no jsdom test for layout (getBoundingClientRect is 0). Verify by typecheck now and
in-app later:

Run: `cd apps/kaipu-record && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/kaipu-record/src/renderer/src/features/screenshots/beautify/beautified-frame.tsx \
        apps/kaipu-record/src/renderer/src/features/screenshots/beautify/beautified-frame.module.css
git commit --no-verify -m "feat(screenshots): window the live preview to the crop"
```

---

## Task 7: Crop-tool interaction in `AnnotationLayer`

While the crop tool is active: render a dim overlay + the crop rect + 8 handles over the
FULL image (the frame passes `crop=undefined` while cropping — see Task 9). Editing the
rect uses the live-commit pattern (beginInteract → setCropLive → endInteract), one undoable
step per drag. Esc resets to full.

**Files:**
- Modify: `annotations/annotation-layer.tsx`

- [ ] **Step 1: Imports + the crop rect being edited**

Add imports:

```ts
import { cropHandles, hitCropHandle, moveCrop, resizeCrop } from "./crop";
import { FULL_CROP, nextAnnotationId, type Annotation, type CropRect } from "./scene";
```

(Replace the existing `./scene` import line — it currently imports `nextAnnotationId` +
`type Annotation` — with the line above, adding `FULL_CROP` and `type CropRect`.)

Extend the `Drag` union with crop modes:

```ts
type Drag =
  | { mode: "draw-box" | "draw-arrow" | "draw-pen" | "draw-blur"; start: Pt }
  | { mode: "move"; id: string; start: Pt; orig: Annotation }
  | { mode: "resize"; id: string; handle: HandleId; orig: Annotation }
  | { mode: "crop-draw"; start: Pt }
  | { mode: "crop-move"; start: Pt; orig: CropRect }
  | { mode: "crop-resize"; handle: HandleId; orig: CropRect };
```

Add near the top of the component, after `size`:

```ts
  // The crop rect being edited = the scene crop, or the full image if none yet.
  const cropRect = scene.crop ?? FULL_CROP;
```

- [ ] **Step 2: Pointer-down for the crop tool**

In `onPointerDown`, add a branch BEFORE the `tools.tool === "select"` branch:

```ts
    if (tools.tool === "crop") {
      const tol = { x: HANDLE_HIT_PX / (size.w || 1), y: HANDLE_HIT_PX / (size.h || 1) };
      const handle = hitCropHandle(cropRect, p, tol, size);
      scene.beginInteract();
      if (handle) {
        drag.current = { mode: "crop-resize", handle, orig: cropRect };
      } else if (
        p.x >= cropRect.x && p.x <= cropRect.x + cropRect.w &&
        p.y >= cropRect.y && p.y <= cropRect.y + cropRect.h
      ) {
        drag.current = { mode: "crop-move", start: p, orig: cropRect };
      } else {
        // Start a fresh rect from this corner.
        drag.current = { mode: "crop-draw", start: p };
      }
      ref.current?.setPointerCapture(e.pointerId);
      return;
    }
```

- [ ] **Step 3: Pointer-move for the crop tool**

In `onPointerMove`, add branches after the `resize` branch:

```ts
    if (d.mode === "crop-resize") {
      scene.setCropLive(resizeCrop(d.orig, d.handle, p, size));
      return;
    }
    if (d.mode === "crop-move") {
      scene.setCropLive(moveCrop(d.orig, p.x - d.start.x, p.y - d.start.y));
      return;
    }
    if (d.mode === "crop-draw") {
      const x = Math.min(d.start.x, p.x);
      const y = Math.min(d.start.y, p.y);
      scene.setCropLive({ x, y, w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) });
      return;
    }
```

- [ ] **Step 4: Pointer-up + abort for the crop tool**

In `onPointerUp`, extend the move/resize commit condition:

```ts
    if (d.mode === "move" || d.mode === "resize" || d.mode === "crop-resize" || d.mode === "crop-move" || d.mode === "crop-draw") {
      scene.endInteract();
      return;
    }
```

In `onPointerAbort`, extend likewise:

```ts
    if (d?.mode === "move" || d?.mode === "resize" || d?.mode?.startsWith("crop-")) scene.endInteract();
```

- [ ] **Step 5: Esc resets the crop to full**

In the window `keydown` effect, add before the Delete/Backspace handling:

```ts
      if (e.key === "Escape" && sceneRef.current.crop) {
        // Only when the crop tool is the active context; guard via a ref set below.
        e.preventDefault();
        sceneRef.current.setCrop(undefined);
        return;
      }
```

Because the keydown effect can't see `tools.tool` (it subscribes once), gate it with a ref.
Add near `sceneRef`:

```ts
  const toolRef = useRef(tools.tool);
  toolRef.current = tools.tool;
```

and change the Escape guard to `if (e.key === "Escape" && toolRef.current === "crop" && sceneRef.current.crop)`.

- [ ] **Step 6: Render the crop overlay**

Add a `CropOverlay` render inside the `<svg>`, after the draft Shape and before/after the
selection `Handles`. Only when the crop tool is active:

```tsx
        {tools.tool === "crop" && <CropOverlay crop={cropRect} size={size} />}
```

Add the component next to `Handles`:

```tsx
/** Dim mask outside the crop rect + the rect outline + 8 resize handles (crop tool). */
function CropOverlay({ crop, size }: { crop: CropRect; size: Size }): React.JSX.Element {
  const { w: W, h: H } = size;
  const x = crop.x * W;
  const y = crop.y * H;
  const w = crop.w * W;
  const h = crop.h * H;
  return (
    <g>
      {/* four dim rects around the crop window */}
      <rect className={styles.cropDim} x={0} y={0} width={W} height={y} />
      <rect className={styles.cropDim} x={0} y={y + h} width={W} height={Math.max(0, H - (y + h))} />
      <rect className={styles.cropDim} x={0} y={y} width={x} height={h} />
      <rect className={styles.cropDim} x={x + w} y={y} width={Math.max(0, W - (x + w))} height={h} />
      <rect className={styles.cropRect} x={x} y={y} width={w} height={h} />
      {cropHandles(crop, size).map((hd) => (
        <rect
          key={hd.id}
          className={styles.handle}
          x={hd.x * W - HANDLE_PX / 2}
          y={hd.y * H - HANDLE_PX / 2}
          width={HANDLE_PX}
          height={HANDLE_PX}
          rx={2}
          style={{ cursor: handleCursor(hd.id) }}
        />
      ))}
    </g>
  );
}
```

Import `handleCursor` is already imported (from `./handles`). Ensure `CropRect` is imported
in this file (from `./scene`).

Also set the layer cursor to `crosshair` for the crop tool (it already is for any non-select
tool — verify the existing `style={{ cursor: tools.tool === "select" ? "default" : "crosshair" }}`
covers crop; it does).

- [ ] **Step 7: Add the crop overlay CSS**

Append to `annotation-layer.module.css`:

```css
.cropDim {
  fill: rgba(0, 0, 0, 0.5);
}

.cropRect {
  fill: none;
  stroke: var(--accent-primary);
  stroke-width: 1.5;
}
```

- [ ] **Step 8: Typecheck + run the annotations suite**

Run: `cd apps/kaipu-record && bun run typecheck && bunx vitest run src/renderer/src/features/screenshots/annotations`
Expected: PASS (no new unit tests here; the pointer path isn't unit-tested — pure geometry
is covered in Tasks 2/5).

- [ ] **Step 9: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.tsx \
        apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-layer.module.css
git commit --no-verify -m "feat(screenshots): crop-tool interaction (dim overlay, rect, handles)"
```

---

## Task 8: Options panel — crop hint + Reset

**Files:**
- Modify: `annotations/annotation-options.tsx`
- Modify: `annotations/annotation-options.module.css`
- Test: `annotations/annotation-options.test.tsx`

- [ ] **Step 1: Write the failing test** (append)

```ts
it("shows a reset control for the crop tool and clears the crop on click", () => {
  const scene = makeScene([], null);
  scene.crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  scene.setCrop = vi.fn();
  render(<AnnotationOptions tools={makeTools({ tool: "crop" })} scene={scene} />);
  fireEvent.click(screen.getByRole("button", { name: "Reset crop" }));
  expect(scene.setCrop).toHaveBeenCalledWith(undefined);
});
```

Add `crop` + `setCrop` to the `makeScene` mock's returned object (crop: `undefined`,
`setCrop: vi.fn()`, `setCropLive: vi.fn()`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/annotation-options.test.tsx`
Expected: FAIL — no "Reset crop" button.

- [ ] **Step 3: Implement**

In `annotation-options.tsx`, change the early return to also keep the panel for the crop
tool, and add a crop branch. Update the guard:

```ts
  const isCrop = tools.tool === "crop";
  if (!controls && !selected && !isCrop) return null;
```

Add, inside the panel `<div>`, before the delete branch:

```tsx
      {isCrop && (
        <>
          <span className={styles.label}>Recorte</span>
          <button
            type="button"
            aria-label="Reset crop"
            title="Volver a la imagen completa"
            className={styles.reset}
            onClick={() => scene.setCrop(undefined)}
          >
            Restablecer
          </button>
        </>
      )}
```

- [ ] **Step 4: Add the reset button CSS** (append to `annotation-options.module.css`)

```css
.reset {
  height: 30px;
  padding: 0 var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-modal);
  color: var(--text-primary);
  cursor: pointer;
  font-size: var(--font-size-xs);
}

.reset:hover {
  border-color: var(--accent-primary);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run src/renderer/src/features/screenshots/annotations/annotation-options.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-options.tsx \
        apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-options.module.css \
        apps/kaipu-record/src/renderer/src/features/screenshots/annotations/annotation-options.test.tsx
git commit --no-verify -m "feat(screenshots): crop options panel with a reset control"
```

---

## Task 9: Wire the editor page

Pass `crop` to the frame (windowed only when the crop tool is inactive) and include `crop`
in the export scene.

**Files:**
- Modify: `pages/screenshot-editor/screenshot-editor-page.tsx`

- [ ] **Step 1: Include crop in the export scene**

Change `exportPng`'s scene object:

```ts
    compositeScene(
      { beautify: scene.beautify.state, annotations: scene.annotations, crop: scene.crop },
      await image.getBytes(),
      imgRef.current?.clientWidth ?? 0,
    );
```

- [ ] **Step 2: Pass crop to the frame (windowed only when not cropping)**

Find the `<BeautifiedFrame ... overlay={<AnnotationLayer ... />} />` usage and add:

```tsx
              crop={tools.tool === "crop" ? undefined : scene.crop}
```

(While the crop tool is active the frame shows the full image so the user can adjust; when
they leave the tool it windows to `scene.crop`.)

- [ ] **Step 3: Typecheck + full suite**

Run: `cd apps/kaipu-record && bun run typecheck && bunx vitest run`
Expected: PASS (all suites green).

- [ ] **Step 4: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/kaipu-record/src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx
git commit --no-verify -m "feat(screenshots): wire crop into the editor preview + export"
```

---

## Task 10: Docs

**Files:**
- Modify: `apps/documentation/src/content/docs/backlog/screenshot-crop.md`
- Modify: `apps/documentation/src/content/docs/backlog/index.mdx`

- [ ] **Step 1: Flip the crop backlog doc status**

Change the status banner at the top of `screenshot-crop.md` from `🔵 Proposed` to:

```md
> **Status: 🟢 Built locally** (on `feat/screenshot-crop`). A Crop tool in the editor:
> drag a rectangle (reposition by dragging the interior, resize with 8 handles), leave
> the tool to see the windowed result. Non-destructive (`scene.crop`), undoable, exports
> at native pixels. Aspect-ratio locks remain a follow-up. See the design spec:
> [2026-06-30 screenshot crop design](../specs/2026-06-30-screenshot-crop-design).
```

- [ ] **Step 2: Update the backlog index row**

In `index.mdx`, change the crop row status:

```md
| Editor — crop tool (quedarse con una sección)                | Editor    | 🟢 En local (`feat/screenshot-crop`)         | Medio      | [Ver](./screenshot-crop)           |
```

- [ ] **Step 3: Commit**

```bash
cd /Users/cristiansotomayor/Documents/Workspace/Personal/Niway/kaipu-record-monorepo
bun run format:tracked >/dev/null
git add apps/documentation/src/content/docs/backlog/screenshot-crop.md \
        apps/documentation/src/content/docs/backlog/index.mdx
git commit --no-verify -m "docs(backlog): mark the screenshot crop tool as built locally"
```

---

## Final verification (before review / PR)

- [ ] `cd apps/kaipu-record && bun run typecheck` → clean.
- [ ] `cd apps/kaipu-record && bunx vitest run` → all green.
- [ ] From repo root: `bunx oxlint apps/kaipu-record/src/renderer/src/features/screenshots` → 0 errors.
- [ ] `bun run format:tracked` produced no further diff (already committed).
- [ ] Manual, in the running app:
  - Draw a crop rect, drag its interior to reposition, resize via handles → leave the tool
    → the frame windows to the crop with padding around it; annotations stay aligned.
  - Re-activate crop → the rect reappears at the applied crop for re-adjustment.
  - Esc / Restablecer → back to full image.
  - Undo/redo steps through crop changes.
  - Copy + Save export the cropped region at native pixels (no upscale, crisp).
  - Crop + a blur box: the blur stays clipped to the crop window in the export.
  - Crop + zoom: the windowed frame zooms correctly.
- [ ] High-effort code review (`/code-review`), fix findings, then squash PR to `main`.
```
