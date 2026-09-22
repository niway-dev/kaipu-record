import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { initialScene } from "../scene";
import { toLayout } from "../timeline";
import { useVideoScene } from "../use-video-scene";
import { useRedactionEditing } from "./use-redaction-editing";

const RECT = { x: 0.1, y: 0.1, w: 0.3, h: 0.1 };

function setup() {
  return renderHook(() => {
    const controller = useVideoScene(initialScene(20));
    const redactions = useRedactionEditing({
      controller,
      layout: toLayout(controller.scene.items),
      sourceDuration: 20,
    });
    return { controller, redactions };
  });
}

describe("useRedactionEditing", () => {
  it("adds a 5 s region at the playhead as one undo step", () => {
    const { result } = setup();
    act(() => {
      result.current.redactions.add("blur", RECT, 3);
    });
    expect(result.current.controller.scene.redactions[0]).toMatchObject({
      kind: "blur",
      start: 3,
      end: 8,
    });
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.redactions).toEqual([]);
  });

  it("near the end the window still has the minimum length", () => {
    const { result } = setup();
    expect(result.current.redactions.windowAt(19.8)).toEqual({ start: 19, end: 20 });
  });

  it("refuses slivers", () => {
    const { result } = setup();
    let r: ReturnType<typeof result.current.redactions.add> | undefined;
    act(() => {
      r = result.current.redactions.add("cover", { x: 0, y: 0, w: 0.001, h: 0.5 }, 1);
    });
    expect(r).toEqual({ ok: false, reason: "too-small" });
  });

  it("an intensity drag is one undo step and never goes below 40", () => {
    const { result } = setup();
    act(() => {
      result.current.redactions.add("blur", RECT, 1);
    });
    const id = result.current.controller.scene.redactions[0].id;
    act(() => result.current.redactions.begin());
    act(() => result.current.redactions.livePatch(id, { intensity: 10 }));
    act(() => result.current.redactions.end());
    expect(result.current.controller.scene.redactions[0]).toMatchObject({ intensity: 40 });
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.redactions[0]).toMatchObject({ intensity: 70 });
  });
});
