import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEditorScene } from "./use-editor-scene";
import type { BoxAnnotation } from "./scene";

const box: BoxAnnotation = {
  id: "b1",
  kind: "box",
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  color: "#f00",
  stroke: 1,
  seed: 1,
};

const colorOf = (a: { kind: string }): string => (a as BoxAnnotation).color;

describe("useEditorScene", () => {
  it("adds annotations with undo/redo history", () => {
    const { result } = renderHook(() => useEditorScene());
    expect(result.current.annotations).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.addAnnotation(box));
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => result.current.undo());
    expect(result.current.annotations).toHaveLength(0);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.annotations).toHaveLength(1);
  });

  it("commitAnnotation edits an annotation as one undoable change", () => {
    const { result } = renderHook(() => useEditorScene());
    act(() => result.current.addAnnotation(box));
    act(() => result.current.commitAnnotation("b1", { color: "#0f0" }));
    expect(colorOf(result.current.annotations[0])).toBe("#0f0");

    act(() => result.current.undo());
    expect(colorOf(result.current.annotations[0])).toBe("#f00");
  });

  it("a fresh add clears the redo stack", () => {
    const { result } = renderHook(() => useEditorScene());
    act(() => result.current.addAnnotation(box));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.addAnnotation({ ...box, id: "b2" }));
    expect(result.current.canRedo).toBe(false); // the old redo branch is discarded
  });

  it("removeSelected deletes the selected annotation", () => {
    const { result } = renderHook(() => useEditorScene());
    act(() => result.current.addAnnotation(box));
    act(() => result.current.select("b1"));
    act(() => result.current.removeSelected());
    expect(result.current.annotations).toHaveLength(0);
  });

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
});
