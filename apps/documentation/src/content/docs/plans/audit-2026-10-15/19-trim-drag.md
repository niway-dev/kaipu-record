---
title: "19 · Trim drag"
description: "Closes VID-B1, VID-B2, VID-B7, VID-B8: the start-edge trim drag runs away from the pointer, trims have no bounds, drags have no cancel handling, and clampOverlays on every live frame permanently truncates annotations."
---

# Trim drag — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clip's trim handle follows the pointer, stops at the source's bounds and at neighbouring clips' footage, ends its interaction exactly once even when the pointer is cancelled, and never permanently shortens annotations during a drag.

**Architecture:** In `timeline-strip.tsx` every drag (trim edges, slide duration) freezes its baseline on pointerdown **in pixels** — `orig`, `x0 = clientX`, `secPerPx` — and computes `orig + (clientX − x0) × secPerPx`. A timeline-time baseline is not enough because `timeFromPointer` uses the live `duration`, which the trim itself changes (that is also the VID-B2 runaway). `onPointerCancel`/`onLostPointerCapture` report "end" once (the `zoom-lane.tsx` contract: release capture first, then a null-ref guard). `trimClip` takes an optional `sourceDuration` and clamps to the nearest non-overlapping neighbour clip in source (order-independent; clips that already overlap from old sessions are ignored so they are never trapped). The page clamps overlays from the overlays captured at drag start, so shorten-then-lengthen gives them back. `overlay-lane.tsx` gets the same abort handlers.

**Tech Stack:** React pointer events with capture, vitest + RTL (`timeline-strip.test.tsx` stubs `setPointerCapture`/`hasPointerCapture`/`releasePointerCapture` and mocks the track rect on `handle.parentElement`).

**Spec:** [Audit report](/audits/2026-10-15/report/) → VID-B1, B2, B7, B8 in [video lens B](/audits/2026-10-15/findings/video-b/). Closes: **VID-B1, VID-B2, VID-B7, VID-B8**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- Do not derive `secondsPerPixel` from `timeFromPointer(x+1) − timeFromPointer(x)`: it is clamped to the track, so at the right edge it gives 0 and the drag dies. Use an explicit getter from the track rect.
- `trimClip`'s 5th parameter is optional (`timeline.test.ts` calls it with four).
- The page ignores the value on phase "end" (`endInteract()` only), so a drag may send its last known value on abort.
- Behaviour changes to state in the PR: trims stop at a neighbour's footage and at the source length (intended); the handle may drift a little from the pointer when the timeline rescales mid-drag (accepted).
- Not fixed, flagged: a handle that **unmounts** mid-drag (selection change) still leaves `interacting` stuck; same gap as zoom-lane.
- `clampOverlays` at `video-editor-page.tsx:552` (`handleDeleteSelected`, a single commit) stays as is.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Start handle: after a re-render with `sourceStart` already moved (what the page does after the first move), two moves to the same `clientX` report the same value — Task 2 test (the VID-B1 regression; fails today).
2. End handle ignores timeline growth during the drag — Task 2 test.
3. `pointercancel` + `lostpointercapture` + `pointerup` after one drag → exactly one "end" — Task 2 test.
4. `trimClip` stops at the previous clip's `sourceEnd` / next clip's `sourceStart`, independent of item order, and ignores clips that already overlap — Task 1 tests.
5. Shorten-then-lengthen in one drag restores annotations — manual step (page-level `handleTrim` has no test harness).

---

### Task 1: Bounded `trimClip`

**Files:**

- Modify: `features/video-editor/timeline.ts:109-124`
- Test: `features/video-editor/timeline.test.ts`

**Interfaces:**

- Produces: `trimClip(items, itemId, edge, sourceTime, sourceDuration = Infinity)`.

- [ ] **Step 1: Write the failing tests** (extend `describe("trimClip")`, using the suite's `clip(id, s, e)`)

```ts
it("clamps the end edge to the source duration", () => {
  expect(trimClip([clip("a", 0, 30)], "a", "end", 90, 60)[0]).toMatchObject({ sourceEnd: 60 });
});
it("start edge stops at the previous clip's end in source, or reclaims a deleted gap", () => {
  expect(trimClip([clip("a", 0, 10), clip("b", 10, 20)], "b", "start", 4)[1]).toMatchObject({ sourceStart: 10 });
  expect(trimClip([clip("a", 0, 5), clip("b", 10, 20)], "b", "start", 4)[1]).toMatchObject({ sourceStart: 5 });
});
it("end edge stops at the next clip's start", () => {
  expect(trimClip([clip("a", 0, 10), clip("b", 10, 20)], "a", "end", 15)[0]).toMatchObject({ sourceEnd: 10 });
  expect(trimClip([clip("a", 0, 5), clip("b", 10, 20)], "a", "end", 15)[0]).toMatchObject({ sourceEnd: 10 });
});
it("bounds do not depend on item order", () => {
  expect(trimClip([clip("b", 10, 20), clip("a", 0, 10)], "b", "start", 0)[0]).toMatchObject({ sourceStart: 10 });
});
it("ignores clips that already overlap (legacy sessions)", () => {
  expect(trimClip([clip("a", 0, 15), clip("b", 10, 20)], "b", "start", 2)[1]).toMatchObject({ sourceStart: 2 });
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/video-editor/timeline.test.ts` → the first four FAIL.

- [ ] **Step 3: Implement**

```ts
export function trimClip(
  items: TrackItem[],
  itemId: string,
  edge: "start" | "end",
  sourceTime: number,
  /** Length of the source recording; the end edge never goes past it. */
  sourceDuration: number = Infinity,
): TrackItem[] {
  return items.map((item) => {
    if (item.id !== itemId || item.kind !== "clip") return item;
    // Order-independent neighbour bounds: a cut leaves other clips' source ranges
    // disjoint, so the dragged edge stops at the nearest other clip lying wholly on that
    // side (a deleted gap can be reclaimed, another clip's footage cannot). Clips that
    // ALREADY overlap this one (legacy/persisted state) are ignored so it is never trapped.
    let lower = 0;
    let upper = sourceDuration;
    for (const other of items) {
      if (other.id === itemId || other.kind !== "clip") continue;
      if (other.sourceEnd <= item.sourceStart) lower = Math.max(lower, other.sourceEnd);
      if (other.sourceStart >= item.sourceEnd) upper = Math.min(upper, other.sourceStart);
    }
    if (edge === "start") {
      const next = Math.min(Math.max(lower, sourceTime), item.sourceEnd - MIN_ITEM_DURATION);
      return { ...item, sourceStart: next };
    }
    const next = Math.min(Math.max(sourceTime, item.sourceStart + MIN_ITEM_DURATION), upper);
    return { ...item, sourceEnd: next };
  });
}
```

- [ ] **Step 4: Run and commit** — PASS, existing test unchanged.

```bash
git add src/renderer/src/features/video-editor/timeline.ts src/renderer/src/features/video-editor/timeline.test.ts
git commit -m "fix(desktop): clip trims stop at the source length and at neighbouring clips"
```

### Task 2: Frozen pixel baseline and abort handlers in the strip

**Files:**

- Modify: `features/video-editor/components/timeline-strip.tsx:108-112` (add `secondsPerPixel`), `:193-206` (`TrackBlock` props), `:240-265`, `:282-340` (drag handlers)
- Test: `features/video-editor/components/timeline-strip.test.tsx`

**Interfaces:**

- Produces: `TrackBlock` prop `secondsPerPixel: () => number` (replaces `timeFromPointer`).

- [ ] **Step 1: Write the failing tests** (new `describe("TimelineStrip trim drag baseline and abort")`; render `twoClipLayout`, `selectedItemId="a"`, `makePlayback({ duration: 10 })`; `const handle = container.querySelector('[data-trim-handle="start"]') as HTMLElement`; stub `setPointerCapture`, `hasPointerCapture = () => true`, `releasePointerCapture` on the handle; mock the rect on `handle.parentElement` with width 1000 → 0.01 s/px)

```tsx
it("start handle: edge = original + pixel delta, unaffected by live re-renders (VID-B1)", () => {
  const onTrim = vi.fn();
  const { container, rerender } = render(<TimelineStrip {...props(twoClipLayout, onTrim)} />);
  const handle = stubHandle(container, '[data-trim-handle="start"]');
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
  // The page applies the first move: a.sourceStart becomes 1 and the block re-renders.
  rerender(<TimelineStrip {...props(withSourceStart(twoClipLayout, "a", 1), onTrim)} />);
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 });
  const moves = onTrim.mock.calls.filter((c) => c[3] === "move");
  expect(moves).toEqual([["a", "start", 1, "move"], ["a", "start", 1, "move"]]);
});

it("end handle ignores timeline growth during the drag", () => {
  const onTrim = vi.fn();
  const { container, rerender } = render(<TimelineStrip {...props(twoClipLayout, onTrim)} />);
  const handle = stubHandle(container, '[data-trim-handle="end"]');
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 }); // orig 5
  rerender(<TimelineStrip {...props(longerLayout /* a: 0-8, duration 13 */, onTrim)} />);
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
  expect(onTrim).toHaveBeenLastCalledWith("a", "end", 6, "move");
});

it("pointer cancel ends the drag exactly once", () => {
  const onTrim = vi.fn();
  const { container } = render(<TimelineStrip {...props(twoClipLayout, onTrim)} />);
  const handle = stubHandle(container, '[data-trim-handle="start"]');
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
  fireEvent.pointerCancel(handle, { pointerId: 1 });
  fireEvent.lostPointerCapture(handle, { pointerId: 1 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 });
  expect(onTrim.mock.calls.filter((c) => c[3] === "end")).toHaveLength(1);
});

it("slide handle: duration = original + delta, and lost capture ends it once", () => {
  const onSlideDuration = vi.fn();
  const { container } = render(<TimelineStrip {...props(slideThenClipLayout, vi.fn(), { selectedItemId: "s1", onSlideDuration })} />);
  const handle = stubHandle(container, "[data-slide-handle]");
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 300 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 });
  expect(onSlideDuration).toHaveBeenLastCalledWith("s1", 4, "move");
  fireEvent.lostPointerCapture(handle, { pointerId: 1 });
  expect(onSlideDuration.mock.calls.filter((c) => c[2] === "end")).toHaveLength(1);
});

it("a move with no prior pointerdown is ignored", () => {
  const onTrim = vi.fn();
  const { container } = render(<TimelineStrip {...props(twoClipLayout, onTrim)} />);
  const handle = stubHandle(container, '[data-trim-handle="start"]');
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 });
  expect(onTrim).not.toHaveBeenCalled();
});
```

Write the small helpers `props(layout, onTrim, overrides?)`, `stubHandle(container, selector)` (stubs capture APIs and mocks `getBoundingClientRect` on `handle.parentElement` to `{ left: 0, width: 1000, … }`), `withSourceStart(layout, id, value)` and `longerLayout` next to the existing fixtures.

- [ ] **Step 2: Run to verify they fail** — the first FAILS (second move reports 2), the cancel test reports 0 or 2 "end"s.

- [ ] **Step 3: Implement**

In `TimelineStrip`, after `timeFromPointer`:

```tsx
  // Seconds per CSS pixel of the track right now. Drags freeze it on pointerdown: a trim
  // changes `duration`, so the live pixel->time mapping moves under the pointer.
  const secondsPerPixel = useCallback((): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? duration / rect.width : 0;
  }, [duration]);
```

Pass `secondsPerPixel={secondsPerPixel}` to `<TrackBlock>`; add `secondsPerPixel: () => number;` to its props and drop its `timeFromPointer` prop (delete the now-unused callback in `TimelineStrip` if nothing else uses it; `timeFromPointerOnElement` still serves the ruler and track). Replace lines 282-340 (delete `sourceTimeFromPointer`) with:

```tsx
  // A drag freezes its baseline on pointerdown (same idea as overlay-lane's bodyOrigin):
  // `orig` is the dragged value then, x0 the pointer x, secPerPx the track scale. Moves
  // are `orig + (clientX - x0) * secPerPx`, never derived from the live entry, so a
  // start trim (which changes entry.sourceStart every frame) cannot feed back.
  const trimDrag = useRef<{ edge: "start" | "end"; orig: number; x0: number; secPerPx: number; last: number } | null>(null);

  const trimHandlers = (edge: "start" | "end"): DragHandlers => {
    // Reports "end" exactly once: pointerup releases capture first, so the
    // lostpointercapture it queues finds the ref already null (zoom-lane.tsx contract).
    const finish = (): void => {
      const drag = trimDrag.current;
      if (!drag) return;
      trimDrag.current = null;
      onTrim?.(entry.itemId, drag.edge, drag.last, "end");
    };
    return {
      onPointerDown: (event) => {
        // Neither scrub the track nor re-select the block underneath.
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const orig = edge === "start" ? entry.sourceStart : entry.sourceEnd;
        trimDrag.current = { edge, orig, x0: event.clientX, secPerPx: secondsPerPixel(), last: orig };
        onTrim?.(entry.itemId, edge, orig, "start");
      },
      onPointerMove: (event) => {
        event.stopPropagation();
        const drag = trimDrag.current;
        if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        drag.last = drag.orig + (event.clientX - drag.x0) * drag.secPerPx;
        onTrim?.(entry.itemId, edge, drag.last, "move");
      },
      onPointerUp: (event) => {
        event.stopPropagation();
        const drag = trimDrag.current;
        if (!drag) return;
        drag.last = drag.orig + (event.clientX - drag.x0) * drag.secPerPx;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        finish();
      },
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    };
  };

  // A slide's right handle sets the hold DURATION: same frozen-baseline contract.
  const slideDrag = useRef<{ orig: number; x0: number; secPerPx: number; last: number } | null>(null);

  const slideDurationHandlers = (): DragHandlers => {
    const finish = (): void => {
      const drag = slideDrag.current;
      if (!drag) return;
      slideDrag.current = null;
      onSlideDuration?.(entry.itemId, drag.last, "end");
    };
    return {
      onPointerDown: (event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const orig = entry.timelineEnd - entry.timelineStart;
        slideDrag.current = { orig, x0: event.clientX, secPerPx: secondsPerPixel(), last: orig };
        onSlideDuration?.(entry.itemId, orig, "start");
      },
      onPointerMove: (event) => {
        event.stopPropagation();
        const drag = slideDrag.current;
        if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        drag.last = drag.orig + (event.clientX - drag.x0) * drag.secPerPx;
        onSlideDuration?.(entry.itemId, drag.last, "move");
      },
      onPointerUp: (event) => {
        event.stopPropagation();
        const drag = slideDrag.current;
        if (!drag) return;
        drag.last = drag.orig + (event.clientX - drag.x0) * drag.secPerPx;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        finish();
      },
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    };
  };
```

At module level: `type DragHandlers = Pick<React.DOMAttributes<HTMLDivElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture">;`. The JSX spreads need no change.

- [ ] **Step 4: Run and commit** — `node_modules/.bin/vitest run src/renderer/src/features/video-editor/components/timeline-strip.test.tsx && bun run check-types` → PASS (the existing slide-lifecycle test still passes: no rect mock → `secPerPx` 0 → value 3, still `expect.any(Number)`).

```bash
git add src/renderer/src/features/video-editor/components/timeline-strip.tsx src/renderer/src/features/video-editor/components/timeline-strip.test.tsx
git commit -m "fix(desktop): trim and slide drags follow the pointer from a frozen baseline and end once"
```

### Task 3: Page clamps overlays from the drag-start snapshot; overlay-lane abort

**Files:**

- Modify: `pages/video-editor/video-editor-page.tsx:833-874` (`handleTrim`, `handleSlideDuration`)
- Modify: `features/video-editor/components/overlay-lane.tsx:92-117`, `:128-160`, `:164-190`
- Test: `features/video-editor/components/overlay-lane.test.tsx`

- [ ] **Step 1: Write the failing overlay-lane test** (reuse its `mockRect`/render helpers)

```tsx
it("pointer cancel / lost capture on a pill body drag and on a resize handle each report end once", () => {
  const onWindowChange = vi.fn();
  const { pill, handle } = renderLane(onWindowChange); // the suite's helper that returns the pill button and a resize handle
  fireEvent.pointerDown(pill, { pointerId: 1, clientX: 100 });
  fireEvent.pointerCancel(pill, { pointerId: 1 });
  fireEvent.lostPointerCapture(pill, { pointerId: 1 });
  expect(onWindowChange.mock.calls.filter((c) => c[3] === "end")).toHaveLength(1);
  onWindowChange.mockClear();
  fireEvent.pointerDown(handle, { pointerId: 2, clientX: 200 });
  fireEvent.lostPointerCapture(handle, { pointerId: 2 });
  fireEvent.pointerUp(handle, { pointerId: 2, clientX: 200 });
  expect(onWindowChange.mock.calls.filter((c) => c[3] === "end")).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

Page — add `const dragOverlaysRef = useRef<VideoOverlay[] | null>(null);` above `handleTrim` (`VideoOverlay` is already referenced by `handleWindowChange`):

```tsx
  const handleTrim = useCallback(
    (itemId: string, edge: "start" | "end", sourceTime: number, phase: "start" | "move" | "end") => {
      if (phase === "start") {
        dragOverlaysRef.current = controller.scene.overlays;
        controller.beginInteract();
      }
      if (phase === "move") {
        const items = trimClip(controller.scene.items, itemId, edge, sourceTime, source.durationSeconds);
        const duration = layoutDuration(toLayout(items));
        controller.updateLive({
          ...controller.scene,
          items,
          // Clamp from the overlays captured at drag start, not the live scene: a drag
          // that shortens then lengthens the timeline must give the windows back.
          overlays: clampOverlays(dragOverlaysRef.current ?? controller.scene.overlays, duration),
        });
      }
      if (phase === "end") {
        dragOverlaysRef.current = null;
        controller.endInteract();
      }
    },
    [controller, source.durationSeconds],
  );
```

`handleSlideDuration` gets the identical treatment (capture in "start", clamp from the ref in "move", null in "end"). One shared ref is fine: only one drag is active at a time.

`overlay-lane.tsx` — in `Pill`:

```tsx
  const abortBody = (): void => {
    if (!bodyOrigin.current) return;
    bodyOrigin.current = null;
    onWindowChange(overlay.id, overlay.start, overlay.end, "end");
  };
  const abortResize = (): void => {
    if (resizeEdge.current === null) return;
    resizeEdge.current = null;
    onWindowChange(overlay.id, overlay.start, overlay.end, "end");
  };
```

`onBodyPointerUp(event)`: `if (!bodyOrigin.current) return; event.currentTarget.releasePointerCapture?.(event.pointerId); abortBody();`. Handle `onPointerUp`: `if (resizeEdge.current === null) return; event.currentTarget.releasePointerCapture?.(event.pointerId); abortResize();`. Wire `onPointerCancel={abortBody} onLostPointerCapture={abortBody}` on the pill `<button>` and `onPointerCancel: abortResize, onLostPointerCapture: abortResize` in `handleHandlers` (extend its return type).

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/video-editor src/renderer/src/pages/video-editor && bun run check-types` → PASS.

```bash
git add src/renderer/src/pages/video-editor/video-editor-page.tsx src/renderer/src/features/video-editor/components/overlay-lane.tsx src/renderer/src/features/video-editor/components/overlay-lane.test.tsx
git commit -m "fix(desktop): overlays clamp from the drag-start snapshot; overlay drags end once on cancel"
```

### Task 4: Ship

- [ ] Open a PR titled `fix(desktop): trim handles track the pointer, respect bounds and end once (audit VID-B1/B2/B7/B8)` linking this plan and the findings; state the behaviour changes and the flagged unmount gap. End with **How to test it yourself**:
  1. Open a recording, select the clip, drag the **left** handle right ~50 px slowly → the cut advances smoothly (before: 5 s → 9.7 s → 14 s).
  2. Split at 10 s, drag clip B's left handle left → it stops at the cut. Drag the last clip's right handle far right → it stops at the source length; the timeline does not grow.
  3. Add an annotation near the end; drag the end handle shorter, then back → the annotation returns to full length.
  4. Start a trim drag and press Esc / switch Space mid-drag → the editor is not stuck "interacting" (undo works, the inspector responds).
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
