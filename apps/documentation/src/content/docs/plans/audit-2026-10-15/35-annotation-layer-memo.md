---
title: "35 · Annotation layer memo"
description: "Closes SHOT-A10 and SHOT-B5: every pointermove during a move/resize/crop drag re-renders the whole screenshot editor page, and clearing a re-edited label then clicking another shape deletes the other shape."
---

# Annotation layer memo — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clearing a label and clicking another shape deletes the label, never the other shape; a move/resize/crop drag renders only the layer, commits once on release, and creates one undo entry.

**Architecture:** **B5 first, independently:** `removeSelected` reads `selectedId` from a stale render closure, so the blur-after-pointerdown sequence (clear label A → mousedown on box B selects B and starts a drag → blur commits "" → `select(A)` queued → `removeSelected()` with `selectedId = B`) deletes B. Fix: an id-targeted `removeAnnotation(id)` in `use-editor-scene.ts` (`removeSelected` delegates to it) and `commitText` uses `editing.id` (captured at edit start) without the two `scene.select(editing.id)` calls that steal the user's newer selection. **A10:** during a move/resize drag the layer keeps `{ id, patch }` in local state (plus a ref) and renders the dragged annotation as `{ ...a, ...patch }`; nothing touches the scene until pointerup → one `commitAnnotation` (one history entry, one page render); `Shape` becomes `React.memo`, and `AnnotationLayer` is memoized with a comparator so beautify-slider drags skip it. Crop gets the same local-state pattern (lowest value, optional). Rejected: writing geometry into the DOM by ref (duplicates `Shape`'s five derivations and drifts) and a ResizeObserver-driven rect cache (zoom is `transform: scale`, pan is scroll — neither fires ResizeObserver, so the cache would misplace shapes; a rect cache taken on pointerdown only is the most to do).

**Tech Stack:** React local state + `React.memo`, vitest + RTL (`annotation-layer.test.tsx`'s mocked `EditorScene` and `renderSizedLayer`).

**Spec:** [Audit report](/audits/2026-10-15/report/) → SHOT-A10 in [screenshot lens A](/audits/2026-10-15/findings/screenshot-a/), SHOT-B5 in [screenshot lens B](/audits/2026-10-15/findings/screenshot-b/). Closes: **SHOT-A10, SHOT-B5**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/features/screenshots/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- Both `makeScene` mocks (`annotation-layer.test.tsx:24-47`, `annotation-options.test.tsx:23-45`) must gain `removeAnnotation: vi.fn()` or the type check fails.
- Behaviour changes to state in the PR: (1) clearing a label then clicking blank canvas now deletes the label (consistent with Enter; before it silently kept the old text); (2) the options panel's "custom text size" highlight updates on release instead of live during a corner drag; (3) mid-drag, `scene.annotations` holds the pre-drag geometry (the page's dirty effect fires once per commit instead of per move — an improvement).
- The B5 regression test must wait one `requestAnimationFrame` before `fireEvent.blur` (blur-to-commit only arms after that frame).
- `scene.updateAnnotation` loses its last production caller after Task 2; delete it from the interface and both mocks.
- If a new prop is ever added to `AnnotationLayer`, `sameLayerProps` must include it — leave a comment.
- Plan 05 rewrites the page's export handlers; this plan only touches `annotations/` and `beautify/crop-overlay.tsx`. No conflict.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Clear label A, pointerdown on box B, rAF, blur → `removeAnnotation("A")`, `removeSelected` never called — Task 1 test (the B5 regression).
2. `removeAnnotation(b1)` with `b2` selected leaves `b2` selected; an unknown id adds no history entry — Task 1 tests.
3. Down on a box, move, up → one `commitAnnotation` with the final geometry; `beginInteract`/`updateAnnotation` never called; down + up with no move → no commit — Task 2 tests.
4. The dragged `<g transform>` changes in the DOM before any commit — Task 2 test.
5. Zoom 200 % + pan, then draw/move → shapes land under the cursor (guards against a stale-rect trap) — manual step.

---

### Task 1: SHOT-B5 — id-targeted delete

**Files:**

- Modify: `annotations/use-editor-scene.ts:6-31` (interface), `:121-128` (`removeSelected`), return object
- Modify: `annotations/annotation-layer.tsx:309-343` (`commitText`)
- Test: `annotations/use-editor-scene.test.ts`, `annotations/annotation-layer.test.tsx`, `annotations/annotation-options.test.tsx` (mock only)

**Interfaces:**

- Produces: `EditorScene.removeAnnotation(id: string): void`.

- [ ] **Step 1: Write the failing tests**

`use-editor-scene.test.ts`:

```ts
it("removeAnnotation deletes by id and leaves another selection alone", () => {
  const { result } = renderHook(() => useEditorScene());
  act(() => result.current.addAnnotation({ ...box, id: "b1" }));
  act(() => result.current.addAnnotation({ ...box, id: "b2" }));
  act(() => result.current.select("b2"));
  act(() => result.current.removeAnnotation("b1"));
  expect(result.current.annotations.map((a) => a.id)).toEqual(["b2"]);
  expect(result.current.selectedId).toBe("b2");
  expect(result.current.canUndo).toBe(true);
});
it("removeAnnotation clears the selection only when it removes the selected one", () => {
  const { result } = renderHook(() => useEditorScene());
  act(() => result.current.addAnnotation(box));
  act(() => result.current.select(box.id));
  act(() => result.current.removeAnnotation(box.id));
  expect(result.current.selectedId).toBeNull();
});
it("removeAnnotation ignores an unknown id", () => {
  const { result } = renderHook(() => useEditorScene());
  act(() => result.current.removeAnnotation("nope"));
  expect(result.current.canUndo).toBe(false);
});
```

`annotation-layer.test.tsx` — change "clearing the text while re-editing deletes the label" to expect `scene.removeAnnotation` `toHaveBeenCalledWith("t1")` and `removeSelected` not called; add:

```tsx
it("clearing a label and then grabbing another shape deletes the label, not the shape (SHOT-B5)", async () => {
  const scene = makeScene([label, farBox], "t1");
  const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
  fireEvent.doubleClick(layer, { clientX: 30, clientY: 30 });
  const input = screen.getByDisplayValue("Hello");
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.pointerDown(layer, { clientX: 80, clientY: 80 }); // the far box
  await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
  fireEvent.blur(input);
  expect(scene.removeAnnotation).toHaveBeenCalledWith("t1");
  expect(scene.removeSelected).not.toHaveBeenCalled();
});
```

(Define `farBox` at `{ x: 0.7, y: 0.7, w: 0.2, h: 0.2 }` so the pointerdown hits it with the 100×100 rect.) Add `removeAnnotation: vi.fn()` to both `makeScene` mocks.

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/screenshots/annotations` → `removeAnnotation` missing; the B5 test sees `removeSelected`.

- [ ] **Step 3: Implement**

`use-editor-scene.ts` interface:

```ts
  /** Delete one annotation by id as a single undoable change (selection is not consulted). */
  removeAnnotation(id: string): void;
  removeSelected(): void;
```

Hook (replacing `removeSelected`):

```ts
  const removeAnnotation = useCallback(
    (id: string) => {
      if (!sceneRef.current.annotations.some((a) => a.id === id)) return;
      commit({ ...sceneRef.current, annotations: sceneRef.current.annotations.filter((a) => a.id !== id) });
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [commit],
  );
  const removeSelected = useCallback(() => {
    if (selectedId) removeAnnotation(selectedId);
  }, [selectedId, removeAnnotation]);
```

Add `removeAnnotation,` to the returned object. `annotation-layer.tsx` `commitText` re-edit branch:

```tsx
    if (editing?.id) {
      // The id was captured when the edit started; selection is NOT consulted, because
      // the blur that commits this can land after the user already selected another shape.
      if (text) scene.commitAnnotation(editing.id, { text });
      else scene.removeAnnotation(editing.id);
      setEditing(null);
      return;
    }
```

- [ ] **Step 4: Run and commit** — PASS.

```bash
git add src/renderer/src/features/screenshots/annotations
git commit -m "fix(desktop): clearing a re-edited label deletes that label, never the shape clicked next"
```

### Task 2: Move/resize drags stay local until release (A10)

**Files:**

- Modify: `annotations/annotation-layer.tsx:43` (export), `:54-84` (state), `:163-190` (pointerdown), `:217-229` (pointermove), `:278-307` (up/abort), render `:350-376`, `Shape` `:462`
- Modify: `annotations/use-editor-scene.ts` (delete `updateAnnotation`), both mocks
- Test: `annotations/annotation-layer.test.tsx`

**Interfaces:**

- Produces: `AnnotationLayer` = `React.memo(AnnotationLayerImpl, sameLayerProps)`; `interface LayerProps { scene: EditorScene; tools: AnnotationToolsController; src: string }`.

- [ ] **Step 1: Rewrite the live-path tests and add new ones**

Replace the three tests that assert on `updateAnnotation` (hidden-handle, editor-ring, "another shape can be grabbed") with assertions on `commitAnnotation` after `pointerUp`, and add:

```tsx
it("commits a move once on release with the final geometry", () => {
  const scene = makeScene([box], "b1"); // box at 0.1,0.1 w/h 0.3
  const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
  fireEvent.pointerDown(layer, { clientX: 20, clientY: 20 });
  fireEvent.pointerMove(layer, { clientX: 30, clientY: 30 });
  fireEvent.pointerMove(layer, { clientX: 30, clientY: 30 });
  expect(scene.commitAnnotation).not.toHaveBeenCalled();
  fireEvent.pointerUp(layer);
  expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
  expect(scene.commitAnnotation).toHaveBeenCalledWith("b1", expect.objectContaining({ x: expect.closeTo(0.2, 5), y: expect.closeTo(0.2, 5) }));
  expect(scene.beginInteract).not.toHaveBeenCalled();
});
it("a click without movement commits nothing", () => {
  const scene = makeScene([box], "b1");
  const { layer } = renderSizedLayer(scene, makeTools({ tool: "select" }));
  fireEvent.pointerDown(layer, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(layer);
  expect(scene.commitAnnotation).not.toHaveBeenCalled();
});
it("the dragged shape moves in the DOM before commit", () => {
  const scene = makeScene([box], "b1");
  const { layer, container } = renderSizedLayer(scene, makeTools({ tool: "select" }));
  const before = container.querySelector("g[data-annotation='b1']")?.getAttribute("transform");
  fireEvent.pointerDown(layer, { clientX: 20, clientY: 20 });
  fireEvent.pointerMove(layer, { clientX: 40, clientY: 40 });
  expect(container.querySelector("g[data-annotation='b1']")?.getAttribute("transform")).not.toBe(before);
  expect(scene.commitAnnotation).not.toHaveBeenCalled();
});
```

(Use whatever attribute `Shape` renders to identify the group; add `data-annotation={a.id}` if none exists.)

- [ ] **Step 2: Run to verify they fail** — `updateAnnotation` is called per move; no DOM move before commit.

- [ ] **Step 3: Implement**

Next to `draft`:

```tsx
  const [live, setLive] = useState<{ id: string; patch: Partial<Annotation> } | null>(null);
  const liveRef = useRef<{ id: string; patch: Partial<Annotation> } | null>(null);
  const setLiveBoth = (next: { id: string; patch: Partial<Annotation> } | null): void => {
    liveRef.current = next;
    setLive(next);
  };
  // Shown geometry: stored annotations with the dragged one overridden. Unchanged
  // annotations keep their object identity, which is what lets Shape memoize.
  const shown = useMemo(
    () => (live ? scene.annotations.map((a) => (a.id === live.id ? ({ ...a, ...live.patch } as Annotation) : a)) : scene.annotations),
    [scene.annotations, live],
  );
```

Delete both `scene.beginInteract();` calls in `onPointerDown`. `onPointerMove` move/resize branches: `setLiveBoth({ id: d.id, patch: moveBy(d.orig, p.x - d.start.x, p.y - d.start.y) })` and `setLiveBoth({ id: d.id, patch: resizeAnnotation(d.orig, d.handle, p, size) })`. `onPointerUp` first branch:

```tsx
    if (d.mode === "move" || d.mode === "resize") {
      const l = liveRef.current;
      setLiveBoth(null);
      if (l) scene.commitAnnotation(l.id, l.patch); // one history entry, one page render
      return;
    }
```

`onPointerAbort`: same commit for move/resize (an aborted drag keeps what was shown, as one entry). Render: map over `shown`, and compute `selectedAnnotation` from `shown` so the handles follow the drag; hit-testing keeps using `scene.annotations`. `Shape` → `const Shape = React.memo(function Shape({ … }) { … });`. Export:

```tsx
interface LayerProps { scene: EditorScene; tools: AnnotationToolsController; src: string }

// Add every new prop here too, or the layer stops seeing it change.
function sameLayerProps(p: LayerProps, n: LayerProps): boolean {
  return (
    p.src === n.src &&
    p.scene.annotations === n.scene.annotations &&
    p.scene.selectedId === n.scene.selectedId &&
    p.scene.removeSelected === n.scene.removeSelected &&
    p.tools.tool === n.tools.tool && p.tools.color === n.tools.color &&
    p.tools.stroke === n.tools.stroke && p.tools.textSize === n.tools.textSize
  );
}
export const AnnotationLayer = React.memo(AnnotationLayerImpl, sameLayerProps);
```

(`select`, `addAnnotation`, `commitAnnotation`, `removeAnnotation` are `useCallback([])`-stable or setters; `setTool` is a `useState` setter.) Delete `updateAnnotation` from the interface, the hook and both mocks. Optional rect cache: in `onPointerDown` store `rectRef.current = ref.current.getBoundingClientRect()` and let `toNorm` read it while `drag.current` is set; nothing more.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/screenshots && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/screenshots/annotations
git commit -m "perf(desktop): annotation drags render only the layer and commit once on release"
```

### Task 3: Crop drag (optional, same pattern)

**Files:**

- Modify: `beautify/crop-overlay.tsx:52`, `:86-149`
- Create: `beautify/crop-overlay.test.tsx` (imitate `renderSizedLayer`)
- Modify: `annotations/use-editor-scene.ts` (delete `setCropLive`), `use-editor-scene.test.ts:75-87`

- [ ] **Step 1: Tests** — a drag draws → `setCrop` called once on up with the rect; a click without move → not called; a full-frame result → `setCrop(undefined)`.
- [ ] **Step 2: Implement** — `const [liveCrop, setLiveCrop] = useState<CropRect | undefined>()` + `liveCropRef`; `const cropRect = liveCrop ?? scene.crop ?? FULL_CROP;`; drop `scene.beginInteract()` in `onPointerDown`; move handlers call `setLiveCrop(...)` with the same math; `onPointerUp`/abort: `const c = liveCropRef.current; liveCropRef.current = undefined; setLiveCrop(undefined); if (!c) return; if (!sameCrop(c, scene.crop)) scene.setCrop(isFullCrop(c) ? undefined : c);`; the Esc handler also clears the live crop. Delete `setCropLive` (now unused) and replace its hook test with a `setCrop` equivalent. `BeautifiedFrame` already receives `crop={undefined}` while the crop tool is active, so the page never re-renders during a crop drag.
- [ ] **Step 3: Run and commit** — `node_modules/.bin/vitest run src/renderer/src/features/screenshots && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/screenshots
git commit -m "perf(desktop): crop drags stay local until release"
```

### Task 4: Measure and ship

- [ ] **Measure** (React DevTools Profiler, dev app): with 50 annotations including 5 blur boxes, drag/resize a shape → `ScreenshotEditor` shows no commits during the drag, one at release; ⌘Z reverts the whole drag in one step. Same for a crop drag. Zoom to 200 %, pan, then draw/move → positions land under the cursor.
- [ ] Open a PR titled `fix(desktop): label delete targets the right shape; annotation drags no longer re-render the page (audit SHOT-A10, SHOT-B5)` linking this plan and both findings; state the three behaviour changes. End with **How to test it yourself**:
  1. Add a text label and a box. Double-click the label, delete all its text, click the box → the label disappears, the box stays and is selected; ⌘Z restores the label in one undo.
  2. Drag and resize shapes with many annotations → smooth; one undo step per drag.
  3. Drag a beautify slider → the frame updates live (unchanged).
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
