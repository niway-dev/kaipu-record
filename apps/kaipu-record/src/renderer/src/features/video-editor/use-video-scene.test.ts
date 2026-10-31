import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialScene } from "./scene";
import { useVideoScene } from "./use-video-scene";
import {
  addWebcamSegment,
  removeWebcamSegment,
  setWebcamLayout,
  updateWebcamSegment,
} from "./webcam/webcam-edits";

const WEBCAM_TRACK = {
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
} as const;

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

  it("markClean resets dirty/undo/redo without touching the current scene", () => {
    const { result } = renderHook(() => useVideoScene(initialScene(10)));
    act(() => result.current.commit({ ...result.current.scene, items: [] }));
    const afterCommit = result.current.scene;
    expect(result.current.dirty).toBe(true);

    act(() => result.current.markClean());
    expect(result.current.scene).toBe(afterCommit);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    // Undo has nothing left to walk back to — the scene stays exactly as it was.
    act(() => result.current.undo());
    expect(result.current.scene).toBe(afterCommit);
  });
});

describe("useVideoScene — webcam edits", () => {
  const open = () => renderHook(() => useVideoScene(initialScene(60, WEBCAM_TRACK)));

  it("undoes and redoes layout, add, update and remove as one step each", () => {
    const { result } = open();
    const seeded = result.current.scene;

    act(() => result.current.commit(setWebcamLayout(result.current.scene, { shape: "rounded" })));
    const afterLayout = result.current.scene;
    let id: string | null = null;
    act(() => {
      const added = addWebcamSegment(
        result.current.scene,
        { start: 10, end: 20, mode: "override", layout: { size: 0.4 } },
        60,
      );
      id = added.id;
      result.current.commit(added.scene);
    });
    act(() =>
      result.current.commit(updateWebcamSegment(result.current.scene, id!, { mode: "hidden" })),
    );
    act(() => result.current.commit(removeWebcamSegment(result.current.scene, id!)));
    expect(result.current.scene.webcam?.segments).toEqual([]);

    act(() => result.current.undo()); // the removal
    expect(result.current.scene.webcam?.segments[0]).toMatchObject({ id, mode: "hidden" });
    act(() => result.current.undo()); // the update
    expect(result.current.scene.webcam?.segments[0]).toMatchObject({ id, mode: "override" });
    act(() => result.current.undo()); // the add
    expect(result.current.scene).toBe(afterLayout);
    act(() => result.current.undo()); // the layout
    expect(result.current.scene).toBe(seeded);
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.redo());
    expect(result.current.scene.webcam?.layout.shape).toBe("rounded");
  });

  it("a no-op webcam edit pushes no history entry and does not make the editor dirty", () => {
    const { result } = open();
    act(() => result.current.commit(setWebcamLayout(result.current.scene, { mirrored: true })));
    act(() => result.current.commit(setWebcamLayout(result.current.scene, {})));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it("dragging the bubble collapses into one undo step", () => {
    const { result } = open();
    const base = result.current.scene;
    act(() => result.current.beginInteract());
    for (const x of [0.2, 0.4, 0.6]) {
      act(() =>
        result.current.updateLive(
          setWebcamLayout(result.current.scene, { position: { x, y: 0.5 } }),
        ),
      );
    }
    act(() => result.current.endInteract());
    expect(result.current.scene.webcam?.layout.position).toEqual({ x: 0.6, y: 0.5 });
    act(() => result.current.undo());
    expect(result.current.scene).toBe(base);
    expect(result.current.canUndo).toBe(false);
  });
});
