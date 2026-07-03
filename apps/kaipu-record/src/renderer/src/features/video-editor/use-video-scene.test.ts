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

  it("undo/redo/commit no-op while an interact is in progress (mid-drag ⌘Z guard)", () => {
    const { result } = renderHook(() => useVideoScene(initialScene(10)));
    const base = result.current.scene;
    act(() => result.current.beginInteract());
    act(() => result.current.updateLive({ ...base, items: [] }));
    // A stray undo/redo/commit while the drag is still open must not touch history —
    // the live value stays and no undo step exists yet.
    act(() => result.current.undo());
    act(() => result.current.redo());
    act(() => result.current.commit({ ...base, items: [] }));
    expect(result.current.scene.items).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    // Ending the drag collapses it into exactly one undo step, restoring the
    // pre-drag scene on undo.
    act(() => result.current.endInteract());
    expect(result.current.canUndo).toBe(true);
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
