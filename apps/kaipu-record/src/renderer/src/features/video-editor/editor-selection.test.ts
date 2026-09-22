import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEditorSelection } from "./editor-selection";

describe("useEditorSelection", () => {
  it("selecting one kind clears the others", () => {
    const { result } = renderHook(() => useEditorSelection());
    act(() => result.current.select("overlay", "o1"));
    expect(result.current.overlayId).toBe("o1");
    act(() => result.current.select("zoom", "z1"));
    expect(result.current.overlayId).toBeNull();
    expect(result.current.zoomId).toBe("z1");
  });
  it("select(kind, null) only clears that kind", () => {
    const { result } = renderHook(() => useEditorSelection());
    act(() => result.current.select("zoom", "z1"));
    act(() => result.current.select("overlay", null));
    expect(result.current.zoomId).toBe("z1");
    act(() => result.current.select("zoom", null));
    expect(result.current.selection).toBeNull();
  });
});
