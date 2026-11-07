import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { initialScene } from "./scene";
import { useBackgroundEditing } from "./use-background-editing";
import { useVideoScene } from "./use-video-scene";

function setup() {
  return renderHook(() => {
    const controller = useVideoScene(initialScene(10));
    const edits = useBackgroundEditing(controller);
    return { controller, edits };
  });
}

describe("useBackgroundEditing", () => {
  it("starts with no background", () => {
    const { result } = setup();
    expect(result.current.edits.background).toEqual({
      bg: "none",
      padding: 0,
      radius: 0,
      shadow: 0,
    });
    expect(result.current.controller.canUndo).toBe(false);
  });

  it("choosing a preset is one undo step", () => {
    const { result } = setup();
    act(() => result.current.edits.choose("magenta"));
    expect(result.current.edits.background.bg).toBe("magenta");
    expect(result.current.controller.canUndo).toBe(true);
    act(() => result.current.controller.undo());
    expect(result.current.edits.background.bg).toBe("none");
    expect(result.current.controller.canUndo).toBe(false);
    act(() => result.current.controller.redo());
    expect(result.current.edits.background.bg).toBe("magenta");
  });

  it("choosing the preset that is already chosen records nothing", () => {
    const { result } = setup();
    act(() => result.current.edits.choose("magenta"));
    act(() => result.current.controller.markClean());
    act(() => result.current.edits.choose("magenta"));
    expect(result.current.controller.canUndo).toBe(false);
  });

  it("a slider drag is ONE undo step, however many values it passes through", () => {
    const { result } = setup();
    act(() => result.current.edits.choose("magenta"));
    act(() => result.current.edits.begin());
    act(() => result.current.edits.live({ padding: 10 }));
    act(() => result.current.edits.live({ padding: 30 }));
    act(() => result.current.edits.live({ padding: 48 }));
    act(() => result.current.edits.end());
    expect(result.current.edits.background.padding).toBe(48);
    act(() => result.current.controller.undo());
    // Back to just before the drag: the preset stays, the padding is the value before it.
    expect(result.current.edits.background).toEqual({
      bg: "magenta",
      padding: 0,
      radius: 0,
      shadow: 0,
    });
    act(() => result.current.controller.undo());
    expect(result.current.edits.background.bg).toBe("none");
  });

  it("a drag that wanders and returns is still at most one step, like every other slider", () => {
    // The scene history compares by reference (`endInteract`), so a drag back to the start
    // value leaves one no-op step rather than none; what matters is that it is never several.
    const { result } = setup();
    act(() => result.current.edits.begin());
    act(() => result.current.edits.live({ padding: 40 }));
    act(() => result.current.edits.live({ padding: 0 }));
    act(() => result.current.edits.end());
    expect(result.current.edits.background.padding).toBe(0);
    act(() => result.current.controller.undo());
    expect(result.current.controller.canUndo).toBe(false);
  });

  it("a keyboard step is a discrete commit, one step each", () => {
    const { result } = setup();
    act(() => result.current.edits.choose("ocean"));
    act(() => result.current.edits.commit({ radius: 1 }));
    act(() => result.current.edits.commit({ radius: 2 }));
    expect(result.current.edits.background.radius).toBe(2);
    act(() => result.current.controller.undo());
    expect(result.current.edits.background.radius).toBe(1);
  });

  it("ignores a commit while another drag owns the scene", () => {
    const { result } = setup();
    act(() => result.current.controller.beginInteract());
    act(() => result.current.edits.commit({ padding: 50 }));
    act(() => result.current.controller.endInteract());
    expect(result.current.edits.background.padding).toBe(0);
  });
});
