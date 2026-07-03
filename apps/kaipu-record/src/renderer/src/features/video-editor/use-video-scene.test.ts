import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialScene } from "./scene";
import { useVideoScene } from "./use-video-scene";

describe("useVideoScene", () => {
  it("commit creates one undo step; undo/redo walk history", () => {
    const { result } = renderHook(() => useVideoScene(initialScene(10)));
    const first = result.current.scene;
    act(() => result.current.commit({ ...first, overlays: [] }));
    // committing an identical reference is a no-op
    act(() => result.current.commit(result.current.scene));
    act(() => result.current.commit({ ...result.current.scene, items: first.items.slice(0, 0) }));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.scene.items).toHaveLength(1);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.scene.items).toHaveLength(0);
  });

  it("a drag (begin/updateLive/end) collapses into a single undo step", () => {
    const { result } = renderHook(() => useVideoScene(initialScene(10)));
    const base = result.current.scene;
    act(() => result.current.beginInteract());
    act(() => result.current.updateLive({ ...base, overlays: [] }));
    act(() => result.current.updateLive({ ...base, items: [] }));
    act(() => result.current.endInteract());
    expect(result.current.scene.items).toHaveLength(0);
    act(() => result.current.undo());
    expect(result.current.scene).toBe(base);
    expect(result.current.canUndo).toBe(false);
  });

  it("undo/redo/commit no-op while an interact is in progress (mid-drag ⌘Z guard), and a completed drag produces exactly one history entry", () => {
    const { result } = renderHook(() => useVideoScene(initialScene(10)));
    const base = result.current.scene;

    // Seed a real, undo-able commit before the drag starts — the guard must protect
    // this pre-existing history, not just an empty stack.
    act(() => result.current.commit({ ...base, overlays: [] }));
    const preDrag = result.current.scene;
    expect(result.current.canUndo).toBe(true);

    expect(result.current.interacting).toBe(false);
    act(() => result.current.beginInteract());
    expect(result.current.interacting).toBe(true);

    // A stray undo mid-drag must be a total no-op: scene AND canUndo stay exactly as
    // they were before the drag — the drag's own snapshot is still pending.
    act(() => result.current.undo());
    expect(result.current.scene).toBe(preDrag);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.scene).toBe(preDrag);
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.commit({ ...preDrag, items: [] }));
    expect(result.current.scene).toBe(preDrag);

    act(() => result.current.updateLive({ ...preDrag, items: [] }));
    act(() => result.current.endInteract());
    expect(result.current.interacting).toBe(false);
    expect(result.current.scene.items).toHaveLength(0);

    // The drag collapsed into exactly one new undo step on top of the earlier commit:
    // one undo restores pre-drag, a second restores the original scene, a third is a
    // no-op (nothing left to undo).
    act(() => result.current.undo());
    expect(result.current.scene).toBe(preDrag);
    act(() => result.current.undo());
    expect(result.current.scene).toBe(base);
    expect(result.current.canUndo).toBe(false);
  });

  it("tracks dirty", () => {
    const { result } = renderHook(() => useVideoScene(initialScene(10)));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.commit({ ...result.current.scene, items: [] }));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.undo());
    expect(result.current.dirty).toBe(false);
  });
});
