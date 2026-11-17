import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEditorScene } from "./use-editor-scene";
import type { BoxAnnotation, ImageAnnotation } from "./scene";

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

  it("a resize of an added image is one undoable change", () => {
    const image: ImageAnnotation = {
      id: "i1",
      kind: "image",
      assetId: "img-aaaaaaaaaaaa",
      x: 0.5,
      y: 0.25,
      w: 0.4,
      h: 0.3,
      pixelWidth: 40,
      pixelHeight: 30,
    };
    const { result } = renderHook(() => useEditorScene());
    act(() => result.current.addAnnotation(image));
    act(() => result.current.commitAnnotation("i1", { w: 0.2, h: 0.15 }));
    expect(result.current.annotations[0]).toMatchObject({ w: 0.2, h: 0.15, pixelWidth: 40 });

    act(() => result.current.undo());
    expect(result.current.annotations[0]).toMatchObject({ w: 0.4, h: 0.3, pixelHeight: 30 });
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

  it("setCrop commits an undoable crop change", () => {
    const { result } = renderHook(() => useEditorScene());
    act(() => result.current.setCrop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }));
    expect(result.current.crop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.crop).toBeUndefined();
  });

  it("setExportFrame commits one undoable change and leaves the crop alone", () => {
    const { result } = renderHook(() => useEditorScene());
    act(() => result.current.setExportFrame({ x: -0.2, y: -0.1, w: 1.5, h: 1.3 }));
    expect(result.current.exportFrame).toEqual({ x: -0.2, y: -0.1, w: 1.5, h: 1.3 });
    expect(result.current.crop).toBeUndefined();
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.exportFrame).toBeUndefined();
    act(() => result.current.redo());
    expect(result.current.exportFrame).toEqual({ x: -0.2, y: -0.1, w: 1.5, h: 1.3 });
  });

  it("setExportFrame(undefined) clears the frame as one undoable change", () => {
    const { result } = renderHook(() => useEditorScene());
    act(() => result.current.setExportFrame({ x: 0, y: 0, w: 2, h: 2 }));
    act(() => result.current.setExportFrame(undefined));
    expect(result.current.exportFrame).toBeUndefined();
    act(() => result.current.undo());
    expect(result.current.exportFrame).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it("undo and redo do nothing while an interaction is open", () => {
    const { result } = renderHook(() => useEditorScene());
    act(() => result.current.addAnnotation(box));
    act(() => result.current.beginInteract());
    let acted = true;
    act(() => {
      acted = result.current.undo();
    });
    expect(acted).toBe(false);
    expect(result.current.annotations).toHaveLength(1);
    act(() => result.current.endInteract());
    act(() => result.current.undo());
    expect(result.current.annotations).toHaveLength(0);
    act(() => result.current.beginInteract());
    act(() => result.current.redo());
    expect(result.current.annotations).toHaveLength(0);
    act(() => result.current.endInteract());
    act(() => result.current.redo());
    expect(result.current.annotations).toHaveLength(1);
  });
});
